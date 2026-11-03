import { app } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { ipCliente } from "../lib/auth";
import { json, error, conSesion } from "../lib/http";
import { auditar } from "../lib/auditoria";
import { idsVisibles, puedeVerEmpleado } from "../lib/organizacion";
import { errorPeriodo, limitesConsulta, datosExportacion, TZ } from "../lib/exportacion";
import { resumirPorDia, fechaLocal, TipoFichaje } from "../lib/jornada";

/* "Mi equipo": cada aprobador ve a sus directos (y a los del titular al que suple); RRHH y ADMIN ven a todos.
   La cadena de aprobación se calcula en lib/organizacion.ts. Nunca se devuelven coordenadas. */

const MAX_DIAS_RESUMEN = 92;
const MAX_DIAS_DETALLE = 186;
const MAX_EMPLEADOS_EXPORT = 100;

interface FilaFichaje { UsuarioId: number; FichajeId: number; Tipo: TipoFichaje; FechaHoraUtc: Date; UbicacionEstado: string | null }

/** Condición SQL sobre u.UsuarioId según la visibilidad (usa el parámetro @ids). */
const filtroIds = (ids: number[] | null) => (ids === null ? "1 = 1" : "u.UsuarioId IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))");

/* ---------- Resumen del equipo e incidencias ---------- */
app.http("equipoResumen", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "equipo/resumen",
  handler: conSesion(
    async (req, _ctx, u) => {
      const desde = req.query.get("desde") ?? "";
      const hasta = req.query.get("hasta") ?? "";
      const err = errorPeriodo(desde, hasta, MAX_DIAS_RESUMEN);
      if (err) return error(400, err);
      const ids = await idsVisibles(u);
      if (ids !== null && !ids.length) return json(200, { desde, hasta, empleados: [], incidencias: [] });
      const pool = await getPool();
      const filtro = filtroIds(ids);
      const lista = (ids ?? []).join(",");

      const emp = await pool
        .request()
        .input("ids", sql.NVarChar(sql.MAX), lista)
        .query(
          `SELECT u.UsuarioId AS id, u.Nombre AS nombre, u.Apellidos AS apellidos, u.Email AS email, u.Activo AS activo,
                  u.TipoPerfil AS tipoPerfil, u.CentroId AS centroId, c.Nombre AS centro, c.CodigoServicio AS codigoServicio,
                  u.DepartamentoId AS departamentoId, d.Nombre AS departamento
             FROM fich.Usuarios u
             LEFT JOIN fich.Centros c ON c.CentroId = u.CentroId
             LEFT JOIN fich.Departamentos d ON d.DepartamentoId = u.DepartamentoId
            WHERE ${filtro}
            ORDER BY u.Apellidos, u.Nombre`
        );

      const { ini, fin } = limitesConsulta(desde, hasta);
      const fich = await pool
        .request()
        .input("ids", sql.NVarChar(sql.MAX), lista)
        .input("ini", sql.DateTime2, ini)
        .input("fin", sql.DateTime2, fin)
        .query(
          `SELECT f.UsuarioId, f.FichajeId, f.Tipo, f.FechaHoraUtc, f.UbicacionEstado
             FROM fich.Fichajes f JOIN fich.Usuarios u ON u.UsuarioId = f.UsuarioId
            WHERE ${filtro} AND f.FechaHoraUtc BETWEEN @ini AND @fin
            ORDER BY f.UsuarioId, f.FechaHoraUtc, f.FichajeId`
        );
      const porUsuario = new Map<number, FilaFichaje[]>();
      for (const f of fich.recordset as FilaFichaje[]) {
        if (!porUsuario.has(f.UsuarioId)) porUsuario.set(f.UsuarioId, []);
        porUsuario.get(f.UsuarioId)!.push(f);
      }

      const hoy = fechaLocal(new Date(), TZ());
      const incidencias: any[] = [];
      const empleados = emp.recordset.map((e: any) => {
        const lista = porUsuario.get(e.id) ?? [];
        const dias = resumirPorDia(lista.map((f) => ({ tipo: f.Tipo, fechaHoraUtc: f.FechaHoraUtc })), TZ()).filter((d) => d.fecha >= desde && d.fecha <= hasta);
        const sinUbicacion = new Map<string, number>();
        for (const f of lista) {
          const fl = fechaLocal(f.FechaHoraUtc, TZ());
          if (fl >= desde && fl <= hasta && f.UbicacionEstado !== "OK") sinUbicacion.set(fl, (sinUbicacion.get(fl) ?? 0) + 1);
        }
        const diasIncidencia = new Set<string>();
        const base = { empleadoId: e.id, nombre: e.nombre, apellidos: e.apellidos, centro: e.centro ?? null, codigoServicio: e.codigoServicio ?? null, departamento: e.departamento ?? null };
        for (const d of dias) {
          if (d.abierto && d.fecha !== hoy) {
            incidencias.push({ ...base, fecha: d.fecha, tipo: "SIN_CERRAR", detalle: "Jornada sin cerrar" });
            diasIncidencia.add(d.fecha);
          }
        }
        for (const [fecha, n] of sinUbicacion) {
          incidencias.push({ ...base, fecha, tipo: "SIN_UBICACION", detalle: `${n} fichaje(s) sin ubicación` });
          diasIncidencia.add(fecha);
        }
        return {
          ...e,
          activo: !!e.activo,
          minutosTrabajados: dias.reduce((s, d) => s + d.minutosTrabajados, 0),
          minutosPausa: dias.reduce((s, d) => s + d.minutosPausa, 0),
          diasTrabajados: dias.filter((d) => d.minutosTrabajados > 0).length,
          diasConIncidencia: diasIncidencia.size,
          enCurso: dias.some((d) => d.abierto && d.fecha === hoy),
        };
      });
      incidencias.sort((a, b) => (a.fecha === b.fecha ? `${a.apellidos}${a.nombre}`.localeCompare(`${b.apellidos}${b.nombre}`) : a.fecha < b.fecha ? 1 : -1));
      return json(200, { desde, hasta, empleados, incidencias });
    },
    {}
  ),
});

