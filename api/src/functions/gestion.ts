import { app } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { hashPassword, validarEmail, validarPassword, ipCliente, ROLES, Rol } from "../lib/auth";
import { json, error, leerJson, conSesion } from "../lib/http";
import { auditar } from "../lib/auditoria";
import { cargarOrg, aprobadorEfectivo, nombreDe, TipoPerfil } from "../lib/organizacion";

// Nota: las rutas no pueden empezar por "admin" (reservado por Azure Functions), por eso "gestion".
// Solo ADMIN gestiona usuarios, perfiles y estructura. RRHH solo supervisa fichajes.
const GESTORES: Rol[] = ["ADMIN"];

const SELECT_USUARIO = `
  SELECT u.UsuarioId AS id, u.Email AS email, u.Nombre AS nombre, u.Apellidos AS apellidos,
         u.EmpresaId AS empresaId, e.Nombre AS empresa, u.CentroId AS centroId, c.Nombre AS centro, c.CodigoServicio AS codigoServicio,
         u.TipoPerfil AS tipoPerfil, u.DepartamentoId AS departamentoId, d.Nombre AS departamento, u.ManagerId AS managerId,
         u.Rol AS rol, u.Activo AS activo, u.DebeCambiarPassword AS debeCambiarPassword,
         CASE WHEN u.BloqueadoHastaUtc > SYSUTCDATETIME() THEN 1 ELSE 0 END AS bloqueado,
         u.UltimoAccesoUtc AS ultimoAccesoUtc, u.CreadoUtc AS creadoUtc, u.EmailCorporativo AS emailCorporativo, u.DNI AS dni`;
const FROM_USUARIO = `
    FROM fich.Usuarios u
    JOIN fich.Empresas e ON e.EmpresaId = u.EmpresaId
    LEFT JOIN fich.Centros c ON c.CentroId = u.CentroId
    LEFT JOIN fich.Departamentos d ON d.DepartamentoId = u.DepartamentoId`;

/** Listado: además, datos de a3 (alta/baja, puesto, contrato, responsable) y estado automático por fecha de baja. */
const SELECT_LISTADO = `${SELECT_USUARIO},
         c.CodigoA3 AS centroA3, u.EmpresaA3 AS empresaA3, u.EmpleadoA3 AS empleadoA3, u.OrigenA3 AS origenA3,
         CONVERT(VARCHAR(10), u.FechaAltaA3, 23) AS fechaAltaA3, CONVERT(VARCHAR(10), u.FechaBajaA3, 23) AS fechaBajaA3,
         CASE WHEN u.Activo = 0 OR u.FechaBajaA3 < CAST(SYSDATETIMEOFFSET() AT TIME ZONE 'Romance Standard Time' AS DATE) THEN 'BAJA'
              WHEN u.FechaBajaA3 IS NOT NULL THEN 'BAJA_PROGRAMADA' ELSE 'ALTA' END AS estado,
         ae.Puesto AS puesto, ae.DepartamentoA3 AS departamentoA3, ae.Contrato AS contrato, ae.ContratoCodigo AS contratoCodigo,
         ae.Jornada AS jornada, ae.ResponsableNombre AS responsableA3, ae.ResponsableCodigo AS responsableCodigoA3
${FROM_USUARIO}
    LEFT JOIN fich.A3Empleados ae ON ae.EmpresaA3 = u.EmpresaA3 AND ae.EmpleadoA3 = u.EmpleadoA3`;

/** Código de trabajador a3 sin ceros a la izquierda ni espacios ("000045" → "45"), para enlazar responsables. */
const codigoA3 = (v: unknown) => String(v ?? "").trim().replace(/^0+(?=.)/, "");

/** Correo profesional (corporativo): opcional; vacío → null. */
function leerEmailCorporativo(v: unknown): { valor: string | null } | { error: string } {
  const e = String(v ?? "").trim();
  if (!e) return { valor: null };
  return validarEmail(e) ? { valor: e.toLowerCase() } : { error: "Correo profesional no válido" };
}

/** Solo un ADMIN puede crear/editar otros ADMIN. */
function puedeAsignarRol(actor: Rol, rol: Rol) {
  return rol !== "ADMIN" || actor === "ADMIN";
}

interface Perfil { tipoPerfil: TipoPerfil | null; departamentoId: number | null; centroId: number | null; managerId: number | null }

