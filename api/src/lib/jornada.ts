export type TipoFichaje = "ENTRADA" | "SALIDA" | "PAUSA_INICIO" | "PAUSA_FIN";
export type Estado = "FUERA" | "TRABAJANDO" | "EN_PAUSA";

export interface Fichaje {
  tipo: TipoFichaje;
  fechaHoraUtc: Date;
  /** Datos de corrección (opcionales): se copian al detalle del día. */
  id?: number | null;
  corregido?: boolean;
  originalUtc?: Date | null;
  anadido?: boolean;
  /** Anulado por una incidencia aceptada: se lista pero no cuenta. */
  anulado?: boolean;
}

export interface FichajeDia {
  tipo: TipoFichaje;
  fechaHoraUtc: string;
  id?: number | null;
  corregido?: boolean;
  originalUtc?: string | null;
  anadido?: boolean;
  anulado?: boolean;
}

export function estadoTras(ultimo: TipoFichaje | null): Estado {
  switch (ultimo) {
    case "ENTRADA":
    case "PAUSA_FIN":
      return "TRABAJANDO";
    case "PAUSA_INICIO":
      return "EN_PAUSA";
    default:
      return "FUERA";
  }
}

export function accionesPermitidas(estado: Estado): TipoFichaje[] {
  switch (estado) {
    case "FUERA":
      return ["ENTRADA"];
    case "TRABAJANDO":
      return ["PAUSA_INICIO", "SALIDA"];
    case "EN_PAUSA":
      return ["PAUSA_FIN"];
  }
}

/** Fecha local (YYYY-MM-DD) en la zona horaria indicada. */
export function fechaLocal(d: Date, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export interface ResumenDia {
  fecha: string;
  minutosTrabajados: number;
  minutosPausa: number;
  abierto: boolean;
  fichajes: FichajeDia[];
}

/**
 * Agrupa fichajes (orden ascendente) por día local y calcula tiempo trabajado y en pausa.
 * Cada tramo se atribuye al día local en que empieza. Si el último tramo sigue abierto,
 * se cuenta hasta `ahora`.
 */
export function resumirPorDia(fichajes: Fichaje[], tz: string, ahora: Date = new Date()): ResumenDia[] {
  const dias = new Map<string, ResumenDia>();
  const dia = (d: Date) => {
    const f = fechaLocal(d, tz);
    if (!dias.has(f)) dias.set(f, { fecha: f, minutosTrabajados: 0, minutosPausa: 0, abierto: false, fichajes: [] });
    return dias.get(f)!;
  };

  let inicioTrabajo: Date | null = null;
  let inicioPausa: Date | null = null;

  for (const f of fichajes) {
    const item: FichajeDia = { tipo: f.tipo, fechaHoraUtc: f.fechaHoraUtc.toISOString() };
    if (f.id !== undefined) item.id = f.id;
    if (f.corregido) { item.corregido = true; item.originalUtc = f.originalUtc ? f.originalUtc.toISOString() : null; }
    if (f.anadido) item.anadido = true;
    if (f.anulado) item.anulado = true;
    dia(f.fechaHoraUtc).fichajes.push(item);
    if (f.anulado) continue;
    switch (f.tipo) {
      case "ENTRADA":
        inicioTrabajo = f.fechaHoraUtc;
        break;
      case "PAUSA_INICIO":
        if (inicioTrabajo) dia(inicioTrabajo).minutosTrabajados += minutos(inicioTrabajo, f.fechaHoraUtc);
        inicioTrabajo = null;
        inicioPausa = f.fechaHoraUtc;
        break;
      case "PAUSA_FIN":
        if (inicioPausa) dia(inicioPausa).minutosPausa += minutos(inicioPausa, f.fechaHoraUtc);
        inicioPausa = null;
        inicioTrabajo = f.fechaHoraUtc;
        break;
      case "SALIDA":
        if (inicioTrabajo) dia(inicioTrabajo).minutosTrabajados += minutos(inicioTrabajo, f.fechaHoraUtc);
        inicioTrabajo = null;
        break;
    }
  }
  if (inicioTrabajo) {
    const d = dia(inicioTrabajo);
    d.minutosTrabajados += minutos(inicioTrabajo, ahora);
    d.abierto = true;
  }
  if (inicioPausa) {
    const d = dia(inicioPausa);
    d.minutosPausa += minutos(inicioPausa, ahora);
    d.abierto = true;
  }
  return [...dias.values()].sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
}

const minutos = (a: Date, b: Date) => Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));

/** Nº de transiciones no válidas en una secuencia ordenada de fichajes (p. ej. dos ENTRADAS seguidas). */
export function transicionesInvalidas(tipos: TipoFichaje[]): number {
  let n = 0;
  for (let i = 1; i < tipos.length; i++) if (!accionesPermitidas(estadoTras(tipos[i - 1])).includes(tipos[i])) n++;
  return n;
}
