import { useState } from "react";
import { api, ApiError, Ausencia, Documento, ETIQUETA_ESTADO_AUS, fechaHora, periodoAusencia } from "../api";
import Modal from "../components/Modal";
import { ListaDocumentos, SubirJustificante } from "../components/Justificantes";

export const claseEstadoAus = (e: Ausencia["estado"]) =>
  e === "APROBADA" ? "chip-activa" : e === "RECHAZADA" ? "chip-salida" : e === "PENDIENTE" ? "chip-pausa_inicio" : "chip-inactiva";

/** Tarjeta "Mis ausencias" del historial: estado, justificantes y retirar. */
export default function MisAusencias({ lista, resuelve, almacen, onCambio }: { lista: Ausencia[]; resuelve: string; almacen: boolean; onCambio: () => void }) {
  const [retirar, setRetirar] = useState<Ausencia | null>(null);
  const [quitar, setQuitar] = useState<{ a: Ausencia; d: Documento } | null>(null);
  const [error, setError] = useState("");
  const [verTodas, setVerTodas] = useState(false);
  const pendientes = lista.filter((a) => a.estado === "PENDIENTE").length;
  const visibles = verTodas ? lista : lista.slice(0, 5);

  async function ejecutar(f: () => Promise<unknown>) {
    setError("");
    try { await f(); onCambio(); } catch (err) { setError(err instanceof ApiError ? err.message : "No se pudo completar la acción"); }
  }

  if (!lista.length) return null;
  return (
    <div className="tarjeta">
      <div className="titulo-acciones">
        <div>
          <h2>Mis ausencias</h2>
          <p className="sub">{pendientes ? `${pendientes} pendiente(s) · ` : ""}Las resuelve: <strong>{resuelve}</strong></p>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <ul className="lista-incidencias">
        {visibles.map((a) => (
          <li key={a.id}>
            <div className="inc-cabecera">
              <span className={`chip ${claseEstadoAus(a.estado)}`}>{ETIQUETA_ESTADO_AUS[a.estado]}</span>
              <strong>{a.motivo}</strong>
              <span className="nota">{periodoAusencia(a)}</span>
            </div>
            {a.comentario && <div className="nota">«{a.comentario}»</div>}
            <ListaDocumentos docs={a.documentos} onQuitar={a.estado === "PENDIENTE" ? (d) => setQuitar({ a, d }) : undefined} />
            {a.estado === "PENDIENTE" && a.requiereJustificante && !a.documentos.length && <div className="error-texto">Falta el justificante: sin él no se puede aprobar.</div>}
            {a.estado === "RECHAZADA" && <div className="error-texto">Rechazada por {a.resueltaPor}: «{a.motivoRechazo}»</div>}
            {a.estado === "APROBADA" && <div className="nota">Aprobada por {a.resueltaPor} el {fechaHora(a.resueltaUtc!)}</div>}
            {a.estado === "PENDIENTE" && (
              <div className="inc-acciones-enlaces">
                {almacen && a.documentos.length < 5 && <SubirJustificante ausenciaId={a.id} onSubido={onCambio} />}
                <button className="btn-link" onClick={() => setRetirar(a)}>Retirar</button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {lista.length > 5 && <button className="btn-link" onClick={() => setVerTodas(!verTodas)}>{verTodas ? "Ver menos" : `Ver todas (${lista.length})`}</button>}

      {retirar && (
        <Modal titulo="Retirar ausencia" onCerrar={() => setRetirar(null)}>
          <p>¿Retirar la ausencia «{retirar.motivo}, {periodoAusencia(retirar)}»? Tu responsable ya no la verá.</p>
          <div className="modal-acciones">
            <button className="btn btn-secundario" onClick={() => setRetirar(null)}>Cancelar</button>
            <button className="btn btn-peligro" onClick={() => { const a = retirar; setRetirar(null); ejecutar(() => api.retirarAusencia(a.id)); }}>Retirar</button>
          </div>
        </Modal>
      )}
      {quitar && (
        <Modal titulo="Quitar justificante" onCerrar={() => setQuitar(null)}>
          <p>¿Quitar «{quitar.d.nombre}»? Se borrará el archivo.</p>
          <div className="modal-acciones">
            <button className="btn btn-secundario" onClick={() => setQuitar(null)}>Cancelar</button>
            <button className="btn btn-peligro" onClick={() => { const q = quitar; setQuitar(null); ejecutar(() => api.borrarJustificante(q.a.id, q.d.id)); }}>Quitar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
