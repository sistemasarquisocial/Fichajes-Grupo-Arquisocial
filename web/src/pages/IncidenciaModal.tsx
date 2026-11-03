import { FormEvent, useState } from "react";
import { api, ApiError, FichajeDia, TipoFichaje, TipoIncidencia, ETIQUETA_TIPO, fechaLarga, hora, fechaDe, hoyLocal, restarDias } from "../api";
import Modal from "../components/Modal";
import { notaCorreccion } from "../components/ChipFichaje";

export const DIAS_INCIDENCIA = 30;

/** Abre una incidencia: corregir la hora o anular un fichaje existente, o añadir uno olvidado. */
export default function IncidenciaModal({ fichaje, fecha, onCerrar, onCreada }: {
  /** Fichaje a corregir (modo cambiar/anular). */
  fichaje?: FichajeDia;
  /** Día propuesto para añadir un fichaje olvidado. */
  fecha?: string;
  onCerrar: () => void;
  onCreada: () => void;
}) {
  const hoy = hoyLocal();
  const minimo = restarDias(hoy, DIAS_INCIDENCIA);
  const [tipo, setTipo] = useState<TipoIncidencia>(fichaje ? "CAMBIAR_HORA" : "ANADIR");
  const [tipoFichaje, setTipoFichaje] = useState<TipoFichaje | "">("");
  const [dia, setDia] = useState(fichaje ? fechaDe(fichaje.fechaHoraUtc) : fecha && fecha >= minimo ? fecha : hoy);
  const [horaNueva, setHoraNueva] = useState(fichaje ? hora(fichaje.fechaHoraUtc) : "");
  const [comentario, setComentario] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const nota = fichaje ? notaCorreccion(fichaje) : null;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    const c = comentario.trim();
    if (tipo === "ANADIR" && !tipoFichaje) return setError("Indica qué fichaje olvidaste.");
    if (tipo !== "ANULAR" && !/^\d{2}:\d{2}$/.test(horaNueva)) return setError("Indica la hora correcta.");
    if (tipo === "CAMBIAR_HORA" && fichaje && horaNueva === hora(fichaje.fechaHoraUtc) && dia === fechaDe(fichaje.fechaHoraUtc)) return setError("La nueva hora es igual a la actual.");
    if (c.length < 5) return setError("Explica el motivo para tu responsable (mínimo 5 caracteres).");
    setError("");
    setEnviando(true);
    try {
      await api.crearIncidencia({
        tipo,
        fichajeId: fichaje?.id ?? undefined,
        tipoFichaje: tipo === "ANADIR" ? (tipoFichaje as TipoFichaje) : undefined,
        fecha: tipo === "ANULAR" ? undefined : dia,
        hora: tipo === "ANULAR" ? undefined : horaNueva,
        comentario: c,
      });
      onCreada();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo enviar la incidencia");
      setEnviando(false);
    }
  }

  return (
    <Modal titulo={fichaje ? "Corregir fichaje" : "Añadir fichaje olvidado"} onCerrar={onCerrar} ancho>
      <form onSubmit={enviar} className="form-modal">
        {fichaje && (
          <>
            <div className="incidencia-fichaje">
              <span className={`chip chip-${fichaje.tipo.toLowerCase()}`}>{ETIQUETA_TIPO[fichaje.tipo]} {hora(fichaje.fechaHoraUtc)}</span>
              <span className="capitalizar">{fechaLarga(fechaDe(fichaje.fechaHoraUtc))}</span>
            </div>
            {nota && <p className="nota">{nota}</p>}
            <div className="segmentado" role="radiogroup" aria-label="Qué quieres hacer">
              <button type="button" role="radio" aria-checked={tipo === "CAMBIAR_HORA"} className={tipo === "CAMBIAR_HORA" ? "activo" : ""} onClick={() => setTipo("CAMBIAR_HORA")}>Cambiar la hora</button>
              <button type="button" role="radio" aria-checked={tipo === "ANULAR"} className={tipo === "ANULAR" ? "activo" : ""} onClick={() => setTipo("ANULAR")}>Anular (es erróneo)</button>
            </div>
          </>
        )}
        {tipo === "ANADIR" && (
          <label>
            Fichaje olvidado *
            <select value={tipoFichaje} onChange={(e) => setTipoFichaje(e.target.value as TipoFichaje)} required>
              <option value="">Selecciona…</option>
              {(Object.keys(ETIQUETA_TIPO) as TipoFichaje[]).map((t) => <option key={t} value={t}>{ETIQUETA_TIPO[t]}</option>)}
            </select>
          </label>
        )}
        {tipo !== "ANULAR" && (
          <div className="fila">
            <label>Día<input type="date" value={dia} min={minimo} max={hoy} onChange={(e) => setDia(e.target.value)} required /></label>
            <label>{tipo === "ANADIR" ? "Hora *" : "Hora correcta *"}<input type="time" value={horaNueva} onChange={(e) => setHoraNueva(e.target.value)} required /></label>
          </div>
        )}
        {tipo === "ANULAR" && <p className="aviso">El fichaje dejará de contar en tu jornada si tu responsable lo aprueba. Seguirá visible como anulado.</p>}
        <label>
          Comentario para tu responsable *
          <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} maxLength={500} rows={3} placeholder="Ej.: olvidé fichar la salida, terminé a las 18:00" required />
        </label>
        <p className="nota">Tu responsable recibirá la incidencia en «Aprobaciones». Si la acepta, el fichaje se corrige y queda constancia del original; si la rechaza, se mantiene como está.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="modal-acciones">
          <button type="button" className="btn btn-secundario" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-primario" disabled={enviando}>{enviando ? "Enviando…" : "Enviar incidencia"}</button>
        </div>
      </form>
    </Modal>
  );
}
