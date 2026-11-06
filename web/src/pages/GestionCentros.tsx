import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import { api, ApiError, Centro, DatosCentro, Empresa, UsuarioGestion } from "../api";
import Modal from "../components/Modal";
import SelectorPersona, { OpcionPersona } from "../components/SelectorPersona";

type Mensaje = { tipo: "exito" | "error"; texto: string } | null;

const VACIO: DatosCentro = { empresaId: 0, codigoServicio: "", nombre: "", direccion: "", codigoPostal: "", ciudad: "", telefono: "" };
const limpiar = (s: string) => s.replace(/\s+/g, " ").trim();

/** Validación en el navegador (la API vuelve a validar todo). */
function validar(d: DatosCentro, centros: Centro[], excluirId: number | null): string | null {
  if (!d.empresaId) return "Selecciona la empresa.";
  if (!/^\d{1,10}$/.test(d.codigoServicio.trim())) return "El código de servicio es obligatorio y solo admite números (máx. 10 dígitos).";
  if (limpiar(d.nombre).length < 2) return "El nombre del centro debe tener al menos 2 caracteres.";
  if (d.codigoPostal.trim() && !/^\d{5}$/.test(d.codigoPostal.trim())) return "El código postal debe tener 5 dígitos.";
  if (d.telefono.trim() && !/^\+?[\d\s]{9,20}$/.test(d.telefono.trim())) return "Teléfono no válido (solo números, espacios y + inicial).";
  const otro = centros.find((c) => c.id !== excluirId && c.codigoServicio === d.codigoServicio.trim());
  if (otro) return `El código de servicio ${d.codigoServicio.trim()} ya lo usa el centro «${otro.nombre}».`;
  if (centros.some((c) => c.id !== excluirId && c.empresaId === d.empresaId && c.nombre.toLowerCase() === limpiar(d.nombre).toLowerCase()))
    return "Ya existe un centro con ese nombre en la empresa.";
  return null;
}

const normalizar = (d: DatosCentro): DatosCentro => ({
  empresaId: d.empresaId,
  codigoServicio: d.codigoServicio.trim(),
  nombre: limpiar(d.nombre),
  direccion: limpiar(d.direccion),
  codigoPostal: d.codigoPostal.trim(),
  ciudad: limpiar(d.ciudad),
  telefono: limpiar(d.telefono),
});

type Vista = "lista" | "empresa" | "comunidad";
const SIN_COMUNIDAD = "Sin comunidad (CP desconocido)";
const porTexto = (a: string, b: string) => a.localeCompare(b, "es");

const direccionCompleta = (c: { direccion: string | null; codigoPostal: string | null; ciudad: string | null }) =>
  [c.direccion, [c.codigoPostal, c.ciudad].filter(Boolean).join(" ")].filter(Boolean).join(", ");

