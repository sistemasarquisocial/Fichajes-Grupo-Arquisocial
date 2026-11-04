import { app } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { ipCliente } from "../lib/auth";
import { json, error, leerJson, conSesion } from "../lib/http";
import { auditar } from "../lib/auditoria";
import {
  NOMBRE_COMUNIDAD, ubicacionDeCentro, normalizarMunicipio, cargarFestivosManuales, festivosDe, festivosAutomaticos, Ubicacion,
} from "../lib/calendario";

/* Calendario laboral (solo ADMIN): calendarios que usan los centros, festivos de cada uno,
   festivos locales por municipio y correcciones de los automáticos. */

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/* ---------- Calendarios en uso (uno por comunidad + municipio de los centros activos) ---------- */
app.http("calendarios", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "gestion/calendarios",
  handler: conSesion(
    async (req) => {
      const anio = Number(req.query.get("anio") ?? new Date().getFullYear());
      if (!Number.isInteger(anio) || anio < 2020 || anio > 2100) return error(400, "Año no válido");
      const pool = await getPool();
      const c = await pool.request().query("SELECT CentroId, Nombre, CodigoServicio, CodigoPostal, Ciudad FROM fich.Centros WHERE Activo = 1 ORDER BY Nombre");
      const manuales = await cargarFestivosManuales(`${anio}-01-01`, `${anio}-12-31`);
      const grupos = new Map<string, { ubicacion: Ubicacion; ciudad: string | null; centros: string[] }>();
      const sinDatos: string[] = [];
      for (const x of c.recordset as any[]) {
        const u = ubicacionDeCentro(x);
        const nombre = `${x.CodigoServicio ? `${x.CodigoServicio} · ` : ""}${x.Nombre}`;
        if (!u.comunidad || !u.municipio) sinDatos.push(nombre);
        const k = `${u.comunidad}|${u.provincia}|${u.municipio}`;
        if (!grupos.has(k)) grupos.set(k, { ubicacion: u, ciudad: x.Ciudad, centros: [] });
        grupos.get(k)!.centros.push(nombre);
      }
      const calendarios = [...grupos.values()].map((g) => ({
        ...g.ubicacion,
        nombreComunidad: g.ubicacion.comunidad ? NOMBRE_COMUNIDAD[g.ubicacion.comunidad] : null,
        ciudad: g.ciudad,
        centros: g.centros,
        festivos: festivosDe(g.ubicacion, `${anio}-01-01`, `${anio}-12-31`, manuales),
        locales: manuales.filter((m) => m.ambito === "MUNICIPIO" && !m.quitar && m.provincia === g.ubicacion.provincia && m.municipio === g.ubicacion.municipio).length,
      }));
      calendarios.sort((a, b) => `${a.nombreComunidad}${a.municipio}`.localeCompare(`${b.nombreComunidad}${b.municipio}`, "es"));
      // Automáticos de cada comunidad presente, para poder quitarlos
      const comunidades = [...new Set(calendarios.map((x) => x.comunidad).filter(Boolean))] as string[];
      return json(200, {
        anio,
        calendarios,
        sinDatos,
        manuales,
        automaticos: Object.fromEntries(comunidades.map((cm) => [cm, festivosAutomaticos(anio, cm)])),
      });
    },
    { roles: ["ADMIN"] }
  ),
});

