import { getPool, sql } from "./db";
import { TipoFichaje, Fichaje } from "./jornada";

/* Fichajes "efectivos": los originales (que nunca se modifican, tabla LEDGER) con las
   correcciones aprobadas aplicadas encima (fich.CorreccionesFichaje, también LEDGER):
   - CAMBIAR_HORA: el fichaje pasa a la nueva hora y queda marcado como corregido (con la hora original).
   - ANADIR: fichaje olvidado añadido por incidencia (sin ubicación: se marca CORRECCION).
   - ANULAR: el fichaje se sigue listando, marcado como anulado, pero no cuenta. */

export interface FichajeEfectivo extends Fichaje {
  usuarioId: number;
  /** FichajeId original (null si es un fichaje añadido por incidencia). */
  id: number | null;
  ubicacion: string;
  precision: number | null;
  corregido: boolean;
  originalUtc: Date | null;
  anadido: boolean;
  anulado: boolean;
}

export interface Original { UsuarioId: number; FichajeId: number; Tipo: TipoFichaje; FechaHoraUtc: Date; UbicacionEstado: string | null; PrecisionM: number | null }
export interface Correccion {
  CorreccionId: number; UsuarioId: number; Tipo: "CAMBIAR_HORA" | "ANADIR" | "ANULAR"; FichajeId: number | null; TipoFichaje: TipoFichaje; FechaHoraUtc: Date | null;
  /** Datos del fichaje original (JOIN), por si queda fuera del rango consultado. */
  OrigTipo?: TipoFichaje | null; OrigUtc?: Date | null; OrigUbicacion?: string | null; OrigPrecision?: number | null;
}

/** Aplica las correcciones (en orden) sobre los originales. Función pura. */
export function aplicarCorrecciones(originales: Original[], correcciones: Correccion[], ini?: Date, fin?: Date): FichajeEfectivo[] {
  const porId = new Map<number, FichajeEfectivo>();
  const anadidos: FichajeEfectivo[] = [];
  const desdeOriginal = (o: Original): FichajeEfectivo => ({
    usuarioId: o.UsuarioId, id: Number(o.FichajeId), tipo: o.Tipo, fechaHoraUtc: o.FechaHoraUtc,
    ubicacion: o.UbicacionEstado ?? "SIN_DATO", precision: o.PrecisionM ?? null,
    corregido: false, originalUtc: null, anadido: false, anulado: false,
  });
  for (const o of originales) porId.set(Number(o.FichajeId), desdeOriginal(o));

  for (const c of [...correcciones].sort((a, b) => Number(a.CorreccionId) - Number(b.CorreccionId))) {
    if (c.Tipo === "ANADIR") {
      if (!c.FechaHoraUtc) continue;
      anadidos.push({
        usuarioId: c.UsuarioId, id: null, tipo: c.TipoFichaje, fechaHoraUtc: c.FechaHoraUtc, ubicacion: "CORRECCION", precision: null,
        corregido: false, originalUtc: null, anadido: true, anulado: false,
      });
      continue;
    }
    if (c.FichajeId === null) continue;
    let f = porId.get(Number(c.FichajeId));
    if (!f && c.OrigUtc && c.OrigTipo) {
      f = desdeOriginal({ UsuarioId: c.UsuarioId, FichajeId: Number(c.FichajeId), Tipo: c.OrigTipo, FechaHoraUtc: c.OrigUtc, UbicacionEstado: c.OrigUbicacion ?? null, PrecisionM: c.OrigPrecision ?? null });
      porId.set(Number(c.FichajeId), f);
    }
    if (!f) continue;
    if (c.Tipo === "CAMBIAR_HORA" && c.FechaHoraUtc) {
      if (!f.corregido) f.originalUtc = f.fechaHoraUtc;
      f.corregido = true;
      f.fechaHoraUtc = c.FechaHoraUtc;
    } else if (c.Tipo === "ANULAR") {
      f.anulado = true;
    }
  }

  return [...porId.values(), ...anadidos]
    .filter((f) => (!ini || f.fechaHoraUtc >= ini) && (!fin || f.fechaHoraUtc <= fin))
    .sort((a, b) => a.fechaHoraUtc.getTime() - b.fechaHoraUtc.getTime() || (a.id ?? Number.MAX_SAFE_INTEGER) - (b.id ?? Number.MAX_SAFE_INTEGER));
}

/**
 * Fichajes efectivos de los usuarios indicados (null = todos) entre ini y fin (UTC), agrupados por usuario.
 * Las correcciones de hora nunca mueven un fichaje más de 1 día, así que basta con mirar el mismo rango.
 */
