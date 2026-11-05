import { useSyncExternalStore } from "react";
import { Horario } from "./api";

/* Horario copiado de una persona para pegarlo en otra(s). Se guarda en memoria y en sessionStorage
   (si está disponible) para que sobreviva a recargar la página durante la sesión del navegador. */

export interface HorarioCopiado { origenId: number; nombre: string; centroId: number | null; horario: Horario }

const CLAVE = "fichajes.horarioCopiado";
let actual: HorarioCopiado | null = (() => {
  try {
    const v = sessionStorage.getItem(CLAVE);
    return v ? (JSON.parse(v) as HorarioCopiado) : null;
  } catch {
    return null;
  }
})();
const oyentes = new Set<() => void>();

export function copiarHorario(c: HorarioCopiado | null) {
  actual = c;
  try {
    if (c) sessionStorage.setItem(CLAVE, JSON.stringify(c));
    else sessionStorage.removeItem(CLAVE);
  } catch {
    /* sin almacenamiento: queda solo en memoria */
  }
  oyentes.forEach((f) => f());
}

export function useHorarioCopiado(): HorarioCopiado | null {
  return useSyncExternalStore(
    (f) => { oyentes.add(f); return () => oyentes.delete(f); },
    () => actual
  );
}

/** Horario listo para el editor de otra persona: si cambia de centro, los turnos pasan a manuales (mismas horas). */
export function horarioParaPegar(c: HorarioCopiado, centroDestino: number | null): Horario {
  const mismoCentro = c.centroId !== null && c.centroId === centroDestino;
  return { ...c.horario, tramos: c.horario.tramos.map((t) => ({ ...t, turnoId: mismoCentro ? t.turnoId : null })) };
}
