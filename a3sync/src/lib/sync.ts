import { getPool, sql } from "./infra";
import { A3Cliente, ErrorA3, enParalelo } from "./a3cliente";
import { crearCliente, leerConexion } from "./conexion";
import { normDni, partirNombre, fechaA3, fechaHoraA3, direccionCentro, aplanarOrganigrama } from "./normalizar";
import { conciliar, enAlta, RegistroA3, UsuarioApp, Pendiente, Campos } from "./conciliar";

/* Sincronización a3 → app. Una ejecución:
   1. Empresas de a3 → fich.A3Empresas (crea en la app las nuevas que se importan).
   2. Por empresa importada: centros (+ dirección y contacto de los nuevos), trabajadores (todos o solo los
      modificados desde la última marca), email de los que están en alta y han cambiado, y organigrama.
   3. Conciliación con fich.Usuarios (lib/conciliar.ts) y bandeja fich.A3Pendientes. */

const PARALELO = 8;
const TIPOS_CONCILIACION = ["CENTRO_SIN_SERVICIO", "SIN_EMAIL", "EMAIL_DUPLICADO", "EMAIL_CAMBIADO", "DNI_INVALIDO", "USUARIO_DESACTIVADO"];

export interface Estadisticas {
  llamadas: number;
  empresas: number;
  centros: number;
  empleadosLeidos: number;
  usuariosCreados: number;
  usuariosActualizados: number;
  usuariosDesactivados: number;
  pendientes: number;
  errores: string[];
}

type Log = (m: string) => void;

const hoyMadrid = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid" }).format(new Date());
const restarDias = (f: string, d: number) => new Date(Date.parse(f + "T00:00:00Z") - d * 86400000).toISOString().slice(0, 10);

/* Alcance de la sincronización (variable A3_ALCANCE de la Function App), para la carga progresiva:
   - EMPRESAS (por defecto): solo la lista de empresas de a3 → fich.A3Empresas. 1 llamada.
   - CENTROS: además, los centros de las empresas importadas → fich.A3Centros. Sin trabajadores.
   - TODO: empresas, centros, trabajadores, organigrama y conciliación con los usuarios.
   A3_EMPRESAS (opcional): códigos a3 separados por comas para limitar el paso 2 (p. ej. "355"). */
export type Alcance = "EMPRESAS" | "CENTROS" | "TODO";
export function alcanceConfigurado(v = process.env.A3_ALCANCE): Alcance {
  const a = String(v ?? "").trim().toUpperCase();
  return a === "CENTROS" || a === "TODO" ? a : "EMPRESAS";
}
export function empresasLimitadas(v = process.env.A3_EMPRESAS): Set<number> | null {
  const l = String(v ?? "").split(",").map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x > 0);
  return l.length ? new Set(l) : null;
}

export async function sincronizar(completaPedida: boolean, log: Log): Promise<Estadisticas> {
  const est: Estadisticas = { llamadas: 0, empresas: 0, centros: 0, empleadosLeidos: 0, usuariosCreados: 0, usuariosActualizados: 0, usuariosDesactivados: 0, pendientes: 0, errores: [] };
  const hoy = hoyMadrid();
  const con = await leerConexion();
  const completa = completaPedida || !con.marcaEmpleados;
  const alcance = alcanceConfigurado();
  const limite = empresasLimitadas();
  log(`Alcance ${alcance}${limite ? `, empresas ${[...limite].join(",")}` : ""}`);
  const cli = await crearCliente();
  const pool = await getPool();

  // 1. Empresas
  const empresasA3 = (await cli.todas<any>("/api/companies")) ?? [];
  const importadas = (await guardarEmpresas(pool, empresasA3, log)).filter((x) => !limite || limite.has(x.codigoA3));
  est.empresas = empresasA3.length;
  if (alcance === "EMPRESAS") {
    est.llamadas = cli.llamadas;
    return est;
  }

  // 2. Por empresa
  const leidas = new Set<number>();
  for (const cc of importadas.map((x) => x.codigoA3)) {
    try {
      est.centros += await leerCentros(cli, pool, cc, completa);
      if (alcance === "CENTROS") continue;
      est.empleadosLeidos += await leerEmpleados(cli, pool, cc, completa, con.marcaEmpleados, hoy, log);
      leidas.add(cc);
      await leerOrganigrama(cli, pool, cc).catch((e) => log(`Organigrama ${cc}: ${e?.message ?? e}`));
    } catch (e: any) {
      const m = `Empresa ${cc}: ${e?.message ?? e}`;
      est.errores.push(m);
      log(m);
      if (e?.name === "ConexionNoDisponible") throw e;
    }
  }

  if (alcance === "CENTROS") {
    est.llamadas = cli.llamadas;
    return est;
  }

  // 3. Conciliación
  await aplicarConciliacion(pool, hoy, leidas, est, log);

  if (!est.errores.length) {
    await pool
      .request()
      .input("m", sql.Date, restarDias(hoy, 1))
      .query("UPDATE fich.A3Conexion SET MarcaEmpleados = @m, UltimaSyncOkUtc = SYSUTCDATETIME() WHERE Id = 1");
  }
  est.llamadas = cli.llamadas;
  return est;
}

