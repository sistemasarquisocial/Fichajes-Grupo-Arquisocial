import { app } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { ipCliente } from "../lib/auth";
import { json, error, leerJson, conSesion } from "../lib/http";
import { auditar } from "../lib/auditoria";
import { cargarOrg, aprobadorEfectivo, directosDe, esAprobador, nombreDe } from "../lib/organizacion";
import { fechaLocal } from "../lib/jornada";

/* Suplencias: mientras dura, el suplente aprueba y ve a los directos del titular.
   Las registra el propio aprobador (para sí mismo) o ADMIN (para cualquiera). No se borran: se anulan. */

const TZ = () => process.env.TZ_APP || "Europe/Madrid";
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

const SELECT = `
  SELECT s.SuplenciaId AS id, s.TitularId AS titularId, t.Nombre + N' ' + t.Apellidos AS titular,
         s.SuplenteId AS suplenteId, p.Nombre + N' ' + p.Apellidos AS suplente,
         CONVERT(char(10), s.Desde, 23) AS desde, CONVERT(char(10), s.Hasta, 23) AS hasta,
         c.Nombre + N' ' + c.Apellidos AS creadoPor, s.CreadoUtc AS creadoUtc
    FROM fich.Suplencias s
    JOIN fich.Usuarios t ON t.UsuarioId = s.TitularId
    JOIN fich.Usuarios p ON p.UsuarioId = s.SuplenteId
    JOIN fich.Usuarios c ON c.UsuarioId = s.CreadoPorId`;

/* ---------- Mi cadena: mi aprobador, si soy aprobador, mis suplencias y a quién suplo ---------- */
app.http("miCadena", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "equipo/mi-cadena",
  handler: conSesion(async (_req, _ctx, u) => {
    const org = await cargarOrg();
    const a = aprobadorEfectivo(org, u.usuarioId);
    const pool = await getPool();
    const hoy = fechaLocal(new Date(), TZ());
    const mias = await pool
      .request()
      .input("yo", sql.Int, u.usuarioId)
      .input("hoy", sql.Date, hoy)
      .query(`${SELECT} WHERE s.AnuladaUtc IS NULL AND s.Hasta >= @hoy AND (s.TitularId = @yo OR s.SuplenteId = @yo) ORDER BY s.Desde`);
    return json(200, {
      aprobador: nombreDe(org, a.titular),
      suplenteDeMiAprobador: a.efectivo !== a.titular ? nombreDe(org, a.efectivo) : null,
      esAprobador: esAprobador(org, u.usuarioId),
      directos: directosDe(org, u.usuarioId).length,
      suplencias: mias.recordset,
    });
  }),
});

/* ---------- Directorio (solo nombres de usuarios activos) para elegir suplente ---------- */
app.http("directorio", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "equipo/directorio",
  handler: conSesion(async () => {
    const pool = await getPool();
    const r = await pool.request().query("SELECT UsuarioId AS id, Nombre + N' ' + Apellidos AS nombre FROM fich.Usuarios WHERE Activo = 1 ORDER BY Nombre, Apellidos");
    return json(200, r.recordset);
  }),
});

/* ---------- Listado completo (ADMIN) ---------- */
app.http("gestionSuplencias", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "gestion/suplencias",
  handler: conSesion(
    async () => {
      const pool = await getPool();
      const hoy = fechaLocal(new Date(), TZ());
      const r = await pool.request().input("hoy", sql.Date, hoy).query(`${SELECT} WHERE s.AnuladaUtc IS NULL AND s.Hasta >= @hoy ORDER BY s.Desde, t.Apellidos`);
      return json(200, r.recordset);
    },
    { roles: ["ADMIN"] }
  ),
});

