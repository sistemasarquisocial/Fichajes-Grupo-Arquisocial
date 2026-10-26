import { FormEvent, ReactNode, useEffect, useState } from "react";
import { api, ApiError, EmpresaGestion } from "../api";
import { useSesion } from "../sesion";

type Mensaje = { tipo: "exito" | "error"; texto: string } | null;

const normalizar = (s: string) => s.replace(/\s+/g, " ").trim();

export default function GestionEmpresas() {
  const { usuario: yo } = useSesion();
  const [empresas, setEmpresas] = useState<EmpresaGestion[] | null>(null);
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [asistente, setAsistente] = useState(false);
  const [editando, setEditando] = useState<EmpresaGestion | null>(null);
  const [confirmarEstado, setConfirmarEstado] = useState<EmpresaGestion | null>(null);

  async function cargar() {
    try {
      setEmpresas(await api.empresasGestion());
    } catch (err) {
      setMensaje({ tipo: "error", texto: err instanceof ApiError ? err.message : "No se pudieron cargar las empresas" });
    }
  }
  useEffect(() => { cargar(); }, []);

  async function cambiarEstado(e: EmpresaGestion) {
    setConfirmarEstado(null);
    try {
      await api.editarEmpresa(e.id, { activa: !e.activa });
      setMensaje({ tipo: "exito", texto: `Empresa «${e.nombre}» ${e.activa ? "desactivada" : "activada"}.` });
      await cargar();
    } catch (err) {
      setMensaje({ tipo: "error", texto: err instanceof ApiError ? err.message : "No se pudo cambiar el estado" });
    }
  }

  return (
    <section>
      <div className="titulo-acciones">
        <div>
          <h1>Empresas</h1>
          <p className="sub">Empresas del grupo disponibles para asignar a usuarios y centros.</p>
        </div>
        <button className="btn btn-primario" onClick={() => { setMensaje(null); setAsistente(true); }}>+ Nueva empresa</button>
      </div>

      {mensaje && <p className={mensaje.tipo} role={mensaje.tipo === "error" ? "alert" : "status"}>{mensaje.texto}</p>}

      <div className="tarjeta tabla-contenedor">
        {!empresas ? (
          <div className="centrado-bloque"><div className="spinner" aria-label="Cargando" /></div>
        ) : empresas.length === 0 ? (
          <p className="nota vacio">Todavía no hay empresas.</p>
        ) : (
          <table className="tabla">
            <thead>
              <tr><th>Empresa</th><th>Estado</th><th>Centros</th><th>Usuarios activos</th><th>Alta</th><th /></tr>
            </thead>
            <tbody>
              {empresas.map((e) => (
                <tr key={e.id} className={e.activa ? "" : "inactivo"}>
                  <td><strong>{e.nombre}</strong></td>
                  <td><span className={`chip ${e.activa ? "chip-activa" : "chip-inactiva"}`}>{e.activa ? "Activa" : "Inactiva"}</span></td>
                  <td>{e.centros}</td>
                  <td>{e.usuariosActivos}</td>
                  <td>{new Date(e.creadoUtc).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" })}</td>
                  <td className="acciones-fila">
                    <button className="btn-link" onClick={() => { setMensaje(null); setEditando(e); }}>Editar</button>
                    {e.id !== yo?.empresaId && (
                      <button className="btn-link" onClick={() => setConfirmarEstado(e)}>{e.activa ? "Desactivar" : "Activar"}</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {asistente && (
        <AsistenteEmpresa
          existentes={empresas ?? []}
          onCerrar={() => setAsistente(false)}
          onCreada={async (nombre) => {
            setAsistente(false);
            setMensaje({ tipo: "exito", texto: `Empresa «${nombre}» creada. Ya puedes asignarla a centros y usuarios.` });
            await cargar();
          }}
        />
      )}

      {editando && (
        <EditarEmpresa
          empresa={editando}
          existentes={empresas ?? []}
          onCerrar={() => setEditando(null)}
          onGuardada={async () => {
            setEditando(null);
            setMensaje({ tipo: "exito", texto: "Empresa actualizada." });
            await cargar();
          }}
        />
      )}

      {confirmarEstado && (
        <Modal titulo={confirmarEstado.activa ? "Desactivar empresa" : "Activar empresa"} onCerrar={() => setConfirmarEstado(null)}>
          {confirmarEstado.activa ? (
            <>
              <p>¿Desactivar <strong>{confirmarEstado.nombre}</strong>?</p>
              <p className="nota">Dejará de aparecer al crear usuarios y centros. No se borra nada: sus usuarios, centros y fichajes se conservan.</p>
              {confirmarEstado.usuariosActivos > 0 && (
                <p className="aviso">Tiene {confirmarEstado.usuariosActivos} usuario(s) activo(s). Seguirán pudiendo fichar hasta que los desactives.</p>
              )}
            </>
          ) : (
            <p>¿Volver a activar <strong>{confirmarEstado.nombre}</strong>?</p>
          )}
          <div className="modal-acciones">
            <button className="btn btn-secundario" onClick={() => setConfirmarEstado(null)}>Cancelar</button>
            <button className={`btn ${confirmarEstado.activa ? "btn-peligro" : "btn-primario"}`} onClick={() => cambiarEstado(confirmarEstado)}>
              {confirmarEstado.activa ? "Desactivar" : "Activar"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

/* ---------- Asistente de alta: 1) Datos · 2) Resumen y confirmar ---------- */
function AsistenteEmpresa({ existentes, onCerrar, onCreada }: { existentes: EmpresaGestion[]; onCerrar: () => void; onCreada: (nombre: string) => void }) {
  const [paso, setPaso] = useState<1 | 2>(1);
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  const limpio = normalizar(nombre);
  const duplicada = existentes.find((e) => e.nombre.toLowerCase() === limpio.toLowerCase());

  function siguiente(ev: FormEvent) {
    ev.preventDefault();
    setError("");
    if (limpio.length < 2) return setError("El nombre debe tener al menos 2 caracteres.");
    if (limpio.length > 100) return setError("El nombre no puede superar 100 caracteres.");
    if (duplicada) return setError(`Ya existe la empresa «${duplicada.nombre}»${duplicada.activa ? "" : " (inactiva: puedes reactivarla desde el listado)"}.`);
    setPaso(2);
  }

  async function confirmar() {
    setError("");
    setGuardando(true);
    try {
      await api.crearEmpresa(limpio);
      onCreada(limpio);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear la empresa");
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Nueva empresa" onCerrar={onCerrar}>
      <ol className="pasos" aria-label="Pasos del asistente">
        <li className={paso === 1 ? "activo" : "hecho"}><span>1</span>Datos</li>
        <li className={paso === 2 ? "activo" : ""}><span>2</span>Resumen y confirmar</li>
      </ol>

      {paso === 1 ? (
        <form onSubmit={siguiente} className="form-modal">
          <label>
            Nombre de la empresa
            <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={100} placeholder="Ej.: Arquisocial" autoFocus required />
          </label>
          <p className="nota">Es el nombre que verán los usuarios y que aparecerá en los informes.</p>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="modal-acciones">
            <button type="button" className="btn btn-secundario" onClick={onCerrar}>Cancelar</button>
            <button className="btn btn-primario">Siguiente</button>
          </div>
        </form>
      ) : (
        <div className="form-modal">
          <dl className="resumen">
            <dt>Empresa</dt><dd>{limpio}</dd>
            <dt>Estado</dt><dd>Activa</dd>
          </dl>
          <p className="nota">Después podrás añadir sus centros de trabajo y usuarios desde la pantalla Usuarios.</p>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="modal-acciones">
            <button type="button" className="btn btn-secundario" onClick={() => setPaso(1)} disabled={guardando}>Atrás</button>
            <button className="btn btn-primario" onClick={confirmar} disabled={guardando}>{guardando ? "Creando…" : "Crear empresa"}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------- Editar nombre ---------- */
function EditarEmpresa({ empresa, existentes, onCerrar, onGuardada }: { empresa: EmpresaGestion; existentes: EmpresaGestion[]; onCerrar: () => void; onGuardada: () => void }) {
  const [nombre, setNombre] = useState(empresa.nombre);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
    setError("");
    const limpio = normalizar(nombre);
    if (limpio.length < 2) return setError("El nombre debe tener al menos 2 caracteres.");
    if (existentes.some((e) => e.id !== empresa.id && e.nombre.toLowerCase() === limpio.toLowerCase())) return setError("Ya existe una empresa con ese nombre.");
    if (limpio === empresa.nombre) return onCerrar();
    setGuardando(true);
    try {
      await api.editarEmpresa(empresa.id, { nombre: limpio });
      onGuardada();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar");
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Editar empresa" onCerrar={onCerrar}>
      <form onSubmit={guardar} className="form-modal">
        <label>
          Nombre de la empresa
          <input value={nombre} onChange={(e) => setNombre(e.target.value)} maxLength={100} autoFocus required />
        </label>
        <p className="nota">El cambio de nombre se aplica a todos sus usuarios, centros e informes.</p>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="modal-acciones">
          <button type="button" className="btn btn-secundario" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-primario" disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Ventana modal ---------- */
function Modal({ titulo, onCerrar, children }: { titulo: string; onCerrar: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onCerrar]);
  return (
    <div className="modal-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="modal-cabecera">
          <h2>{titulo}</h2>
          <button className="modal-cerrar" onClick={onCerrar} aria-label="Cerrar">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
