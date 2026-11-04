import Holidays from "date-holidays";
import { getPool } from "./db";

/* Calendario laboral de cada centro:
   - Festivos nacionales y autonómicos automáticos (librería date-holidays), según la comunidad
     que se deduce de la provincia (2 primeros dígitos del código postal).
   - Festivos manuales (fich.FestivosManuales): locales por municipio y correcciones de comunidad
     (añadir uno que falte o quitar uno automático que no corresponda ese año). */

/** Provincia (prefijo del CP) → comunidad autónoma (código ISO 3166-2:ES usado por date-holidays). */
const COMUNIDAD_DE_PROVINCIA: Record<string, string> = {
  "01": "PV", "02": "CM", "03": "VC", "04": "AN", "05": "CL", "06": "EX", "07": "IB", "08": "CT", "09": "CL", "10": "EX",
  "11": "AN", "12": "VC", "13": "CM", "14": "AN", "15": "GA", "16": "CM", "17": "CT", "18": "AN", "19": "CM", "20": "PV",
  "21": "AN", "22": "AR", "23": "AN", "24": "CL", "25": "CT", "26": "RI", "27": "GA", "28": "MD", "29": "AN", "30": "MC",
  "31": "NC", "32": "GA", "33": "AS", "34": "CL", "35": "CN", "36": "GA", "37": "CL", "38": "CN", "39": "CB", "40": "CL",
  "41": "AN", "42": "CL", "43": "CT", "44": "AR", "45": "CM", "46": "VC", "47": "CL", "48": "PV", "49": "CL", "50": "AR",
  "51": "CE", "52": "ML",
};

export const NOMBRE_COMUNIDAD: Record<string, string> = {
  AN: "Andalucía", AR: "Aragón", AS: "Asturias", CB: "Cantabria", CE: "Ceuta", CL: "Castilla y León", CM: "Castilla-La Mancha",
  CN: "Canarias", CT: "Cataluña", EX: "Extremadura", GA: "Galicia", IB: "Illes Balears", MC: "Región de Murcia", MD: "Comunidad de Madrid",
  ML: "Melilla", NC: "Navarra", PV: "País Vasco", RI: "La Rioja", VC: "Comunitat Valenciana",
};

export const provinciaDeCP = (cp: string | null | undefined) => (cp && /^\d{5}$/.test(cp) ? cp.slice(0, 2) : null);
export const comunidadDeCP = (cp: string | null | undefined) => {
  const p = provinciaDeCP(cp);
  return p ? COMUNIDAD_DE_PROVINCIA[p] ?? null : null;
};

/** Municipio normalizado para comparar: mayúsculas, sin tildes ni espacios dobles. */
export const normalizarMunicipio = (s: string | null | undefined) =>
  s ? s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toUpperCase() || null : null;

/** Ubicación de calendario de un centro. */
export interface Ubicacion { comunidad: string | null; provincia: string | null; municipio: string | null }
export const ubicacionDeCentro = (c: { CodigoPostal?: string | null; Ciudad?: string | null } | null | undefined): Ubicacion => ({
  comunidad: comunidadDeCP(c?.CodigoPostal),
  provincia: provinciaDeCP(c?.CodigoPostal),
  municipio: normalizarMunicipio(c?.Ciudad),
});

export interface FestivoManual {
  id: number; fecha: string; nombre: string; ambito: "MUNICIPIO" | "COMUNIDAD";
  provincia: string | null; municipio: string | null; comunidad: string | null; quitar: boolean;
}

export async function cargarFestivosManuales(desde: string, hasta: string): Promise<FestivoManual[]> {
  const r = await (await getPool())
    .request()
    .input("d", desde)
    .input("h", hasta)
    .query(
      `SELECT FestivoId AS id, CONVERT(char(10), Fecha, 23) AS fecha, Nombre AS nombre, Ambito AS ambito,
              Provincia AS provincia, Municipio AS municipio, Comunidad AS comunidad, Quitar AS quitar
         FROM fich.FestivosManuales WHERE Fecha BETWEEN @d AND @h`
    );
  return r.recordset.map((x: any) => ({ ...x, quitar: !!x.quitar }));
}

export interface Festivo { fecha: string; nombre: string; origen: "NACIONAL" | "AUTONOMICO" | "LOCAL" | "MANUAL"; id?: number }

const cacheAuto = new Map<string, Festivo[]>();

/** Festivos automáticos (nacionales y de la comunidad) de un año. */
export function festivosAutomaticos(anio: number, comunidad: string | null): Festivo[] {
  const k = `${anio}-${comunidad ?? ""}`;
  if (!cacheAuto.has(k)) {
    const h = comunidad ? new Holidays("ES", comunidad) : new Holidays("ES");
    const nacionales = new Set(new Holidays("ES").getHolidays(anio).filter((x) => x.type === "public").map((x) => x.date.slice(0, 10)));
    const lista = h
      .getHolidays(anio)
      .filter((x) => x.type === "public")
      .map((x): Festivo => ({ fecha: x.date.slice(0, 10), nombre: x.name, origen: nacionales.has(x.date.slice(0, 10)) ? "NACIONAL" : "AUTONOMICO" }));
    const unicos = new Map<string, Festivo>();
    for (const f of lista) if (!unicos.has(f.fecha)) unicos.set(f.fecha, f);
    cacheAuto.set(k, [...unicos.values()].sort((a, b) => a.fecha.localeCompare(b.fecha)));
  }
  return cacheAuto.get(k)!;
}

/** Festivos efectivos de una ubicación entre dos fechas (YYYY-MM-DD). Función pura sobre los manuales dados. */
export function festivosDe(u: Ubicacion, desde: string, hasta: string, manuales: FestivoManual[]): Festivo[] {
  const anios: number[] = [];
  for (let a = Number(desde.slice(0, 4)); a <= Number(hasta.slice(0, 4)); a++) anios.push(a);
  const mapa = new Map<string, Festivo>();
  for (const a of anios) for (const f of festivosAutomaticos(a, u.comunidad)) if (f.fecha >= desde && f.fecha <= hasta) mapa.set(f.fecha, f);
  const aplica = (m: FestivoManual) =>
    m.ambito === "COMUNIDAD" ? !!u.comunidad && m.comunidad === u.comunidad : !!u.municipio && m.provincia === u.provincia && m.municipio === u.municipio;
  for (const m of manuales.filter((m) => m.fecha >= desde && m.fecha <= hasta && aplica(m))) {
    if (m.quitar) mapa.delete(m.fecha);
    else mapa.set(m.fecha, { fecha: m.fecha, nombre: m.nombre, origen: m.ambito === "MUNICIPIO" ? "LOCAL" : "MANUAL", id: m.id });
  }
  return [...mapa.values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
}