/* ---------- 1. Empresas ---------- */
async function guardarEmpresas(pool: sql.ConnectionPool, lista: any[], log: Log) {
  for (const c of lista) {
    const codigo = Number(c.companyCode);
    if (!codigo) continue;
    await pool
      .request()
      .input("c", sql.Int, codigo)
      .input("n", sql.NVarChar(150), String(c.companyName ?? "").trim().slice(0, 150) || `Empresa ${codigo}`)
      .input("cif", sql.VarChar(15), String(c.identifierNumber ?? "").trim().slice(0, 15) || null)
      .input("lu", sql.DateTime2, fechaHoraA3(c.lastUpdate))
      .query(
        `MERGE fich.A3Empresas AS t USING (SELECT @c AS CodigoA3) AS s ON t.CodigoA3 = s.CodigoA3
         WHEN MATCHED THEN UPDATE SET Nombre = @n, CIF = @cif, LastUpdateA3 = @lu, ActualizadoUtc = SYSUTCDATETIME()
         WHEN NOT MATCHED THEN INSERT (CodigoA3, Nombre, CIF, LastUpdateA3, Importar) VALUES (@c, @n, @cif, @lu, 0);`
      );
  }
  // Empresas que se importan y aún no existen en la app: se crean (si ya hay una con ese nombre, se enlaza)
  const nuevas = await pool.request().query("SELECT CodigoA3, Nombre FROM fich.A3Empresas WHERE Importar = 1 AND EmpresaId IS NULL");
  for (const e of nuevas.recordset) {
    const nombre = String(e.Nombre).slice(0, 100);
    const r = await pool
      .request()
      .input("n", sql.NVarChar(100), nombre)
      .input("c", sql.Int, e.CodigoA3)
      .query(
        `DECLARE @id INT = (SELECT EmpresaId FROM fich.Empresas WHERE LOWER(Nombre) = LOWER(@n)
                             AND EmpresaId NOT IN (SELECT EmpresaId FROM fich.A3Empresas WHERE EmpresaId IS NOT NULL));
         IF @id IS NULL BEGIN INSERT INTO fich.Empresas (Nombre) VALUES (@n); SET @id = SCOPE_IDENTITY(); END
         UPDATE fich.A3Empresas SET EmpresaId = @id WHERE CodigoA3 = @c;
         SELECT @id AS id;`
      );
    await auditar(pool, "A3_EMPRESA", "Empresa", r.recordset[0].id, `a3 ${e.CodigoA3} → ${nombre}`);
    log(`Empresa a3 ${e.CodigoA3} enlazada con la empresa ${r.recordset[0].id}`);
  }
  const r = await pool.request().query("SELECT CodigoA3, EmpresaId FROM fich.A3Empresas WHERE Importar = 1 AND EmpresaId IS NOT NULL ORDER BY CodigoA3");
  return r.recordset.map((x: any) => ({ codigoA3: x.CodigoA3 as number, empresaId: x.EmpresaId as number }));
}