/** Valida el perfil: ESTRUCTURA → departamento; DELEGACION → centro. El manager manual solo aplica a ESTRUCTURA. */
async function validarPerfil(pool: sql.ConnectionPool, b: any, empresaId: number, propioId: number | null): Promise<Perfil | { error: string }> {
  const tipo = b.tipoPerfil === "ESTRUCTURA" || b.tipoPerfil === "DELEGACION" ? (b.tipoPerfil as TipoPerfil) : null;
  const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number(v));
  let departamentoId = tipo === "ESTRUCTURA" ? num(b.departamentoId) : null;
  // Estructura también puede tener centro (sede): solo para calendario y parámetros de control; le aprueba su departamento
  let centroId = num(b.centroId);
  const managerId = tipo === "ESTRUCTURA" ? num(b.managerId) : null;
  if (tipo === "DELEGACION" && !centroId) return { error: "Un perfil de delegación debe tener centro" };
  if (departamentoId !== null) {
    const r = await pool.request().input("d", sql.Int, departamentoId).query("SELECT Activo FROM fich.Departamentos WHERE DepartamentoId = @d");
    if (!r.recordset[0]?.Activo) return { error: "El departamento no existe o está inactivo" };
  }
  if (!(await centroValido(pool, centroId, empresaId))) return { error: "El centro no pertenece a la empresa" };
  if (managerId !== null) {
    if (managerId === propioId) return { error: "Una persona no puede ser su propio manager" };
    const r = await pool.request().input("m", sql.Int, managerId).query("SELECT 1 AS ok FROM fich.Usuarios WHERE UsuarioId = @m AND Activo = 1");
    if (!r.recordset.length) return { error: "El manager debe ser un usuario activo" };
  }
  return { tipoPerfil: tipo, departamentoId, centroId, managerId };
}

async function centroValido(pool: sql.ConnectionPool, centroId: number | null, empresaId: number) {
  if (centroId === null) return true;
  const r = await pool
    .request()
    .input("c", sql.Int, centroId)
    .input("e", sql.Int, empresaId)
    .query("SELECT 1 AS ok FROM fich.Centros WHERE CentroId = @c AND EmpresaId = @e AND Activo = 1");
  return r.recordset.length > 0;
}

/* ---------- Listar usuarios ---------- */
app.http("gestionUsuariosListar", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "gestion/usuarios",
  handler: conSesion(
    async () => {
      const pool = await getPool();
      const [r, org] = await Promise.all([pool.request().query(`${SELECT_LISTADO} ORDER BY u.Activo DESC, u.Apellidos, u.Nombre`), cargarOrg()]);
      // Responsable de a3 → usuario de la app (mismo código de empresa a3)
      const porCodigo = new Map<string, number>();
      for (const x of r.recordset) if (x.empresaA3 && x.empleadoA3) porCodigo.set(`${x.empresaA3}-${codigoA3(x.empleadoA3)}`, x.id);
      return json(
        200,
        r.recordset.map((x: any) => {
          const a = aprobadorEfectivo(org, x.id);
          const resp = x.responsableCodigoA3 ? porCodigo.get(`${x.empresaA3}-${codigoA3(x.responsableCodigoA3)}`) ?? null : null;
          const { responsableCodigoA3, ...resto } = x;
          return {
            ...resto,
            empleadoA3: x.empleadoA3 ? String(x.empleadoA3).trim() : null,
            origenA3: !!x.origenA3,
            jornada: x.jornada === null ? null : Number(x.jornada),
            responsableA3Id: resp !== x.id ? resp : null,
            manager: nombreDe(org, x.managerId),
            aprobador: nombreDe(org, a.titular),
            suplente: a.efectivo !== a.titular ? nombreDe(org, a.efectivo) : null,
            esCoordinador: (org.centrosQueCoordina.get(x.id) ?? []).length > 0,
            esManagerDepartamento: (org.depsQueDirige.get(x.id) ?? []).length > 0,
          };
        })
      );
    },
    { roles: GESTORES }
  ),
});

