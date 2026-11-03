import { getPool, sql } from "./db";
import { firmar, UsuarioSesion } from "./auth";
import { auditar } from "./auditoria";
import { resumirPorDia, fechaLocal, TipoFichaje } from "./jornada";

export const TZ = () => process.env.TZ_APP || "Europe/Madrid";
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

/** Valida un periodo YYYY-MM-DD (máx. `maxDias` días, sin fechas futuras). Devuelve el error o null. */
export function errorPeriodo(desde: string, hasta: string, maxDias = 366): string | null {
  if (!RE_FECHA.test(desde) || !RE_FECHA.test(hasta) || desde > hasta) return "Periodo no válido";
  const a = new Date(`${desde}T00:00:00Z`).getTime();
  const b = new Date(`${hasta}T00:00:00Z`).getTime();
  if (isNaN(a) || isNaN(b)) return "Periodo no válido";
  if (b - a > maxDias * 86400000) return maxDias >= 366 ? "El periodo máximo es de 12 meses" : `El periodo máximo es de ${maxDias} días`;
  if (hasta > fechaLocal(new Date(), TZ())) return "El periodo no puede terminar en el futuro";
  return null;
}

/** Límites UTC de consulta con margen de un día por la diferencia horaria (después se filtra por fecha local). */
export function limitesConsulta(desde: string, hasta: string) {
  return {
    ini: new Date(new Date(`${desde}T00:00:00Z`).getTime() - 86400000),
    fin: new Date(new Date(`${hasta}T00:00:00Z`).getTime() + 2 * 86400000),
  };
}

/**
 * Datos del registro de jornada de un empleado para generar PDF/Excel en el navegador.
 * Incluye un código de verificación (HMAC del contenido con la clave interna) y deja
 * constancia en la auditoría de quién exporta, de quién, el periodo y el código.
 * La comprobación de permisos se hace ANTES de llamar a esta función.
 */
export async function datosExportacion(empleadoId: number, desde: string, hasta: string, formato: string, actor: UsuarioSesion, ip: string | null) {
  const pool = await getPool();
  const emp = await pool
    .request()
    .input("uid", sql.Int, empleadoId)
    .query(
      `SELECT u.Nombre, u.Apellidos, u.Email, e.Nombre AS Empresa, c.Nombre AS Centro, c.CodigoServicio, d.Nombre AS Departamento
         FROM fich.Usuarios u
         JOIN fich.Empresas e ON e.EmpresaId = u.EmpresaId
         LEFT JOIN fich.Centros c ON c.CentroId = u.CentroId
         LEFT JOIN fich.Departamentos d ON d.DepartamentoId = u.DepartamentoId
        WHERE u.UsuarioId = @uid`
    );
  const d = emp.recordset[0];
  if (!d) return null;

  const { ini, fin } = limitesConsulta(desde, hasta);
  const r = await pool
    .request()
    .input("uid", sql.Int, empleadoId)
    .input("desde", sql.DateTime2, ini)
    .input("hasta", sql.DateTime2, fin)
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
  const firma = await firmar(
    JSON.stringify({ u: empleadoId, a: actor.usuarioId, desde, hasta, g: generadoUtc, f: fichajes.map((f) => [f.id, f.tipo, f.fechaHoraUtc, f.ubicacion]) })
  );
  const codigo = firma.slice(0, 16).toUpperCase().match(/.{4}/g)!.join("-");
  const propio = empleadoId === actor.usuarioId;

  await auditar(
    actor.usuarioId,
    "EXPORTAR_FICHAJES",
    "Usuario",
    empleadoId,
    `${formato} ${desde}..${hasta} fichajes=${fichajes.length} codigo=${codigo}${propio ? "" : " (supervision)"}`,
    ip
  );

  return {
    empleado: {
      nombre: d.Nombre,
      apellidos: d.Apellidos,
      email: d.Email,
      empresa: d.Empresa,
      centro: d.Centro ?? null,
      codigoServicio: d.CodigoServicio ?? null,
      departamento: d.Departamento ?? null,
    },
    exportadoPor: propio ? null : `${actor.nombre} ${actor.apellidos}`,
    desde,
    hasta,
    generadoUtc,
    codigo,
    dias,
    fichajes,
  };
}