/* ---------- 2a. Centros ---------- */
async function leerCentros(cli: A3Cliente, pool: sql.ConnectionPool, cc: number, completa: boolean): Promise<number> {
  const lista = await cli.todas<any>(`/api/companies/${cc}/workplaces`);
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const t = new sql.Table("#centros");
    t.create = true;
    t.columns.add("CentroA3", sql.Int, { nullable: false });
    t.columns.add("IdA3", sql.UniqueIdentifier, { nullable: true });
    t.columns.add("Nombre", sql.NVarChar(150), { nullable: false });
    for (const w of lista) t.rows.add(Number(w.workplaceCode), w.companyworkplaceId ?? null, String(w.workplaceName ?? "").trim().slice(0, 150) || `Centro ${w.workplaceCode}`);
    await new sql.Request(tx).bulk(t);
    await new sql.Request(tx).input("e", sql.Int, cc).query(
      `MERGE fich.A3Centros AS d USING #centros AS s ON d.EmpresaA3 = @e AND d.CentroA3 = s.CentroA3
       WHEN MATCHED THEN UPDATE SET IdA3 = s.IdA3, Nombre = s.Nombre, Activo = 1, ActualizadoUtc = SYSUTCDATETIME()
       WHEN NOT MATCHED BY TARGET THEN INSERT (EmpresaA3, CentroA3, IdA3, Nombre) VALUES (@e, s.CentroA3, s.IdA3, s.Nombre);
       UPDATE fich.A3Centros SET Activo = 0, ActualizadoUtc = SYSUTCDATETIME()
        WHERE EmpresaA3 = @e AND Activo = 1 AND CentroA3 NOT IN (SELECT CentroA3 FROM #centros);
       DROP TABLE #centros;`
    );
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }

  // Dirección y contacto: de los nuevos (o de todos en la sincronización completa)
  const sinDetalle = await pool
    .request()
    .input("e", sql.Int, cc)
    .input("todos", sql.Bit, completa)
    .query("SELECT CentroA3 FROM fich.A3Centros WHERE EmpresaA3 = @e AND Activo = 1 AND (@todos = 1 OR DetalleLeidoUtc IS NULL)");
  await enParalelo(sinDetalle.recordset.map((x: any) => x.CentroA3 as number), PARALELO / 2, async (wc) => {
    const dir = await cli.get<any>(`/api/companies/${cc}/workplaces/${wc}/contactdata/address`);
    const con = await cli.get<any>(`/api/companies/${cc}/workplaces/${wc}/datacontact`);
    const a = Array.isArray(dir) ? dir[0] : dir;
    const c = Array.isArray(con) ? con[0] : con;
    await pool
      .request()
      .input("e", sql.Int, cc)
      .input("c", sql.Int, wc)
      .input("dir", sql.NVarChar(200), direccionCentro(a))
      .input("cp", sql.VarChar(10), String(a?.postalCode ?? "").trim().slice(0, 10) || null)
      .input("ciu", sql.NVarChar(100), String(a?.city || a?.region || "").trim().slice(0, 100) || null)
      .input("pro", sql.NVarChar(100), String(a?.region ?? "").trim().slice(0, 100) || null)
      .input("tel", sql.VarChar(30), String(c?.phonenumber1 ?? "").trim().slice(0, 30) || null)
      .query(
        `UPDATE fich.A3Centros SET Direccion = @dir, CodigoPostal = @cp, Ciudad = @ciu, Provincia = @pro, Telefono = @tel,
                DetalleLeidoUtc = SYSUTCDATETIME() WHERE EmpresaA3 = @e AND CentroA3 = @c`
      );
  });
  return lista.length;
}

