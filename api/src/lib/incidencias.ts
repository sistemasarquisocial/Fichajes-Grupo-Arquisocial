import { getPool, sql } from "./db";
import { UsuarioSesion, ROLES_VEN_TODO } from "./auth";
import { Org, aprobadorEfectivo, directosDe } from "./organizacion";
import { TipoFichaje, transicionesInvalidas } from "./jornada";
import { FichajeEfectivo, fichajesEfectivos } from "./correcciones";

/* Incidencias de fichaje: el empleado propone una corrección y su aprobador la acepta o rechaza.
   - Resuelve el aprobador titular o el efectivo (suplente vigente).
   - Si el empleado no tiene aprobador (p. ej. la CEO o sin perfil), resuelven RRHH y ADMIN.
   - Nadie resuelve sus propias incidencias. */

export type TipoIncidencia = "CAMBIAR_HORA" | "ANADIR" | "ANULAR";
export const TIPOS_INCIDENCIA: TipoIncidencia[] = ["CAMBIAR_HORA", "ANADIR", "ANULAR"];
export const DIAS_MAX_INCIDENCIA = 30;
const DIA = 86400000;

export function puedeResolver(org: Org, actor: UsuarioSesion, solicitanteId: number): boolean {
  if (actor.usuarioId === solicitanteId) return false;
  const a = aprobadorEfectivo(org, solicitanteId);
  if (a.titular === null) return ROLES_VEN_TODO.includes(actor.rol);
  return a.titular === actor.usuarioId || a.efectivo === actor.usuarioId;
}

/** Empleados cuyas incidencias resuelve hoy el actor. */
export function solicitantesDe(org: Org, actor: UsuarioSesion): number[] {
  const ids = new Set(directosDe(org, actor.usuarioId));
  if (ROLES_VEN_TODO.includes(actor.rol)) {
    for (const u of org.usuarios.values()) if (u.id !== actor.usuarioId && aprobadorEfectivo(org, u.id).titular === null) ids.add(u.id);
  }
  return [...ids];
}

/** Nombre de quién resolverá (para mostrárselo al empleado). */
export function quienResuelve(org: Org, solicitanteId: number): string {
  const a = aprobadorEfectivo(org, solicitanteId);
  const n = (id: number | null) => {
    const u = id ? org.usuarios.get(id) : undefined;
    return u ? `${u.nombre} ${u.apellidos}` : null;
  };
  if (a.titular === null) return "RRHH / Administración";
  return a.efectivo !== a.titular ? `${n(a.efectivo)} (suplente de ${n(a.titular)})` : n(a.titular) ?? "—";
}

/** Incidencias y ausencias pendientes que resuelve el actor (contador del menú Aprobaciones). */
export async function contarPendientes(org: Org, actor: UsuarioSesion): Promise<number> {
  const ids = solicitantesDe(org, actor);
  if (!ids.length) return 0;
  const r = await (await getPool())
    .request()
    .input("ids", sql.NVarChar(sql.MAX), ids.join(","))
    .query(
      `SELECT (SELECT COUNT(*) FROM fich.Incidencias WHERE Estado = 'PENDIENTE' AND UsuarioId IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ',')))
            + (SELECT COUNT(*) FROM fich.Ausencias WHERE Estado = 'PENDIENTE' AND UsuarioId IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))) AS n`
    );
  return r.recordset[0].n as number;
}

export interface Propuesta {
  tipo: TipoIncidencia;
  fichajeId: number | null;
  tipoFichaje: TipoFichaje;
  /** Nueva hora (CAMBIAR_HORA y ANADIR). */
  nuevaUtc: Date | null;
}

/** Aplica la propuesta a una lista de fichajes efectivos (copia). Función pura. */
export function simular(lista: FichajeEfectivo[], p: Propuesta): FichajeEfectivo[] {
  const r = lista.map((f) => ({ ...f }));
  if (p.tipo === "ANADIR" && p.nuevaUtc) {
    r.push({ usuarioId: 0, id: null, tipo: p.tipoFichaje, fechaHoraUtc: p.nuevaUtc, ubicacion: "CORRECCION", precision: null, corregido: false, originalUtc: null, anadido: true, anulado: false });
  } else {
    const f = r.find((x) => x.id === p.fichajeId);
    if (f && p.tipo === "CAMBIAR_HORA" && p.nuevaUtc) f.fechaHoraUtc = p.nuevaUtc;
    if (f && p.tipo === "ANULAR") f.anulado = true;
  }
  return r.sort((a, b) => a.fechaHoraUtc.getTime() - b.fechaHoraUtc.getTime() || (a.id ?? Number.MAX_SAFE_INTEGER) - (b.id ?? Number.MAX_SAFE_INTEGER));
}

/**
 * ¿La corrección deja la secuencia de fichajes coherente? Compara las transiciones no válidas
 * (p. ej. dos entradas seguidas) en ±2 días antes y después de aplicarla: no puede empeorar.
 * Así se permite arreglar días ya descuadrados sin exigir que todo el historial sea perfecto.
 */
export function errorSecuencia(lista: FichajeEfectivo[], p: Propuesta, referencia: Date): string | null {
  const ini = referencia.getTime() - 2 * DIA;
  const fin = referencia.getTime() + 2 * DIA;
  const tipos = (l: FichajeEfectivo[]) => l.filter((f) => !f.anulado && f.fechaHoraUtc.getTime() >= ini && f.fechaHoraUtc.getTime() <= fin).map((f) => f.tipo);
  const antes = transicionesInvalidas(tipos(lista));
  const despues = transicionesInvalidas(tipos(simular(lista, p)));
  return despues > antes
    ? "Con esa corrección los fichajes quedarían descuadrados (por ejemplo, dos entradas seguidas o una salida sin entrada). Revisa el tipo y la hora."
    : null;
}

/** Fichajes efectivos del usuario alrededor de una fecha (±3 días), para validar. */
export async function entorno(usuarioId: number, referencia: Date, tx?: sql.Transaction): Promise<FichajeEfectivo[]> {
  const m = await fichajesEfectivos([usuarioId], new Date(referencia.getTime() - 3 * DIA), new Date(referencia.getTime() + 3 * DIA), tx);
  return m.get(usuarioId) ?? [];
}

/** Límites comunes de fechas: no futuras y como mucho 30 días atrás. */
export function errorFecha(d: Date, ahora = new Date()): string | null {
  if (d.getTime() > ahora.getTime()) return "La hora no puede estar en el futuro";
  if (d.getTime() < ahora.getTime() - DIAS_MAX_INCIDENCIA * DIA) return `Solo se pueden corregir fichajes de los últimos ${DIAS_MAX_INCIDENCIA} días`;
  return null;
}
