import { useState } from "react";
import { api, ApiError, Incidencia, ETIQUETA_INCIDENCIA, ETIQUETA_ESTADO_INC, ETIQUETA_TIPO, fechaHora } from "../api";
import Modal from "../components/Modal";

/** Descripción corta de lo que pide una incidencia. */
export function describirIncidencia(i: Incidencia): string {
  const t = ETIQUETA_TIPO[i.tipoFichaje];
  if (i.tipo === "ANADIR") return `Añadir ${t.toLowerCase()} el ${fechaHora(i.propuestaUtc!)}`;
  if (i.tipo === "ANULAR") return `Anular ${t.toLowerCase()} del ${fechaHora(i.originalUtc!)}`;
  return `${t}: ${fechaHora(i.originalUtc!)} → ${fechaHora(i.propuestaUtc!)}`;
}

export const claseEstado = (e: Incidencia["estado"]) =>
  e === "ACEPTADA" ? "chip-activa" : e === "RECHAZADA" ? "chip-salida" : e === "PENDIENTE" ? "chip-pausa_inicio" : "chip-inactiva";

/** Tarjeta "Mis incidencias" del historial. */
export default function MisIncidencias({ lista, resuelve, onCambio }: { lista: Incidencia[]; resuelve: string; onCambio: () => void }) {
  const [retirar, setRetirar] = useState<Incidencia | null>(null);
  const [error, setError] = useState("");
  const [verTodas, setVerTodas] = useState(false);
  const pendientes = lista.filter((i) => i.estado === "PENDIENTE").length;
  const visibles = verTodas ? lista : lista.slice(0, 5);

  async function confirmarRetirar(i: Incidencia) {
    setRetirar(null);
    try {
      await api.retirarIncidencia(i.id);
      onCambio();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo retirar");
    }
  }

  if (!lista.length) return null;
  return (
    <div className="tarjeta">
      <div className="titulo-acciones">
        <div>
          <h2>Mis incidencias</h2>
          <p className="sub">{pendientes ? `${pendientes} pendiente(s) · ` : ""}Las resuelve: <strong>{resuelve}</strong></p>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      <ul className="lista-incidencias">
        {visibles.map((i) => (
          <li key={i.id}>
            <div className="inc-cabecera">
              <span className={`chip ${claseEstado(i.estado)}`}>{ETIQUETA_ESTADO_INC[i.estado]}</span>
              <strong>{ETIQUETA_INCIDENCIA[i.tipo]}</strong>
              <span className="nota">abierta el {fechaHora(i.creadoUtc)}</span>
            </div>
            <div>{describirIncidencia(i)}</div>
            <div className="nota">«{i.comentario}»</div>
            {i.estado === "RECHAZADA" && <div className="error-texto">Rechazada por {i.resueltaPor}: «{i.motivoRechazo}»</div>}
            {i.estado === "ACEPTADA" && <div className="nota">Aceptada por {i.resueltaPor} el {fechaHora(i.resueltaUtc!)}</div>}
            {i.estado === "PENDIENTE" && <button className="btn-link" onClick={() => setRetirar(i)}>Retirar</button>}
          </li>
        ))}
      </ul>
      {lista.length > 5 && <button className="btn-link" onClick={() => setVerTodas(!verTodas)}>{verTodas ? "Ver menos" : `Ver todas (${lista.length})`}</button>}

      {retirar && (
        <Modal titulo="Retirar incidencia" onCerrar={() => setRetirar(null)}>
          <p>¿Retirar la incidencia «{describirIncidencia(retirar)}»? Tu responsable ya no la verá.</p>
          <div className="modal-acciones">
            <button className="btn btn-secundario" onClick={() => setRetirar(null)}>Cancelar</button>
            <button className="btn btn-peligro" onClick={() => confirmarRetirar(retirar)}>Retirar</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