/* ---------- 2b. Trabajadores ---------- */
async function leerEmpleados(cli: A3Cliente, pool: sql.ConnectionPool, cc: number, completa: boolean, marca: string | null, hoy: string, log: Log): Promise<number> {
  const ruta = `/api/companies/${cc}/employees`;
  let lista: any[];
  if (!completa && marca) {
    try {
      lista = await cli.todas<any>(ruta, { filter: `lastUpdate gt ${marca}` });
    } catch (e) {
      if (!(e instanceof ErrorA3) || e.status !== 400) throw e;
      log(`Empresa ${cc}: el filtro por lastUpdate no se admite; se lee el listado completo`);
      lista = await cli.todas<any>(ruta);
    }
  } else {
    lista = await cli.todas<any>(ruta);
  }

  const previos = new Map<string, { lu: number | null; contacto: boolean }>();
  const p = await pool.request().input("e", sql.Int, cc).query("SELECT EmpleadoA3, LastUpdateA3, ContactoLeidoUtc FROM fich.A3Empleados WHERE EmpresaA3 = @e");
  for (const x of p.recordset) previos.set(String(x.EmpleadoA3).trim(), { lu: x.LastUpdateA3 ? new Date(x.LastUpdateA3).getTime() : null, contacto: !!x.ContactoLeidoUtc });

  const filas = lista
    .filter((x) => x?.employeeCode && x?.identifierNumber)
    .map((x) => {
      const { nombre, apellidos } = partirNombre(x.completeName);
      const lu = fechaHoraA3(x.lastUpdate);
      return {
        cod: String(x.employeeCode).trim().slice(0, 6),
        idA3: x.employeeId ?? null,
        dni: normDni(x.identifierNumber),
        nombre,
        apellidos,
        centro: Number(x.workplaceCode) || 0,
        alta: fechaA3(x.enrolmentDate),
        baja: fechaA3(x.dropDate),
        lu,
        prof: undefined as string | null | undefined,
        pers: undefined as string | null | undefined,
      };
    });

  // Email: solo de los que están en alta y son nuevos, han cambiado o en la completa
  const pedirContacto = filas.filter((f) => {
    if (!enAlta({ fechaBaja: f.baja }, hoy)) return false;
    const prev = previos.get(f.cod);
    return completa || !prev || !prev.contacto || prev.lu !== (f.lu ? f.lu.getTime() : null);
  });
  log(`Empresa ${cc}: ${filas.length} trabajadores leídos; ${pedirContacto.length} emails a consultar`);
  await enParalelo(pedirContacto, PARALELO, async (f) => {
    const base = `/api/companies/${cc}/employees/${encodeURIComponent(f.cod)}/contactdata`;
    const [pr, pe] = await Promise.all([cli.get<any>(`${base}/professional`), cli.get<any>(`${base}/personal`)]);
    const a = Array.isArray(pr) ? pr[0] : pr;
    const b = Array.isArray(pe) ? pe[0] : pe;
    f.prof = a?.professionalemail ? String(a.professionalemail).trim().slice(0, 254) : null;
    f.pers = b?.personalemail ? String(b.personalemail).trim().slice(0, 254) : null;
  });

  if (!filas.length) return 0;
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const t = new sql.Table("#emp");
    t.create = true;
    t.columns.add("EmpleadoA3", sql.Char(6), { nullable: false });
    t.columns.add("IdA3", sql.UniqueIdentifier, { nullable: true });
    t.columns.add("DNI", sql.VarChar(12), { nullable: false });
    t.columns.add("Apellidos", sql.NVarChar(150), { nullable: false });
    t.columns.add("Nombre", sql.NVarChar(100), { nullable: false });
    t.columns.add("CentroA3", sql.Int, { nullable: false });
    t.columns.add("FechaAlta", sql.Date, { nullable: true });
    t.columns.add("FechaBaja", sql.Date, { nullable: true });
    t.columns.add("LastUpdateA3", sql.DateTime2(3), { nullable: true });
    t.columns.add("Contacto", sql.Bit, { nullable: false });
    t.columns.add("EmailProfesional", sql.NVarChar(254), { nullable: true });
    t.columns.add("EmailPersonal", sql.NVarChar(254), { nullable: true });
    for (const f of filas)
      t.rows.add(f.cod, f.idA3, f.dni, f.apellidos, f.nombre, f.centro, f.alta, f.baja, f.lu, f.prof !== undefined, f.prof ?? null, f.pers ?? null);
    await new sql.Request(tx).bulk(t);
    await new sql.Request(tx).input("e", sql.Int, cc).query(
      `MERGE fich.A3Empleados AS d USING #emp AS s ON d.EmpresaA3 = @e AND d.EmpleadoA3 = s.EmpleadoA3
       WHEN MATCHED THEN UPDATE SET IdA3 = s.IdA3, DNI = s.DNI, Apellidos = s.Apellidos, Nombre = s.Nombre, CentroA3 = s.CentroA3,
            FechaAlta = s.FechaAlta, FechaBaja = s.FechaBaja, LastUpdateA3 = s.LastUpdateA3, ActualizadoUtc = SYSUTCDATETIME(),
            EmailProfesional = CASE WHEN s.Contacto = 1 THEN s.EmailProfesional ELSE d.EmailProfesional END,
            EmailPersonal    = CASE WHEN s.Contacto = 1 THEN s.EmailPersonal    ELSE d.EmailPersonal END,
            ContactoLeidoUtc = CASE WHEN s.Contacto = 1 THEN SYSUTCDATETIME() ELSE d.ContactoLeidoUtc END
       WHEN NOT MATCHED BY TARGET THEN INSERT (EmpresaA3, EmpleadoA3, IdA3, DNI, Apellidos, Nombre, CentroA3, FechaAlta, FechaBaja, LastUpdateA3,
            EmailProfesional, EmailPersonal, ContactoLeidoUtc)
         VALUES (@e, s.EmpleadoA3, s.IdA3, s.DNI, s.Apellidos, s.Nombre, s.CentroA3, s.FechaAlta, s.FechaBaja, s.LastUpdateA3,
            s.EmailProfesional, s.EmailPersonal, CASE WHEN s.Contacto = 1 THEN SYSUTCDATETIME() END);
       DROP TABLE #emp;`
    );
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
  return filas.length;
}

