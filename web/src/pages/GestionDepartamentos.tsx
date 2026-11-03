import { FormEvent, useEffect, useMemo, useState } from "react";
import { api, ApiError, Departamento, UsuarioGestion } from "../api";
import Modal from "../components/Modal";

type Mensaje = { tipo: "exito" | "error"; texto: string } | null;

/** Departamentos de estructura: nombre y manager (aprueba a los empleados del departamento). */
export default function GestionDepartamentos() {
  const [deps, setDeps] = useState<Departamento[] | null>(null);
  const [usuarios, setUsuarios] = useState<UsuarioGestion[]>([]);
  const [filtro, setFiltro] = useState("");
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [editando, setEditando] = useState<Departamento | "nuevo" | null>(null);
  const [confirmar, setConfirmar] = useState<Departamento | null>(null);

  async function cargar() {
    try {
      const [d, u] = await Promise.all([api.departamentos(), api.usuarios()]);
      setDeps(d);
      setUsuarios(u);
    } catch (err) {
      setMensaje({ tipo: "error", texto: err instanceof ApiError ? err.message : "No se pudieron cargar los departamentos" });
    }
  }
  useEffect(() => { cargar(); }, []);

  const filtrados = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    return (deps ?? []).filter((d) => !q || `${d.nombre} ${d.manager ?? ""}`.toLowerCase().includes(q));
  }, [deps, filtro]);

  async function cambiarEstado(d: Departamento) {
    setConfirmar(null);
    try {
      await api.editarDepartamento(d.id, { activo: !d.activo });
      setMensaje({ tipo: "exito", texto: `Departamento «${d.nombre}» ${d.activo ? "desactivado" : "activado"}.` });
      await cargar();
    } catch (err) {
      setMensaje({ tipo: "error", texto: err instanceof ApiError ? err.message : "No se pudo cambiar el estado" });
    }
  }

  return (
    <section>
      <div className="titulo-acciones">
        <div>
          <h2>Gestión de departamentos</h2>
          <p className="sub">Departamentos de estructura y su manager, que aprueba a los empleados del departamento.</p>
        </div>
        <button className="btn btn-primario" onClick={() => { setMensaje(null); setEditando("nuevo"); }}>+ Nuevo departamento</button>
      </div>

      {mensaje && <p className={mensaje.tipo} role={mensaje.tipo === "error" ? "alert" : "status"}>{mensaje.texto}</p>}

      <div className="tarjeta tabla-contenedor">
        {!deps ? (
          <div className="centrado-bloque"><div className="spinner" aria-label="Cargando" /></div>
        ) : (
          <>
            <div className="tabla-buscador">
              <input className="buscador" placeholder="Buscar por departamento o manager…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
            </div>
            {filtrados.length === 0 ? (
              <p className="nota vacio">{deps.length ? "Ningún departamento coincide con la búsqueda." : "Todavía no hay departamentos."}</p>
            ) : (
              <table className="tabla">
                <thead><tr><th>Departamento</th><th>Manager</th><th>Personas</th><th>Estado</th><th /></tr></thead>
                <tbody>
                  {filtrados.map((d) => (
                    <tr key={d.id} className={d.activo ? "" : "inactivo"}>
                      <td><strong>{d.nombre}</strong></td>
                      <td>{d.manager ?? <span className="chip chip-pausa_inicio">Sin manager</span>}</td>
                      <td>{d.miembros}</td>
                      <td><span className={`chip ${d.activo ? "chip-activa" : "chip-inactiva"}`}>{d.activo ? "Activo" : "Inactivo"}</span></td>
                      <td className="acciones-fila">
                        <button className="btn-link" onClick={() => { setMensaje(null); setEditando(d); }}>Editar</button>
                        <button className="btn-link" onClick={() => setConfirmar(d)}>{d.activo ? "Desactivar" : "Activar"}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {editando && (
        <EditarDepartamento
          dep={editando === "nuevo" ? null : editando}
          deps={deps ?? []}
          usuarios={usuarios}
          onCerrar={() => setEditando(null)}
          onGuardado={async (texto) => {
            setEditando(null);
            setMensaje({ tipo: "exito", texto });
            await cargar();
          }}
        />
      )}

      {confirmar && (
        <Modal titulo={confirmar.activo ? "Desactivar departamento" : "Activar departamento"} onCerrar={() => setConfirmar(null)}>
          {confirmar.activo ? (
            <>
              <p>¿Desactivar <strong>{confirmar.nombre}</strong>?</p>
              <p className="nota">Dejará de aparecer al asignar departamento a los usuarios. No se borra nada.</p>
              {confirmar.miembros > 0 && <p className="aviso">Tiene {confirmar.miembros} persona(s) activa(s). Seguirán asignadas y su manager les seguirá aprobando.</p>}
            </>
          ) : (
            <p>¿Volver a activar <strong>{confirmar.nombre}</strong>?</p>
          )}
          <div className="modal-acciones">
            <button className="btn btn-secundario" onClick={() => setConfirmar(null)}>Cancelar</button>
            <button className={`btn ${confirmar.activo ? "btn-peligro" : "btn-primario"}`} onClick={() => cambiarEstado(confirmar)}>{confirmar.activo ? "Desactivar" : "Activar"}</button>
          </div>
        </Modal>
      )}
    </section>
  );
}

function EditarDepartamento({ dep, deps, usuarios, onCerrar, onGuardado }: {
  dep: Departamento | null; deps: Departamento[]; usuarios: UsuarioGestion[]; onCerrar: () => void; onGuardado: (texto: string) => void;
}) {
  const [nombre, setNombre] = useState(dep?.nombre ?? "");
  const [managerId, setManagerId] = useState(dep?.managerId ? String(dep.managerId) : "");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const activos = usuarios.filter((u) => u.activo).sort((a, b) => `${a.apellidos} ${a.nombre}`.localeCompare(`${b.apellidos} ${b.nombre}`, "es"));

  async function guardar(e: FormEvent) {
    e.preventDefault();
    const n = nombre.replace(/\s+/g, " ").trim();
    if (n.length < 2) return setError("El nombre debe tener al menos 2 caracteres.");
    if (deps.some((d) => d.id !== dep?.id && d.nombre.toLowerCase() === n.toLowerCase())) return setError("Ya existe un departamento con ese nombre.");
    setError("");
    setGuardando(true);
    try {
      const m = managerId ? Number(managerId) : null;
      if (dep) {
        await api.editarDepartamento(dep.id, { nombre: n, managerId: m });
        onGuardado("Departamento actualizado.");
      } else {
        await api.crearDepartamento({ nombre: n, managerId: m });
        onGuardado(`Departamento «${n}» creado. Ya puedes asignarlo a usuarios de estructura.`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar");
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={dep ? "Editar departamento" : "Nuevo departamento"} onCerrar={onCerrar} ancho>
      <form onSubmit={guardar} className="form-modal">
        <label>
          Nombre *
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={100} placeholder="Ej.: Gestión Zona Norte" required />
        </label>
        <label>
          Manager
          <select value={managerId} onChange={(e) => setManagerId(e.target.value)}>
            <option value="">(Sin manager)</option>
            {activos.map((u) => <option key={u.id} value={u.id}>{u.nombre} {u.apellidos}</option>)}
          </select>
        </label>
        <p className="nota">El manager aprueba a las personas de estructura de este departamento. A él le aprueba el manager indicado en su ficha de usuario.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="modal-acciones">
          <button type="button" className="btn btn-secundario" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-primario" disabled={guardando}>{guardando ? "Guardando…" : dep ? "Guardar" : "Crear departamento"}</button>
        </div>
      </form>
    </Modal>
  );
}
