import { getPool } from "./db";
import { UsuarioSesion, ROLES_VEN_TODO } from "./auth";
import { fechaLocal } from "./jornada";

/* Cadena de aprobación (se calcula siempre a partir de las asignaciones):
   - ESTRUCTURA: le aprueba el manager de su departamento. Si es manager de algún departamento
     (o no tiene departamento), le aprueba el manager asignado en su ficha (ManagerId). La CEO no tiene.
   - DELEGACION: le aprueba el coordinador de su centro. Si es coordinador de algún centro,
     le aprueba el gestor de sus centros.
   - Suplencias: si el aprobador tiene una suplencia vigente hoy, aprueba el suplente.
   "Mi equipo" = directos de la persona (y los de los titulares a los que suple hoy).
   Ámbito (lo que ve y gestiona): sus directos + todo el personal de delegación de los centros que gestiona
   (gestor) + el de los centros de los gestores que dirige (director territorial).
   El gestor también puede aprobar al personal de sus centros, además del coordinador.
   RRHH: si es técnico de RRHH de algún centro, supervisa solo a las personas de esos centros (además de su ámbito
   normal); si no es técnico de ningún centro, supervisa a todos (RRHH global). ADMIN ve todo. */

export type TipoPerfil = "ESTRUCTURA" | "DELEGACION";

interface U { id: number; nombre: string; apellidos: string; activo: boolean; tipo: TipoPerfil | null; departamentoId: number | null; centroId: number | null; managerId: number | null }
interface Dep { id: number; nombre: string; managerId: number | null }
interface Cen { id: number; coordinadorId: number | null; gestorId: number | null; tecnicoRrhhId: number | null }
interface Sup { titularId: number; suplenteId: number; hasta: string }

export interface Org {
  usuarios: Map<number, U>;
  deps: Map<number, Dep>;
  centros: Map<number, Cen>;
  /** Suplencias vigentes hoy: titular → suplente */
  suplencias: Map<number, Sup>;
  depsQueDirige: Map<number, number[]>;
  centrosQueCoordina: Map<number, number[]>;
  /** Centros de los que es técnico de RRHH cada persona */
  centrosRrhh: Map<number, number[]>;
}

const TZ = () => process.env.TZ_APP || "Europe/Madrid";

/* La organización (≈10.000 personas) se lee una vez y se reutiliza 60 s en la instancia: ahorra consultas en cada
   página. Cualquier petición que modifica datos (POST/PUT/DELETE) la invalida (ver conSesion en http.ts). */
const TTL_ORG_MS = 60_000;
let cacheOrg: { t: number; p: Promise<Org> } | null = null;

export function invalidarOrg() {
  cacheOrg = null;
}

export function cargarOrg(): Promise<Org> {
  if (cacheOrg && Date.now() - cacheOrg.t < TTL_ORG_MS) return cacheOrg.p;
  const p = leerOrg();
  cacheOrg = { t: Date.now(), p };
  p.catch(() => {
    if (cacheOrg?.p === p) cacheOrg = null;
  });
  return p;
}

