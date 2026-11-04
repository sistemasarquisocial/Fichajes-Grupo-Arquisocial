import { ChangeEvent, useRef, useState } from "react";
import { api, ApiError, Documento } from "../api";

/* Justificantes de una ausencia: abrir (enlace de 5 minutos, queda registrado), subir y quitar. */

export const MAX_MB = 10;
const ACEPTA = "application/pdf,image/jpeg,image/png";

const tamano = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Las fotos del móvil se reducen (máx. 2000 px, JPEG) antes de subirlas. Los PDF se suben tal cual. */
export async function prepararArchivo(f: File): Promise<{ datos: Blob; nombre: string }> {
  if (!/^image\/(jpeg|png)$/.test(f.type) || f.size < 1.5 * 1048576) return { datos: f, nombre: f.name };
  try {
    const bmp = await createImageBitmap(f);
    const escala = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * escala);
    c.height = Math.round(bmp.height * escala);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, "image/jpeg", 0.85));
    if (!blob || blob.size >= f.size) return { datos: f, nombre: f.name };
    return { datos: blob, nombre: f.name.replace(/\.(png|jpe?g)$/i, "") + ".jpg" };
  } catch {
    return { datos: f, nombre: f.name };
  }
}

/** Abre el documento en otra pestaña (la pestaña se abre antes para que el navegador no la bloquee). */
export async function abrirDocumento(id: number): Promise<string | null> {
  const w = window.open("", "_blank");
  try {
    const { url } = await api.enlaceDocumento(id);
    if (w) { w.opener = null; w.location.href = url; } else window.location.href = url;
    return null;
  } catch (err) {
    w?.close();
    return err instanceof ApiError ? err.message : "No se pudo abrir el documento";
  }
}

export function ListaDocumentos({ docs, onQuitar }: { docs: Documento[]; onQuitar?: (d: Documento) => void }) {
  const [error, setError] = useState("");
  if (!docs.length) return null;
  return (
    <div className="documentos">
      {docs.map((d) => (
        <span key={d.id} className="documento">
          <button type="button" className="btn-link" onClick={async () => setError((await abrirDocumento(d.id)) ?? "")} title="Abrir (queda registrado)">
            {d.nombre}
          </button>
          <span className="nota">{tamano(d.bytes)}</span>
          {onQuitar && <button type="button" className="btn-link" aria-label={`Quitar ${d.nombre}`} onClick={() => onQuitar(d)}>Quitar</button>}
        </span>
      ))}
      {error && <span className="error-texto">{error}</span>}
    </div>
  );
}

/** Botón para subir uno o varios justificantes a una ausencia ya creada. */
export function SubirJustificante({ ausenciaId, onSubido }: { ausenciaId: number; onSubido: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [subiendo, setSubiendo] = useState(false);
  const [error, setError] = useState("");
  async function elegir(e: ChangeEvent<HTMLInputElement>) {
    const archivos = [...(e.target.files ?? [])];
    e.target.value = "";
    if (!archivos.length) return;
    setError("");
    setSubiendo(true);
    try {
      for (const f of archivos) {
        const { datos, nombre } = await prepararArchivo(f);
        if (datos.size > MAX_MB * 1048576) throw new ApiError(413, `«${f.name}» supera ${MAX_MB} MB`);
        await api.subirJustificante(ausenciaId, datos, nombre);
      }
      onSubido();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo subir el archivo");
    }
    setSubiendo(false);
  }
  return (
    <span className="subir-justificante">
      <input ref={ref} type="file" accept={ACEPTA} multiple hidden onChange={elegir} />
      <button type="button" className="btn-link" disabled={subiendo} onClick={() => ref.current?.click()}>{subiendo ? "Subiendo…" : "+ Adjuntar justificante"}</button>
      {error && <span className="error-texto">{error}</span>}
    </span>
  );
}

/** Selector de archivos para el formulario de nueva ausencia (se suben al guardar). */
export function ElegirArchivos({ archivos, onCambio }: { archivos: File[]; onCambio: (a: File[]) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="elegir-archivos">
      <input ref={ref} type="file" accept={ACEPTA} multiple hidden onChange={(e) => { onCambio([...archivos, ...(e.target.files ?? [])].slice(0, 5)); e.target.value = ""; }} />
      <button type="button" className="btn btn-secundario" onClick={() => ref.current?.click()}>Adjuntar justificante</button>
      {archivos.map((f, i) => (
        <span key={i} className="documento">
          {f.name} <span className="nota">{tamano(f.size)}</span>
          <button type="button" className="btn-link" onClick={() => onCambio(archivos.filter((_, k) => k !== i))}>Quitar</button>
        </span>
      ))}
      <span className="nota">PDF, JPG o PNG, hasta {MAX_MB} MB. Puedes hacer una foto con el móvil.</span>
    </div>
  );
}