/* ---------- Añadir festivo local / corrección de comunidad ---------- */
app.http("festivosCrear", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "gestion/festivos",
  handler: conSesion(
    async (req, _ctx, u) => {
      const b = await leerJson(req);
      const fecha = String(b?.fecha ?? "");
      if (!RE_FECHA.test(fecha)) return error(400, "Fecha no válida");
      const ambito = b?.ambito === "COMUNIDAD" ? "COMUNIDAD" : "MUNICIPIO";
      const quitar = b?.quitar === true;
      const nombre = String(b?.nombre ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
      if (!quitar && nombre.length < 3) return error(400, "Indica el nombre del festivo");
      let provincia: string | null = null, municipio: string | null = null, comunidad: string | null = null;
      if (ambito === "MUNICIPIO") {
        provincia = /^\d{2}$/.test(String(b?.provincia ?? "")) ? String(b.provincia) : null;
        municipio = normalizarMunicipio(b?.municipio);
        if (!provincia || !municipio) return error(400, "Indica el municipio");
      } else {
        comunidad = String(b?.comunidad ?? "");
        if (!NOMBRE_COMUNIDAD[comunidad]) return error(400, "Comunidad no válida");
      }
      const pool = await getPool();
      const dup = await pool
        .request()
        .input("f", sql.Date, fecha)
        .input("a", sql.VarChar(10), ambito)
        .input("p", sql.Char(2), provincia)
        .input("m", sql.NVarChar(100), municipio)
        .input("c", sql.Char(2), comunidad)
        .query(
          `SELECT 1 AS x FROM fich.FestivosManuales WHERE Fecha = @f AND Ambito = @a
             AND ISNULL(Provincia, '') = ISNULL(@p, '') AND ISNULL(Municipio, N'') = ISNULL(@m, N'') AND ISNULL(Comunidad, '') = ISNULL(@c, '')`
        );
      if (dup.recordset.length) return error(409, "Ya hay un festivo o corrección en esa fecha para ese calendario");
      if (ambito === "MUNICIPIO" && !quitar) {
        const n = await pool
          .request()
          .input("p", sql.Char(2), provincia)
          .input("m", sql.NVarChar(100), municipio)
          .input("a", sql.Int, Number(fecha.slice(0, 4)))
          .query("SELECT COUNT(*) AS n FROM fich.FestivosManuales WHERE Ambito = 'MUNICIPIO' AND Quitar = 0 AND Provincia = @p AND Municipio = @m AND YEAR(Fecha) = @a");
        if (n.recordset[0].n >= 2) return error(409, "Ese municipio ya tiene 2 festivos locales ese año");
      }
      const r = await pool
        .request()
        .input("f", sql.Date, fecha)
        .input("n", sql.NVarChar(100), quitar ? nombre || "Festivo no aplicable" : nombre)
        .input("a", sql.VarChar(10), ambito)
        .input("p", sql.Char(2), provincia)
        .input("m", sql.NVarChar(100), municipio)
        .input("c", sql.Char(2), comunidad)
        .input("q", sql.Bit, quitar)
        .input("por", sql.Int, u.usuarioId)
        .query(
          `INSERT INTO fich.FestivosManuales (Fecha, Nombre, Ambito, Provincia, Municipio, Comunidad, Quitar, CreadoPorId)
           OUTPUT INSERTED.FestivoId VALUES (@f, @n, @a, @p, @m, @c, @q, @por)`
        );
      await auditar(u.usuarioId, quitar ? "QUITAR_FESTIVO" : "CREAR_FESTIVO", "Festivo", r.recordset[0].FestivoId, `${fecha} ${ambito} ${comunidad ?? `${provincia}/${municipio}`} ${nombre}`, ipCliente(req));
      return json(201, { id: r.recordset[0].FestivoId });
    },
    { roles: ["ADMIN"] }
  ),
});

app.http("festivosBorrar", {
  methods: ["DELETE"],
  authLevel: "anonymous",
  route: "gestion/festivos/{id:int}",
  handler: conSesion(
    async (req, _ctx, u) => {
      const id = Number(req.params.id);
      const pool = await getPool();
      const r = await pool.request().input("id", sql.Int, id).query("DELETE FROM fich.FestivosManuales OUTPUT DELETED.Fecha, DELETED.Nombre WHERE FestivoId = @id");
      if (!r.recordset[0]) return error(404, "Festivo no encontrado");
      await auditar(u.usuarioId, "BORRAR_FESTIVO", "Festivo", id, `${r.recordset[0].Nombre}`, ipCliente(req));
      return json(200, { ok: true });
    },
    { roles: ["ADMIN"] }
  ),
});