/* ---------- Detalle de un empleado (auditado) ---------- */
app.http("equipoDetalle", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "equipo/empleados/{id:int}/historial",
  handler: conSesion(
    async (req, _ctx, u) => {
      const id = Number(req.params.id);
      const desde = req.query.get("desde") ?? "";
      const hasta = req.query.get("hasta") ?? "";
      const err = errorPeriodo(desde, hasta, MAX_DIAS_DETALLE);
      if (err) return error(400, err);
      if (!(await puedeVerEmpleado(u, id))) return error(403, "No tienes acceso a los fichajes de este empleado");

      const pool = await getPool();
      const emp = await pool
        .request()
        .input("id", sql.Int, id)
        .query(
          `SELECT u.UsuarioId AS id, u.Nombre AS nombre, u.Apellidos AS apellidos, u.Email AS email, u.Activo AS activo,
                  c.Nombre AS centro, c.CodigoServicio AS codigoServicio, d.Nombre AS departamento
             FROM fich.Usuarios u
             LEFT JOIN fich.Centros c ON c.CentroId = u.CentroId
             LEFT JOIN fich.Departamentos d ON d.DepartamentoId = u.DepartamentoId
            WHERE u.UsuarioId = @id`
        );
      if (!emp.recordset[0]) return error(404, "Empleado no encontrado");

      const { ini, fin } = limitesConsulta(desde, hasta);
      const r = await pool
        .request()
        .input("id", sql.Int, id)
        .input("ini", sql.DateTime2, ini)
        .input("fin", sql.DateTime2, fin)
        .query(
          `SELECT FichajeId, Tipo, FechaHoraUtc, UbicacionEstado FROM fich.Fichajes
            WHERE UsuarioId = @id AND FechaHoraUtc BETWEEN @ini AND @fin
            ORDER BY FechaHoraUtc, FichajeId`
        );
      const lista = r.recordset as Omit<FilaFichaje, "UsuarioId">[];
      const dias = resumirPorDia(lista.map((f) => ({ tipo: f.Tipo, fechaHoraUtc: f.FechaHoraUtc })), TZ())
        .filter((d) => d.fecha >= desde && d.fecha <= hasta)
        .map((d) => ({
          fecha: d.fecha,
          minutosTrabajados: d.minutosTrabajados,
          minutosPausa: d.minutosPausa,
          abierto: d.abierto,
          fichajes: lista
            .filter((f) => fechaLocal(f.FechaHoraUtc, TZ()) === d.fecha)
            .map((f) => ({ tipo: f.Tipo, fechaHoraUtc: f.FechaHoraUtc.toISOString(), ubicacion: f.UbicacionEstado ?? "SIN_DATO" })),
        }));

      if (id !== u.usuarioId) {
        await auditar(u.usuarioId, "CONSULTAR_FICHAJES", "Usuario", id, `${desde}..${hasta}`, ipCliente(req));
      }
      return json(200, { empleado: { ...emp.recordset[0], activo: !!emp.recordset[0].activo }, desde, hasta, dias });
    },
    {}
  ),
});

/* ---------- Exportar varios empleados (un informe por persona, cada uno con su código) ---------- */
app.http("equipoExportar", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "equipo/exportar",
  handler: conSesion(
    async (req, _ctx, u) => {
      const desde = req.query.get("desde") ?? "";
      const hasta = req.query.get("hasta") ?? "";
      const formato = req.query.get("formato") ?? "";
      const err = errorPeriodo(desde, hasta);
      if (err) return error(400, err);
      if (!["pdf", "xlsx"].includes(formato)) return error(400, "Formato no válido");
      const ids = [...new Set((req.query.get("ids") ?? "").split(",").filter((x) => /^\d+$/.test(x)).map(Number))];
      if (!ids.length) return error(400, "Selecciona al menos un empleado");
      if (ids.length > MAX_EMPLEADOS_EXPORT) return error(400, `Máximo ${MAX_EMPLEADOS_EXPORT} empleados por exportación`);
      const visibles = await idsVisibles(u);
      if (visibles !== null && ids.some((x) => x !== u.usuarioId && !visibles.includes(x))) return error(403, "No tienes acceso a alguno de los empleados seleccionados");

      const informes = [];
      for (const id of ids) {
        const d = await datosExportacion(id, desde, hasta, formato, u, ipCliente(req));
        if (d) informes.push(d);
      }
      informes.sort((a, b) => `${a.empleado.apellidos} ${a.empleado.nombre}`.localeCompare(`${b.empleado.apellidos} ${b.empleado.nombre}`, "es"));
      return json(200, { informes });
    },
    {}
  ),
});
