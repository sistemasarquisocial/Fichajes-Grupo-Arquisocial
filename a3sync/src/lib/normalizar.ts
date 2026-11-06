/* Normalización de los datos que devuelve la API de a3innuva Nómina (formato visto en las muestras del 05/11/2026). */

const LETRAS_DNI = "TRWAGMYFPDXBNJZSQVHLCKE";

/** DNI/NIE en mayúsculas y sin separadores. Quita el 0 que a3 antepone a algunos NIE (0X1234567L → X1234567L). */
export function normDni(v: unknown): string {
  let s = String(v ?? "").toUpperCase().replace(/[\s.\-]/g, "");
  if (/^0[XYZ]\d{7}[A-Z]$/.test(s)) s = s.slice(1);
  return s.slice(0, 12);
}

/** ¿DNI o NIE con letra de control correcta? */
export function dniValido(dni: string): boolean {
  const m = /^([XYZ]?)(\d{7,8})([A-Z])$/.exec(dni);
  if (!m) return false;
  if (m[1] && m[2].length !== 7) return false;
  if (!m[1] && m[2].length !== 8) return false;
  const num = Number(({ "": "", X: "0", Y: "1", Z: "2" } as Record<string, string>)[m[1]] + m[2]);
  return LETRAS_DNI[num % 23] === m[3];
}

/** Fecha de a3 ("2026-11-04T00:00:00Z"; "0001-01-01…" = sin fecha) → "YYYY-MM-DD" o null. */
export function fechaA3(v: unknown): string | null {
  const s = String(v ?? "");
  if (!/^\d{4}-\d{2}-\d{2}/.test(s) || s.startsWith("0001")) return null;
  return s.slice(0, 10);
}

