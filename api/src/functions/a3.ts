import { app } from "@azure/functions";
import crypto from "crypto";
import { getPool, sql } from "../lib/db";
import { ipCliente } from "../lib/auth";
import { json, error, leerJson, conSesion } from "../lib/http";
import { auditar } from "../lib/auditoria";

/* Integración con a3innuva Nómina (solo ADMIN). La app no habla con a3 ni guarda sus secretos:
   - Conectar: genera el state y devuelve la URL de login de Wolters Kluwer; la vuelta la atiende la Function App
     func-a3sync-prod (a3/callback), que guarda el permiso en Key Vault.
   - Sincronizar: deja una petición en fich.A3Sincronizaciones que la Function App atiende en su ejecución nocturna (una vez al día).
   - El resto: estado, historial, bandeja de pendientes, centros a3 ↔ servicios, empresas y organigrama. */

const ADMIN = { roles: ["ADMIN" as const] };
const URL_AUTORIZAR = "https://login.wolterskluwer.eu/auth/core/connect/authorize";
const SCOPE = "offline_access+openid+IDInfo+WK.ES.A3EquipoContex";
const AVISO_DIAS = 7;

/* ---------- Estado ---------- */
app.http("a3Estado", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "gestion/a3/estado",
  handler: conSesion(async () => {
    const pool = await getPool();
    const [c, s, p, cs, e, o] = await Promise.all([
      pool.request().query(
        `SELECT c.Estado, c.UsuarioA3, c.ConectadaUtc, c.CaducaUtc, c.UltimaSyncOkUtc, c.UltimoError,
                CASE WHEN c.RedirectUri IS NULL THEN 0 ELSE 1 END AS Configurada,
                u.Nombre + N' ' + u.Apellidos AS ConectadaPor
           FROM fich.A3Conexion c LEFT JOIN fich.Usuarios u ON u.UsuarioId = c.ConectadaPorId WHERE c.Id = 1`
      ),
      pool.request().query(
        `SELECT TOP (20) s.SincronizacionId AS id, s.Tipo AS tipo, s.Completa AS completa, s.Estado AS estado,
                s.SolicitadaUtc AS solicitadaUtc, s.InicioUtc AS inicioUtc, s.FinUtc AS finUtc, s.Llamadas AS llamadas,
                s.Empresas AS empresas, s.Centros AS centros, s.EmpleadosLeidos AS empleadosLeidos, s.UsuariosCreados AS creados,
                s.UsuariosActualizados AS actualizados, s.UsuariosDesactivados AS desactivados, s.Pendientes AS pendientes, s.Error AS error,
                u.Nombre + N' ' + u.Apellidos AS solicitadaPor
           FROM fich.A3Sincronizaciones s LEFT JOIN fich.Usuarios u ON u.UsuarioId = s.SolicitadaPorId
          ORDER BY s.SincronizacionId DESC`
      ),
      pool.request().query("SELECT Tipo, COUNT(*) AS n FROM fich.A3Pendientes WHERE ResueltoUtc IS NULL GROUP BY Tipo"),
      pool.request().query(
        `SELECT COUNT(*) AS total, SUM(CASE WHEN CentroId IS NULL THEN 1 ELSE 0 END) AS sinServicio
           FROM fich.A3Centros c JOIN fich.A3Empresas e ON e.CodigoA3 = c.EmpresaA3 AND e.Importar = 1 WHERE c.Activo = 1`
      ),
      pool.request().query("SELECT COUNT(*) AS n FROM fich.Centros WHERE EsEstructura = 1"),
      pool.request().query("SELECT COUNT(*) AS n FROM fich.Usuarios WHERE OrigenA3 = 1"),
    ]);
    const x = c.recordset[0] ?? {};
    const diasParaCaducar = x.CaducaUtc ? Math.floor((new Date(x.CaducaUtc).getTime() - Date.now()) / 86400000) : null;
    return json(200, {
      conexion: {
        estado: x.Estado ?? "DESCONECTADA",
        configurada: !!x.Configurada,
        usuarioA3: x.UsuarioA3 ?? null,
        conectadaUtc: x.ConectadaUtc ?? null,
        conectadaPor: x.ConectadaPor ?? null,
        caducaUtc: x.CaducaUtc ?? null,
        diasParaCaducar,
        avisoCaducidad: x.Estado === "CONECTADA" && diasParaCaducar !== null && diasParaCaducar <= AVISO_DIAS,
        ultimaSyncOkUtc: x.UltimaSyncOkUtc ?? null,
        ultimoError: x.UltimoError ?? null,
      },
      sincronizaciones: s.recordset.map((r: any) => ({ ...r, completa: !!r.completa })),
      pendientes: Object.fromEntries(p.recordset.map((r: any) => [r.Tipo, r.n])),
      centrosA3: { total: cs.recordset[0].total ?? 0, sinServicio: cs.recordset[0].sinServicio ?? 0 },
      centrosEstructura: e.recordset[0].n,
      usuariosA3: o.recordset[0].n,
    });
  }, ADMIN),
});

