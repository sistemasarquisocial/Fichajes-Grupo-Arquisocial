import { getPool, sql } from "./db";
import { fechaLocal, resumirPorDia, estadoTras, Estado, TipoFichaje } from "./jornada";
import { FichajeEfectivo, fichajesEfectivos, localAUtc } from "./correcciones";
import { Ubicacion, ubicacionDeCentro, cargarFestivosManuales, festivosDe, FestivoManual } from "./calendario";
import { Org, directosDe } from "./organizacion";
import { Ausencia, cargarAusencias, minutosDia, restarAusencias } from "./ausencias";

/* Horario de cada trabajador:
   - FIJO: una semana tipo. ROTATIVO: patrón de N semanas que se repite desde InicioPatron.
     Su objetivo del mes = suma de horas planificadas (sin festivos si DescuentaFestivos). Saldo informativo.
   - VARIABLE: horas al mes. La diferencia va a la bolsa de horas (deuda), que se arrastra sin límite;
     lo trabajado de más compensa primero la deuda.
   - Cambio de un día: sustituye el plan de esa fecha (sin tramos = libre).
   - Ajuste de mes: horas objetivo de un mes concreto (vacaciones, bajas...).
   Todas las horas son locales de Madrid; los turnos que terminan a una hora <= inicio acaban al día siguiente. */

export const TZ = () => process.env.TZ_APP || "Europe/Madrid";
export type TipoHorario = "FIJO" | "ROTATIVO" | "VARIABLE";
export const TIPOS_HORARIO: TipoHorario[] = ["FIJO", "ROTATIVO", "VARIABLE"];
const DIA = 86400000;

export interface Tramo { semana: number; dia: number; inicio: string; fin: string; turnoId: number | null }
export interface TramoDia { inicio: string; fin: string }
export interface Horario {
  usuarioId: number; tipo: TipoHorario; horasMes: number | null; semanas: number; inicioPatron: string | null;
  bolsaDesde: string | null; descuentaFestivos: boolean; tramos: Tramo[];
}
export interface ParamsCentro { margen: number; escalado: number; umbral: number; maxSinSalida: number; ubicacion: Ubicacion }
export const PARAMS_DEFECTO: ParamsCentro = { margen: 10, escalado: 30, umbral: 10, maxSinSalida: 12, ubicacion: { comunidad: null, provincia: null, municipio: null } };