/* ---------- Crear usuario ---------- */
app.http("gestionUsuariosCrear", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "gestion/usuarios",
  handler: conSesion(
    async (req, _ctx, actor) => {
      const b = await leerJson(req);
      if (!b) return error(400, "Datos no válidos");
      if (!validarEmail(b.email)) return error(400, "Email no válido");
      const nombre = String(b.nombre ?? "").trim();
      const apellidos = String(b.apellidos ?? "").trim();
      if (!nombre || !apellidos) return error(400, "Nombre y apellidos son obligatorios");
      const empresaId = Number(b.empresaId);
      if (!empresaId) return error(400, "Empresa obligatoria");
      const rol: Rol = ROLES.includes(b.rol) ? b.rol : "EMPLEADO";
      if (!puedeAsignarRol(actor.rol, rol)) return error(403, "Solo un administrador puede crear administradores");
      const errPw = validarPassword(b.passwordTemporal);
      if (errPw) return error(400, errPw);
      const corp = leerEmailCorporativo(b.emailCorporativo);
      if ("error" in corp) return error(400, corp.error);

      const pool = await getPool();
      const perfil = await validarPerfil(pool, b, empresaId, null);
      if ("error" in perfil) return error(400, perfil.error);
      const existe = await pool.request().input("e", sql.NVarChar(254), b.email.trim().toLowerCase()).query("SELECT 1 FROM fich.Usuarios WHERE EmailNormalizado = @e");
      if (existe.recordset.length) return error(409, "Ya existe un usuario con ese email");

      const hash = await hashPassword(b.passwordTemporal);
      const r = await pool
        .request()
        .input("email", sql.NVarChar(254), b.email.trim())
        .input("nombre", sql.NVarChar(100), nombre)
        .input("apellidos", sql.NVarChar(150), apellidos)
        .input("empresa", sql.Int, empresaId)
        .input("centro", sql.Int, perfil.centroId)
        .input("rol", sql.VarChar(20), rol)
        .input("tipo", sql.VarChar(12), perfil.tipoPerfil)
        .input("dep", sql.Int, perfil.departamentoId)
        .input("man", sql.Int, perfil.managerId)
        .input("hash", sql.VarChar(255), hash)
        .input("corp", sql.NVarChar(254), corp.valor)
        .query(
          `INSERT INTO fich.Usuarios (Email, Nombre, Apellidos, EmpresaId, CentroId, Rol, TipoPerfil, DepartamentoId, ManagerId, PasswordHash, DebeCambiarPassword, EmailCorporativo)
           OUTPUT INSERTED.UsuarioId
           VALUES (@email, @nombre, @apellidos, @empresa, @centro, @rol, @tipo, @dep, @man, @hash, 1, @corp)`
        );
      const id = r.recordset[0].UsuarioId;
      await auditar(
        actor.usuarioId,
        "CREAR_USUARIO",
        "Usuario",
        id,
        `${b.email} rol=${rol} empresa=${empresaId} perfil=${perfil.tipoPerfil ?? "-"} centro=${perfil.centroId ?? "-"} departamento=${perfil.departamentoId ?? "-"} manager=${perfil.managerId ?? "-"}`,
        ipCliente(req)
      );
      return json(201, { id });
    },
    { roles: GESTORES }
  ),
});

