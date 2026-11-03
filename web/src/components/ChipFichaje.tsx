import { FichajeDia, ETIQUETA_TIPO, hora, fechaDe, fechaHora } from "../api";

/** Texto explicativo de un fichaje corregido, añadido o anulado. */
export function notaCorreccion(f: FichajeDia): string | null {
  if (f.anulado) return "Anulado por una incidencia aprobada (no cuenta)";
  if (f.corregido && f.originalUtc) {
    const otroDia = fechaDe(f.originalUtc) !== fechaDe(f.fechaHoraUtc);
    return `Corregido por incidencia aprobada · hora original ${otroDia ? fechaHora(f.originalUtc) : hora(f.originalUtc)}`;
  }
  if (f.anadido) return "Añadido por una incidencia aprobada";
  return null;
}

/** Chip de un fichaje con sus marcas de corrección. Si recibe onClick se muestra como botón. */
export default function ChipFichaje({ f, extraClase = "", sufijo = "", titulo, onClick, pendiente = false }: {
  f: FichajeDia; extraClase?: string; sufijo?: string; titulo?: string; onClick?: () => void; pendiente?: boolean;
}) {
  const nota = notaCorreccion(f);
  const clase = `chip chip-${f.tipo.toLowerCase()}${f.anulado ? " chip-anulado" : ""}${f.corregido || f.anadido ? " chip-corregido" : ""}${pendiente ? " chip-pendiente" : ""}${onClick ? " chip-boton" : ""} ${extraClase}`.trim();
  const title = [titulo ?? ETIQUETA_TIPO[f.tipo], nota, pendiente ? "Tiene una incidencia pendiente" : null, onClick ? "Pulsa para corregir" : null].filter(Boolean).join(" · ");
  const marca = f.anulado ? "" : f.corregido ? " ✎" : f.anadido ? " +" : "";
  const contenido = (
    <>
      {ETIQUETA_TIPO[f.tipo]} {hora(f.fechaHoraUtc)}{marca}{sufijo}{pendiente ? " ⏳" : ""}
    </>
  );
  return onClick ? (
    <button type="button" className={clase} title={title} aria-label={title} onClick={onClick}>{contenido}</button>
  ) : (
    <span className={clase} title={title}>{contenido}</span>
  );
}
