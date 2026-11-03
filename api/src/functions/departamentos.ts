import { app } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { ipCliente } from "../lib/auth";
import { json, error, leerJson, conSesion } from "../lib/http";
import { auditar } from "../lib/auditoria";

/* Departamentos (solo ADMIN). Cada departamento tiene un manager, que aprueba a los empleados
   de estructura del departamento. No se borran: se desactivan. */

function validarNombre(v: unknown): string | { error: string } {
  const nombre = String(v ?? "").replace(/\s+/g, " ").trim();
  if (nombre.length < 2) return { error: "El nombre debe tener al menos 2 caracteres" };
  if (nombre.length > 100) return { error: "El nombre no puede superar 100 caracteres" };
  return nombre;
}

async function nombreDuplicado(pool: sql.ConnectionPool, nombre: string, excluirId: number | null) {
  const r = await pool
    .request()
    .input("n", sql.NVarChar(100), nombre)
    .input("id", sql.Int, excluirId)
    .query("SELECT 1 AS x FROM fich.Departamentos WHERE LOWER(Nombre) = LOWER(@n) AND (@id IS NULL OR DepartamentoId <> @id)");
  return r.recordset.length > 0;
}

/** Valida el manager: null o un usuario activo. */
async function managerValido(pool: sql.ConnectionPool, v: unknown): Promise<number | null | { error: string }> {
  if (v === null || v === undefined || v === "") return null;
  const id = Number(v);
  if (!Number.isInteger(id)) return { error: "Manager no válido" };
  const r = await pool.request().input("id", sql.Int, id).query("SELECT 1 AS ok FROM fich.Usuarios WHERE UsuarioId = @id AND Activo = 1");
  return r.recordset.length ? id : { error: "El manager debe ser un usuario activo" };
}

/* ---------- Listar ---------- */
app.http("gestionDepartamentosListar", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "gestion/departamentos",
  handler: conSesion(
    async () => {
      const pool = await getPool();
      const r = await pool.request().query(
        `SELECT d.DepartamentoId AS id, d.Nombre AS nombre, d.Activo AS activo, d.CreadoUtc AS creadoUtc,
                d.ManagerId AS managerId, CASE WHEN m.UsuarioId IS NULL THEN NULL ELSE m.Nombre + N' ' + m.Apellidos END AS manager,
                (SELECT COUNT(*) FROM fich.Usuarios u WHERE u.DepartamentoId = d.DepartamentoId AND u.Activo = 1) AS miembros
           FROM fich.Departamentos d LEFT JOIN fich.Usuarios m ON m.UsuarioId = d.ManagerId
          ORDER BY d.Activo DESC, d.Nombre`
      );
      return json(200, r.recordset.map((x: any) => ({ ...x, activo: !!x.activo })));
    },
    { roles: ["ADMIN"] }
  ),
});

/* ---------- Crear ---------- */
app.http("gestionDepartamentosCrear", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "gestion/departamentos",
  handler: conSesion(
    async (req, _ctx, actor) => {
      const b = await leerJson(req);
      const nombre = validarNombre(b?.nombre);
      if (typeof nombre !== "string") return error(400, nombre.error);
      const pool = await getPool();
      if (await nombreDuplicado(pool, nombre, null)) return error(409, "Ya existe un departamento con ese nombre");
      const managerId = await managerValido(pool, b?.managerId);
      if (managerId !== null && typeof managerId === "object") return error(400, managerId.error);
      const r = await pool
        .request()
        .input("n", sql.NVarChar(100), nombre)
        .input("m", sql.Int, managerId)
        .query("INSERT INTO fich.Departamentos (Nombre, ManagerId) OUTPUT INSERTED.DepartamentoId VALUES (@n, @m)");
      const id = r.recordset[0].DepartamentoId;
      await auditar(actor.usuarioId, "CREAR_DEPARTAMENTO", "Departamento", id, `${nombre} manager=${managerId ?? "-"}`, ipCliente(req));
      return json(201, { id, nombre });
    },
    { roles: ["ADMIN"] }
  ),
});

/* ---------- Editar nombre / manager / activar-desactivar ---------- */
app.http("gestionDepartamentosEditar", {
  methods: ["PUT"],
  authLevel: "anonymous",
  route: "gestion/departamentos/{id:int}",
  handler: conSesion(
    async (req, _ctx, actor) => {
      const id = Number(req.params.id);
      const b = await leerJson(req);
      if (!b) return error(400, "Datos no válidos");
      const pool = await getPool();
      const act = await pool.request().input("id", sql.Int, id).query("SELECT Nombre, ManagerId, Activo FROM fich.Departamentos WHERE DepartamentoId = @id");
      const actual = act.recordset[0];
      if (!actual) return error(404, "Departamento no encontrado");

      let nombre: string = actual.Nombre;
      if (b.nombre !== undefined) {
        const v = validarNombre(b.nombre);
        if (typeof v !== "string") return error(400, v.error);
        if (await nombreDuplicado(pool, v, id)) return error(409, "Ya existe un departamento con ese nombre");
        nombre = v;
      }
      let managerId: number | null = actual.ManagerId;
      if (b.managerId !== undefined) {
        const m = await managerValido(pool, b.managerId);
        if (m !== null && typeof m === "object") return error(400, m.error);
        managerId = m;
      }
      const activo = b.activo === undefined ? !!actual.Activo : b.activo === true;

      await pool
        .request()
        .input("id", sql.Int, id)
        .input("n", sql.NVarChar(100), nombre)
        .input("m", sql.Int, managerId)
        .input("a", sql.Bit, activo)
        .query("UPDATE fich.Departamentos SET Nombre = @n, ManagerId = @m, Activo = @a WHERE DepartamentoId = @id");

      const cambios: string[] = [];
      if (nombre !== actual.Nombre) cambios.push(`nombre: ${actual.Nombre} -> ${nombre}`);
      if (managerId !== actual.ManagerId) cambios.push(`manager: ${actual.ManagerId ?? "-"} -> ${managerId ?? "-"}`);
      if (activo !== !!actual.Activo) cambios.push(activo ? "activado" : "desactivado");
      if (cambios.length) await auditar(actor.usuarioId, "EDITAR_DEPARTAMENTO", "Departamento", id, cambios.join("; "), ipCliente(req));
      return json(200, { ok: true });
    },
    { roles: ["ADMIN"] }
  ),
});