export async function fichajesEfectivos(usuarioIds: number[] | null, ini: Date, fin: Date, tx?: sql.Transaction): Promise<Map<number, FichajeEfectivo[]>> {
  const pool = tx ? null : await getPool();
  const nueva = () => (tx ? new sql.Request(tx) : pool!.request());
  const filtro = (col: string) => (usuarioIds === null ? "1 = 1" : `${col} IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))`);
  const ids = (usuarioIds ?? []).join(",");
  const r = new Map<number, FichajeEfectivo[]>();
  if (usuarioIds !== null && !usuarioIds.length) return r;

  // Secuencial: una transacción de mssql no admite peticiones simultáneas
  const o = await nueva()
      .input("ids", sql.NVarChar(sql.MAX), ids)
      .input("ini", sql.DateTime2, ini)
      .input("fin", sql.DateTime2, fin)
      .query(
        `SELECT UsuarioId, FichajeId, Tipo, FechaHoraUtc, UbicacionEstado, PrecisionM FROM fich.Fichajes
          WHERE ${filtro("UsuarioId")} AND FechaHoraUtc BETWEEN @ini AND @fin`
      );
  const c = await nueva()
      .input("ids", sql.NVarChar(sql.MAX), ids)
      .input("ini", sql.DateTime2, ini)
      .input("fin", sql.DateTime2, fin)
      .query(
        `SELECT c.CorreccionId, c.UsuarioId, c.Tipo, c.FichajeId, c.TipoFichaje, c.FechaHoraUtc,
                f.Tipo AS OrigTipo, f.FechaHoraUtc AS OrigUtc, f.UbicacionEstado AS OrigUbicacion, f.PrecisionM AS OrigPrecision
           FROM fich.CorreccionesFichaje c
           LEFT JOIN fich.Fichajes f ON f.FichajeId = c.FichajeId
          WHERE ${filtro("c.UsuarioId")}
            AND (c.FechaHoraUtc BETWEEN @ini AND @fin OR f.FechaHoraUtc BETWEEN @ini AND @fin)`
      );
  const origPorU = new Map<number, Original[]>();
  for (const x of o.recordset as Original[]) origPorU.set(x.UsuarioId, [...(origPorU.get(x.UsuarioId) ?? []), x]);
  const corrPorU = new Map<number, Correccion[]>();
  for (const x of c.recordset as Correccion[]) corrPorU.set(x.UsuarioId, [...(corrPorU.get(x.UsuarioId) ?? []), x]);
  // Una corrección de hora sobre un fichaje del rango debe aplicarse aunque la nueva hora quede fuera
  // (para excluirlo): la consulta ya lo cubre porque mira también la hora original.
  for (const uid of new Set([...origPorU.keys(), ...corrPorU.keys()])) {
    const lista = aplicarCorrecciones(origPorU.get(uid) ?? [], corrPorU.get(uid) ?? [], ini, fin);
    if (lista.length) r.set(uid, lista);
  }
  return r;
}

/** Último fichaje efectivo (no anulado) de un usuario: decide su estado actual al fichar. */
export async function ultimoEfectivo(usuarioId: number, tx?: sql.Transaction): Promise<FichajeEfectivo | null> {
  const ahora = Date.now();
  const ini = new Date(ahora - 32 * 86400000);
  const lista = (await fichajesEfectivos([usuarioId], ini, new Date(ahora + 86400000), tx)).get(usuarioId) ?? [];
  const vivos = lista.filter((f) => !f.anulado);
  if (vivos.length) return vivos[vivos.length - 1];
  // Nada en el último mes: el último original anterior (las correcciones solo afectan a los últimos 30 días)
  const req = tx ? new sql.Request(tx) : (await getPool()).request();
  const r = await req
    .input("uid", sql.Int, usuarioId)
    .input("ini", sql.DateTime2, ini)
    .query("SELECT TOP 1 UsuarioId, FichajeId, Tipo, FechaHoraUtc, UbicacionEstado, PrecisionM FROM fich.Fichajes WHERE UsuarioId = @uid AND FechaHoraUtc < @ini ORDER BY FechaHoraUtc DESC, FichajeId DESC");
  const o = r.recordset[0] as Original | undefined;
  return o ? aplicarCorrecciones([o], [])[0] : null;
}

/** Hora local de Madrid (YYYY-MM-DD + HH:MM) → instante UTC. Tiene en cuenta el horario de verano. */
export function localAUtc(fecha: string, hora: string, tz: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !/^\d{2}:\d{2}$/.test(hora)) return null;
  const supuesto = new Date(`${fecha}T${hora}:00Z`);
  if (isNaN(supuesto.getTime())) return null;
  const desfase = (d: Date) => {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(d);
    const g = (t: string) => Number(p.find((x) => x.type === t)!.value);
    return Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"), g("second")) - d.getTime();
  };
  let utc = new Date(supuesto.getTime() - desfase(supuesto));
  utc = new Date(supuesto.getTime() - desfase(utc));
  return utc;
}