/* ---------- 2c. Organigrama ---------- */
async function leerOrganigrama(cli: A3Cliente, pool: sql.ConnectionPool, cc: number) {
  const raiz = await cli.get<any>(`/api/companies/${cc}/organigram`);
  if (!raiz) return;
  const nodos = aplanarOrganigrama(raiz, cc);
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    await new sql.Request(tx).input("e", sql.Int, cc).query("DELETE FROM fich.A3Organigrama WHERE EmpresaA3 = @e");
    for (const n of nodos) {
      await new sql.Request(tx)
        .input("id", sql.UniqueIdentifier, n.nodoId)
        .input("p", sql.UniqueIdentifier, n.padreNodoId)
        .input("e", sql.Int, cc)
        .input("u", sql.UniqueIdentifier, n.unidadId)
        .input("t", sql.NVarChar(100), n.tipo?.slice(0, 100) ?? null)
        .input("c", sql.NVarChar(50), n.codigo?.slice(0, 50) ?? null)
        .input("n", sql.NVarChar(200), n.nombre?.slice(0, 200) ?? null)
        .input("d", sql.NVarChar(400), n.descripcion?.slice(0, 400) ?? null)
        .input("rc", sql.NVarChar(20), n.responsableCodigo?.slice(0, 20) ?? null)
        .input("rd", sql.VarChar(12), n.responsableDNI)
        .input("rn", sql.NVarChar(200), n.responsableNombre?.slice(0, 200) ?? null)
        .input("fa", sql.Date, n.fechaAlta)
        .input("fb", sql.Date, n.fechaBaja)
        .input("o", sql.Int, n.orden)
        .query(
          `IF NOT EXISTS (SELECT 1 FROM fich.A3Organigrama WHERE NodoId = @id)
           INSERT INTO fich.A3Organigrama (NodoId, PadreNodoId, EmpresaA3, UnidadId, Tipo, Codigo, Nombre, Descripcion,
                  ResponsableCodigo, ResponsableDNI, ResponsableNombre, FechaAlta, FechaBaja, Orden)
           VALUES (@id, @p, @e, @u, @t, @c, @n, @d, @rc, @rd, @rn, @fa, @fb, @o)`
        );
    }
    await tx.commit();
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}

