import { getPool, sql } from "./db";
import { UsuarioSesion, ROLES_VEN_TODO } from "./auth";
import { Org, aprobadorEfectivo } from "./organizacion";

/* Ausencias justificadas (db/009_ausencias.sql).
   - Unas horas de un día (HoraInicio/HoraFin) o días completos (sin horas).
   - Pendiente: silencia los avisos de fichaje olvidado de esas horas, pero no cuenta en el saldo.
   - Aprobada: cuenta como horas justificadas (columna "Justificado", separada de lo trabajado).
     Un día completo cuenta como un día trabajado: las horas de su horario ese día (fijo/rotativo)
     o sus horas del mes repartidas entre los días laborables del mes (variable).
   Lo resuelve el mismo circuito que las incidencias (ver lib/incidencias.ts). */

export type EstadoAusencia = "PENDIENTE" | "APROBADA" | "RECHAZADA" | "RETIRADA";
export const DIAS_ATRAS = 30;
export const DIAS_ADELANTE = 365;
export const MAX_DIAS = 366;

export interface Ausencia {
  id: number; usuarioId: number; motivoId: number; motivo: string; requiereJustificante: boolean;
  fechaInicio: string; fechaFin: string; horaInicio: string | null; horaFin: string | null; estado: EstadoAusencia;
}
interface TramoHoras { inicio: string; fin: string }

const aMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
const deMin = (m: number) => `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export const cubreFecha = (a: Pick<Ausencia, "fechaInicio" | "fechaFin">, fecha: string) => fecha >= a.fechaInicio && fecha <= a.fechaFin;
export const diaCompleto = (a: Pick<Ausencia, "horaInicio">) => a.horaInicio === null;

/** Tramo de horario [inicio, fin) en minutos del día (fin > 1440 si termina al día siguiente). */
function enMinutos(t: TramoHoras): [number, number] {
  const a = aMin(t.inicio);
  let b = aMin(t.fin);
  if (b <= a) b += 1440;
  return [a, b];
}

/** Quita de un tramo planificado las horas de ausencia de ese día. Devuelve los trozos que quedan. Función pura. */
export function restarAusencias(fecha: string, t: TramoHoras, ausencias: Ausencia[]): TramoHoras[] {
  const del = ausencias.filter((a) => cubreFecha(a, fecha));
  if (del.some(diaCompleto)) return [];
  let trozos: [number, number][] = [enMinutos(t)];
  for (const a of del) {
    const x = aMin(a.horaInicio!);
    const y = aMin(a.horaFin!);
    trozos = trozos.flatMap(([i, f]) => {
      if (y <= i || x >= f) return [[i, f]] as [number, number][];
      const r: [number, number][] = [];
      if (x > i) r.push([i, x]);
      if (y < f) r.push([y, f]);
      return r;
    });
  }
  return trozos.filter(([i, f]) => f - i >= 1).map(([i, f]) => ({ inicio: deMin(i), fin: deMin(f) }));
}

/**
 * Minutos justificados por una ausencia en una fecha. Función pura.
 * - Horas: la parte que coincide con su horario de ese día; sin horario ese día, la duración indicada.
 * - Día completo: las horas de su horario ese día; si es variable (`minutosDiaVariable` != null), su jornada media
 *   si el día es laborable.
 */
export function minutosJustificados(
  a: Ausencia, fecha: string, plan: TramoHoras[], minutosDiaVariable: number | null, laborable: boolean
): number {
  if (!cubreFecha(a, fecha)) return 0;
  if (diaCompleto(a)) {
    if (minutosDiaVariable !== null) return laborable ? minutosDiaVariable : 0;
    return plan.reduce((s, t) => { const [i, f] = enMinutos(t); return s + f - i; }, 0);
  }
  const x = aMin(a.horaInicio!);
  const y = aMin(a.horaFin!);
  if (!plan.length) return y - x;
  return plan.reduce((s, t) => {
    const [i, f] = enMinutos(t);
    return s + Math.max(0, Math.min(f, y) - Math.max(i, x));
  }, 0);
}

/** Minutos justificados de un día sumando todas sus ausencias (sin pasar de su jornada planificada si la tiene). */
export function minutosDia(lista: Ausencia[], fecha: string, plan: TramoHoras[], minutosDiaVariable: number | null, laborable: boolean): number {
  const del = lista.filter((a) => cubreFecha(a, fecha));
  if (!del.length) return 0;
  if (del.some(diaCompleto)) return minutosJustificados(del.find(diaCompleto)!, fecha, plan, minutosDiaVariable, laborable);
  const total = del.reduce((s, a) => s + minutosJustificados(a, fecha, plan, minutosDiaVariable, laborable), 0);
  const jornada = plan.reduce((s, t) => { const [i, f] = enMinutos(t); return s + f - i; }, 0);
  return plan.length ? Math.min(total, jornada) : total;
}

/* ---------- carga ---------- */
export const SELECT_AUSENCIA = `
  SELECT a.AusenciaId AS id, a.UsuarioId AS usuarioId, a.MotivoId AS motivoId, m.Nombre AS motivo, m.RequiereJustificante AS requiereJustificante,
         CONVERT(char(10), a.FechaInicio, 23) AS fechaInicio, CONVERT(char(10), a.FechaFin, 23) AS fechaFin,
         CONVERT(char(5), a.HoraInicio, 108) AS horaInicio, CONVERT(char(5), a.HoraFin, 108) AS horaFin, a.Estado AS estado
    FROM fich.Ausencias a JOIN fich.MotivosAusencia m ON m.MotivoId = a.MotivoId`;

/** Ausencias de unos usuarios que se solapan con [desde, hasta], en los estados indicados. */
export async function cargarAusencias(ids: number[] | null, desde: string, hasta: string, estados: EstadoAusencia[]): Promise<Map<number, Ausencia[]>> {
  const r = new Map<number, Ausencia[]>();
  if (ids !== null && !ids.length) return r;
  const q = await (await getPool())
    .request()
    .input("ids", sql.NVarChar(sql.MAX), (ids ?? []).join(","))
    .input("d", sql.Date, desde)
    .input("h", sql.Date, hasta)
    .input("est", sql.NVarChar(200), estados.join(","))
    .query(
      `${SELECT_AUSENCIA}
        WHERE ${ids === null ? "1 = 1" : "a.UsuarioId IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))"}
          AND a.FechaInicio <= @h AND a.FechaFin >= @d AND a.Estado IN (SELECT value FROM STRING_SPLIT(@est, ','))
        ORDER BY a.UsuarioId, a.FechaInicio, a.HoraInicio`
    );
  for (const x of q.recordset as any[]) {
    if (!r.has(x.usuarioId)) r.set(x.usuarioId, []);
    r.get(x.usuarioId)!.push({ ...x, requiereJustificante: !!x.requiereJustificante });
  }
  return r;
}

/* ---------- permisos ---------- */

/** Ven el justificante: la propia persona, su aprobador (titular o suplente vigente), RRHH y ADMIN. */
export function puedeVerJustificante(org: Org, actor: UsuarioSesion, propietarioId: number): boolean {
  if (actor.usuarioId === propietarioId || ROLES_VEN_TODO.includes(actor.rol)) return true;
  const a = aprobadorEfectivo(org, propietarioId);
  return a.titular === actor.usuarioId || a.efectivo === actor.usuarioId;
}

/** Texto corto del periodo: "12/11/2026 10:00–12:00", "12/11/2026", "12/11/2026 – 14/11/2026". */
export function textoPeriodo(a: Pick<Ausencia, "fechaInicio" | "fechaFin" | "horaInicio" | "horaFin">): string {
  const f = (x: string) => `${x.slice(8, 10)}/${x.slice(5, 7)}/${x.slice(0, 4)}`;
  if (a.horaInicio) return `${f(a.fechaInicio)} ${a.horaInicio}–${a.horaFin}`;
  return a.fechaInicio === a.fechaFin ? f(a.fechaInicio) : `${f(a.fechaInicio)} – ${f(a.fechaFin)}`;
}
