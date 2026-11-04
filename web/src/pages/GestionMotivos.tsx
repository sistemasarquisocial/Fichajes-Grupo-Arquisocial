import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, MotivoGestion } from "../api";
import Modal from "../components/Modal";

type Mensaje = { tipo: "exito" | "error"; texto: string } | null;

/** Motivos de ausencia (ADMIN): los que puede elegir la plantilla y si exigen justificante. No se borran: se desactivan. */
export default function GestionMotivos() {
  const [motivos, setMotivos] = useState<MotivoGestion[] | null>(null);
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [editando, setEditando] = useState<MotivoGestion | "nuevo" | null>(null);

  async function cargar() {
    try {
      setMotivos((await api.motivosGestion()).motivos);
    } catch (err) {
      setMensaje({ tipo: "error", texto: err instanceof ApiError ? err.message : "No se pudieron cargar los motivos" });
    }
  }
  useEffect(() => { cargar(); }, []);

  return (
    <section>
      <div className="titulo-acciones">
        <div>
          <h2>Motivos de ausencia</h2>
          <p className="sub">Motivos que la plantilla puede elegir al justificar una ausencia. Si exigen justificante, no se pueden aprobar sin él.</p>
        </div>
        <button className="btn btn-primario" onClick={() => { setMensaje(null); setEditando("nuevo"); }}>+ Nuevo motivo</button>
      </div>
      {mensaje && <p className={mensaje.tipo} role={mensaje.tipo === "error" ? "alert" : "status"}>{mensaje.texto}</p>}
      <div className="tarjeta tabla-contenedor">
        {!motivos ? (
          <div className="centrado-bloque"><div className="spinner" aria-label="Cargando" /></div>
        ) : (
          <table className="tabla">
            <thead><tr><th>Orden</th><th>Motivo</th><th>Justificante</th><th>Usos</th><th>Estado</th><th /></tr></thead>
            <tbody>
              {motivos.map((m) => (
                <tr key={m.id} className={m.activo ? "" : "inactivo"}>
                  <td>{m.orden}</td>
                  <td><strong>{m.nombre}</strong></td>
                  <td>{m.requiereJustificante ? "Obligatorio" : "Opcional"}</td>
                  <td>{m.usos}</td>
                  <td><span className={`chip ${m.activo ? "chip-activa" : "chip-inactiva"}`}>{m.activo ? "Activo" : "Inactivo"}</span></td>
                  <td className="acciones-fila"><button className="btn-link" onClick={() => { setMensaje(null); setEditando(m); }}>Editar</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editando && (
        <EditarMotivo
          motivo={editando === "nuevo" ? null : editando}
          onCerrar={() => setEditando(null)}
          onGuardado={async (t) => { setEditando(null); setMensaje({ tipo: "exito", texto: t }); await cargar(); }}
        />
      )}
    </section>
  );
}

function EditarMotivo({ motivo, onCerrar, onGuardado }: { motivo: MotivoGestion | null; onCerrar: () => void; onGuardado: (t: string) => void }) {
  const [f, setF] = useState({ nombre: motivo?.nombre ?? "", requiereJustificante: motivo?.requiereJustificante ?? true, orden: String(motivo?.orden ?? 100), activo: motivo?.activo ?? true });
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    const nombre = f.nombre.trim();
    const orden = Number(f.orden);
    if (nombre.length < 3) return setError("El nombre debe tener al menos 3 caracteres.");
    if (!Number.isInteger(orden) || orden < 0) return setError("El orden debe ser un número entero.");
    setGuardando(true);
    try {
      if (motivo) await api.editarMotivo(motivo.id, { nombre, requiereJustificante: f.requiereJustificante, orden, activo: f.activo });
      else await api.crearMotivo({ nombre, requiereJustificante: f.requiereJustificante, orden });
      onGuardado(motivo ? `Motivo «${nombre}» actualizado.` : `Motivo «${nombre}» creado.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar");
      setGuardando(false);
    }
  }
  return (
    <Modal titulo={motivo ? "Editar motivo" : "Nuevo motivo"} onCerrar={onCerrar}>
      <form onSubmit={guardar} className="form-modal">
        <label>Nombre *<input value={f.nombre} maxLength={100} onChange={(e) => setF({ ...f, nombre: e.target.value })} required /></label>
        <label className="campo-corto">Orden en la lista<input inputMode="numeric" value={f.orden} onChange={(e) => setF({ ...f, orden: e.target.value })} /></label>
        <label className="check"><input type="checkbox" checked={f.requiereJustificante} onChange={(e) => setF({ ...f, requiereJustificante: e.target.checked })} /> Exige justificante para poder aprobarla</label>
        {motivo && <label className="check"><input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} /> Activo (se puede elegir)</label>}
        {motivo && motivo.usos > 0 && <p className="nota">Lo usan {motivo.usos} ausencia(s). Si cambias el nombre, también cambia en ellas.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="modal-acciones">
          <button type="button" className="btn btn-secundario" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-primario" disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}
