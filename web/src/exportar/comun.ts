import { DatosExportacion, ETIQUETA_TIPO, TipoFichaje } from "../api";

/* Utilidades compartidas por la exportación a PDF y a Excel. Todo se calcula en el navegador. */

export const TZ = "Europe/Madrid";
export const MARCA = {
  verde: "#899F75",
  verdeOscuro: "#6C8159",
  verdeClaro: "#EEF2EA",
  crema: "#FFF9DC",
  amarillo: "#F5D892",
  negro: "#2A2A2A",
  rojo: "#AA4B4B",
  gris: "#6B6B6B",
  grisClaro: "#F4F4F2",
};

const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** Partes de fecha/hora en hora de Madrid. */
export function partes(iso: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value])
  );
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}`, h: Number(p.hour), m: Number(p.minute) };
}

export const fechaES = (yyyyMmDd: string) => `${yyyyMmDd.slice(8, 10)}/${yyyyMmDd.slice(5, 7)}/${yyyyMmDd.slice(0, 4)}`;
export const diaSemana = (yyyyMmDd: string) => DIAS[new Date(`${yyyyMmDd}T12:00:00Z`).getUTCDay()];
export const esFinDeSemana = (yyyyMmDd: string) => [0, 6].includes(new Date(`${yyyyMmDd}T12:00:00Z`).getUTCDay());
export const hhmm = (min: number) => `${Math.floor(min / 60)}:${String(min % 60).padStart(2, "0")}`;

export function textoUbicacion(estado: string, precision: number | null): string {
  switch (estado) {
    case "OK": return precision != null ? `Sí (±${precision} m)` : "Sí";
    case "DENEGADA": return "No (permiso denegado)";
    case "TIMEOUT": return "No (tiempo agotado)";
    case "NO_SOPORTADA": return "No (navegador no compatible)";
    case "NO_DISPONIBLE": return "No (no disponible)";
    default: return "Sin dato";
  }
}

export interface FilaDia {
  fecha: string;
  diaSemana: string;
  finDeSemana: boolean;
  entrada: string;
  salida: string;
  minutosPausa: number;
  minutosTrabajados: number;
  numFichajes: number;
  ubicacion: string;
  incidencias: string;
}

export interface FilaFichaje {
  fecha: string;
  hora: string;
  tipo: string;
  ubicacion: string;
}

export interface Informe {
  dias: FilaDia[];
  fichajes: FilaFichaje[];
  totalMinutos: number;
  totalPausa: number;
  diasTrabajados: number;
  mediaMinutos: number;
  numIncidencias: number;
  nombreCompleto: string;
  centro: string;
  periodo: string;
  generado: string;
  nombreArchivo: string;
}

/** Prepara los datos del informe: una fila por cada día del periodo (también los días sin fichajes). */
export function prepararInforme(d: DatosExportacion): Informe {
  const hoy = partes(new Date().toISOString()).fecha;
  const porDia = new Map(d.dias.map((x) => [x.fecha, x]));
  const fichajesDia = new Map<string, DatosExportacion["fichajes"]>();
  for (const f of d.fichajes) {
    const k = partes(f.fechaHoraUtc).fecha;
    if (!fichajesDia.has(k)) fichajesDia.set(k, []);
    fichajesDia.get(k)!.push(f);
  }

  const dias: FilaDia[] = [];
  for (let t = new Date(`${d.desde}T12:00:00Z`); t <= new Date(`${d.hasta}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + 1)) {
    const fecha = t.toISOString().slice(0, 10);
    const r = porDia.get(fecha);
    const fs = fichajesDia.get(fecha) ?? [];
    const entradas = fs.filter((f) => f.tipo === "ENTRADA");
    const salidas = fs.filter((f) => f.tipo === "SALIDA");
    const conUbi = fs.filter((f) => f.ubicacion === "OK").length;
    const inc: string[] = [];
    if (r?.abierto && fecha !== hoy) inc.push("Jornada sin cerrar");
    if (r?.abierto && fecha === hoy) inc.push("Jornada en curso");
    if (fs.length && conUbi < fs.length) inc.push(`${fs.length - conUbi} fichaje(s) sin ubicación`);
    dias.push({
      fecha,
      diaSemana: diaSemana(fecha),
      finDeSemana: esFinDeSemana(fecha),
      entrada: entradas.length ? partes(entradas[0].fechaHoraUtc).hora : "",
      salida: salidas.length ? partes(salidas[salidas.length - 1].fechaHoraUtc).hora : "",
      minutosPausa: r?.minutosPausa ?? 0,
      minutosTrabajados: r?.minutosTrabajados ?? 0,
      numFichajes: fs.length,
      ubicacion: !fs.length ? "" : conUbi === fs.length ? "Sí" : conUbi === 0 ? "No" : "Parcial",
      incidencias: inc.join(" · "),
    });
  }

  const fichajes: FilaFichaje[] = d.fichajes.map((f) => {
    const p = partes(f.fechaHoraUtc);
    return { fecha: p.fecha, hora: p.hora, tipo: ETIQUETA_TIPO[f.tipo as TipoFichaje] ?? f.tipo, ubicacion: textoUbicacion(f.ubicacion, f.precision) };
  });

  const totalMinutos = dias.reduce((s, x) => s + x.minutosTrabajados, 0);
  const totalPausa = dias.reduce((s, x) => s + x.minutosPausa, 0);
  const diasTrabajados = dias.filter((x) => x.minutosTrabajados > 0).length;
  const e = d.empleado;
  const g = partes(d.generadoUtc);
  const apellido = (e.apellidos.split(" ")[0] || "").normalize("NFD").replace(/[^\w]/g, "");
  const nombre = (e.nombre.split(" ")[0] || "").normalize("NFD").replace(/[^\w]/g, "");
  const empresa = e.empresa.normalize("NFD").replace(/[^\w]/g, "");
  return {
    dias,
    fichajes,
    totalMinutos,
    totalPausa,
    diasTrabajados,
    mediaMinutos: diasTrabajados ? Math.round(totalMinutos / diasTrabajados) : 0,
    numIncidencias: dias.filter((x) => x.incidencias && !x.incidencias.startsWith("Jornada en curso")).length,
    nombreCompleto: `${e.nombre} ${e.apellidos}`,
    centro: e.centro ? `${e.codigoServicio ? `${e.codigoServicio} · ` : ""}${e.centro}` : "Sin centro asignado",
    periodo: `${fechaES(d.desde)} – ${fechaES(d.hasta)}`,
    generado: `${fechaES(g.fecha)} ${g.hora}`,
    nombreArchivo: `Registro_jornada_${empresa}_${d.desde}_${d.hasta}_${apellido}-${nombre}`,
  };
}

/** Convierte el logo SVG (crema) en PNG para incrustarlo en PDF y Excel. */
export async function logoPng(alto = 120): Promise<{ dataUrl: string; ancho: number; alto: number }> {
  const svg = await (await fetch("/logo-arquisocial.svg")).text();
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  await img.decode();
  const ancho = Math.round((img.naturalWidth / img.naturalHeight) * alto);
  const c = document.createElement("canvas");
  c.width = ancho;
  c.height = alto;
  c.getContext("2d")!.drawImage(img, 0, 0, ancho, alto);
  return { dataUrl: c.toDataURL("image/png"), ancho, alto };
}

export function descargar(blob: Blob, nombre: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export const TEXTO_LEGAL =
  "Registro diario de jornada conforme al art. 34.9 del Estatuto de los Trabajadores. Los registros se conservan durante cuatro años. " +
  "Las horas se calculan a partir de los fichajes registrados en el servidor (hora oficial de Madrid); los fichajes no pueden modificarse una vez registrados.";