/* ---------- Crear ---------- */
app.http("crearSuplencia", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "suplencias",
  handler: conSesion(async (req, _ctx, u) => {
    const b = await leerJson(req);
    const esAdmin = u.rol === "ADMIN";
    const titularId = esAdmin && b?.titularId ? Number(b.titularId) : u.usuarioId;
    const suplenteId = Number(b?.suplenteId);
    const desde = String(b?.desde ?? "");
    const hasta = String(b?.hasta ?? "");
    const hoy = fechaLocal(new Date(), TZ());
    if (!Number.isInteger(titularId) || !Number.isInteger(suplenteId)) return error(400, "Selecciona el suplente");
    if (titularId === suplenteId) return error(400, "El suplente no puede ser el propio titular");
    if (!RE_FECHA.test(desde) || !RE_FECHA.test(hasta) || desde > hasta) return error(400, "Revisa las fechas");
    if (hasta < hoy) return error(400, "La suplencia no puede terminar en el pasado");
    if (new Date(`${hasta}T00:00:00Z`).getTime() - new Date(`${desde}T00:00:00Z`).getTime() > 366 * 86400000) return error(400, "Máximo 12 meses por suplencia");

    const org = await cargarOrg();
    if (!esAdmin && !esAprobador(org, titularId)) return error(403, "Solo un aprobador puede designar suplente");
    const t = org.usuarios.get(titularId);
    const s = org.usuarios.get(suplenteId);
    if (!t || !t.activo) return error(400, "Titular no válido");
    if (!s || !s.activo) return error(400, "El suplente debe ser un usuario activo");

    const pool = await getPool();
    const solape = await pool
      .request()
      .input("t", sql.Int, titularId)
      .input("d", sql.Date, desde)
      .input("h", sql.Date, hasta)
      .query("SELECT TOP 1 CONVERT(char(10), Desde, 23) AS d, CONVERT(char(10), Hasta, 23) AS h FROM fich.Suplencias WHERE TitularId = @t AND AnuladaUtc IS NULL AND Desde <= @h AND Hasta >= @d");
    if (solape.recordset[0]) return error(409, `Ya hay una suplencia en esas fechas (${solape.recordset[0].d} a ${solape.recordset[0].h}). Anúlala antes de crear otra.`);

    const r = await pool
      .request()
      .input("t", sql.Int, titularId)
      .input("s", sql.Int, suplenteId)
      .input("d", sql.Date, desde)
      .input("h", sql.Date, hasta)
      .input("c", sql.Int, u.usuarioId)
      .query("INSERT INTO fich.Suplencias (TitularId, SuplenteId, Desde, Hasta, CreadoPorId) OUTPUT INSERTED.SuplenciaId VALUES (@t, @s, @d, @h, @c)");
    const id = r.recordset[0].SuplenciaId;
    await auditar(u.usuarioId, "CREAR_SUPLENCIA", "Suplencia", id, `titular=${titularId} (${nombreDe(org, titularId)}) suplente=${suplenteId} (${nombreDe(org, suplenteId)}) ${desde}..${hasta}`, ipCliente(req));
    return json(201, { id });
  }),
});

/* ---------- Anular ---------- */
app.http("anularSuplencia", {
  methods: ["PUT"],
  authLevel: "anonymous",
  route: "suplencias/{id:int}/anular",
  handler: conSesion(async (req, _ctx, u) => {
    const id = Number(req.params.id);
    const pool = await getPool();
    const act = await pool.request().input("id", sql.Int, id).query("SELECT TitularId, AnuladaUtc FROM fich.Suplencias WHERE SuplenciaId = @id");
    const s = act.recordset[0];
    if (!s) return error(404, "Suplencia no encontrada");
    if (s.TitularId !== u.usuarioId && u.rol !== "ADMIN") return error(403, "Solo el titular o un administrador pueden anularla");
    if (s.AnuladaUtc) return json(200, { ok: true });
    await pool.request().input("id", sql.Int, id).query("UPDATE fich.Suplencias SET AnuladaUtc = SYSUTCDATETIME() WHERE SuplenciaId = @id");
    await auditar(u.usuarioId, "ANULAR_SUPLENCIA", "Suplencia", id, null, ipCliente(req));
    return json(200, { ok: true });
  }),
});