/* ---------- 3. Conciliación y pendientes ---------- */
const COLUMNA: Record<keyof Campos, { col: string; tipo: any }> = {
  nombre: { col: "Nombre", tipo: sql.NVarChar(100) },
  apellidos: { col: "Apellidos", tipo: sql.NVarChar(150) },
  empresaId: { col: "EmpresaId", tipo: sql.Int },
  centroId: { col: "CentroId", tipo: sql.Int },
  tipoPerfil: { col: "TipoPerfil", tipo: sql.VarChar(12) },
  activo: { col: "Activo", tipo: sql.Bit },
  dni: { col: "DNI", tipo: sql.VarChar(12) },
  empresaA3: { col: "EmpresaA3", tipo: sql.Int },
  empleadoA3: { col: "EmpleadoA3", tipo: sql.Char(6) },
  idA3: { col: "IdA3", tipo: sql.UniqueIdentifier },
  fechaAltaA3: { col: "FechaAltaA3", tipo: sql.Date },
  fechaBajaA3: { col: "FechaBajaA3", tipo: sql.Date },
  desactivadoPorA3: { col: "DesactivadoPorA3", tipo: sql.Bit },
};

async function aplicarConciliacion(pool: sql.ConnectionPool, hoy: string, leidas: Set<number>, est: Estadisticas, log: Log) {
  const [reg, emp, cen, estr, usu] = await Promise.all([
    pool.request().query(
      `SELECT e.EmpresaA3, e.EmpleadoA3, e.IdA3, e.DNI, e.Nombre, e.Apellidos, e.CentroA3,
              CONVERT(char(10), e.FechaAlta, 23) AS FechaAlta, CONVERT(char(10), e.FechaBaja, 23) AS FechaBaja, e.EmailProfesional, e.EmailPersonal
         FROM fich.A3Empleados e JOIN fich.A3Empresas a ON a.CodigoA3 = e.EmpresaA3 AND a.Importar = 1`
    ),
    pool.request().query("SELECT CodigoA3, EmpresaId FROM fich.A3Empresas WHERE Importar = 1 AND EmpresaId IS NOT NULL"),
    pool.request().query("SELECT EmpresaA3, CentroA3, CentroId, Nombre FROM fich.A3Centros"),
    pool.request().query("SELECT CentroId FROM fich.Centros WHERE EsEstructura = 1"),
    pool.request().query(
      `SELECT UsuarioId, Email, Nombre, Apellidos, EmpresaId, CentroId, TipoPerfil, Activo, DNI, EmpresaA3, EmpleadoA3, IdA3,
              CONVERT(char(10), FechaAltaA3, 23) AS FechaAltaA3, CONVERT(char(10), FechaBajaA3, 23) AS FechaBajaA3, OrigenA3, DesactivadoPorA3
         FROM fich.Usuarios`
    ),
  ]);
  const registros: RegistroA3[] = reg.recordset.map((x: any) => ({
    empresaA3: x.EmpresaA3, empleadoA3: String(x.EmpleadoA3).trim(), idA3: x.IdA3 ? String(x.IdA3).toLowerCase() : null, dni: x.DNI,
    nombre: x.Nombre, apellidos: x.Apellidos, centroA3: x.CentroA3, fechaAlta: x.FechaAlta?.trim() || null, fechaBaja: x.FechaBaja?.trim() || null,
    emailProfesional: x.EmailProfesional, emailPersonal: x.EmailPersonal,
  }));
  const usuarios: UsuarioApp[] = usu.recordset.map((x: any) => ({
    id: x.UsuarioId, email: x.Email, nombre: x.Nombre, apellidos: x.Apellidos, empresaId: x.EmpresaId, centroId: x.CentroId, tipoPerfil: x.TipoPerfil,
    activo: !!x.Activo, dni: x.DNI, empresaA3: x.EmpresaA3, empleadoA3: x.EmpleadoA3 ? String(x.EmpleadoA3).trim() : null,
    idA3: x.IdA3 ? String(x.IdA3).toLowerCase() : null, fechaAltaA3: x.FechaAltaA3?.trim() || null, fechaBajaA3: x.FechaBajaA3?.trim() || null,
    origenA3: !!x.OrigenA3, desactivadoPorA3: !!x.DesactivadoPorA3,
  }));
  const res = conciliar({
    hoy,
    registros,
    empresas: new Map(emp.recordset.map((x: any) => [x.CodigoA3, { empresaId: x.EmpresaId }])),
    centros: new Map(cen.recordset.map((x: any) => [`${x.EmpresaA3}-${x.CentroA3}`, { centroId: x.CentroId, nombre: x.Nombre }])),
    estructura: new Set(estr.recordset.map((x: any) => x.CentroId)),
    usuarios,
    empresasLeidas: leidas,
  });

  for (const n of res.crear) {
    try {
      const r = await pool
        .request()
        .input("email", sql.NVarChar(254), n.email)
        .input("nombre", sql.NVarChar(100), n.nombre)
        .input("apellidos", sql.NVarChar(150), n.apellidos)
        .input("empresa", sql.Int, n.empresaId)
        .input("centro", sql.Int, n.centroId)
        .input("perfil", sql.VarChar(12), n.tipoPerfil)
        .input("dni", sql.VarChar(12), n.dni)
        .input("ea3", sql.Int, n.empresaA3)
        .input("ca3", sql.Char(6), n.empleadoA3)
        .input("ida3", sql.UniqueIdentifier, n.idA3)
        .input("fa", sql.Date, n.fechaAltaA3)
        .input("fb", sql.Date, n.fechaBajaA3)
        .query(
          `INSERT INTO fich.Usuarios (Email, Nombre, Apellidos, EmpresaId, CentroId, Rol, TipoPerfil, PasswordHash, DebeCambiarPassword,
                  DNI, EmpresaA3, EmpleadoA3, IdA3, FechaAltaA3, FechaBajaA3, OrigenA3)
           OUTPUT INSERTED.UsuarioId
           VALUES (@email, @nombre, @apellidos, @empresa, @centro, 'EMPLEADO', @perfil, NULL, 0, @dni, @ea3, @ca3, @ida3, @fa, @fb, 1);`
        );
      const id = r.recordset[0].UsuarioId;
      res.enlaces.push({ empresaA3: n.empresaA3, empleadoA3: n.empleadoA3, usuarioId: id });
      await auditar(pool, "A3_ALTA_USUARIO", "Usuario", id, `${n.nombre} ${n.apellidos} <${n.email}> a3 ${n.empresaA3}/${n.empleadoA3}`);
      est.usuariosCreados++;
    } catch (e: any) {
      log(`No se pudo crear ${n.email}: ${e?.message ?? e}`);
      res.pendientes.push({ tipo: "EMAIL_DUPLICADO", clave: n.email, empresaA3: n.empresaA3, empleadoA3: n.empleadoA3, centroA3: null, detalle: `${n.nombre} ${n.apellidos}: no se pudo crear el usuario (${String(e?.message ?? e).slice(0, 200)}).` });
    }
  }

  for (const a of res.actualizar) {
    const rq = pool.request().input("id", sql.Int, a.id);
    const sets: string[] = [];
    for (const [k, v] of Object.entries(a.campos) as [keyof Campos, any][]) {
      const c = COLUMNA[k];
      if (!c) continue;
      rq.input(k, c.tipo, v);
      sets.push(`${c.col} = @${k}`);
    }
    if (!sets.length) continue;
    await rq.query(`UPDATE fich.Usuarios SET ${sets.join(", ")}, ModificadoUtc = SYSUTCDATETIME() WHERE UsuarioId = @id`);
    await auditar(pool, "A3_ACTUALIZAR_USUARIO", "Usuario", a.id, Object.keys(a.campos).join(", "));
    est.usuariosActualizados++;
  }

  for (const d of res.desactivar) {
    await pool
      .request()
      .input("id", sql.Int, d.id)
      .input("fb", sql.Date, d.fechaBajaA3)
      .query(
        `UPDATE fich.Usuarios SET Activo = 0, DesactivadoPorA3 = 1, FechaBajaA3 = @fb, VersionSesion = VersionSesion + 1,
                ModificadoUtc = SYSUTCDATETIME() WHERE UsuarioId = @id AND Activo = 1`
      );
    await auditar(pool, "A3_BAJA_USUARIO", "Usuario", d.id, `Baja en a3${d.fechaBajaA3 ? ` el ${d.fechaBajaA3}` : ""}`);
    est.usuariosDesactivados++;
  }

  for (const l of res.enlaces) {
    await pool
      .request()
      .input("e", sql.Int, l.empresaA3)
      .input("c", sql.Char(6), l.empleadoA3)
      .input("u", sql.Int, l.usuarioId)
      .query("UPDATE fich.A3Empleados SET UsuarioId = @u WHERE EmpresaA3 = @e AND EmpleadoA3 = @c AND (UsuarioId IS NULL OR UsuarioId <> @u)");
  }

  est.pendientes = await guardarPendientes(pool, res.pendientes);
  log(`Conciliación: ${est.usuariosCreados} altas, ${est.usuariosActualizados} cambios, ${est.usuariosDesactivados} bajas, ${est.pendientes} pendientes abiertos, ${res.omitidosSinServicio} sin servicio`);
}

