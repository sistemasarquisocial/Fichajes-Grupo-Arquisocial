import { app } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { ipCliente, Rol } from "../lib/auth";
import { json, error, leerJson, conSesion } from "../lib/http";
import { auditar } from "../lib/auditoria";

/* Centros de trabajo.
   - Listar: ADMIN y RRHH (necesario para asignar centro a usuarios).
   - Crear / editar / activar-desactivar: solo ADMIN.
   - Código de servicio: numérico, obligatorio en altas y único en todo el grupo. */

const GESTORES: Rol[] = ["ADMIN", "RRHH"];

interface DatosCentro {
  empresaId: number;
  codigoServicio: string;
  nombre: string;
  direccion: string | null;
  codigoPostal: string | null;
  ciudad: string | null;
  telefono: string | null;
}

const texto = (v: unknown, max: number) => {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

function validar(b: any): DatosCentro | { error: string } {
  const empresaId = Number(b?.empresaId);
  if (!Number.isInteger(empresaId) || empresaId <= 0) return { error: "La empresa es obligatoria" };
  const codigoServicio = String(b?.codigoServicio ?? "").trim();
  if (!/^\d{1,10}$/.test(codigoServicio)) return { error: "El código de servicio es obligatorio y solo admite números (máx. 10 dígitos)" };
  const nombre = texto(b?.nombre, 150);
  if (!nombre || nombre.length < 2) return { error: "El nombre del centro debe tener al menos 2 caracteres" };
  const codigoPostal = texto(b?.codigoPostal, 5);
  if (codigoPostal && !/^\d{5}$/.test(codigoPostal)) return { error: "El código postal debe tener 5 dígitos" };
  const telefono = texto(b?.telefono, 20);
  if (telefono && !/^\+?[\d\s]{9,20}$/.test(telefono)) return { error: "Teléfono no válido (solo números, espacios y + inicial)" };
  return { empresaId, codigoServicio, nombre, direccion: texto(b?.direccion, 200), codigoPostal, ciudad: texto(b?.ciudad, 100), telefono };
}

async function comprobarConflictos(pool: sql.ConnectionPool, d: DatosCentro, excluirId: number | null) {
  const emp = await pool.request().input("e", sql.Int, d.empresaId).query("SELECT Activa FROM fich.Empresas WHERE EmpresaId = @e");
  if (!emp.recordset[0]) return "La empresa no existe";
  const r = await pool
    .request()
    .input("cod", sql.VarChar(10), d.codigoServicio)
    .input("n", sql.NVarChar(150), d.nombre)
    .input("e", sql.Int, d.empresaId)
    .input("id", sql.Int, excluirId)
    .query(
      `SELECT CASE WHEN CodigoServicio = @cod THEN 'codigo' ELSE 'nombre' END AS motivo, Nombre
         FROM fich.Centros
        WHERE (@id IS NULL OR CentroId <> @id)
          AND (CodigoServicio = @cod OR (EmpresaId = @e AND LOWER(Nombre) = LOWER(@n)))`
    );
  const c = r.recordset.find((x: any) => x.motivo === "codigo") ?? r.recordset[0];
  if (!c) return null;
  return c.motivo === "codigo" ? `El código de servicio ${d.codigoServicio} ya lo usa el centro «${c.Nombre}»` : "Ya existe un centro con ese nombre en la empresa";
}

const inputs = (req: sql.Request, d: DatosCentro) =>
  req
    .input("e", sql.Int, d.empresaId)
    .input("cod", sql.VarChar(10), d.codigoServicio)
    .input("n", sql.NVarChar(150), d.nombre)
    .input("dir", sql.NVarChar(200), d.direccion)
    .input("cp", sql.VarChar(5), d.codigoPostal)
    .input("ciu", sql.NVarChar(100), d.ciudad)
    .input("tel", sql.VarChar(20), d.telefono);

/* ---------- Listar ---------- */
app.http("gestionCentrosListar", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "gestion/centros",
  handler: conSesion(
    async () => {
      const pool = await getPool();
      const r = await pool.request().query(
        `SELECT c.CentroId AS id, c.CodigoServicio AS codigoServicio, c.Nombre AS nombre, c.EmpresaId AS empresaId, e.Nombre AS empresa,
                c.Direccion AS direccion, c.CodigoPostal AS codigoPostal, c.Ciudad AS ciudad, c.Telefono AS telefono,
                c.Activo AS activo, c.CreadoUtc AS creadoUtc,
                (SELECT COUNT(*) FROM fich.Usuarios u WHERE u.CentroId = c.CentroId AND u.Activo = 1) AS usuariosActivos
           FROM fich.Centros c JOIN fich.Empresas e ON e.EmpresaId = c.EmpresaId
          ORDER BY c.Activo DESC, e.Nombre, c.Nombre`
      );
      return json(200, r.recordset.map((x: any) => ({ ...x, activo: !!x.activo })));
    },
    { roles: GESTORES }
  ),
});