/* ---------- Conectar / reconectar ---------- */
app.http("a3Conectar", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "gestion/a3/conectar",
  handler: conSesion(async (req, _ctx, u) => {
    const pool = await getPool();
    const c = (await pool.request().query("SELECT ClientId, RedirectUri FROM fich.A3Conexion WHERE Id = 1")).recordset[0];
    if (!c?.RedirectUri) return error(409, "Falta configurar la dirección de vuelta del conector (RedirectUri). Avisa a Sistemas.");
    const state = crypto.randomBytes(24).toString("hex");
    const nonce = crypto.randomBytes(16).toString("hex");
    await pool
      .request()
      .input("s", sql.VarChar(64), state)
      .input("u", sql.Int, u.usuarioId)
      .query("UPDATE fich.A3Conexion SET OAuthState = @s, OAuthStateUtc = SYSUTCDATETIME(), OAuthPorId = @u WHERE Id = 1");
    await auditar(u.usuarioId, "A3_CONECTAR_INICIO", "A3Conexion", 1, null, ipCliente(req));
    const q = `client_id=${encodeURIComponent(c.ClientId)}&response_type=code&redirect_uri=${encodeURIComponent(c.RedirectUri)}&scope=${SCOPE}&state=${state}&nonce=${nonce}`;
    return json(200, { url: `${URL_AUTORIZAR}?${q}` });
  }, ADMIN),
});

/* ---------- Pedir sincronización ---------- */
app.http("a3Sincronizar", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "gestion/a3/sincronizar",
  handler: conSesion(async (req, _ctx, u) => {
    const b = await leerJson(req);
    const completa = b?.completa === true;
    const pool = await getPool();
    const c = (await pool.request().query("SELECT Estado FROM fich.A3Conexion WHERE Id = 1")).recordset[0];
    if (c?.Estado !== "CONECTADA") return error(409, "Primero conecta la app con a3.");
    const r = await pool
      .request()
      .input("u", sql.Int, u.usuarioId)
      .input("c", sql.Bit, completa)
      .query(
        `IF EXISTS (SELECT 1 FROM fich.A3Sincronizaciones WHERE Estado IN ('PENDIENTE','EN_CURSO')) SELECT CAST(NULL AS INT) AS id
         ELSE INSERT INTO fich.A3Sincronizaciones (Tipo, Completa, SolicitadaPorId) OUTPUT INSERTED.SincronizacionId AS id VALUES ('MANUAL', @c, @u)`
      );
    const id = r.recordset[0]?.id;
    if (!id) return error(409, "Ya hay una sincronización pendiente o en curso.");
    await auditar(u.usuarioId, "A3_SINCRONIZAR", "A3Sincronizacion", id, completa ? "completa" : "cambios", ipCliente(req));
    return json(201, { id });
  }, ADMIN),
});

/* ---------- Pendientes ---------- */
app.http("a3Pendientes", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "gestion/a3/pendientes",
  handler: conSesion(async (req) => {
    const resueltos = req.query.get("estado") === "resueltos";
    const r = await (await getPool()).request().query(
      `SELECT TOP (1000) p.PendienteId AS id, p.Tipo AS tipo, p.EmpresaA3 AS empresaA3, p.EmpleadoA3 AS empleadoA3, p.CentroA3 AS centroA3,
              p.Detalle AS detalle, p.CreadoUtc AS creadoUtc, p.VistoUtc AS vistoUtc, p.ResueltoUtc AS resueltoUtc, p.Resolucion AS resolucion,
              u.Nombre + N' ' + u.Apellidos AS resueltoPor
         FROM fich.A3Pendientes p LEFT JOIN fich.Usuarios u ON u.UsuarioId = p.ResueltoPorId
        WHERE ${resueltos ? "p.ResueltoUtc IS NOT NULL" : "p.ResueltoUtc IS NULL"}
        ORDER BY ${resueltos ? "p.ResueltoUtc DESC" : "p.Tipo, p.CreadoUtc"}`
    );
    return json(200, r.recordset.map((x: any) => ({ ...x, empleadoA3: x.empleadoA3?.trim() ?? null })));
  }, ADMIN),
});

