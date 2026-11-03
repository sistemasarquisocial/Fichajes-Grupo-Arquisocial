import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, Incidencia, ETIQUETA_INCIDENCIA, ETIQUETA_ESTADO_INC, fechaHora, fechaLarga, fechaDe } from "../api";
import Modal from "../components/Modal";
import ChipFichaje from "../components/ChipFichaje";
import { describirIncidencia, claseEstado } from "./MisIncidencias";

type Mensaje = { tipo: "exito" | "error"; texto: string } | null;

/** Asistente de aprobaciones: incidencias de fichaje de las personas que aprueba el usuario. */
export default function Aprobaciones({ onPendientes }: { onPendientes: (n: number) => void }) {
  const [vista, setVista] = useState<"PENDIENTES" | "RESUELTAS">("PENDIENTES");
  const [lista, setLista] = useState<Incidencia[] | null>(null);
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [aceptar, setAceptar] = useState<Incidencia | null>(null);
  const [rechazar, setRechazar] = useState<Incidencia | null>(null);

  async function cargar(v = vista) {
    setLista(null);
    try {
      const r = await api.aprobaciones(v);
      setLista(r.incidencias);
      if (v === "PENDIENTES") onPendientes(r.incidencias.length);
    } catch (err) {
      setMensaje({ tipo: "error", texto: err instanceof ApiError ? err.message : "No se pudieron cargar las aprobaciones" });
      setLista([]);
    }
  }
  useEffect(() => { cargar(vista); }, [vista]); // eslint-disable-line react-hooks/exhaustive-deps

  async function resolver(i: Incidencia, accion: "ACEPTAR" | "RECHAZAR", motivo?: string) {
    await api.resolverIncidencia(i.id, accion, motivo);
    setAceptar(null);
    setRechazar(null);
    setMensaje({ tipo: "exito", texto: accion === "ACEPTAR" ? `Incidencia de ${i.solicitante} aceptada: el fichaje queda corregido.` : `Incidencia de ${i.solicitante} rechazada.` });
    await cargar("PENDIENTES");
  }

  return (
    <section>
      <div className="titulo-acciones">
        <div>
          <h2>Aprobaciones</h2>
          <p className="sub">Incidencias de fichaje de tu equipo. Al aceptar se corrige el fichaje (el original queda registrado); al rechazar se mantiene como está.</p>
        </div>
      </div>
      {mensaje && <p className={mensaje.tipo} role={mensaje.tipo === "error" ? "alert" : "status"}>{mensaje.texto}</p>}

      <div className="tarjeta">
        <div className="pestanas" role="tablist">
          <button role="tab" aria-selected={vista === "PENDIENTES"} className={vista === "PENDIENTES" ? "activo" : ""} onClick={() => { setMensaje(null); setVista("PENDIENTES"); }}>Pendientes</button>
          <button role="tab" aria-selected={vista === "RESUELTAS"} className={vista === "RESUELTAS" ? "activo" : ""} onClick={() => { setMensaje(null); setVista("RESUELTAS"); }}>Resueltas (90 días)</button>
        </div>

        {!lista ? (
          <div className="centrado-bloque"><div className="spinner" aria-label="Cargando" /></div>
        ) : lista.length === 0 ? (
          <p className="nota vacio">{vista === "PENDIENTES" ? "No tienes incidencias pendientes de aprobar." : "No hay incidencias resueltas en los últimos 90 días."}</p>
        ) : (
          <ul className="lista-incidencias">
            {lista.map((i) => (
              <li key={i.id}>
                <div className="inc-cabecera">
                  {vista === "RESUELTAS" && <span className={`chip ${claseEstado(i.estado)}`}>{ETIQUETA_ESTADO_INC[i.estado]}</span>}
                  <strong>{i.solicitante}</strong>
                  <span className="nota">{i.centro ? `${i.codigoServicio ? `${i.codigoServicio} · ` : ""}${i.centro}` : i.departamento ? `Dpto. ${i.departamento}` : ""}</span>
                  <span className="nota">· abierta el {fechaHora(i.creadoUtc)}</span>
                </div>
                <div><strong>{ETIQUETA_INCIDENCIA[i.tipo]}</strong> · {describirIncidencia(i)}</div>
                <div className="inc-comentario">«{i.comentario}»</div>
                {i.contexto && (
                  <div className="inc-contexto">
                    <span className="nota capitalizar-bloque">Fichajes de {fechaLarga(fechaDe(i.propuestaUtc ?? i.originalUtc!))}:</span>
                    <div className="chips">
                      {i.contexto.length ? i.contexto.map((f, k) => <ChipFichaje key={k} f={f} extraClase={f.id && f.id === i.fichajeId ? "chip-objetivo" : ""} />) : <span className="nota">ninguno</span>}
                    </div>
                  </div>
                )}
                {i.estado === "RECHAZADA" && <div className="error-texto">Rechazada por {i.resueltaPor}: «{i.motivoRechazo}»</div>}
                {(i.estado === "ACEPTADA" || i.estado === "RETIRADA") && <div className="nota">{i.estado === "ACEPTADA" ? `Aceptada por ${i.resueltaPor}` : "Retirada por el empleado"} el {fechaHora(i.resueltaUtc!)}</div>}
                {i.estado === "PENDIENTE" && (
                  <div className="inc-acciones">
                    <button className="btn btn-primario" onClick={() => { setMensaje(null); setAceptar(i); }}>Aceptar</button>
                    <button className="btn btn-secundario" onClick={() => { setMensaje(null); setRechazar(i); }}>Rechazar</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {aceptar && <Confirmar inc={aceptar} onCerrar={() => setAceptar(null)} onConfirmar={() => resolver(aceptar, "ACEPTAR")} />}
      {rechazar && <Rechazar inc={rechazar} onCerrar={() => setRechazar(null)} onConfirmar={(m) => resolver(rechazar, "RECHAZAR", m)} />}
    </section>
  );
}

function Confirmar({ inc, onCerrar, onConfirmar }: { inc: Incidencia; onCerrar: () => void; onConfirmar: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  async function ok() {
    setEnviando(true);
    try {
      await onConfirmar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo aceptar");
      setEnviando(false);
    }
  }
  return (
    <Modal titulo="Aceptar incidencia" onCerrar={onCerrar}>
      <p>¿Aceptar la incidencia de <strong>{inc.solicitante}</strong>?</p>
      <p>{describirIncidencia(inc)}</p>
      <p className="nota">El fichaje original no se borra: queda registrado y se mostrará como «corregido» en el historial y en los informes.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-acciones">
        <button className="btn btn-secundario" onClick={onCerrar}>Cancelar</button>
        <button className="btn btn-primario" onClick={ok} disabled={enviando}>{enviando ? "Aceptando…" : "Aceptar"}</button>
      </div>
    </Modal>
  );
}

function Rechazar({ inc, onCerrar, onConfirmar }: { inc: Incidencia; onCerrar: () => void; onConfirmar: (motivo: string) => Promise<void> }) {
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (motivo.trim().length < 5) return setError("Indica el motivo (mínimo 5 caracteres). Lo verá el empleado.");
    setEnviando(true);
    try {
      await onConfirmar(motivo.trim());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo rechazar");
      setEnviando(false);
    }
  }
  return (
    <Modal titulo="Rechazar incidencia" onCerrar={onCerrar} ancho>
      <form onSubmit={enviar} className="form-modal">
        <p>Incidencia de <strong>{inc.solicitante}</strong>: {describirIncidencia(inc)}</p>
        <label>
          Motivo del rechazo * <span className="nota">(lo verá {inc.solicitante.split(" ")[0]})</span>
          <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={500} rows={3} required />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="modal-acciones">
          <button type="button" className="btn btn-secundario" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-peligro" disabled={enviando}>{enviando ? "Rechazando…" : "Rechazar"}</button>
        </div>
      </form>
    </Modal>
  );
}