/** Abre o refresca cada pendiente; los que ya no aparecen se cierran solos. Los ignorados no vuelven a abrirse. */
async function guardarPendientes(pool: sql.ConnectionPool, lista: Pendiente[]): Promise<number> {
  const marca = new Date();
  for (const p of lista) {
    await pool
      .request()
      .input("t", sql.VarChar(30), p.tipo)
      .input("k", sql.NVarChar(60), p.clave.slice(0, 60))
      .input("e", sql.Int, p.empresaA3)
      .input("c", sql.Char(6), p.empleadoA3)
      .input("ce", sql.Int, p.centroA3)
      .input("d", sql.NVarChar(500), p.detalle.slice(0, 500))
      .input("m", sql.DateTime2(0), marca)
      .query(
        `IF NOT EXISTS (SELECT 1 FROM fich.A3Pendientes WHERE Tipo = @t AND Clave = @k AND Resolucion = 'IGNORADO')
         BEGIN
           UPDATE fich.A3Pendientes SET Detalle = @d, VistoUtc = @m WHERE Tipo = @t AND Clave = @k AND ResueltoUtc IS NULL;
           IF @@ROWCOUNT = 0
             INSERT INTO fich.A3Pendientes (Tipo, Clave, EmpresaA3, EmpleadoA3, CentroA3, Detalle, VistoUtc) VALUES (@t, @k, @e, @c, @ce, @d, @m);
         END`
      );
  }
  const rq = pool.request().input("m", sql.DateTime2(0), marca);
  await rq.query(
    `UPDATE fich.A3Pendientes SET ResueltoUtc = SYSUTCDATETIME(), Resolucion = 'AUTO'
      WHERE ResueltoUtc IS NULL AND VistoUtc < @m AND Tipo IN (${TIPOS_CONCILIACION.map((t) => `'${t}'`).join(",")})`
  );
  const n = await pool.request().query("SELECT COUNT(*) AS n FROM fich.A3Pendientes WHERE ResueltoUtc IS NULL");
  return n.recordset[0].n;
}

export async function auditar(pool: sql.ConnectionPool, accion: string, entidad: string, id: string | number | null, detalle: string, actor: number | null = null) {
  await pool
    .request()
    .input("actor", sql.Int, actor)
    .input("accion", sql.VarChar(50), accion)
    .input("entidad", sql.VarChar(50), entidad)
    .input("id", sql.VarChar(50), id === null ? null : String(id))
    .input("detalle", sql.NVarChar(2000), detalle.slice(0, 2000))
    .query("INSERT INTO fich.Auditoria (ActorUsuarioId, Accion, Entidad, EntidadId, Detalle, IpOrigen) VALUES (@actor, @accion, @entidad, @id, @detalle, NULL)");
}

