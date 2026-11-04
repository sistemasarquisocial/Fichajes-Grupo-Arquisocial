import { app } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { ipCliente } from "../lib/auth";
import { errorPeriodo, datosExportacion } from "../lib/exportacion";
import { json, error, leerJson, conSesion } from "../lib/http";
import { estadoTras, accionesPermitidas, resumirPorDia, fechaLocal, TipoFichaje } from "../lib/jornada";
import { fichajesEfectivos, ultimoEfectivo } from "../lib/correcciones";
import { justificadoPorDia } from "../lib/horarios";
import { cargarAusencias, textoPeriodo } from "../lib/ausencias";

const TZ = () => process.env.TZ_APP || "Europe/Madrid";
const TIPOS: TipoFichaje[] = ["ENTRADA", "SALIDA", "PAUSA_INICIO", "PAUSA_FIN"];
const ESTADOS_SIN_UBICACION = ["DENEGADA", "NO_DISPONIBLE", "TIMEOUT", "NO_SOPORTADA"] as const;

interface Ubicacion { estado: string; lat: number | null; lon: number | null; precision: number | null }

/** Valida la ubicación enviada por el navegador. Nunca bloquea el fichaje: si no es válida se guarda como NO_DISPONIBLE. */
function leerUbicacion(b: any): Ubicacion {
  const u = b?.ubicacion;
  if (u && typeof u === "object") {
    const lat = Number(u.lat), lon = Number(u.lon), precision = Number(u.precision);
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      const p = Number.isFinite(precision) && precision >= 0 ? Math.min(Math.round(precision), 1000000) : null;
      return { estado: "OK", lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6, precision: p };
    }
  }
  const estado = ESTADOS_SIN_UBICACION.includes(b?.ubicacionEstado) ? b.ubicacionEstado : "NO_DISPONIBLE";
  return { estado, lat: null, lon: null, precision: null };
}

/* ---------- Estado actual + resumen de hoy ---------- */
app.http("fichajeEstado", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "fichajes/estado",
  handler: conSesion(async (_req, _ctx, u) => {
    // Fichajes efectivos (con las correcciones aprobadas aplicadas)
    const ultimo = await ultimoEfectivo(u.usuarioId);
    const estado = estadoTras(ultimo?.tipo ?? null);

    // Desde hace 36 h para cubrir el día local completo y turnos que cruzan medianoche
    const ahora = Date.now();
    const lista = (await fichajesEfectivos([u.usuarioId], new Date(ahora - 36 * 3600000), new Date(ahora + 3600000))).get(u.usuarioId) ?? [];
    const resumen = resumirPorDia(lista, TZ());
    const hoy = resumen.find((d) => d.fecha === fechaLocal(new Date(), TZ())) ?? null;

    return json(200, {
      estado,
      acciones: accionesPermitidas(estado),
      ultimo: ultimo ? { tipo: ultimo.tipo, fechaHoraUtc: ultimo.fechaHoraUtc } : null,
      hoy,
      servidorUtc: new Date().toISOString(),
    });
  }),
});