app.http("a3PendienteIgnorar", {
  methods: ["PUT"],
  authLevel: "anonymous",
  route: "gestion/a3/pendientes/{id:int}/ignorar",
  handler: conSesion(async (req, _ctx, u) => {
    const id = Number(req.params.id);
    const r = await (await getPool())
      .request()
      .input("id", sql.Int, id)
      .input("u", sql.Int, u.usuarioId)
      .query(
        `UPDATE fich.A3Pendientes SET ResueltoUtc = SYSUTCDATETIME(), ResueltoPorId = @u, Resolucion = 'IGNORADO'
          OUTPUT INSERTED.Tipo, INSERTED.Clave WHERE PendienteId = @id AND ResueltoUtc IS NULL`
      );
    if (!r.recordset.length) return error(404, "Pendiente no encontrado o ya resuelto");
    await auditar(u.usuarioId, "A3_IGNORAR_PENDIENTE", "A3Pendiente", id, `${r.recordset[0].Tipo} ${r.recordset[0].Clave}`, ipCliente(req));
    return json(200, { ok: true });
  }, ADMIN),
});

/* ---------- Empresas de a3 ---------- */
app.http("a3Empresas", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "gestion/a3/empresas",
  handler: conSesion(async () => {
    const r = await (await getPool()).request().input("hoy", sql.Date, new Date()).query(
      `SELECT a.CodigoA3 AS codigoA3, a.Nombre AS nombre, a.CIF AS cif, a.Importar AS importar, a.EmpresaId AS empresaId, e.Nombre AS empresa,
              (SELECT COUNT(*) FROM fich.A3Empleados x WHERE x.EmpresaA3 = a.CodigoA3 AND (x.FechaBaja IS NULL OR x.FechaBaja >= @hoy)) AS enAlta,
              (SELECT COUNT(*) FROM fich.A3Centros x WHERE x.EmpresaA3 = a.CodigoA3 AND x.Activo = 1) AS centros
         FROM fich.A3Empresas a LEFT JOIN fich.Empresas e ON e.EmpresaId = a.EmpresaId
        ORDER BY a.CodigoA3`
    );
    return json(200, r.recordset.map((x: any) => ({ ...x, importar: !!x.importar })));
  }, ADMIN),
});

app.http("a3EmpresaEditar", {
  methods: ["PUT"],
  authLevel: "anonymous",
  route: "gestion/a3/empresas/{codigo:int}",
  handler: conSesion(async (req, _ctx, u) => {
    const codigo = Number(req.params.codigo);
    const b = await leerJson(req);
    if (!b || typeof b.importar !== "boolean") return error(400, "Datos no válidos");
    const empresaId = b.empresaId === null || b.empresaId === undefined || b.empresaId === "" ? null : Number(b.empresaId);
    const pool = await getPool();
    if (empresaId !== null) {
      const ya = await pool.request().input("e", sql.Int, empresaId).input("c", sql.Int, codigo)
        .query("SELECT CodigoA3 FROM fich.A3Empresas WHERE EmpresaId = @e AND CodigoA3 <> @c");
      if (ya.recordset.length) return error(409, `Esa empresa ya está enlazada con la empresa a3 ${ya.recordset[0].CodigoA3}`);
      const ex = await pool.request().input("e", sql.Int, empresaId).query("SELECT 1 AS x FROM fich.Empresas WHERE EmpresaId = @e");
      if (!ex.recordset.length) return error(400, "Empresa no válida");
    }
    const r = await pool
      .request()
      .input("c", sql.Int, codigo)
      .input("i", sql.Bit, b.importar)
      .input("e", sql.Int, empresaId)
      .query("UPDATE fich.A3Empresas SET Importar = @i, EmpresaId = @e WHERE CodigoA3 = @c");
    if (!r.rowsAffected[0]) return error(404, "Empresa de a3 no encontrada");
    await auditar(u.usuarioId, "A3_EMPRESA", "A3Empresa", codigo, `importar=${b.importar} empresaId=${empresaId ?? "—"}`, ipCliente(req));
    return json(200, { ok: true });
  }, ADMIN),
});

/* ---------- Centros de a3 → servicio de la app ---------- */
app.http("a3Centros", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "gestion/a3/centros",
  handler: conSesion(async () => {
    const r = await (await getPool()).request().input("hoy", sql.Date, new Date()).query(
      `SELECT c.EmpresaA3 AS empresaA3, a.Nombre AS empresa, c.CentroA3 AS centroA3, c.Nombre AS nombre, c.Direccion AS direccion,
              c.CodigoPostal AS codigoPostal, c.Ciudad AS ciudad, c.Activo AS activo, c.CentroId AS centroId,
              s.Nombre AS servicio, s.CodigoServicio AS codigoServicio, s.EsEstructura AS esEstructura,
              (SELECT COUNT(*) FROM fich.A3Empleados x WHERE x.EmpresaA3 = c.EmpresaA3 AND x.CentroA3 = c.CentroA3
                  AND (x.FechaBaja IS NULL OR x.FechaBaja >= @hoy)) AS enAlta
         FROM fich.A3Centros c
         JOIN fich.A3Empresas a ON a.CodigoA3 = c.EmpresaA3 AND a.Importar = 1
         LEFT JOIN fich.Centros s ON s.CentroId = c.CentroId
        ORDER BY c.EmpresaA3, c.CentroA3`
    );
    return json(200, r.recordset.map((x: any) => ({ ...x, activo: !!x.activo, esEstructura: !!x.esEstructura })));
  }, ADMIN),
});

