import { app } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { ipCliente } from "../lib/auth";
import { json, error, leerJson, conSesion } from "../lib/http";
import { auditar } from "../lib/auditoria";

/* Gestión de empresas: solo ADMIN. Las empresas nunca se borran (tienen usuarios y fichajes asociados): se desactivan. */

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
    .query("SELECT 1 AS x FROM fich.Empresas WHERE LOWER(Nombre) = LOWER(@n) AND (@id IS NULL OR EmpresaId <> @id)");
  return r.recordset.length > 0;
}

/* ---------- Listar ---------- */
app.http("gestionEmpresasListar", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "gestion/empresas",
  handler: conSesion(
    async () => {
      const pool = await getPool();
      const r = await pool.request().query(
        `SELECT e.EmpresaId AS id, e.Nombre AS nombre, e.Activa AS activa, e.CreadoUtc AS creadoUtc,
                (SELECT COUNT(*) FROM fich.Centros c WHERE c.EmpresaId = e.EmpresaId AND c.Activo = 1) AS centros,
                (SELECT COUNT(*) FROM fich.Usuarios u WHERE u.EmpresaId = e.EmpresaId AND u.Activo = 1) AS usuariosActivos
           FROM fich.Empresas e
          ORDER BY e.Activa DESC, e.Nombre`
      );
      return json(200, r.recordset.map((x: any) => ({ ...x, activa: !!x.activa })));
    },
    { roles: ["ADMIN"] }
  ),
});

/* ---------- Crear ---------- */
app.http("gestionEmpresasCrear", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "gestion/empresas",
  handler: conSesion(
    async (req, _ctx, actor) => {
      const b = await leerJson(req);
      const nombre = validarNombre(b?.nombre);
      if (typeof nombre !== "string") return error(400, nombre.error);
      const pool = await getPool();
      if (await nombreDuplicado(pool, nombre, null)) return error(409, "Ya existe una empresa con ese nombre");
      const r = await pool
        .request()
        .input("n", sql.NVarChar(100), nombre)
        .query("INSERT INTO fich.Empresas (Nombre) OUTPUT INSERTED.EmpresaId VALUES (@n)");
      const id = r.recordset[0].EmpresaId;
      await auditar(actor.usuarioId, "CREAR_EMPRESA", "Empresa", id, nombre, ipCliente(req));
      return json(201, { id, nombre });
    },
    { roles: ["ADMIN"] }
  ),
});

/* ---------- Editar nombre / activar / desactivar ---------- */
app.http("gestionEmpresasEditar", {
  methods: ["PUT"],
  authLevel: "anonymous",
  route: "gestion/empresas/{id:int}",
  handler: conSesion(
    async (req, _ctx, actor) => {
      const id = Number(req.params.id);
      const b = await leerJson(req);
      if (!b) return error(400, "Datos no válidos");
      const pool = await getPool();
      const act = await pool.request().input("id", sql.Int, id).query("SELECT Nombre, Activa FROM fich.Empresas WHERE EmpresaId = @id");
      const actual = act.recordset[0];
      if (!actual) return error(404, "Empresa no encontrada");

      let nombre: string = actual.Nombre;
      if (b.nombre !== undefined) {
        const v = validarNombre(b.nombre);
        if (typeof v !== "string") return error(400, v.error);
        if (await nombreDuplicado(pool, v, id)) return error(409, "Ya existe una empresa con ese nombre");
        nombre = v;
      }
      const activa = b.activa === undefined ? !!actual.Activa : b.activa === true;
      if (!activa && id === actor.empresaId) return error(400, "No puedes desactivar la empresa a la que perteneces");

      await pool
        .request()
        .input("id", sql.Int, id)
        .input("n", sql.NVarChar(100), nombre)
        .input("a", sql.Bit, activa)
        .query("UPDATE fich.Empresas SET Nombre = @n, Activa = @a WHERE EmpresaId = @id");

      const cambios: string[] = [];
      if (nombre !== actual.Nombre) cambios.push(`nombre: ${actual.Nombre} -> ${nombre}`);
      if (activa !== !!actual.Activa) cambios.push(activa ? "activada" : "desactivada");
      if (cambios.length) await auditar(actor.usuarioId, "EDITAR_EMPRESA", "Empresa", id, cambios.join("; "), ipCliente(req));
      return json(200, { ok: true });
    },
    { roles: ["ADMIN"] }
  ),
});