export default function GestionCentros() {
  const [centros, setCentros] = useState<Centro[] | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [filtro, setFiltro] = useState("");
  const [fEmpresa, setFEmpresa] = useState("");
  const [fComunidad, setFComunidad] = useState("");
  const [fTipo, setFTipo] = useState<"" | "ESTRUCTURA" | "DELEGACION">("");
  const [fEstado, setFEstado] = useState<"" | "ACTIVO" | "CERRADO">("");
  const [vista, setVista] = useState<Vista>("lista");
  const [mensaje, setMensaje] = useState<Mensaje>(null);
  const [asistente, setAsistente] = useState(false);
  const [editando, setEditando] = useState<Centro | null>(null);
  const [confirmarEstado, setConfirmarEstado] = useState<Centro | null>(null);
  const [responsables, setResponsables] = useState<Centro | null>(null);
  const [control, setControl] = useState<Centro | null>(null);

  async function cargar() {
    try {
      const [c, e] = await Promise.all([api.centros(), api.empresas()]);
      setCentros(c);
      setEmpresas(e);
    } catch (err) {
      setMensaje({ tipo: "error", texto: err instanceof ApiError ? err.message : "No se pudieron cargar los centros" });
    }
  }
  useEffect(() => { cargar(); }, []);

  const comunidades = useMemo(
    () => [...new Set((centros ?? []).map((c) => c.comunidad ?? SIN_COMUNIDAD))].sort(porTexto),
    [centros]
  );
  const empresasConCentros = useMemo(() => [...new Set((centros ?? []).map((c) => c.empresa))].sort(porTexto), [centros]);

  const filtrados = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    if (!centros) return [];
    return centros.filter(
      (c) =>
        (!fEmpresa || c.empresa === fEmpresa) &&
        (!fComunidad || (c.comunidad ?? SIN_COMUNIDAD) === fComunidad) &&
        (!fTipo || (fTipo === "ESTRUCTURA") === c.esEstructura) &&
        (!fEstado || (fEstado === "ACTIVO") === c.activo) &&
        (!q ||
          `${c.codigoServicio ?? ""} ${c.codigoA3 ?? ""} ${c.nombre} ${c.empresa} ${c.ciudad ?? ""} ${c.direccion ?? ""} ${c.comunidad ?? ""} ${c.coordinador ?? ""} ${c.gestor ?? ""} ${c.tecnicoRrhh ?? ""}`
            .toLowerCase()
            .includes(q))
    );
  }, [centros, filtro, fEmpresa, fComunidad, fTipo, fEstado]);

  /** Grupos según la vista: una sola lista o agrupados por empresa / comunidad autónoma. */
  const grupos = useMemo(() => {
    if (vista === "lista") return [{ titulo: "", centros: filtrados }];
    const clave = (c: Centro) => (vista === "empresa" ? c.empresa : c.comunidad ?? SIN_COMUNIDAD);
    const m = new Map<string, Centro[]>();
    for (const c of filtrados) m.set(clave(c), [...(m.get(clave(c)) ?? []), c]);
    return [...m.entries()].sort(([a], [b]) => porTexto(a, b)).map(([titulo, cs]) => ({ titulo, centros: cs }));
  }, [filtrados, vista]);
  const hayFiltros = !!(filtro || fEmpresa || fComunidad || fTipo || fEstado);

  async function cambiarEstado(c: Centro) {
    setConfirmarEstado(null);
    try {
      await api.estadoCentro(c.id, !c.activo);
      setMensaje({ tipo: "exito", texto: `Centro «${c.nombre}» ${c.activo ? "desactivado" : "activado"}.` });
      await cargar();
    } catch (err) {
      setMensaje({ tipo: "error", texto: err instanceof ApiError ? err.message : "No se pudo cambiar el estado" });
    }
  }

  return (
    <section>
      <div className="titulo-acciones">
        <div>
          <h2>Gestión de centros</h2>
          <p className="sub">Centros de trabajo de cada empresa, identificados por su código de servicio.</p>
        </div>
        <button className="btn btn-primario" onClick={() => { setMensaje(null); setAsistente(true); }} disabled={!empresas.length}>+ Nuevo centro</button>
      </div>

      {mensaje && <p className={mensaje.tipo} role={mensaje.tipo === "error" ? "alert" : "status"}>{mensaje.texto}</p>}

      <div className="tarjeta tabla-contenedor">
        {!centros ? (
          <div className="centrado-bloque"><div className="spinner" aria-label="Cargando" /></div>
        ) : (
          <>
            <div className="tabla-buscador">
              <input className="buscador" placeholder="Buscar por código, código a3, nombre, empresa, ciudad o responsable…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
            </div>
            <div className="centros-filtros">
              <label>
                Empresa
                <select value={fEmpresa} onChange={(e) => setFEmpresa(e.target.value)}>
                  <option value="">Todas</option>
                  {empresasConCentros.map((e) => <option key={e} value={e}>{e}</option>)}
                </select>
              </label>
              <label>
                Comunidad autónoma
                <select value={fComunidad} onChange={(e) => setFComunidad(e.target.value)}>
                  <option value="">Todas</option>
                  {comunidades.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </label>
              <label>
                Tipo
                <select value={fTipo} onChange={(e) => setFTipo(e.target.value as typeof fTipo)}>
                  <option value="">Todos</option>
                  <option value="ESTRUCTURA">Estructura</option>
                  <option value="DELEGACION">Delegación</option>
                </select>
              </label>
              <label>
                Estado
                <select value={fEstado} onChange={(e) => setFEstado(e.target.value as typeof fEstado)}>
                  <option value="">Todos</option>
                  <option value="ACTIVO">Activos</option>
                  <option value="CERRADO">Cerrados</option>
                </select>
              </label>
              <label>
                Ver
                <select value={vista} onChange={(e) => setVista(e.target.value as Vista)}>
                  <option value="lista">Lista</option>
                  <option value="empresa">Agrupar por empresa</option>
                  <option value="comunidad">Agrupar por comunidad</option>
                </select>
              </label>
              <span className="nota centros-total">
                {filtrados.length} de {centros.length} centros
                {hayFiltros && <> · <button className="btn-link" onClick={() => { setFiltro(""); setFEmpresa(""); setFComunidad(""); setFTipo(""); setFEstado(""); }}>Quitar filtros</button></>}
              </span>
            </div>
            {filtrados.length === 0 ? (
              <p className="nota vacio">{centros.length ? "Ningún centro coincide con la búsqueda o los filtros." : "Todavía no hay centros."}</p>
            ) : (
              <table className="tabla">
                <thead>
                  <tr><th>Códigos</th><th>Centro</th><th>Empresa</th><th>Responsables</th><th>Dirección</th><th>Estado</th><th /></tr>
                </thead>
                <tbody>
                  {grupos.map((g) => (
                    <Fragment key={g.titulo || "todos"}>
                      {g.titulo && (
                        <tr className="grupo"><td colSpan={7}>{g.titulo} <span className="nota">· {g.centros.length} centro(s)</span></td></tr>
                      )}
                      {g.centros.map((c) => (
                        <tr key={c.id} className={c.activo ? "" : "inactivo"}>
                          <td className="codigos">
                            <div title="Código de servicio">{c.codigoServicio ? <span className="codigo">{c.codigoServicio}</span> : <span className="chip chip-pausa_inicio">Sin código</span>}</div>
                            <div className="nota" title="Código del centro en a3 (empresa-centro)">a3: {c.codigoA3 ? <span className="codigo">{c.codigoA3}</span> : "—"}</div>
                          </td>
                          <td><strong>{c.nombre}</strong>{c.esEstructura && <> <span className="chip chip-activa">Estructura</span></>}<div className="nota">{c.usuariosActivos} usuario(s) activo(s)</div></td>
                          <td>{c.empresa}</td>
                          <td className="responsables">
                            <div>{c.coordinador ? <><span className="nota">Coord.:</span> <strong>{c.coordinador}</strong></> : <span className="chip chip-pausa_inicio">Sin coordinador</span>}</div>
                            <div className="nota">{c.gestor ? `Gestor: ${c.gestor}` : "Sin gestor"}</div>
                            <div className="nota">{c.tecnicoRrhh ? `RRHH: ${c.tecnicoRrhh}` : "Sin técnico de RRHH"}</div>
                          </td>
                          <td>{direccionCompleta(c) || <span className="nota">—</span>}{c.comunidad && <div className="nota">{c.comunidad}</div>}{c.telefono && <div className="nota">{c.telefono}</div>}</td>
                          <td><span className={`chip ${c.activo ? "chip-activa" : "chip-inactiva"}`}>{c.activo ? "Activo" : "Cerrado"}</span></td>
                          <td className="acciones-fila">
                            <button className="btn-link" onClick={() => { setMensaje(null); setEditando(c); }}>Editar</button>
                            <button className="btn-link" onClick={() => { setMensaje(null); setResponsables(c); }}>Responsables</button>
                            <button className="btn-link" onClick={() => { setMensaje(null); setControl(c); }}>Control horario</button>
                            <button className="btn-link" onClick={() => setConfirmarEstado(c)}>{c.activo ? "Desactivar" : "Activar"}</button>
                          </td>
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>

      {asistente && (
        <AsistenteCentro
          empresas={empresas}
          centros={centros ?? []}
          onCerrar={() => setAsistente(false)}
          onCreado={async (nombre) => {
            setAsistente(false);
            setMensaje({ tipo: "exito", texto: `Centro «${nombre}» creado. Ya puedes asignarlo a usuarios.` });
            await cargar();
          }}
        />
      )}

      {editando && (
        <EditarCentro
          centro={editando}
          empresas={empresas}
          centros={centros ?? []}
          onCerrar={() => setEditando(null)}
          onGuardado={async () => {
            setEditando(null);
            setMensaje({ tipo: "exito", texto: "Centro actualizado." });
            await cargar();
          }}
        />
      )}

      {control && (
        <ControlCentro
          centro={control}
          onCerrar={() => setControl(null)}
          onGuardado={async () => {
            setMensaje({ tipo: "exito", texto: `Control horario de «${control.nombre}» actualizado.` });
            setControl(null);
            await cargar();
          }}
        />
      )}

      {responsables && (
        <ResponsablesCentro
          centro={responsables}
          onCerrar={() => setResponsables(null)}
          onGuardado={async () => {
            setMensaje({ tipo: "exito", texto: `Responsables de «${responsables.nombre}» actualizados.` });
            setResponsables(null);
            await cargar();
          }}
        />
      )}

      {confirmarEstado && (
        <Modal titulo={confirmarEstado.activo ? "Desactivar centro" : "Activar centro"} onCerrar={() => setConfirmarEstado(null)}>
          {confirmarEstado.activo ? (
            <>
              <p>¿Desactivar <strong>{confirmarEstado.nombre}</strong>?</p>
              <p className="nota">Dejará de aparecer al asignar centro a los usuarios. No se borra nada.</p>
              {confirmarEstado.usuariosActivos > 0 && (
                <p className="aviso">Tiene {confirmarEstado.usuariosActivos} usuario(s) activo(s) asignado(s). Seguirán asignados y podrán fichar.</p>
              )}
            </>
          ) : (
            <p>¿Volver a activar <strong>{confirmarEstado.nombre}</strong>?</p>
          )}
          <div className="modal-acciones">
            <button className="btn btn-secundario" onClick={() => setConfirmarEstado(null)}>Cancelar</button>
            <button className={`btn ${confirmarEstado.activo ? "btn-peligro" : "btn-primario"}`} onClick={() => cambiarEstado(confirmarEstado)}>
              {confirmarEstado.activo ? "Desactivar" : "Activar"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

/* ---------- Campos del centro (compartidos por el asistente y la edición) ---------- */
function CamposCentro({ d, set, empresas }: { d: DatosCentro; set: (d: DatosCentro) => void; empresas: Empresa[] }) {
  const f = (k: keyof DatosCentro) => (e: { target: { value: string } }) => set({ ...d, [k]: k === "empresaId" ? Number(e.target.value) : e.target.value });
  return (
    <>
      <div className="fila">
        <label>
          Empresa *
          <select value={d.empresaId || ""} onChange={f("empresaId")} required>
            <option value="">Selecciona…</option>
            {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
          </select>
        </label>
        <label>
          Código de servicio *
          <input value={d.codigoServicio} onChange={(e) => set({ ...d, codigoServicio: e.target.value.replace(/\D/g, "") })} inputMode="numeric" maxLength={10} placeholder="Ej.: 1024" required />
        </label>
      </div>
      <label>
        Nombre del centro *
        <input value={d.nombre} onChange={f("nombre")} maxLength={150} placeholder="Ej.: Residencia Las Fuentes" required />
      </label>
      <label>
        Dirección
        <input value={d.direccion} onChange={f("direccion")} maxLength={200} placeholder="Calle, número, piso…" />
      </label>
      <div className="fila">
        <label>
          Código postal
          <input value={d.codigoPostal} onChange={(e) => set({ ...d, codigoPostal: e.target.value.replace(/\D/g, "") })} inputMode="numeric" maxLength={5} placeholder="50001" />
        </label>
        <label>
          Ciudad
          <input value={d.ciudad} onChange={f("ciudad")} maxLength={100} placeholder="Zaragoza" />
        </label>
      </div>
      <label>
        Teléfono del centro
        <input value={d.telefono} onChange={f("telefono")} inputMode="tel" maxLength={20} placeholder="976 000 000" />
      </label>
      <p className="nota">* Obligatorio.</p>
    </>
  );
}

/* ---------- Asistente de alta: 1) Datos · 2) Resumen y confirmar ---------- */
function AsistenteCentro({ empresas, centros, onCerrar, onCreado }: { empresas: Empresa[]; centros: Centro[]; onCerrar: () => void; onCreado: (nombre: string) => void }) {
  const [paso, setPaso] = useState<1 | 2>(1);
  const [d, setD] = useState<DatosCentro>({ ...VACIO, empresaId: empresas.length === 1 ? empresas[0].id : 0 });
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const n = normalizar(d);

  function siguiente(ev: FormEvent) {
    ev.preventDefault();
    const e = validar(d, centros, null);
    setError(e ?? "");
    if (!e) setPaso(2);
  }

  async function confirmar() {
    setError("");
    setGuardando(true);
    try {
      await api.crearCentro(n);
      onCreado(n.nombre);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo crear el centro");
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Nuevo centro" onCerrar={onCerrar} ancho>
      <ol className="pasos" aria-label="Pasos del asistente">
        <li className={paso === 1 ? "activo" : "hecho"}><span>1</span>Datos</li>
        <li className={paso === 2 ? "activo" : ""}><span>2</span>Resumen y confirmar</li>
      </ol>
      {paso === 1 ? (
        <form onSubmit={siguiente} className="form-modal">
          <CamposCentro d={d} set={setD} empresas={empresas} />
          {error && <p className="error" role="alert">{error}</p>}
          <div className="modal-acciones">
            <button type="button" className="btn btn-secundario" onClick={onCerrar}>Cancelar</button>
            <button className="btn btn-primario">Siguiente</button>
          </div>
        </form>
      ) : (
        <div className="form-modal">
          <dl className="resumen">
            <dt>Empresa</dt><dd>{empresas.find((e) => e.id === n.empresaId)?.nombre}</dd>
            <dt>Código de servicio</dt><dd>{n.codigoServicio}</dd>
            <dt>Centro</dt><dd>{n.nombre}</dd>
            <dt>Dirección</dt><dd>{direccionCompleta(n) || "—"}</dd>
            <dt>Teléfono</dt><dd>{n.telefono || "—"}</dd>
            <dt>Estado</dt><dd>Activo</dd>
          </dl>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="modal-acciones">
            <button type="button" className="btn btn-secundario" onClick={() => setPaso(1)} disabled={guardando}>Atrás</button>
            <button className="btn btn-primario" onClick={confirmar} disabled={guardando}>{guardando ? "Creando…" : "Crear centro"}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------- Editar ---------- */
function EditarCentro({ centro, empresas, centros, onCerrar, onGuardado }: { centro: Centro; empresas: Empresa[]; centros: Centro[]; onCerrar: () => void; onGuardado: () => void }) {
  const [d, setD] = useState<DatosCentro>({
    empresaId: centro.empresaId,
    codigoServicio: centro.codigoServicio ?? "",
    nombre: centro.nombre,
    direccion: centro.direccion ?? "",
    codigoPostal: centro.codigoPostal ?? "",
    ciudad: centro.ciudad ?? "",
    telefono: centro.telefono ?? "",
  });
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  // La lista de empresas del selector solo trae activas: si la del centro está inactiva, se añade para no perderla.
  const opciones = empresas.some((e) => e.id === centro.empresaId) ? empresas : [...empresas, { id: centro.empresaId, nombre: centro.empresa }];

  async function guardar(ev: FormEvent) {
    ev.preventDefault();
    const e = validar(d, centros, centro.id);
    if (e) return setError(e);
    setError("");
    setGuardando(true);
    try {
      await api.editarCentro(centro.id, normalizar(d));
      onGuardado();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar");
      setGuardando(false);
    }
  }

  return (
    <Modal titulo="Editar centro" onCerrar={onCerrar} ancho>
      <form onSubmit={guardar} className="form-modal">
        <CamposCentro d={d} set={setD} empresas={opciones} />
        {error && <p className="error" role="alert">{error}</p>}
        <div className="modal-acciones">
          <button type="button" className="btn btn-secundario" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-primario" disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Responsables del centro: coordinador, gestor y técnico de RRHH ---------- */
function ResponsablesCentro({ centro, onCerrar, onGuardado }: { centro: Centro; onCerrar: () => void; onGuardado: () => void }) {
  const [usuarios, setUsuarios] = useState<UsuarioGestion[] | null>(null);
  const [coordinadorId, setCoordinadorId] = useState(centro.coordinadorId ? String(centro.coordinadorId) : "");
  const [gestorId, setGestorId] = useState(centro.gestorId ? String(centro.gestorId) : "");
  const [tecnicoRrhhId, setTecnicoRrhhId] = useState(centro.tecnicoRrhhId ? String(centro.tecnicoRrhhId) : "");
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    api.usuarios().then(setUsuarios).catch((err) => setError(err instanceof ApiError ? err.message : "No se pudieron cargar los usuarios"));
  }, []);

  const activos = (usuarios ?? []).filter((u) => u.activo).sort((a, b) => `${a.apellidos} ${a.nombre}`.localeCompare(`${b.apellidos} ${b.nombre}`, "es"));
  // Primero los del propio centro (coordinador) y los de estructura (gestor)
  const opcCoord = [...activos.filter((u) => u.centroId === centro.id), ...activos.filter((u) => u.centroId !== centro.id)];
  const opcGestor = [...activos.filter((u) => u.tipoPerfil === "ESTRUCTURA"), ...activos.filter((u) => u.tipoPerfil !== "ESTRUCTURA")];
  const opcion = (u: UsuarioGestion): OpcionPersona => ({
    id: u.id,
    nombre: `${u.nombre} ${u.apellidos}`,
    detalle: u.tipoPerfil === "ESTRUCTURA" && u.departamento ? u.departamento : u.centro,
  });

  async function guardar() {
    setError("");
    if (coordinadorId && coordinadorId === gestorId) return setError("El coordinador y el gestor no pueden ser la misma persona.");
    setGuardando(true);
    try {
      await api.responsablesCentro(centro.id, {
        coordinadorId: coordinadorId ? Number(coordinadorId) : null,
        gestorId: gestorId ? Number(gestorId) : null,
        tecnicoRrhhId: tecnicoRrhhId ? Number(tecnicoRrhhId) : null,
      });
      onGuardado();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar");
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={`Responsables · ${centro.codigoServicio ? `${centro.codigoServicio} · ` : ""}${centro.nombre}`} onCerrar={onCerrar} ancho>
      {!usuarios && !error ? (
        <div className="centrado-bloque"><div className="spinner" aria-label="Cargando" /></div>
      ) : (
        <div className="form-modal">
          <label>
            Coordinador del centro
            <SelectorPersona personas={opcCoord.map(opcion)} valor={coordinadorId} onCambio={setCoordinadorId} vacio="Sin coordinador" />
          </label>
          <p className="nota">Aprueba a los empleados del centro. Puede coordinar varios centros, siempre con el mismo gestor.</p>
          <label>
            Gestor
            <SelectorPersona personas={opcGestor.map(opcion)} valor={gestorId} onCambio={setGestorId} vacio="Sin gestor" />
          </label>
          <p className="nota">Aprueba al coordinador y ve y puede aprobar a todo el personal del centro. Al gestor le aprueba el manager de su departamento de Gestión (director territorial), que ve a todo el personal de su zona.</p>
          <label>
            Técnico de RRHH
            <SelectorPersona personas={opcGestor.map(opcion)} valor={tecnicoRrhhId} onCambio={setTecnicoRrhhId} vacio="Sin técnico de RRHH" />
          </label>
          <p className="nota">Persona de RRHH de referencia para el centro.</p>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="modal-acciones">
            <button type="button" className="btn btn-secundario" onClick={onCerrar}>Cancelar</button>
            <button className="btn btn-primario" onClick={guardar} disabled={guardando || !usuarios}>{guardando ? "Guardando…" : "Guardar"}</button>
          </div>
        </div>
      )}
    </Modal>
  );
}

/* ---------- Parámetros de control horario del centro ---------- */
function ControlCentro({ centro, onCerrar, onGuardado }: { centro: Centro; onCerrar: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({
    margenMinutos: String(centro.margenMinutos), escaladoMinutos: String(centro.escaladoMinutos),
    umbralSobrecargaHoras: String(centro.umbralSobrecargaHoras), maxHorasSinSalida: String(centro.maxHorasSinSalida),
  });
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  async function guardar(e: FormEvent) {
    e.preventDefault();
    const d = { margenMinutos: Number(f.margenMinutos), escaladoMinutos: Number(f.escaladoMinutos), umbralSobrecargaHoras: Number(f.umbralSobrecargaHoras), maxHorasSinSalida: Number(f.maxHorasSinSalida) };
    if (!Object.values(d).every(Number.isInteger)) return setError("Usa números enteros.");
    setGuardando(true);
    try {
      await api.controlCentro(centro.id, d);
      onGuardado();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar");
      setGuardando(false);
    }
  }
  const campo = (k: keyof typeof f, etiqueta: string, ayuda: string) => (
    <label>
      {etiqueta}
      <input inputMode="numeric" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
      <small className="nota">{ayuda}</small>
    </label>
  );
  return (
    <Modal titulo={`Control horario · ${centro.codigoServicio ? `${centro.codigoServicio} · ` : ""}${centro.nombre}`} onCerrar={onCerrar} ancho>
      <form onSubmit={guardar} className="form-modal">
        <p className="nota">
          Calendario: {centro.comunidad ?? "sin comunidad (falta código postal)"}{centro.ciudad ? ` · ${centro.ciudad}` : " · sin ciudad"}. Los festivos se gestionan en Calendario laboral.
        </p>
        <div className="fila">
          {campo("margenMinutos", "Margen de cortesía (min)", "Tiempo tras la hora prevista antes de avisar de falta de fichaje o retraso.")}
          {campo("escaladoMinutos", "Escalado al aprobador (min)", "Si la persona no ficha tras el aviso, pasado este tiempo se avisa a su aprobador.")}
        </div>
        <div className="fila">
          {campo("umbralSobrecargaHoras", "Umbral de sobrecarga (h/mes)", "Horas por encima de sus horas del mes a partir de las que se marca sobrecarga.")}
          {campo("maxHorasSinSalida", "Aviso de salida sin fichar (h)", "Para horario variable: horas seguidas dentro sin fichar la salida.")}
        </div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="modal-acciones">
          <button type="button" className="btn btn-secundario" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-primario" disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
        </div>
      </form>
    </Modal>
  );
}