app.http("a3CentroAsignar", {
  methods: ["PUT"],
  authLevel: "anonymous",
  route: "gestion/a3/centros/{empresa:int}/{centro:int}",
  handler: conSesion(async (req, _ctx, u) => {
    const empresa = Number(req.params.empresa);
    const centro = Number(req.params.centro);
    const b = await leerJson(req);
    const centroId = b?.centroId === null || b?.centroId === "" || b?.centroId === undefined ? null : Number(b.centroId);
    const pool = await getPool();
    if (centroId !== null) {
      const s = await pool.request().input("c", sql.Int, centroId).query("SELECT Activo FROM fich.Centros WHERE CentroId = @c");
      if (!s.recordset[0]?.Activo) return error(400, "Servicio no válido o desactivado");
    }
    const r = await pool
      .request()
      .input("e", sql.Int, empresa)
      .input("c", sql.Int, centro)
      .input("s", sql.Int, centroId)
      .query("UPDATE fich.A3Centros SET CentroId = @s WHERE EmpresaA3 = @e AND CentroA3 = @c");
    if (!r.rowsAffected[0]) return error(404, "Centro de a3 no encontrado");
    await auditar(u.usuarioId, "A3_CENTRO_SERVICIO", "A3Centro", `${empresa}-${centro}`, `servicio=${centroId ?? "—"}`, ipCliente(req));
    return json(200, { ok: true });
  }, ADMIN),
});

/* ---------- Servicios de la app (para elegir) y marca de estructura (OH) ---------- */
app.http("a3Servicios", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "gestion/a3/servicios",
  handler: conSesion(async () => {
    const r = await (await getPool()).request().query(
      `SELECT c.CentroId AS id, c.CodigoServicio AS codigoServicio, c.Nombre AS nombre, e.Nombre AS empresa, c.EsEstructura AS esEstructura,
              (SELECT COUNT(*) FROM fich.A3Centros x WHERE x.CentroId = c.CentroId) AS centrosA3
         FROM fich.Centros c JOIN fich.Empresas e ON e.EmpresaId = c.EmpresaId
        WHERE c.Activo = 1 ORDER BY c.EsEstructura DESC, c.CodigoServicio, c.Nombre`
    );
    return json(200, r.recordset.map((x: any) => ({ ...x, esEstructura: !!x.esEstructura })));
  }, ADMIN),
});

app.http("a3ServicioEstructura", {
  methods: ["PUT"],
  authLevel: "anonymous",
  route: "gestion/a3/servicios/{id:int}/estructura",
  handler: conSesion(async (req, _ctx, u) => {
    const id = Number(req.params.id);
    const b = await leerJson(req);
    if (typeof b?.esEstructura !== "boolean") return error(400, "Datos no válidos");
    const r = await (await getPool()).request().input("id", sql.Int, id).input("v", sql.Bit, b.esEstructura)
      .query("UPDATE fich.Centros SET EsEstructura = @v WHERE CentroId = @id");
    if (!r.rowsAffected[0]) return error(404, "Centro no encontrado");
    await auditar(u.usuarioId, "CENTRO_ESTRUCTURA", "Centro", id, String(b.esEstructura), ipCliente(req));
    return json(200, { ok: true });
  }, ADMIN),
});

/* ---------- Organigrama de a3 ---------- */
app.http("a3Organigrama", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "gestion/a3/organigrama",
  handler: conSesion(async () => {
    const r = await (await getPool()).request().query(
      `SELECT CONVERT(varchar(36), o.NodoId) AS id, CONVERT(varchar(36), o.PadreNodoId) AS padreId, o.EmpresaA3 AS empresaA3, a.Nombre AS empresa,
              o.Tipo AS tipo, o.Codigo AS codigo, o.Nombre AS nombre, o.Descripcion AS descripcion,
              o.ResponsableNombre AS responsable, o.ResponsableCodigo AS responsableCodigo,
              u.UsuarioId AS usuarioId, u.Nombre + N' ' + u.Apellidos AS usuario, CONVERT(char(10), o.FechaBaja, 23) AS fechaBaja
         FROM fich.A3Organigrama o
         JOIN fich.A3Empresas a ON a.CodigoA3 = o.EmpresaA3
         LEFT JOIN fich.Usuarios u ON u.DNI = o.ResponsableDNI
        ORDER BY o.EmpresaA3, o.Orden`
    );
    return json(200, r.recordset.map((x: any) => ({ ...x, id: x.id?.toLowerCase(), padreId: x.padreId?.toLowerCase() ?? null })));
  }, ADMIN),
});
