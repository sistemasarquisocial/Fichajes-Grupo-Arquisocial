import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, MotivoAusencia, DIAS_AUSENCIA, hoyLocal, restarDias } from "../api";
import Modal from "../components/Modal";
import { ElegirArchivos, prepararArchivo, MAX_MB } from "../components/Justificantes";

type Duracion = "HORAS" | "DIA" | "DIAS";

/** Justificar una ausencia: motivo, horas o días, comentario y justificante. Va a Aprobaciones de su responsable. */
export default function AusenciaModal({ fecha, onCerrar, onCreada }: { fecha?: string; onCerrar: () => void; onCreada: (aviso: string) => void }) {
  const hoy = hoyLocal();
  const minimo = restarDias(hoy, DIAS_AUSENCIA);
  const [motivos, setMotivos] = useState<MotivoAusencia[] | null>(null);
  const [motivoId, setMotivoId] = useState("");
  const [duracion, setDuracion] = useState<Duracion>("HORAS");
  const [desde, setDesde] = useState(fecha && fecha >= minimo ? fecha : hoy);
  const [hasta, setHasta] = useState(fecha && fecha >= minimo ? fecha : hoy);
  const [hi, setHi] = useState("");
  const [hf, setHf] = useState("");
  const [comentario, setComentario] = useState("");
  const [archivos, setArchivos] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    api.motivosAusencia().then((r) => setMotivos(r.motivos)).catch(() => { setMotivos([]); setError("No se pudieron cargar los motivos"); });
  }, []);
  const motivo = motivos?.find((m) => String(m.id) === motivoId);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!motivo) return setError("Elige el motivo.");
    if (duracion === "HORAS" && (!hi || !hf)) return setError("Indica desde qué hora y hasta qué hora.");
    if (duracion === "HORAS" && hf <= hi) return setError("La hora de fin debe ser posterior a la de inicio.");
    if (duracion === "DIAS" && hasta < desde) return setError("La fecha de fin no puede ser anterior a la de inicio.");
    setError("");
    setEnviando(true);
    let id: number;
    try {
      ({ id } = await api.crearAusencia({
        motivoId: motivo.id,
        fechaInicio: desde,
        fechaFin: duracion === "DIAS" ? hasta : desde,
        horaInicio: duracion === "HORAS" ? hi : undefined,
        horaFin: duracion === "HORAS" ? hf : undefined,
        comentario: comentario.trim() || undefined,
      }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo enviar");
      setEnviando(false);
      return;
    }
    // La ausencia ya está creada: si falla algún archivo, se puede volver a adjuntar desde «Mis ausencias»
    const fallos: string[] = [];
    for (const f of archivos) {
      try {
        const { datos, nombre } = await prepararArchivo(f);
        if (datos.size > MAX_MB * 1048576) throw new ApiError(413, `supera ${MAX_MB} MB`);
        await api.subirJustificante(id, datos, nombre);
      } catch (err) {
        fallos.push(`${f.name} (${err instanceof ApiError ? err.message : "error"})`);
      }
    }
    const falta = motivo.requiereJustificante && archivos.length - fallos.length === 0;
    onCreada(
      fallos.length
        ? `Ausencia enviada, pero no se pudo adjuntar: ${fallos.join(", ")}. Adjúntalo desde «Mis ausencias».`
        : falta
          ? "Ausencia enviada. Este motivo exige justificante: adjúntalo desde «Mis ausencias» para que puedan aprobarla."
          : "Ausencia enviada a tu responsable. Puedes seguirla en «Mis ausencias»."
    );
  }

  const seg = (v: Duracion, t: string) => (
    <button type="button" role="radio" aria-checked={duracion === v} className={duracion === v ? "activo" : ""} onClick={() => setDuracion(v)}>{t}</button>
  );

  return (
    <Modal titulo="Justificar una ausencia" onCerrar={onCerrar} ancho>
      <form onSubmit={enviar} className="form-modal">
        <label>
          Motivo *
          <select value={motivoId} onChange={(e) => setMotivoId(e.target.value)} required disabled={!motivos}>
            <option value="">{motivos ? "Selecciona…" : "Cargando…"}</option>
            {motivos?.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
        </label>
        <div className="segmentado" role="radiogroup" aria-label="Duración">
          {seg("HORAS", "Unas horas")}
          {seg("DIA", "Un día completo")}
          {seg("DIAS", "Varios días")}
        </div>
        <div className="fila">
          <label>{duracion === "DIAS" ? "Desde *" : "Día *"}<input type="date" value={desde} min={minimo} onChange={(e) => { setDesde(e.target.value); if (hasta < e.target.value) setHasta(e.target.value); }} required /></label>
          {duracion === "DIAS" && <label>Hasta *<input type="date" value={hasta} min={desde} onChange={(e) => setHasta(e.target.value)} required /></label>}
          {duracion === "HORAS" && (
            <>
              <label>De *<input type="time" value={hi} onChange={(e) => setHi(e.target.value)} required /></label>
              <label>A *<input type="time" value={hf} onChange={(e) => setHf(e.target.value)} required /></label>
            </>
          )}
        </div>
        <p className="nota">
          {duracion === "HORAS" ? "Cuentan las horas que coincidan con tu horario de ese día." : "Cada día completo cuenta como un día trabajado."} Puedes pedirla antes o comunicarla después (hasta {DIAS_AUSENCIA} días atrás).
        </p>
        <label>
          Comentario para tu responsable
          <textarea value={comentario} onChange={(e) => setComentario(e.target.value)} maxLength={500} rows={2} placeholder="Opcional" />
        </label>
        <div>
          <span className="etiqueta-campo">Justificante{motivo?.requiereJustificante ? " * (obligatorio para este motivo)" : " (opcional)"}</span>
          <ElegirArchivos archivos={archivos} onCambio={setArchivos} />
          {motivo?.requiereJustificante && !archivos.length && <p className="nota">Si aún no lo tienes, puedes enviarla y adjuntarlo después desde «Mis ausencias». No se podrá aprobar sin él.</p>}
        </div>
        <p className="nota">Lo verán tu responsable, RRHH y Administración. Si la aprueban, no contará como ausencia: aparecerá como horas justificadas.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="modal-acciones">
          <button type="button" className="btn btn-secundario" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-primario" disabled={enviando}>{enviando ? "Enviando…" : "Enviar"}</button>
        </div>
      </form>
    </Modal>
  );
}