/* ---------- Crear ---------- */
app.http("gestionCentrosCrear", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "gestion/centros",
  handler: conSesion(
    async (req, _ctx, actor) => {
      const d = validar(await leerJson(req));
      if ("error" in d) return error(400, d.error);
      const pool = await getPool();
      const conflicto = await comprobarConflictos(pool, d, null);
      if (conflicto) return error(409, conflicto);
      const r = await inputs(pool.request(), d).query(
        `INSERT INTO fich.Centros (EmpresaId, CodigoServicio, Nombre, Direccion, CodigoPostal, Ciudad, Telefono)
         OUTPUT INSERTED.CentroId VALUES (@e, @cod, @n, @dir, @cp, @ciu, @tel)`
      );
      const id = r.recordset[0].CentroId;
      await auditar(actor.usuarioId, "CREAR_CENTRO", "Centro", id, `${d.codigoServicio} ${d.nombre} empresa=${d.empresaId}`, ipCliente(req));
      return json(201, { id });
    },
    { roles: ["ADMIN"] }
  ),
});

/* ---------- Editar datos ---------- */
app.http("gestionCentrosEditar", {
  methods: ["PUT"],
  authLevel: "anonymous",
  route: "gestion/centros/{id:int}",
  handler: conSesion(
    async (req, _ctx, actor) => {
      const id = Number(req.params.id);
      const pool = await getPool();
      const act = await pool.request().input("id", sql.Int, id).query("SELECT EmpresaId FROM fich.Centros WHERE CentroId = @id");
      if (!act.recordset[0]) return error(404, "Centro no encontrado");
      const d = validar(await leerJson(req));
      if ("error" in d) return error(400, d.error);
      if (d.empresaId !== act.recordset[0].EmpresaId) {
        const u = await pool.request().input("id", sql.Int, id).query("SELECT COUNT(*) AS n FROM fich.Usuarios WHERE CentroId = @id");
        if (u.recordset[0].n > 0) return error(409, "No se puede cambiar la empresa de un centro que tiene usuarios asignados");
      }
      const conflicto = await comprobarConflictos(pool, d, id);
      if (conflicto) return error(409, conflicto);
      await inputs(pool.request().input("id", sql.Int, id), d).query(
        `UPDATE fich.Centros SET EmpresaId = @e, CodigoServicio = @cod, Nombre = @n, Direccion = @dir,
                CodigoPostal = @cp, Ciudad = @ciu, Telefono = @tel
          WHERE CentroId = @id`
      );
      await auditar(actor.usuarioId, "EDITAR_CENTRO", "Centro", id, `${d.codigoServicio} ${d.nombre} empresa=${d.empresaId}`, ipCliente(req));
      return json(200, { ok: true });
    },
    { roles: ["ADMIN"] }
  ),
});

/* ---------- Activar / desactivar ---------- */
app.http("gestionCentrosEstado", {
  methods: ["PUT"],
  authLevel: "anonymous",
  route: "gestion/centros/{id:int}/estado",
  handler: conSesion(
    async (req, _ctx, actor) => {
      const id = Number(req.params.id);
      const b = await leerJson(req);
      if (typeof b?.activo !== "boolean") return error(400, "Datos no válidos");
      const pool = await getPool();
      const r = await pool
        .request()
        .input("id", sql.Int, id)
        .input("a", sql.Bit, b.activo)
        .query("UPDATE fich.Centros SET Activo = @a OUTPUT INSERTED.Nombre WHERE CentroId = @id");
      if (!r.recordset[0]) return error(404, "Centro no encontrado");
      await auditar(actor.usuarioId, "EDITAR_CENTRO", "Centro", id, b.activo ? "activado" : "desactivado", ipCliente(req));
      return json(200, { ok: true });
    },
    { roles: ["ADMIN"] }
  ),
});