/* ---------- Fichar ---------- */
app.http("fichar", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "fichajes",
  handler: conSesion(async (req, _ctx, u) => {
    const b = await leerJson(req);
    const tipo = b?.tipo as TipoFichaje;
    if (!TIPOS.includes(tipo)) return error(400, "Tipo de fichaje no válido");
    const ubi = leerUbicacion(b);

    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      // Serializa fichajes concurrentes del mismo usuario
      await new sql.Request(tx).input("uid", sql.Int, u.usuarioId).query("SELECT UsuarioId FROM fich.Usuarios WITH (UPDLOCK, ROWLOCK) WHERE UsuarioId = @uid");
      const ultimo = await ultimoEfectivo(u.usuarioId, tx);
      const estado = estadoTras(ultimo?.tipo ?? null);
      if (!accionesPermitidas(estado).includes(tipo)) {
        await tx.rollback();
        return error(409, "Ese fichaje no es válido en tu estado actual. Recarga la página.");
      }
      const r = await new sql.Request(tx)
        .input("uid", sql.Int, u.usuarioId)
        .input("tipo", sql.VarChar(20), tipo)
        .input("ip", sql.VarChar(45), ipCliente(req))
        .input("ua", sql.NVarChar(400), (req.headers.get("user-agent") ?? "").slice(0, 400))
        .input("lat", sql.Decimal(9, 6), ubi.lat)
        .input("lon", sql.Decimal(9, 6), ubi.lon)
        .input("prec", sql.Int, ubi.precision)
        .input("ubi", sql.VarChar(20), ubi.estado)
        .query(
          `INSERT INTO fich.Fichajes (UsuarioId, Tipo, IpOrigen, UserAgent, Latitud, Longitud, PrecisionM, UbicacionEstado)
           OUTPUT INSERTED.FichajeId, INSERTED.FechaHoraUtc
           VALUES (@uid, @tipo, @ip, @ua, @lat, @lon, @prec, @ubi)`
        );
      await tx.commit();
      return json(201, {
        fichajeId: r.recordset[0].FichajeId,
        tipo,
        fechaHoraUtc: r.recordset[0].FechaHoraUtc,
        ubicacion: { estado: ubi.estado, precision: ubi.precision },
      });
    } catch (e) {
      await tx.rollback().catch(() => {});
      throw e;
    }
  }),
});

/* ---------- Historial propio ---------- */
app.http("historial", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "fichajes/historial",
  handler: conSesion(async (req, _ctx, u) => {
    const desde = req.query.get("desde");
    const hasta = req.query.get("hasta");
    const reFecha = /^\d{4}-\d{2}-\d{2}$/;
    const hoy = new Date();
    const dDesde = desde && reFecha.test(desde) ? new Date(`${desde}T00:00:00Z`) : new Date(hoy.getTime() - 30 * 86400000);
    const dHasta = hasta && reFecha.test(hasta) ? new Date(`${hasta}T23:59:59Z`) : hoy;
    if (dHasta.getTime() - dDesde.getTime() > 186 * 86400000) return error(400, "El rango máximo es de 6 meses");

    // Margen de 1 día por diferencia horaria; se filtra por fecha local después.
    // Fichajes efectivos: incluyen id, marca de corregido (con hora original), añadidos y anulados.
    const lista = (await fichajesEfectivos([u.usuarioId], new Date(dDesde.getTime() - 86400000), new Date(dHasta.getTime() + 86400000))).get(u.usuarioId) ?? [];
    const fDesde = dDesde.toISOString().slice(0, 10);
    const fHasta = dHasta.toISOString().slice(0, 10);
    const dias = resumirPorDia(lista, TZ()).filter((d) => d.fecha >= fDesde && d.fecha <= fHasta);

    // Ausencias justificadas: las aprobadas cuentan como "Justificado"; las pendientes se muestran como pendientes
    const justificados = [...((await justificadoPorDia([u.usuarioId], fDesde, fHasta)).get(u.usuarioId) ?? new Map()).entries()].map(([fecha, j]) => ({ fecha, ...j }));
    const ausencias = ((await cargarAusencias([u.usuarioId], fDesde, fHasta, ["PENDIENTE", "APROBADA"])).get(u.usuarioId) ?? []).map((a) => ({
      id: a.id, motivo: a.motivo, estado: a.estado, fechaInicio: a.fechaInicio, fechaFin: a.fechaFin, horaInicio: a.horaInicio, horaFin: a.horaFin, periodo: textoPeriodo(a),
    }));
    return json(200, { desde: fDesde, hasta: fHasta, dias, justificados, ausencias });
  }),
});

/* ---------- Exportación del propio registro (PDF / Excel se generan en el navegador) ---------- */
app.http("exportarFichajes", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "fichajes/exportar",
  handler: conSesion(async (req, _ctx, u) => {
    const desde = req.query.get("desde") ?? "";
    const hasta = req.query.get("hasta") ?? "";
    const formato = req.query.get("formato") ?? "";
    const err = errorPeriodo(desde, hasta);
    if (err) return error(400, err);
    if (!["pdf", "xlsx"].includes(formato)) return error(400, "Formato no válido");
    const datos = await datosExportacion(u.usuarioId, desde, hasta, formato, u, ipCliente(req));
    if (!datos) return error(404, "Usuario no encontrado");
    return json(200, datos);
  }),
});
