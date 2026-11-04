import { FormEvent, ReactNode, useEffect, useState } from "react";
import { api, ApiError, Incidencia, Ausencia, ETIQUETA_INCIDENCIA, ETIQUETA_ESTADO_INC, ETIQUETA_ESTADO_AUS, fechaHora, fechaLarga, fechaDe, periodoAusencia } from "../api";
import Modal from "../components/Modal";
import ChipFichaje from "../components/ChipFichaje";
import { describirIncidencia, claseEstado } from "./MisIncidencias";
import { claseEstadoAus } from "./MisAusencias";
import { ListaDocumentos } from "../components/Justificantes";

type Mensaje = { tipo: "exito" | "error"; texto: string } | null;

/** Asistente de aprobaciones: ausencias justificadas e incidencias de fichaje de las personas que aprueba el usuario. */
export default function Aprobaciones({ onPendientes }: { onPendientes: (n: number) => void }) {
  const [vista, setVista] = useState<"PENDIENTES" | "RESUELTAS">("PENDIENTES");
  const [lista, setLista] = useState<Incidencia[] | null>(null);
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [aceptar, setAceptar] = useState<Incidencia | null>(null);
  const [rechazar, setRechazar] = useState<Incidencia | null>(null);
  const [ausencias, setAusencias] = useState<Ausencia[] | null>(null);
  const [aprobarAus, setAprobarAus] = useState<Ausencia | null>(null);
  const [rechazarAus, setRechazarAus] = useState<Ausencia | null>(null);

  async function cargar(v = vista) {
    setLista(null);
    setAusencias(null);
    try {
      const [r, a] = await Promise.all([api.aprobaciones(v), api.aprobacionesAusencias(v)]);
      setLista(r.incidencias);
      setAusencias(a.ausencias);
      if (v === "PENDIENTES") onPendientes(r.incidencias.length + a.ausencias.length);
    } catch (err) {
      setMensaje({ tipo: "error", texto: err instanceof ApiError ? err.message : "No se pudieron cargar las aprobaciones" });
      setLista([]);
      setAusencias([]);
    }
  }

  async function resolverAus(a: Ausencia, accion: "ACEPTAR" | "RECHAZAR", motivo?: string) {
    await api.resolverAusencia(a.id, accion, motivo);
    setAprobarAus(null);
    setRechazarAus(null);
    setMensaje({ tipo: "exito", texto: accion === "ACEPTAR" ? `Ausencia de ${a.solicitante} aprobada: cuenta como horas justificadas.` : `Ausencia de ${a.solicitante} rechazada.` });
    await cargar("PENDIENTES");
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
          <p className="sub">Ausencias justificadas e incidencias de fichaje de tu equipo. Una ausencia aprobada cuenta como horas justificadas; una incidencia aceptada corrige el fichaje (el original queda registrado).</p>
        </div>
      </div>
      {mensaje && <p className={mensaje.tipo} role={mensaje.tipo === "error" ? "alert" : "status"}>{mensaje.texto}</p>}

      <div className="tarjeta">
        <div className="pestanas" role="tablist">
          <button role="tab" aria-selected={vista === "PENDIENTES"} className={vista === "PENDIENTES" ? "activo" : ""} onClick={() => { setMensaje(null); setVista("PENDIENTES"); }}>Pendientes</button>
          <button role="tab" aria-selected={vista === "RESUELTAS"} className={vista === "RESUELTAS" ? "activo" : ""} onClick={() => { setMensaje(null); setVista("RESUELTAS"); }}>Resueltas (90 días)</button>
        </div>

        {ausencias && ausencias.length > 0 && (
          <>
            <h3 className="apartado">Ausencias ({ausencias.length})</h3>
            <ul className="lista-incidencias">
              {ausencias.map((a) => (
                <li key={`a${a.id}`}>
                  <div className="inc-cabecera">
                    {vista === "RESUELTAS" && <span className={`chip ${claseEstadoAus(a.estado)}`}>{ETIQUETA_ESTADO_AUS[a.estado]}</span>}
                    <strong>{a.solicitante}</strong>
                    <span className="nota">{a.centro ? `${a.codigoServicio ? `${a.codigoServicio} · ` : ""}${a.centro}` : a.departamento ? `Dpto. ${a.departamento}` : ""}</span>
                    <span className="nota">· enviada el {fechaHora(a.creadoUtc)}</span>
                  </div>
                  <div><strong>{a.motivo}</strong> · {periodoAusencia(a)}</div>
                  {a.comentario && <div className="inc-comentario">«{a.comentario}»</div>}
                  <ListaDocumentos docs={a.documentos} />
                  {a.estado === "PENDIENTE" && a.requiereJustificante && !a.documentos.length && <div className="error-texto">Este motivo exige justificante y aún no lo ha adjuntado.</div>}
                  {a.estado === "PENDIENTE" && !a.requiereJustificante && !a.documentos.length && <div className="nota">Sin justificante (no es obligatorio para este motivo).</div>}
                  {a.estado === "RECHAZADA" && <div className="error-texto">Rechazada por {a.resueltaPor}: «{a.motivoRechazo}»</div>}
                  {(a.estado === "APROBADA" || a.estado === "RETIRADA") && <div className="nota">{a.estado === "APROBADA" ? `Aprobada por ${a.resueltaPor}` : "Retirada por el empleado"} el {fechaHora(a.resueltaUtc!)}</div>}
                  {a.estado === "PENDIENTE" && (
                    <div className="inc-acciones">
                      <button className="btn btn-primario" disabled={a.requiereJustificante && !a.documentos.length} onClick={() => { setMensaje(null); setAprobarAus(a); }}>Aprobar</button>
                      <button className="btn btn-secundario" onClick={() => { setMensaje(null); setRechazarAus(a); }}>Rechazar</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {lista && lista.length > 0 && <h3 className="apartado">Incidencias de fichaje ({lista.length})</h3>}
          </>
        )}
        {!lista || !ausencias ? (
          <div className="centrado-bloque"><div className="spinner" aria-label="Cargando" /></div>
        ) : lista.length === 0 ? (
          ausencias.length ? null : <p className="nota vacio">{vista === "PENDIENTES" ? "No tienes nada pendiente de aprobar." : "No hay solicitudes resueltas en los últimos 90 días."}</p>
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
      {aprobarAus && <AprobarAusencia aus={aprobarAus} onCerrar={() => setAprobarAus(null)} onConfirmar={() => resolverAus(aprobarAus, "ACEPTAR")} />}
      {rechazarAus && (
        <Rechazar
          inc={null} titulo="Rechazar ausencia" descripcion={<>Ausencia de <strong>{rechazarAus.solicitante}</strong>: {rechazarAus.motivo}, {periodoAusencia(rechazarAus)}</>}
          nombre={rechazarAus.solicitante} onCerrar={() => setRechazarAus(null)} onConfirmar={(m) => resolverAus(rechazarAus, "RECHAZAR", m)}
        />
      )}
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

function AprobarAusencia({ aus, onCerrar, onConfirmar }: { aus: Ausencia; onCerrar: () => void; onConfirmar: () => Promise<void> }) {
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  async function ok() {
    setEnviando(true);
    try {
      await onConfirmar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo aprobar");
      setEnviando(false);
    }
  }
  return (
    <Modal titulo="Aprobar ausencia" onCerrar={onCerrar}>
      <p>¿Aprobar la ausencia de <strong>{aus.solicitante}</strong>?</p>
      <p>{aus.motivo} · {periodoAusencia(aus)}</p>
      <p className="nota">No contará como ausencia: aparecerá como horas justificadas en su historial, en su saldo y en los informes.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-acciones">
        <button className="btn btn-secundario" onClick={onCerrar}>Cancelar</button>
        <button className="btn btn-primario" onClick={ok} disabled={enviando}>{enviando ? "Aprobando…" : "Aprobar"}</button>
      </div>
    </Modal>
  );
}

function Rechazar({ inc, titulo, descripcion, nombre, onCerrar, onConfirmar }: {
  inc: Incidencia | null; titulo?: string; descripcion?: ReactNode; nombre?: string; onCerrar: () => void; onConfirmar: (motivo: string) => Promise<void>;
}) {
  const quien = nombre ?? inc?.solicitante ?? "";
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
    <Modal titulo={titulo ?? "Rechazar incidencia"} onCerrar={onCerrar} ancho>
      <form onSubmit={enviar} className="form-modal">
        <p>{descripcion ?? (inc && <>Incidencia de <strong>{inc.solicitante}</strong>: {describirIncidencia(inc)}</>)}</p>
        <label>
          Motivo del rechazo * <span className="nota">(lo verá {quien.split(" ")[0]})</span>
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