/** Fecha-hora de a3 → Date o null. */
export function fechaHoraA3(v: unknown): Date | null {
  const s = String(v ?? "");
  if (!s || s.startsWith("0001")) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

const MINUSCULAS = new Set(["de", "del", "la", "las", "los", "y", "e", "i", "da", "do", "dos", "das", "van", "von"]);

/** "PEREZ GOMEZ" → "Perez Gomez"; "GARCIA DE LA TORRE" → "Garcia de la Torre"; respeta guiones. */
export function capitalizar(s: string): string {
  return s
    .toLocaleLowerCase("es")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((p, i) =>
      i > 0 && MINUSCULAS.has(p)
        ? p
        : p.replace(/(^|[-'])(\p{L})/gu, (_m, sep: string, l: string) => sep + l.toLocaleUpperCase("es"))
    )
    .join(" ");
}

/** completeName de a3 ("APELLIDOS, NOMBRE") → nombre y apellidos capitalizados. */
export function partirNombre(completo: unknown): { nombre: string; apellidos: string } {
  const s = String(completo ?? "").trim();
  const i = s.indexOf(",");
  const apellidos = i >= 0 ? s.slice(0, i) : s;
  const nombre = i >= 0 ? s.slice(i + 1) : "";
  return { nombre: capitalizar(nombre).slice(0, 100) || "—", apellidos: capitalizar(apellidos).slice(0, 150) || "—" };
}

/** Email en minúsculas si es válido; si no, null. */
export function normEmail(v: unknown): string | null {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s || s.length > 254) return null;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : null;
}

/** Dirección de un centro (contactdata/address) en una línea: "Calle Rio San Pedro 6, Bajo". */
export function direccionCentro(a: any): string | null {
  if (!a) return null;
  const via = [a.acronym, a.streetName, a.buildingNumber].map((x) => String(x ?? "").trim()).filter(Boolean).join(" ");
  const resto = [a.stairWell && `Esc. ${a.stairWell}`, a.floor, a.gate].map((x) => String(x ?? "").trim()).filter(Boolean).join(" ");
  const r = [via, resto].filter(Boolean).join(", ");
  return r ? r.slice(0, 200) : null;
}

/** Recorre el árbol del organigrama de a3 y lo devuelve plano con el nodo padre. */
export function aplanarOrganigrama(raiz: any, empresaA3: number): NodoOrganigrama[] {
  const r: NodoOrganigrama[] = [];
  const visitar = (n: any, padre: string | null) => {
    if (!n?.orgUnitNodeID) return;
    r.push({
      nodoId: String(n.orgUnitNodeID),
      padreNodoId: padre,
      empresaA3,
      unidadId: n.orgUnitID ? String(n.orgUnitID) : null,
      tipo: n.orgUnitTypeName ?? null,
      codigo: n.orgUnitCode ?? null,
      nombre: n.orgUnitName ?? null,
      descripcion: n.orgUnitDescription ?? null,
      responsableCodigo: n.orgUnitManagerCode || null,
      responsableDNI: n.orgUnitManagerIdentifierNumber ? normDni(n.orgUnitManagerIdentifierNumber) : null,
      responsableNombre: n.orgUnitManagerName || null,
      fechaAlta: fechaA3(n.orgUnitCreateDate),
      fechaBaja: fechaA3(n.orgUnitDropDate),
      orden: r.length,
    });
    for (const h of n.children ?? []) visitar(h, String(n.orgUnitNodeID));
  };
  for (const n of Array.isArray(raiz) ? raiz : [raiz]) visitar(n, null);
  return r;
}

export interface NodoOrganigrama {
  nodoId: string;
  padreNodoId: string | null;
  empresaA3: number;
  unidadId: string | null;
  tipo: string | null;
  codigo: string | null;
  nombre: string | null;
  descripcion: string | null;
  responsableCodigo: string | null;
  responsableDNI: string | null;
  responsableNombre: string | null;
  fechaAlta: string | null;
  fechaBaja: string | null;
  orden: number;
}

/* ---------- Ficha laboral (puesto, responsable y contrato) ---------- */
const txt = (v: unknown, max: number): string | null => {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};

export interface FichaPuesto {
  puestoCodigo: string | null;
  puesto: string | null;
  departamento: string | null;
  unidadOrganizativa: string | null;
  responsableCodigo: string | null;
  responsableNombre: string | null;
  jornada: number | null;
  puestoDesde: string | null;
}

/** /employees/{ec}/jobPositionInformation → puesto, departamento, responsable (manager) y % de jornada. */
export function fichaPuesto(x: any): FichaPuesto {
  const p = Array.isArray(x) ? x[0] : x;
  const fte = Number(p?.fte);
  const resp = txt(p?.responsibleToCode, 20);
  return {
    puestoCodigo: txt(p?.jobCode, 20),
    puesto: txt(p?.jobTitle, 150),
    departamento: txt(p?.department, 150),
    unidadOrganizativa: txt(p?.organizationalUnit, 150),
    // Código de trabajador a3 del responsable (se enlaza en la app ignorando ceros a la izquierda)
    responsableCodigo: resp,
    responsableNombre: txt(p?.responsibleTo, 200),
    jornada: p?.fte === null || p?.fte === undefined || isNaN(fte) ? null : Math.round(fte * 100) / 100,
    puestoDesde: fechaA3(p?.startDate),
  };
}

export interface FichaContrato {
  contratoCodigo: string | null;
  contrato: string | null;
  contratoDesde: string | null;
  contratoHasta: string | null;
  tipoCotizacion: string | null;
}

/** /employees/{ec}/contract-agreement → contrato vigente. No se guarda el salario (annualGross*). */
export function fichaContrato(x: any): FichaContrato {
  const c = Array.isArray(x) ? x[0] : x;
  return {
    contratoCodigo: txt(c?.contractCode, 10),
    contrato: txt(c?.contractDescription, 200),
    contratoDesde: fechaA3(c?.labourPeriodStartDate),
    contratoHasta: fechaA3(c?.labourPeriodEndDate),
    tipoCotizacion: txt(c?.contributionType, 100),
  };
}
