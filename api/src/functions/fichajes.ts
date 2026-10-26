import { app } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { ipCliente, firmar } from "../lib/auth";
import { auditar } from "../lib/auditoria";
import { json, error, leerJson, conSesion } from "../lib/http";
import { estadoTras, accionesPermitidas, resumirPorDia, fechaLocal, TipoFichaje } from "../lib/jornada";

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

async function ultimoFichaje(req: sql.Request, usuarioId: number) {
  const r = await req
    .input("uid", sql.Int, usuarioId)
    .query("SELECT TOP 1 Tipo, FechaHoraUtc FROM fich.Fichajes WHERE UsuarioId = @uid ORDER BY FechaHoraUtc DESC, FichajeId DESC");
  return r.recordset[0] as { Tipo: TipoFichaje; FechaHoraUtc: Date } | undefined;
}

/* ---------- Estado actual + resumen de hoy ---------- */
app.http("fichajeEstado", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "fichajes/estado",
  handler: conSesion(async (_req, _ctx, u) => {
    const pool = await getPool();
    const ultimo = await ultimoFichaje(pool.request(), u.usuarioId);
    const estado = estadoTras(ultimo?.Tipo ?? null);

    // Fichajes desde hace 36 h para cubrir el día local completo y turnos que cruzan medianoche
    const r = await pool
      .request()
      .input("uid", sql.Int, u.usuarioId)
      .query(
        `SELECT Tipo, FechaHoraUtc FROM fich.Fichajes
          WHERE UsuarioId = @uid AND FechaHoraUtc >= DATEADD(HOUR, -36, SYSUTCDATETIME())
          ORDER BY FechaHoraUtc, FichajeId`
      );
    const resumen = resumirPorDia(
      r.recordset.map((f: any) => ({ tipo: f.Tipo, fechaHoraUtc: f.FechaHoraUtc })),
      TZ()
    );
    const hoy = resumen.find((d) => d.fecha === fechaLocal(new Date(), TZ())) ?? null;

    return json(200, {
      estado,
      acciones: accionesPermitidas(estado),
      ultimo: ultimo ? { tipo: ultimo.Tipo, fechaHoraUtc: ultimo.FechaHoraUtc } : null,
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
      const ultimo = await ultimoFichaje(new sql.Request(tx), u.usuarioId);
      const estado = estadoTras(ultimo?.Tipo ?? null);
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

    // Margen de 1 día por diferencia horaria; se filtra por fecha local después
    const pool = await getPool();
    const r = await pool
      .request()
      .input("uid", sql.Int, u.usuarioId)
      .input("desde", sql.DateTime2, new Date(dDesde.getTime() - 86400000))
      .input("hasta", sql.DateTime2, new Date(dHasta.getTime() + 86400000))
      .query(
        `SELECT Tipo, FechaHoraUtc FROM fich.Fichajes
          WHERE UsuarioId = @uid AND FechaHoraUtc BETWEEN @desde AND @hasta
          ORDER BY FechaHoraUtc, FichajeId`
      );
    const fDesde = dDesde.toISOString().slice(0, 10);
    const fHasta = dHasta.toISOString().slice(0, 10);
    const dias = resumirPorDia(
      r.recordset.map((f: any) => ({ tipo: f.Tipo, fechaHoraUtc: f.FechaHoraUtc })),
      TZ()
    ).filter((d) => d.fecha >= fDesde && d.fecha <= fHasta);

    return json(200, { desde: fDesde, hasta: fHasta, dias });
  }),
});

/* ---------- Exportación del propio registro (PDF / Excel se generan en el navegador) ----------
   Devuelve los datos del empleado, sus fichajes del periodo y un código de verificación
   (HMAC del contenido con la clave interna). Cada exportación queda en la auditoría con su código. */
app.http("exportarFichajes", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "fichajes/exportar",
  handler: conSesion(async (req, _ctx, u) => {
    const reFecha = /^\d{4}-\d{2}-\d{2}$/;
    const desde = req.query.get("desde") ?? "";
    const hasta = req.query.get("hasta") ?? "";
    const formato = req.query.get("formato") ?? "";
    if (!reFecha.test(desde) || !reFecha.test(hasta) || desde > hasta) return error(400, "Periodo no válido");
    if (!["pdf", "xlsx"].includes(formato)) return error(400, "Formato no válido");
    const dDesde = new Date(`${desde}T00:00:00Z`);
    const dHasta = new Date(`${hasta}T00:00:00Z`);
    if (isNaN(dDesde.getTime()) || isNaN(dHasta.getTime())) return error(400, "Periodo no válido");
    if (dHasta.getTime() - dDesde.getTime() > 366 * 86400000) return error(400, "El periodo máximo es de 12 meses");
    if (hasta > fechaLocal(new Date(), TZ())) return error(400, "El periodo no puede terminar en el futuro");

    const pool = await getPool();
    const emp = await pool
      .request()
      .input("uid", sql.Int, u.usuarioId)
      .query(
        `SELECT u.Nombre, u.Apellidos, u.Email, e.Nombre AS Empresa, c.Nombre AS Centro, c.CodigoServicio
           FROM fich.Usuarios u
           JOIN fich.Empresas e ON e.EmpresaId = u.EmpresaId
           LEFT JOIN fich.Centros c ON c.CentroId = u.CentroId
          WHERE u.UsuarioId = @uid`
      );
    const d = emp.recordset[0];

    // Margen de 1 día por la diferencia horaria; después se filtra por fecha local
    const r = await pool
      .request()
      .input("uid", sql.Int, u.usuarioId)
      .input("desde", sql.DateTime2, new Date(dDesde.getTime() - 86400000))
      .input("hasta", sql.DateTime2, new Date(dHasta.getTime() + 2 * 86400000))
      .query(
        `SELECT FichajeId, Tipo, FechaHoraUtc, UbicacionEstado, PrecisionM
           FROM fich.Fichajes
          WHERE UsuarioId = @uid AND FechaHoraUtc BETWEEN @desde AND @hasta
          ORDER BY FechaHoraUtc, FichajeId`
      );
    const todos = r.recordset as { FichajeId: number; Tipo: TipoFichaje; FechaHoraUtc: Date; UbicacionEstado: string | null; PrecisionM: number | null }[];
    const enRango = todos.filter((f) => {
      const fl = fechaLocal(f.FechaHoraUtc, TZ());
      return fl >= desde && fl <= hasta;
    });
    const dias = resumirPorDia(
      todos.map((f) => ({ tipo: f.Tipo, fechaHoraUtc: f.FechaHoraUtc })),
      TZ()
    )
      .filter((x) => x.fecha >= desde && x.fecha <= hasta)
      .map(({ fecha, minutosTrabajados, minutosPausa, abierto }) => ({ fecha, minutosTrabajados, minutosPausa, abierto }));

    const fichajes = enRango.map((f) => ({
      id: Number(f.FichajeId),
      tipo: f.Tipo,
      fechaHoraUtc: f.FechaHoraUtc.toISOString(),
      ubicacion: f.UbicacionEstado ?? "SIN_DATO",
      precision: f.PrecisionM,
    }));
    const generadoUtc = new Date().toISOString();
    const firma = await firmar(JSON.stringify({ u: u.usuarioId, desde, hasta, g: generadoUtc, f: fichajes.map((f) => [f.id, f.tipo, f.fechaHoraUtc, f.ubicacion]) }));
    const codigo = firma.slice(0, 16).toUpperCase().match(/.{4}/g)!.join("-");

    await auditar(u.usuarioId, "EXPORTAR_FICHAJES", "Usuario", u.usuarioId, `${formato} ${desde}..${hasta} fichajes=${fichajes.length} codigo=${codigo}`, ipCliente(req));

    return json(200, {
      empleado: {
        nombre: d.Nombre,
        apellidos: d.Apellidos,
        email: d.Email,
        empresa: d.Empresa,
        centro: d.Centro ?? null,
        codigoServicio: d.CodigoServicio ?? null,
      },
      desde,
      hasta,
      generadoUtc,
      codigo,
      dias,
      fichajes,
    });
  }),
});
