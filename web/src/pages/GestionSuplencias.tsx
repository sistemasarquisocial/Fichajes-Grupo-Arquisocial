import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, Suplencia, hoyLocal } from "../api";
import Modal from "../components/Modal";
import SelectorPersona from "../components/SelectorPersona";

type Mensaje = { tipo: "exito" | "error"; texto: string } | null;
const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;

/** Suplencias vigentes y futuras de todos los aprobadores (ADMIN). */
export default function GestionSuplencias() {
  const [lista, setLista] = useState<Suplencia[] | null>(null);
  const [directorio, setDirectorio] = useState<{ id: number; nombre: string }[]>([]);
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [nueva, setNueva] = useState(false);
  const [anular, setAnular] = useState<Suplencia | null>(null);
  const hoy = hoyLocal();

  async function cargar() {
    try {
      const [s, d] = await Promise.all([api.suplenciasGestion(), api.directorio()]);
      setLista(s);
      setDirectorio(d);
    } catch (err) {
      setMensaje({ tipo: "error", texto: err instanceof ApiError ? err.message : "No se pudieron cargar las suplencias" });
    }
  }
  useEffect(() => { cargar(); }, []);

  async function confirmarAnular(s: Suplencia) {
    setAnular(null);
    try {
      await api.anularSuplencia(s.id);
      setMensaje({ tipo: "exito", texto: "Suplencia anulada." });
      await cargar();
    } catch (err) {
      setMensaje({ tipo: "error", texto: err instanceof ApiError ? err.message : "No se pudo anular" });
    }
  }

  return (
    <section>
      <div className="titulo-acciones">
        <div>
          <h2>Suplencias</h2>
          <p className="sub">Durante una suplencia, el suplente aprueba y ve a las personas del titular.</p>
        </div>
        <button className="btn btn-primario" onClick={() => { setMensaje(null); setNueva(true); }}>+ Nueva suplencia</button>
      </div>
      {mensaje && <p className={mensaje.tipo} role={mensaje.tipo === "error" ? "alert" : "status"}>{mensaje.texto}</p>}
      <div className="tarjeta tabla-contenedor">
        {!lista ? (
          <div className="centrado-bloque"><div className="spinner" aria-label="Cargando" /></div>
        ) : lista.length === 0 ? (
          <p className="nota vacio">No hay suplencias vigentes ni programadas.</p>
        ) : (
          <table className="tabla">
            <thead><tr><th>Titular</th><th>Suplente</th><th>Periodo</th><th>Registrada por</th><th /></tr></thead>
            <tbody>
              {lista.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.titular}</strong></td>
                  <td>{s.suplente}</td>
                  <td className="nowrap">{fechaCorta(s.desde)} – {fechaCorta(s.hasta)} {s.desde <= hoy && <span className="chip chip-entrada">En curso</span>}</td>
                  <td>{s.creadoPor}</td>
                  <td className="acciones-fila"><button className="btn-link" onClick={() => setAnular(s)}>Anular</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {nueva && (
        <NuevaSuplencia
          directorio={directorio}
          onCerrar={() => setNueva(false)}
          onGuardado={async () => {
            setNueva(false);
            setMensaje({ tipo: "exito", texto: "Suplencia registrada." });
            await cargar();
          }}
        />
      )}

      {anular && (
        <Modal titulo="Anular suplencia" onCerrar={() => setAnular(null)}>
          <p>¿Anular la suplencia de <strong>{anular.titular}</strong> por <strong>{anular.suplente}</strong> ({fechaCorta(anular.desde)} – {fechaCorta(anular.hasta)})?</p>
          <div className="modal-acciones">
            <button className="btn btn-secundario" onClick={() => setAnular(null)}>Cancelar</button>
            <button className="btn btn-peligro" onClick={() => confirmarAnular(anular)}>Anular</button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function NuevaSuplencia({ directorio, onCerrar, onGuardado }: { directorio: { id: number; nombre: string }[]; onCerrar: () => void; onGuardado: () => void }) {
  const hoy = hoyLocal();
  const [f, setF] = useState({ titularId: "", suplenteId: "", desde: hoy, hasta: hoy });
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!f.titularId || !f.suplenteId) return setError("Elige titular y suplente.");
    if (f.titularId === f.suplenteId) return setError("El suplente no puede ser el titular.");
    if (f.desde > f.hasta) return setError("La fecha de fin no puede ser anterior a la de inicio.");
    setError("");
    setGuardando(true);
    try {
      await api.crearSuplencia({ titularId: Number(f.titularId), suplenteId: Number(f.suplenteId), desde: f.desde, hasta: f.hasta });
      onGuardado();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo registrar");
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Nueva suplencia" onCerrar={onCerrar} ancho>
      <form onSubmit={guardar} className="form-modal">
        <label>
          Titular (aprobador ausente)
          <SelectorPersona personas={directorio} valor={f.titularId} onCambio={(v) => setF({ ...f, titularId: v })} requerido />
        </label>
        <label>
          Suplente
          <SelectorPersona personas={directorio.filter((x) => String(x.id) !== f.titularId)} valor={f.suplenteId} onCambio={(v) => setF({ ...f, suplenteId: v })} requerido />
        </label>
        <div className="fila">
          <label>Desde<input type="date" value={f.desde} min={hoy} onChange={(e) => setF({ ...f, desde: e.target.value })} required /></label>
          <label>Hasta<input type="date" value={f.hasta} min={f.desde} onChange={(e) => setF({ ...f, hasta: e.target.value })} required /></label>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="modal-acciones">
          <button type="button" className="btn btn-secundario" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-primario" disabled={guardando}>{guardando ? "Guardando…" : "Registrar"}</button>
        </div>
      </form>
    </Modal>
  );
}