/* ---------- Editar usuario (datos, rol, activo) ---------- */
app.http("gestionUsuariosEditar", {
  methods: ["PUT"],
  authLevel: "anonymous",
  route: "gestion/usuarios/{id:int}",
  handler: conSesion(
    async (req, _ctx, actor) => {
      const id = Number(req.params.id);
      const b = await leerJson(req);
      if (!b) return error(400, "Datos no válidos");

      const pool = await getPool();
      const act = await pool.request().input("id", sql.Int, id).query("SELECT Rol, Activo, Email, EmailCorporativo, EmpresaId, CentroId, TipoPerfil, DepartamentoId, ManagerId FROM fich.Usuarios WHERE UsuarioId = @id");
      const actual = act.recordset[0];
      if (!actual) return error(404, "Usuario no encontrado");
      if (actual.Rol === "ADMIN" && actor.rol !== "ADMIN") return error(403, "Solo un administrador puede modificar administradores");

      if (!validarEmail(b.email)) return error(400, "Email no válido");
      const nombre = String(b.nombre ?? "").trim();
      const apellidos = String(b.apellidos ?? "").trim();
      if (!nombre || !apellidos) return error(400, "Nombre y apellidos son obligatorios");
      const empresaId = Number(b.empresaId);
      const rol: Rol = ROLES.includes(b.rol) ? b.rol : actual.Rol;
      const activo = b.activo !== false;
      if (!puedeAsignarRol(actor.rol, rol)) return error(403, "Solo un administrador puede asignar el rol ADMIN");
      if (id === actor.usuarioId && (!activo || rol !== actor.rol)) return error(400, "No puedes desactivarte ni cambiar tu propio rol");
      const perfil = await validarPerfil(pool, b, empresaId, id);
      if ("error" in perfil) return error(400, perfil.error);
      const corp = leerEmailCorporativo(b.emailCorporativo);
      if ("error" in corp) return error(400, corp.error);

      const dup = await pool
        .request()
        .input("e", sql.NVarChar(254), b.email.trim().toLowerCase())
        .input("id", sql.Int, id)
        .query("SELECT 1 FROM fich.Usuarios WHERE EmailNormalizado = @e AND UsuarioId <> @id");
      if (dup.recordset.length) return error(409, "Ya existe otro usuario con ese email");

      // Si se desactiva o cambia el rol, se invalidan sus sesiones
      const invalidar = (!activo && actual.Activo) || rol !== actual.Rol ? 1 : 0;
      await pool
        .request()
        .input("id", sql.Int, id)
        .input("email", sql.NVarChar(254), b.email.trim())
        .input("nombre", sql.NVarChar(100), nombre)
        .input("apellidos", sql.NVarChar(150), apellidos)
        .input("empresa", sql.Int, empresaId)
        .input("centro", sql.Int, perfil.centroId)
        .input("rol", sql.VarChar(20), rol)
        .input("tipo", sql.VarChar(12), perfil.tipoPerfil)
        .input("dep", sql.Int, perfil.departamentoId)
        .input("man", sql.Int, perfil.managerId)
        .input("activo", sql.Bit, activo)
        .input("inv", sql.Int, invalidar)
        .input("corp", sql.NVarChar(254), corp.valor)
        .query(
          `UPDATE fich.Usuarios
              SET Email = @email, EmailCorporativo = @corp, Nombre = @nombre, Apellidos = @apellidos, EmpresaId = @empresa, CentroId = @centro,
                  Rol = @rol, TipoPerfil = @tipo, DepartamentoId = @dep, ManagerId = @man, Activo = @activo, VersionSesion = VersionSesion + @inv, ModificadoUtc = SYSUTCDATETIME()
            WHERE UsuarioId = @id`
        );
      await auditar(
        actor.usuarioId,
        "EDITAR_USUARIO",
        "Usuario",
        id,
        `antes: ${actual.Email} corp=${actual.EmailCorporativo ?? "-"} rol=${actual.Rol} activo=${actual.Activo} empresa=${actual.EmpresaId} perfil=${actual.TipoPerfil ?? "-"} centro=${actual.CentroId ?? "-"} departamento=${actual.DepartamentoId ?? "-"} manager=${actual.ManagerId ?? "-"} | despues: ${b.email} corp=${corp.valor ?? "-"} rol=${rol} activo=${activo} empresa=${empresaId} perfil=${perfil.tipoPerfil ?? "-"} centro=${perfil.centroId ?? "-"} departamento=${perfil.departamentoId ?? "-"} manager=${perfil.managerId ?? "-"}`,
        ipCliente(req)
      );
      return json(200, { ok: true });
    },
    { roles: GESTORES }
  ),
});

/* ---------- Resetear contraseña (temporal + desbloqueo) ---------- */
app.http("gestionUsuariosResetPassword", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "gestion/usuarios/{id:int}/reset-password",
  handler: conSesion(
    async (req, _ctx, actor) => {
      const id = Number(req.params.id);
      const b = await leerJson(req);
      const errPw = validarPassword(b?.passwordTemporal);
      if (errPw) return error(400, errPw);

      const pool = await getPool();
      const act = await pool.request().input("id", sql.Int, id).query("SELECT Rol FROM fich.Usuarios WHERE UsuarioId = @id");
      if (!act.recordset[0]) return error(404, "Usuario no encontrado");
      if (act.recordset[0].Rol === "ADMIN" && actor.rol !== "ADMIN") return error(403, "Solo un administrador puede resetear a un administrador");

      const hash = await hashPassword(b.passwordTemporal);
      await pool
        .request()
        .input("id", sql.Int, id)
        .input("hash", sql.VarChar(255), hash)
        .query(
          `UPDATE fich.Usuarios
              SET PasswordHash = @hash, DebeCambiarPassword = 1, IntentosFallidos = 0, BloqueadoHastaUtc = NULL,
                  VersionSesion = VersionSesion + 1, ModificadoUtc = SYSUTCDATETIME()
            WHERE UsuarioId = @id`
        );
      await auditar(actor.usuarioId, "RESET_PASSWORD", "Usuario", id, null, ipCliente(req));
      return json(200, { ok: true });
    },
    { roles: GESTORES }
  ),
});

/* Centros: ver functions/centros.ts */