/* ---------- utilidades de fecha y hora ---------- */
export const RE_HORA = /^([01]\d|2[0-3]):[0-5]\d$/;
export const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const aMin = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
/** Duración de un tramo en minutos (si fin <= inicio, termina al día siguiente). */
export const minutosTramo = (t: TramoDia) => {
  const d = aMin(t.fin) - aMin(t.inicio);
  return d > 0 ? d : d + 1440;
};
const sumarDias = (f: string, n: number) => new Date(Date.parse(`${f}T12:00:00Z`) + n * DIA).toISOString().slice(0, 10);
/** 1 = lunes ... 7 = domingo */
export const diaSemana = (f: string) => ((new Date(`${f}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
export const diasDelMes = (mes: string) => {
  const r: string[] = [];
  for (let f = `${mes}-01`; f.startsWith(mes); f = sumarDias(f, 1)) r.push(f);
  return r;
};
export const mesAnterior = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
};
const mesSiguiente = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
};

/** Semana del patrón (1..N) que toca en una fecha. */
export function semanaPatron(h: Pick<Horario, "tipo" | "semanas" | "inicioPatron">, fecha: string): number {
  if (h.tipo !== "ROTATIVO" || !h.inicioPatron || h.semanas <= 1) return 1;
  const semanas = Math.floor((Date.parse(`${fecha}T12:00:00Z`) - Date.parse(`${h.inicioPatron}T12:00:00Z`)) / (7 * DIA));
  return (((semanas % h.semanas) + h.semanas) % h.semanas) + 1;
}

/** Tramos planificados de un día (cambio puntual > festivo > patrón). */
export function planDia(h: Horario | undefined, fecha: string, cambios: Map<string, TramoDia[]>, festivos: Set<string>): TramoDia[] {
  if (cambios.has(fecha)) return cambios.get(fecha)!;
  if (!h || h.tipo === "VARIABLE") return [];
  if (h.descuentaFestivos && festivos.has(fecha)) return [];
  const s = semanaPatron(h, fecha);
  const d = diaSemana(fecha);
  return h.tramos.filter((t) => t.semana === s && t.dia === d).map(({ inicio, fin }) => ({ inicio, fin })).sort((a, b) => a.inicio.localeCompare(b.inicio));
}

/** Minutos objetivo del mes (y hasta una fecha incluida, solo para FIJO/ROTATIVO sin ajuste). */
export function objetivoMes(
  h: Horario | undefined, mes: string, cambios: Map<string, TramoDia[]>, festivos: Set<string>, ajusteHoras: number | null, hasta?: string
): { total: number; hastaFecha: number | null } {
  if (ajusteHoras !== null) return { total: Math.round(ajusteHoras * 60), hastaFecha: null };
  if (!h) return { total: 0, hastaFecha: null };
  if (h.tipo === "VARIABLE") {
    // Los cambios de día no alteran las horas al mes de un variable
    return { total: Math.round((h.horasMes ?? 0) * 60), hastaFecha: null };
  }
  let total = 0;
  let hastaFecha = 0;
  for (const f of diasDelMes(mes)) {
    const m = planDia(h, f, cambios, festivos).reduce((s, t) => s + minutosTramo(t), 0);
    total += m;
    if (hasta && f <= hasta) hastaFecha += m;
  }
  return { total, hastaFecha: hasta ? hastaFecha : null };
}

/** Minutos trabajados en el mes según los fichajes efectivos (los tramos se atribuyen al día en que empiezan). */
export function trabajadoMes(lista: FichajeEfectivo[], mes: string, ahora = new Date()): number {
  return resumirPorDia(lista, TZ(), ahora).filter((d) => d.fecha.startsWith(mes)).reduce((s, d) => s + d.minutosTrabajados, 0);
}

/** Bolsa al cierre de un mes: la deuda nunca es negativa; el exceso compensa primero la deuda. */
export const bolsaTrasMes = (bolsaAnterior: number, objetivo: number, trabajado: number) => Math.max(0, bolsaAnterior + objetivo - trabajado);

/* ---------- avisos de fichaje (en vivo) ---------- */
export type TipoAviso = "SIN_ENTRADA" | "SIN_SALIDA" | "RETRASO";
export interface Aviso { tipo: TipoAviso; prevista: string | null; desdeUtc: string; minutos: number; escalado: boolean; texto: string }

const hhmm = (d: Date) => d.toLocaleTimeString("es-ES", { timeZone: TZ(), hour: "2-digit", minute: "2-digit" });

/** Convierte un tramo de una fecha a instantes UTC. */
export function intervaloUtc(fecha: string, t: TramoDia): { ini: Date; fin: Date } | null {
  const ini = localAUtc(fecha, t.inicio, TZ());
  const finFecha = aMin(t.fin) > aMin(t.inicio) ? fecha : sumarDias(fecha, 1);
  const fin = localAUtc(finFecha, t.fin, TZ());
  return ini && fin ? { ini, fin } : null;
}

/**
 * Avisos de un trabajador ahora mismo. Función pura.
 * - SIN_ENTRADA: tenía un tramo empezado (más el margen) y está fuera.
 * - RETRASO: fichó la entrada después de la hora prevista más el margen (informativo).
 * - SIN_SALIDA: sigue dentro pasada la hora de fin más el margen, o (sin plan) más de N horas seguidas.
 * Se escalan al aprobador cuando pasan los minutos de escalado sin reaccionar.
 */
export function calcularAvisos(
  tramos: { fecha: string; t: TramoDia }[], fichajes: FichajeEfectivo[], p: ParamsCentro, ahora: Date
): Aviso[] {
  const vivos = fichajes.filter((f) => !f.anulado && f.fechaHoraUtc <= ahora);
  const ultimo = vivos[vivos.length - 1];
  const estado: Estado = estadoTras((ultimo?.tipo ?? null) as TipoFichaje | null);
  const dentro = estado !== "FUERA";
  const ms = (min: number) => min * 60000;
  const avisos: Aviso[] = [];
  let salidaPorPlan = false;

  for (const { fecha, t } of tramos) {
    const iv = intervaloUtc(fecha, t);
    if (!iv || iv.ini > ahora) continue;
    const limiteEntrada = new Date(iv.ini.getTime() + ms(p.margen));
    const entradas = vivos.filter((f) => f.tipo === "ENTRADA" && f.fechaHoraUtc.getTime() >= iv.ini.getTime() - ms(120) && f.fechaHoraUtc <= iv.fin);
    if (!entradas.length) {
      if (!dentro && ahora >= limiteEntrada && ahora < iv.fin) {
        const min = Math.round((ahora.getTime() - iv.ini.getTime()) / 60000);
        avisos.push({
          tipo: "SIN_ENTRADA", prevista: t.inicio, desdeUtc: limiteEntrada.toISOString(), minutos: min,
          escalado: ahora.getTime() >= limiteEntrada.getTime() + ms(p.escalado),
          texto: `No ha fichado la entrada (prevista a las ${t.inicio})`,
        });
      }
    } else if (entradas[0].fechaHoraUtc > limiteEntrada && fechaLocal(entradas[0].fechaHoraUtc, TZ()) === fechaLocal(ahora, TZ())) {
      const min = Math.round((entradas[0].fechaHoraUtc.getTime() - iv.ini.getTime()) / 60000);
      avisos.push({ tipo: "RETRASO", prevista: t.inicio, desdeUtc: entradas[0].fechaHoraUtc.toISOString(), minutos: min, escalado: false, texto: `Entrada a las ${hhmm(entradas[0].fechaHoraUtc)} (prevista ${t.inicio})` });
    }
    const limiteSalida = new Date(iv.fin.getTime() + ms(p.margen));
    if (dentro && entradas.length && ahora >= limiteSalida) {
      const siguiente = tramos.some(({ fecha: f2, t: t2 }) => {
        const iv2 = intervaloUtc(f2, t2);
        return iv2 && iv2.ini > iv.fin && iv2.ini.getTime() - ms(p.margen) <= ahora.getTime();
      });
      if (!siguiente) {
        salidaPorPlan = true;
        avisos.push({
          tipo: "SIN_SALIDA", prevista: t.fin, desdeUtc: limiteSalida.toISOString(), minutos: Math.round((ahora.getTime() - iv.fin.getTime()) / 60000),
          escalado: ahora.getTime() >= limiteSalida.getTime() + ms(p.escalado),
          texto: `No ha fichado la salida (prevista a las ${t.fin})`,
        });
      }
    }
  }

  if (dentro && !salidaPorPlan) {
    const entrada = [...vivos].reverse().find((f) => f.tipo === "ENTRADA");
    if (entrada) {
      const limite = new Date(entrada.fechaHoraUtc.getTime() + p.maxSinSalida * 3600000);
      if (ahora >= limite) {
        avisos.push({
          tipo: "SIN_SALIDA", prevista: null, desdeUtc: limite.toISOString(), minutos: Math.round((ahora.getTime() - entrada.fechaHoraUtc.getTime()) / 60000),
          escalado: ahora.getTime() >= limite.getTime() + ms(p.escalado),
          texto: `Lleva más de ${p.maxSinSalida} h sin fichar la salida (entró a las ${hhmm(entrada.fechaHoraUtc)})`,
        });
      }
    }
  }
  return avisos;
}

/* ---------- carga desde BD ---------- */
export async function cargarHorarios(ids: number[] | null): Promise<Map<number, Horario>> {
  const pool = await getPool();
  const filtro = ids === null ? "1 = 1" : "UsuarioId IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))";
  const lista = (ids ?? []).join(",");
  const r = new Map<number, Horario>();
  if (ids !== null && !ids.length) return r;
  const h = await pool
    .request()
    .input("ids", sql.NVarChar(sql.MAX), lista)
    .query(
      `SELECT UsuarioId, Tipo, HorasMes, Semanas, CONVERT(char(10), InicioPatron, 23) AS InicioPatron, BolsaDesde, DescuentaFestivos
         FROM fich.Horarios WHERE ${filtro}`
    );
  for (const x of h.recordset as any[])
    r.set(x.UsuarioId, {
      usuarioId: x.UsuarioId, tipo: x.Tipo, horasMes: x.HorasMes === null ? null : Number(x.HorasMes), semanas: x.Semanas,
      inicioPatron: x.InicioPatron, bolsaDesde: x.BolsaDesde, descuentaFestivos: !!x.DescuentaFestivos, tramos: [],
    });
  if (r.size) {
    const t = await pool
      .request()
      .input("ids", sql.NVarChar(sql.MAX), lista)
      .query(
        `SELECT UsuarioId, Semana, DiaSemana, CONVERT(char(5), HoraInicio, 108) AS Ini, CONVERT(char(5), HoraFin, 108) AS Fin, TurnoId
           FROM fich.HorarioTramos WHERE ${filtro} ORDER BY UsuarioId, Semana, DiaSemana, HoraInicio`
      );
    for (const x of t.recordset as any[]) r.get(x.UsuarioId)?.tramos.push({ semana: x.Semana, dia: x.DiaSemana, inicio: x.Ini, fin: x.Fin, turnoId: x.TurnoId });
  }
  return r;
}

/** Cambios de día por usuario: usuario → fecha → tramos (vacío = libre). */
export async function cargarCambios(ids: number[] | null, desde: string, hasta: string): Promise<Map<number, Map<string, TramoDia[]>>> {
  const r = new Map<number, Map<string, TramoDia[]>>();
  if (ids !== null && !ids.length) return r;
  const c = await (await getPool())
    .request()
    .input("ids", sql.NVarChar(sql.MAX), (ids ?? []).join(","))
    .input("d", sql.Date, desde)
    .input("h", sql.Date, hasta)
    .query(
      `SELECT UsuarioId, CONVERT(char(10), Fecha, 23) AS Fecha, CONVERT(char(5), HoraInicio, 108) AS Ini, CONVERT(char(5), HoraFin, 108) AS Fin
         FROM fich.CambiosDia
        WHERE ${ids === null ? "1 = 1" : "UsuarioId IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))"} AND Fecha BETWEEN @d AND @h
        ORDER BY UsuarioId, Fecha, HoraInicio`
    );
  for (const x of c.recordset as any[]) {
    if (!r.has(x.UsuarioId)) r.set(x.UsuarioId, new Map());
    const m = r.get(x.UsuarioId)!;
    if (!m.has(x.Fecha)) m.set(x.Fecha, []);
    if (x.Ini) m.get(x.Fecha)!.push({ inicio: x.Ini, fin: x.Fin });
  }
  return r;
}

export async function cargarAjustes(ids: number[] | null, meses: string[]): Promise<Map<string, { horas: number; motivo: string }>> {
  const r = new Map<string, { horas: number; motivo: string }>();
  if ((ids !== null && !ids.length) || !meses.length) return r;
  const a = await (await getPool())
    .request()
    .input("ids", sql.NVarChar(sql.MAX), (ids ?? []).join(","))
    .input("meses", sql.NVarChar(sql.MAX), meses.join(","))
    .query(
      `SELECT UsuarioId, Mes, Horas, Motivo FROM fich.AjustesMes
        WHERE ${ids === null ? "1 = 1" : "UsuarioId IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))"}
          AND Mes IN (SELECT value FROM STRING_SPLIT(@meses, ','))`
    );
  for (const x of a.recordset as any[]) r.set(`${x.UsuarioId}|${x.Mes}`, { horas: Number(x.Horas), motivo: x.Motivo });
  return r;
}

/** Parámetros y ubicación del centro de cada usuario (o los de defecto si no tiene centro). */
export async function cargarParams(ids: number[] | null): Promise<Map<number, ParamsCentro & { centroId: number | null }>> {
  const r = new Map<number, ParamsCentro & { centroId: number | null }>();
  if (ids !== null && !ids.length) return r;
  const q = await (await getPool())
    .request()
    .input("ids", sql.NVarChar(sql.MAX), (ids ?? []).join(","))
    .query(
      `SELECT u.UsuarioId, c.CentroId, c.CodigoPostal, c.Ciudad, c.MargenMinutos, c.EscaladoMinutos, c.UmbralSobrecargaHoras, c.MaxHorasSinSalida
         FROM fich.Usuarios u LEFT JOIN fich.Centros c ON c.CentroId = u.CentroId
        WHERE ${ids === null ? "1 = 1" : "u.UsuarioId IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))"}`
    );
  for (const x of q.recordset as any[])
    r.set(x.UsuarioId, x.CentroId
      ? { centroId: x.CentroId, margen: x.MargenMinutos, escalado: x.EscaladoMinutos, umbral: x.UmbralSobrecargaHoras, maxSinSalida: x.MaxHorasSinSalida, ubicacion: ubicacionDeCentro(x) }
      : { centroId: null, ...PARAMS_DEFECTO });
  return r;
}

/** Festivos (conjunto de fechas) por ubicación, con caché por clave. */
export function festivosPorUbicacion(manuales: FestivoManual[], desde: string, hasta: string) {
  const cache = new Map<string, Set<string>>();
  return (u: Ubicacion) => {
    const k = `${u.comunidad}|${u.provincia}|${u.municipio}`;
    if (!cache.has(k)) cache.set(k, new Set(festivosDe(u, desde, hasta, manuales).map((f) => f.fecha)));
    return cache.get(k)!;
  };
}

/** Días laborables del mes (lunes a viernes que no son festivo): reparten las horas al mes de un horario variable. */
export const laborablesMes = (mes: string, festivos: Set<string>) => diasDelMes(mes).filter((f) => diaSemana(f) <= 5 && !festivos.has(f)).length;

export interface Justificado { minutos: number; motivos: string[] }

/**
 * Minutos justificados por ausencias APROBADAS, por usuario y día, entre dos fechas (YYYY-MM-DD).
 * Un día completo cuenta como un día trabajado: horas de su horario ese día (fijo/rotativo)
 * o sus horas del mes / días laborables del mes (variable).
 */
export async function justificadoPorDia(ids: number[], desde: string, hasta: string): Promise<Map<number, Map<string, Justificado>>> {
  const r = new Map<number, Map<string, Justificado>>();
  if (!ids.length || desde > hasta) return r;
  const aus = await cargarAusencias(ids, desde, hasta, ["APROBADA"]);
  const conAus = ids.filter((id) => aus.has(id));
  if (!conAus.length) return r;
  // Meses completos: hacen falta para contar los días laborables de cada mes
  const iniMes = `${desde.slice(0, 7)}-01`;
  const finMes = diasDelMes(hasta.slice(0, 7)).slice(-1)[0];
  const [horarios, cambios, params, manuales] = await Promise.all([
    cargarHorarios(conAus), cargarCambios(conAus, iniMes, finMes), cargarParams(conAus), cargarFestivosManuales(iniMes, finMes),
  ]);
  const festivos = festivosPorUbicacion(manuales, iniMes, finMes);
  for (const id of conAus) {
    const h = horarios.get(id);
    const fs = festivos((params.get(id) ?? PARAMS_DEFECTO).ubicacion);
    const cm = cambios.get(id) ?? new Map<string, TramoDia[]>();
    const lista = aus.get(id)!;
    const m = new Map<string, Justificado>();
    for (let f = desde; f <= hasta; f = sumarDias(f, 1)) {
      const del = lista.filter((a) => f >= a.fechaInicio && f <= a.fechaFin);
      if (!del.length) continue;
      const diaVariable = h?.tipo === "VARIABLE" ? Math.round(((h.horasMes ?? 0) * 60) / Math.max(1, laborablesMes(f.slice(0, 7), fs))) : null;
      const laborable = diaSemana(f) <= 5 && !fs.has(f);
      m.set(f, { minutos: minutosDia(del, f, planDia(h, f, cm, fs), diaVariable, laborable), motivos: [...new Set(del.map((a) => a.motivo))] });
    }
    if (m.size) r.set(id, m);
  }
  return r;
}

const totalMes = (m: Map<string, Justificado> | undefined, mes: string) =>
  [...(m ?? new Map<string, Justificado>()).entries()].filter(([f]) => f.startsWith(mes)).reduce((s, [, j]) => s + j.minutos, 0);

/* ---------- resumen mensual de un grupo de usuarios ---------- */
export interface ResumenMes {
  usuarioId: number; tipo: TipoHorario | null; objetivoMin: number; objetivoHastaHoyMin: number | null; trabajadoMin: number;
  /** Horas justificadas por ausencias aprobadas: cuentan como cumplidas en el saldo y en la bolsa. */
  justificadoMin: number;
  ajuste: { horas: number; motivo: string } | null; bolsaAnteriorMin: number | null; pendienteMin: number | null;
  excesoMin: number; sobrecarga: boolean; umbralHoras: number; centroId: number | null;
}

/**
 * Cierra (una sola vez) los meses terminados de los horarios VARIABLE que aún no tengan cierre
 * y devuelve la bolsa acumulada al cierre del mes anterior a `mes`.
 */
async function bolsaAntesDe(ids: number[], horarios: Map<number, Horario>, mes: string): Promise<Map<number, number>> {
  const r = new Map<number, number>();
  const variables = ids.filter((id) => horarios.get(id)?.tipo === "VARIABLE" && horarios.get(id)!.bolsaDesde);
  if (!variables.length) return r;
  const pool = await getPool();
  const c = await pool
    .request()
    .input("ids", sql.NVarChar(sql.MAX), variables.join(","))
    .query("SELECT UsuarioId, Mes, BolsaMinutos FROM fich.CierresMes WHERE UsuarioId IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ',')) ORDER BY UsuarioId, Mes");
  const cierres = new Map<number, Map<string, number>>();
  for (const x of c.recordset as any[]) {
    if (!cierres.has(x.UsuarioId)) cierres.set(x.UsuarioId, new Map());
    cierres.get(x.UsuarioId)!.set(x.Mes, x.BolsaMinutos);
  }
  const mesActual = fechaLocal(new Date(), TZ()).slice(0, 7);
  for (const id of variables) {
    const h = horarios.get(id)!;
    const propios = cierres.get(id) ?? new Map<string, number>();
    let bolsa = 0;
    for (let m = h.bolsaDesde!; m < mes; m = mesSiguiente(m)) {
      if (propios.has(m)) { bolsa = propios.get(m)!; continue; }
      if (m >= mesActual) break; // el mes en curso no se cierra
      // Cierre perezoso del mes terminado
      const ini = `${m}-01`;
      const fin = `${mesSiguiente(m)}-01`;
      const ef = (await fichajesEfectivos([id], new Date(Date.parse(`${ini}T00:00:00Z`) - DIA), new Date(Date.parse(`${fin}T00:00:00Z`) + DIA))).get(id) ?? [];
      const ajuste = (await cargarAjustes([id], [m])).get(`${id}|${m}`) ?? null;
      const objetivo = objetivoMes(h, m, new Map(), new Set(), ajuste?.horas ?? null).total;
      const trabajado = trabajadoMes(ef, m, new Date(Date.parse(`${fin}T00:00:00Z`)));
      const justificado = totalMes((await justificadoPorDia([id], ini, diasDelMes(m).slice(-1)[0])).get(id), m);
      bolsa = bolsaTrasMes(bolsa, objetivo, trabajado + justificado);
      await pool
        .request()
        .input("u", sql.Int, id)
        .input("m", sql.Char(7), m)
        .input("t", sql.VarChar(10), h.tipo)
        .input("o", sql.Int, objetivo)
        .input("w", sql.Int, trabajado)
        .input("b", sql.Int, bolsa)
        .query(
          `IF NOT EXISTS (SELECT 1 FROM fich.CierresMes WHERE UsuarioId = @u AND Mes = @m)
           INSERT INTO fich.CierresMes (UsuarioId, Mes, Tipo, MinutosObjetivo, MinutosTrabajados, BolsaMinutos) VALUES (@u, @m, @t, @o, @w, @b)`
        );
    }
    r.set(id, bolsa);
  }
  return r;
}

export async function resumenMes(ids: number[], mes: string, ahora = new Date()): Promise<Map<number, ResumenMes>> {
  const r = new Map<number, ResumenMes>();
  if (!ids.length) return r;
  const ini = `${mes}-01`;
  const fin = diasDelMes(mes).slice(-1)[0];
  const hoy = fechaLocal(ahora, TZ());
  const [horarios, cambios, ajustes, params, manuales] = await Promise.all([
    cargarHorarios(ids), cargarCambios(ids, ini, fin), cargarAjustes(ids, [mes]), cargarParams(ids), cargarFestivosManuales(ini, fin),
  ]);
  const festivos = festivosPorUbicacion(manuales, ini, fin);
  const ef = await fichajesEfectivos(ids, new Date(Date.parse(`${ini}T00:00:00Z`) - DIA), new Date(Date.parse(`${fin}T00:00:00Z`) + 2 * DIA));
  const bolsas = await bolsaAntesDe(ids, horarios, mes);
  const justificados = await justificadoPorDia(ids, ini, fin);
  for (const id of ids) {
    const h = horarios.get(id);
    const p = params.get(id) ?? { centroId: null, ...PARAMS_DEFECTO };
    const ajuste = ajustes.get(`${id}|${mes}`) ?? null;
    const obj = objetivoMes(h, mes, cambios.get(id) ?? new Map(), festivos(p.ubicacion), ajuste?.horas ?? null, hoy < fin ? hoy : fin);
    const trabajado = trabajadoMes(ef.get(id) ?? [], mes, ahora);
    const justificado = totalMes(justificados.get(id), mes);
    const bolsaAnterior = h?.tipo === "VARIABLE" ? bolsas.get(id) ?? 0 : null;
    const pendiente = h?.tipo === "VARIABLE" ? (bolsaAnterior ?? 0) + obj.total - trabajado - justificado : null;
    const exceso = h ? trabajado + justificado - obj.total : 0;
    r.set(id, {
      usuarioId: id, tipo: h?.tipo ?? null, objetivoMin: obj.total, objetivoHastaHoyMin: obj.hastaFecha, trabajadoMin: trabajado,
      justificadoMin: justificado, ajuste, bolsaAnteriorMin: bolsaAnterior, pendienteMin: pendiente, excesoMin: exceso,
      sobrecarga: !!h && exceso > p.umbral * 60, umbralHoras: p.umbral, centroId: p.centroId,
    });
  }
  return r;
}

/** Plan de hoy (y de ayer, por los turnos de noche) y avisos de un grupo de usuarios. */
export async function estadoAhora(ids: number[], ahora = new Date()) {
  const r = new Map<number, { estado: Estado; ultimoUtc: string | null; planHoy: TramoDia[]; avisos: Aviso[]; params: ParamsCentro }>();
  if (!ids.length) return r;
  const hoy = fechaLocal(ahora, TZ());
  const ayer = sumarDias(hoy, -1);
  const [horarios, cambios, params, manuales, ausencias] = await Promise.all([
    cargarHorarios(ids), cargarCambios(ids, ayer, hoy), cargarParams(ids), cargarFestivosManuales(ayer, hoy),
    // Las ausencias pendientes o aprobadas silencian los avisos de esas horas
    cargarAusencias(ids, ayer, hoy, ["PENDIENTE", "APROBADA"]),
  ]);
  const festivos = festivosPorUbicacion(manuales, ayer, hoy);
  const ef = await fichajesEfectivos(ids, new Date(ahora.getTime() - 2 * DIA), new Date(ahora.getTime() + 60000));
  for (const id of ids) {
    const h = horarios.get(id);
    const p = params.get(id) ?? { centroId: null, ...PARAMS_DEFECTO };
    const fs = festivos(p.ubicacion);
    const cm = cambios.get(id) ?? new Map();
    const planAyer = planDia(h, ayer, cm, fs);
    const planHoy = planDia(h, hoy, cm, fs);
    const aus: Ausencia[] = ausencias.get(id) ?? [];
    const sinAusencias = (fecha: string, plan: TramoDia[]) => plan.flatMap((t) => restarAusencias(fecha, t, aus)).map((t) => ({ fecha, t }));
    const tramos = [...sinAusencias(ayer, planAyer), ...sinAusencias(hoy, planHoy)];
    const lista = ef.get(id) ?? [];
    const vivos = lista.filter((f) => !f.anulado && f.fechaHoraUtc <= ahora);
    const ultimo = vivos[vivos.length - 1];
    r.set(id, {
      estado: estadoTras((ultimo?.tipo ?? null) as TipoFichaje | null),
      ultimoUtc: ultimo ? ultimo.fechaHoraUtc.toISOString() : null,
      planHoy,
      avisos: calcularAvisos(tramos, lista, p, ahora),
      params: p,
    });
  }
  return r;
}

/** Texto corto del horario: "L–V 08:00–15:00", "Rotativo 2 semanas", "Variable 120 h/mes". */
export function resumenHorario(h: Horario | undefined): string {
  if (!h) return "Sin horario";
  if (h.tipo === "VARIABLE") return `Variable · ${h.horasMes ?? 0} h/mes`;
  const horas = Math.round(h.tramos.reduce((s, t) => s + minutosTramo(t), 0) / 60 / h.semanas * 10) / 10;
  return h.tipo === "FIJO" ? `Fijo · ${horas} h/semana` : `Rotativo ${h.semanas} sem. · ${horas} h/semana de media`;
}

/** Nº de directos (propios o por suplencia) con algún aviso ya escalado al aprobador (contador del menú). */
export async function contarAvisosEscalados(org: Org, usuarioId: number): Promise<number> {
  const ids = directosDe(org, usuarioId);
  if (!ids.length) return 0;
  const est = await estadoAhora(ids);
  let n = 0;
  for (const x of est.values()) if (x.avisos.some((a) => a.escalado)) n++;
  return n;
}