async function leerOrg(): Promise<Org> {
  const pool = await getPool();
  const hoy = fechaLocal(new Date(), TZ());
  const [u, d, c, s] = await Promise.all([
    pool.request().query("SELECT UsuarioId, Nombre, Apellidos, Activo, TipoPerfil, DepartamentoId, CentroId, ManagerId FROM fich.Usuarios"),
    pool.request().query("SELECT DepartamentoId, Nombre, ManagerId FROM fich.Departamentos"),
    pool.request().query("SELECT CentroId, CoordinadorId, GestorId, TecnicoRrhhId FROM fich.Centros"),
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
    centrosRrhh: new Map(),
  };
  for (const x of u.recordset as any[])
    org.usuarios.set(x.UsuarioId, { id: x.UsuarioId, nombre: x.Nombre, apellidos: x.Apellidos, activo: !!x.Activo, tipo: x.TipoPerfil, departamentoId: x.DepartamentoId, centroId: x.CentroId, managerId: x.ManagerId });
  for (const x of d.recordset as any[]) {
    org.deps.set(x.DepartamentoId, { id: x.DepartamentoId, nombre: x.Nombre, managerId: x.ManagerId });
    if (x.ManagerId) org.depsQueDirige.set(x.ManagerId, [...(org.depsQueDirige.get(x.ManagerId) ?? []), x.DepartamentoId]);
  }
  for (const x of c.recordset as any[]) {
    org.centros.set(x.CentroId, { id: x.CentroId, coordinadorId: x.CoordinadorId, gestorId: x.GestorId, tecnicoRrhhId: x.TecnicoRrhhId ?? null });
    if (x.TecnicoRrhhId) org.centrosRrhh.set(x.TecnicoRrhhId, [...(org.centrosRrhh.get(x.TecnicoRrhhId) ?? []), x.CentroId]);
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

/** Titulares a los que representa hoy `id`: él mismo y aquellos a los que suple. */
export function representados(org: Org, id: number): Set<number> {
  const r = new Set<number>([id]);
  for (const s of org.suplencias.values()) if (s.suplenteId === id) r.add(s.titularId);
  return r;
}

/** Centros cuyo gestor es `gestorId`. */
export function centrosDeGestor(org: Org, gestorId: number): number[] {
  return [...org.centros.values()].filter((c) => c.gestorId === gestorId).map((c) => c.id);
}

/** Centros que gestiona hoy `id` (como gestor o como suplente de un gestor). */
export function centrosGestionados(org: Org, id: number): number[] {
  return [...representados(org, id)].flatMap((t) => centrosDeGestor(org, t));
}

/** Gestor del centro de una persona de delegación (null si no aplica). */
export function gestorDe(org: Org, id: number): number | null {
  const u = org.usuarios.get(id);
  if (!u || u.tipo !== "DELEGACION" || !u.centroId) return null;
  return org.centros.get(u.centroId)?.gestorId ?? null;
}

/** Personal de delegación de unos centros (incluye a sus coordinadores). */
function personalDeCentros(org: Org, centros: Set<number>): number[] {
  const r = new Set<number>();
  if (!centros.size) return [];
  for (const u of org.usuarios.values()) if (u.tipo === "DELEGACION" && u.centroId && centros.has(u.centroId)) r.add(u.id);
  for (const c of centros) {
    const co = org.centros.get(c)?.coordinadorId;
    if (co) r.add(co);
  }
  return [...r];
}

/** Centros de su zona: los que gestiona y los de los gestores que dirige (directos suyos). */
export function centrosZona(org: Org, id: number): number[] {
  const r = new Set<number>(centrosGestionados(org, id));
  for (const d of directosDe(org, id)) for (const c of centrosDeGestor(org, d)) r.add(c);
  return [...r];
}

/** Personas que ve y gestiona hoy `id`: directos + personal de los centros de su zona. */
export function ambitoDe(org: Org, id: number): number[] {
  const r = new Set<number>(directosDe(org, id));
  for (const p of personalDeCentros(org, new Set(centrosZona(org, id)))) r.add(p);
  r.delete(id);
  return [...r];
}

/** Personas que aprueba hoy `id`: sus directos + el personal de los centros que gestiona. */
export function aprobadosPor(org: Org, id: number): number[] {
  const r = new Set<number>(directosDe(org, id));
  for (const p of personalDeCentros(org, new Set(centrosGestionados(org, id)))) r.add(p);
  r.delete(id);
  return [...r];
}

/** Candidatos a suplente de un titular: su aprobador y, si es de estructura, sus compañeros de departamento. */
export function candidatosSuplente(org: Org, titularId: number): number[] {
  const t = org.usuarios.get(titularId);
  if (!t) return [];
  const r = new Set<number>();
  const a = aprobadorTitular(org, titularId);
  if (a) r.add(a);
  if (t.tipo === "ESTRUCTURA" && t.departamentoId)
    for (const u of org.usuarios.values()) if (u.tipo === "ESTRUCTURA" && u.departamentoId === t.departamentoId) r.add(u.id);
  r.delete(titularId);
  return [...r].filter((x) => org.usuarios.get(x)?.activo);
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

/** ¿Supervisa a todo el grupo? ADMIN siempre; RRHH solo si no es técnico de RRHH de ningún centro. */
export function veTodoOrg(org: Org, u: Pick<UsuarioSesion, "usuarioId" | "rol">): boolean {
  if (u.rol === "ADMIN") return true;
  return ROLES_VEN_TODO.includes(u.rol) && !(org.centrosRrhh.get(u.usuarioId) ?? []).length;
}

/** Centros que supervisa como técnico de RRHH (solo si tiene rol RRHH). */
export function centrosRrhhDe(org: Org, u: Pick<UsuarioSesion, "usuarioId" | "rol">): number[] {
  return u.rol === "RRHH" ? org.centrosRrhh.get(u.usuarioId) ?? [] : [];
}

/** Personas de los centros en los que es técnico de RRHH: cualquiera con ese centro (delegación o sede) y sus coordinadores. */
export function personasRrhhDe(org: Org, u: Pick<UsuarioSesion, "usuarioId" | "rol">): number[] {
  const centros = new Set(centrosRrhhDe(org, u));
  if (!centros.size) return [];
  const r = new Set<number>();
  for (const x of org.usuarios.values()) if (x.centroId && centros.has(x.centroId)) r.add(x.id);
  for (const c of centros) {
    const co = org.centros.get(c)?.coordinadorId;
    if (co) r.add(co);
  }
  r.delete(u.usuarioId);
  return [...r];
}

/** Empleados cuyos fichajes puede ver: null = todos (ADMIN y RRHH global); si no, su ámbito (+ sus centros si es técnico de RRHH). */
export async function idsVisibles(u: UsuarioSesion, orgDada?: Org): Promise<number[] | null> {
  const org = orgDada ?? (await cargarOrg());
  if (veTodoOrg(org, u)) return null;
  const r = new Set(ambitoDe(org, u.usuarioId));
  for (const p of personasRrhhDe(org, u)) r.add(p);
  return [...r];
}

/** ¿Puede ver los fichajes de este empleado? */
export async function puedeVerEmpleado(u: UsuarioSesion, empleadoId: number): Promise<boolean> {
  if (empleadoId === u.usuarioId) return true;
  const ids = await idsVisibles(u);
  return ids === null || ids.includes(empleadoId);
}
