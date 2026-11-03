import { getPool } from "./db";
import { UsuarioSesion, ROLES_VEN_TODO } from "./auth";
import { fechaLocal } from "./jornada";

/* Cadena de aprobación (se calcula siempre a partir de las asignaciones):
   - ESTRUCTURA: le aprueba el manager de su departamento. Si es manager de algún departamento
     (o no tiene departamento), le aprueba el manager asignado en su ficha (ManagerId). La CEO no tiene.
   - DELEGACION: le aprueba el coordinador de su centro. Si es coordinador de algún centro,
     le aprueba el gestor de sus centros.
   - Suplencias: si el aprobador tiene una suplencia vigente hoy, aprueba el suplente.
   "Mi equipo" = directos de la persona (y los de los titulares a los que suple hoy). */

export type TipoPerfil = "ESTRUCTURA" | "DELEGACION";

interface U { id: number; nombre: string; apellidos: string; activo: boolean; tipo: TipoPerfil | null; departamentoId: number | null; centroId: number | null; managerId: number | null }
interface Dep { id: number; nombre: string; managerId: number | null }
interface Cen { id: number; coordinadorId: number | null; gestorId: number | null }
interface Sup { titularId: number; suplenteId: number; hasta: string }

export interface Org {
  usuarios: Map<number, U>;
  deps: Map<number, Dep>;
  centros: Map<number, Cen>;
  /** Suplencias vigentes hoy: titular → suplente */
  suplencias: Map<number, Sup>;
  depsQueDirige: Map<number, number[]>;
  centrosQueCoordina: Map<number, number[]>;
}

const TZ = () => process.env.TZ_APP || "Europe/Madrid";

export async function cargarOrg(): Promise<Org> {
  const pool = await getPool();
  const hoy = fechaLocal(new Date(), TZ());
  const [u, d, c, s] = await Promise.all([
    pool.request().query("SELECT UsuarioId, Nombre, Apellidos, Activo, TipoPerfil, DepartamentoId, CentroId, ManagerId FROM fich.Usuarios"),
    pool.request().query("SELECT DepartamentoId, Nombre, ManagerId FROM fich.Departamentos"),
    pool.request().query("SELECT CentroId, CoordinadorId, GestorId FROM fich.Centros"),
    pool
      .request()
      .input("hoy", hoy)
      .query(
        `SELECT TitularId, SuplenteId, CONVERT(char(10), Hasta, 23) AS Hasta FROM fich.Suplencias
          WHERE AnuladaUtc IS NULL AND Desde <= @hoy AND Hasta >= @hoy
          ORDER BY CreadoUtc DESC`
      ),
  ]);
  const org: Org = {
    usuarios: new Map(),
    deps: new Map(),
    centros: new Map(),
    suplencias: new Map(),
    depsQueDirige: new Map(),
    centrosQueCoordina: new Map(),
  };
  for (const x of u.recordset as any[])
    org.usuarios.set(x.UsuarioId, { id: x.UsuarioId, nombre: x.Nombre, apellidos: x.Apellidos, activo: !!x.Activo, tipo: x.TipoPerfil, departamentoId: x.DepartamentoId, centroId: x.CentroId, managerId: x.ManagerId });
  for (const x of d.recordset as any[]) {
    org.deps.set(x.DepartamentoId, { id: x.DepartamentoId, nombre: x.Nombre, managerId: x.ManagerId });
    if (x.ManagerId) org.depsQueDirige.set(x.ManagerId, [...(org.depsQueDirige.get(x.ManagerId) ?? []), x.DepartamentoId]);
  }
  for (const x of c.recordset as any[]) {
    org.centros.set(x.CentroId, { id: x.CentroId, coordinadorId: x.CoordinadorId, gestorId: x.GestorId });
    if (x.CoordinadorId) org.centrosQueCoordina.set(x.CoordinadorId, [...(org.centrosQueCoordina.get(x.CoordinadorId) ?? []), x.CentroId]);
  }
  for (const x of s.recordset as any[]) if (!org.suplencias.has(x.TitularId)) org.suplencias.set(x.TitularId, { titularId: x.TitularId, suplenteId: x.SuplenteId, hasta: x.Hasta });
  return org;
}

/** Aprobador titular (sin tener en cuenta suplencias). */
export function aprobadorTitular(org: Org, id: number): number | null {
  const u = org.usuarios.get(id);
  if (!u || !u.tipo) return null;
  let a: number | null = null;
  if (u.tipo === "ESTRUCTURA") {
    const dirige = (org.depsQueDirige.get(id) ?? []).length > 0;
    const dep = u.departamentoId ? org.deps.get(u.departamentoId) : undefined;
    a = dirige || !dep ? u.managerId : dep.managerId;
  } else {
    const coordina = org.centrosQueCoordina.get(id) ?? [];
    if (coordina.length) {
      a = coordina.map((c) => org.centros.get(c)?.gestorId ?? null).find((g) => g) ?? null;
    } else {
      a = u.centroId ? org.centros.get(u.centroId)?.coordinadorId ?? null : null;
    }
  }
  return a && a !== id ? a : null;
}

/** Aprobador efectivo hoy (si el titular tiene suplente vigente, el suplente). */
export function aprobadorEfectivo(org: Org, id: number): { titular: number | null; efectivo: number | null; suplenciaHasta: string | null } {
  const titular = aprobadorTitular(org, id);
  const s = titular ? org.suplencias.get(titular) : undefined;
  return { titular, efectivo: s && s.suplenteId !== id ? s.suplenteId : titular, suplenciaHasta: s ? s.hasta : null };
}

/** Ids de los directos que ve/aprueba hoy `id`: los suyos y los de los titulares a los que suple. */
export function directosDe(org: Org, id: number): number[] {
  const titulares = new Set<number>([id]);
  for (const s of org.suplencias.values()) if (s.suplenteId === id) titulares.add(s.titularId);
  const r: number[] = [];
  for (const u of org.usuarios.values()) {
    if (u.id === id) continue;
    const t = aprobadorTitular(org, u.id);
    if (t && titulares.has(t)) r.push(u.id);
  }
  return r;
}

/** ¿Es aprobador de alguien (titular)? Sirve para saber si puede registrar suplencias. */
export function esAprobador(org: Org, id: number): boolean {
  for (const u of org.usuarios.values()) if (u.id !== id && aprobadorTitular(org, u.id) === id) return true;
  return false;
}

export const nombreDe = (org: Org, id: number | null) => {
  const u = id ? org.usuarios.get(id) : undefined;
  return u ? `${u.nombre} ${u.apellidos}` : null;
};

/** Empleados cuyos fichajes puede ver: null = todos (RRHH y ADMIN); si no, sus directos. */
export async function idsVisibles(u: UsuarioSesion): Promise<number[] | null> {
  if (ROLES_VEN_TODO.includes(u.rol)) return null;
  return directosDe(await cargarOrg(), u.usuarioId);
}

/** ¿Puede ver los fichajes de este empleado? */
export async function puedeVerEmpleado(u: UsuarioSesion, empleadoId: number): Promise<boolean> {
  if (empleadoId === u.usuarioId) return true;
  const ids = await idsVisibles(u);
  return ids === null || ids.includes(empleadoId);
}
