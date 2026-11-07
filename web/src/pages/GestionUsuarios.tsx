import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, Centro, Departamento, Empresa, Rol, ROLES, ETIQUETA_ROL, ETIQUETA_PERFIL, TipoPerfil, UsuarioGestion, generarPasswordTemporal } from "../api";
import SelectorPersona from "../components/SelectorPersona";
import ListadoUsuarios from "../components/ListadoUsuarios";
import Modal from "../components/Modal";

const VACIO = {
  email: "", emailCorporativo: "", nombre: "", apellidos: "", empresaId: "", centroId: "", rol: "EMPLEADO" as Rol, activo: true,
  tipoPerfil: "" as TipoPerfil | "", departamentoId: "", managerId: "",
};

const AYUDA_ROL: Record<Rol, string> = {
  EMPLEADO: "Ficha y ve sus datos. Si aprueba a alguien, verá también a su equipo.",
  RRHH: "Además, supervisa los fichajes de los centros en los que es técnico de RRHH. Si no es técnico de ningún centro, los de todos.",
  ADMIN: "Mantenimiento de la plataforma: ve y gestiona todo.",
};

export default function GestionUsuarios() {
  const [usuarios, setUsuarios] = useState<UsuarioGestion[] | null>(null);
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [centros, setCentros] = useState<Centro[]>([]);
  const [departamentos, setDepartamentos] = useState<Departamento[]>([]);
  const [editando, setEditando] = useState<UsuarioGestion | "nuevo" | null>(null);
  const [form, setForm] = useState(VACIO);
  const [pwTemporal, setPwTemporal] = useState("");
  const [mensaje, setMensaje] = useState<{ tipo: "exito" | "error"; texto: string } | null>(null);
  const [credenciales, setCredenciales] = useState<{ email: string; password: string } | null>(null);

  async function cargar() {
    const [u, e, c, d] = await Promise.all([api.usuarios(), api.empresas(), api.centros(), api.departamentos()]);
    setUsuarios(u); setEmpresas(e); setCentros(c); setDepartamentos(d);
  }
  useEffect(() => { cargar().catch((err) => setMensaje({ tipo: "error", texto: err.message })); }, []);

  const centrosEmpresa = centros.filter((c) => String(c.empresaId) === String(form.empresaId) && c.activo);
  const candidatosManager = (usuarios ?? []).filter((u) => u.activo && (editando === "nuevo" || !editando || u.id !== editando.id));
  const editandoUsuario = editando && editando !== "nuevo" ? editando : null;

  function abrirNuevo() {
    setForm(VACIO);
    setPwTemporal(generarPasswordTemporal());
    setEditando("nuevo");
    setMensaje(null);
    setCredenciales(null);
  }
  function abrirEditar(u: UsuarioGestion) {
    setForm({ email: u.email, emailCorporativo: u.emailCorporativo ?? "", nombre: u.nombre, apellidos: u.apellidos, empresaId: String(u.empresaId), centroId: u.centroId ? String(u.centroId) : "", rol: u.rol, activo: !!u.activo,
      tipoPerfil: u.tipoPerfil ?? "", departamentoId: u.departamentoId ? String(u.departamentoId) : "", managerId: u.managerId ? String(u.managerId) : "" });
    setEditando(u);
    setMensaje(null);
    setCredenciales(null);
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setMensaje(null);
    const datos = {
      ...form,
      empresaId: Number(form.empresaId),
      tipoPerfil: form.tipoPerfil || null,
      centroId: form.centroId ? Number(form.centroId) : null,
      departamentoId: form.tipoPerfil === "ESTRUCTURA" && form.departamentoId ? Number(form.departamentoId) : null,
      managerId: form.tipoPerfil === "ESTRUCTURA" && form.managerId ? Number(form.managerId) : null,
    };
    try {
      if (editando === "nuevo") {
        await api.crearUsuario({ ...datos, passwordTemporal: pwTemporal });
        setCredenciales({ email: form.email, password: pwTemporal });
        setMensaje({ tipo: "exito", texto: "Usuario creado. Entrega las credenciales al empleado; deberá cambiar la contraseña al entrar." });
      } else if (editando) {
        await api.editarUsuario(editando.id, datos);
        setMensaje({ tipo: "exito", texto: "Usuario actualizado." });
      }
      setEditando(null);
      await cargar();
    } catch (err) {
      setMensaje({ tipo: "error", texto: err instanceof ApiError ? err.message : "Error al guardar" });
    }
  }

  async function resetear(u: UsuarioGestion) {
    if (!confirm(`¿Generar una contraseña temporal nueva para ${u.nombre} ${u.apellidos}? Se cerrarán sus sesiones abiertas.`)) return;
    const pw = generarPasswordTemporal();
    try {
      await api.resetPassword(u.id, pw);
      setCredenciales({ email: u.email, password: pw });
      setMensaje({ tipo: "exito", texto: "Contraseña temporal generada y cuenta desbloqueada." });
      await cargar();
    } catch (err) {
      setMensaje({ tipo: "error", texto: err instanceof ApiError ? err.message : "Error" });
    }
  }

  const set = (k: keyof typeof form) => (e: any) =>
    setForm({ ...form, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value, ...(k === "empresaId" ? { centroId: "" } : {}) });

  return (
    <section>
      <div className="tarjeta">
        <div className="titulo-acciones">
          <h2>Gestión de usuarios</h2>
          <button className="btn btn-primario" onClick={abrirNuevo}>+ Nuevo usuario</button>
        </div>
        {mensaje && <p className={mensaje.tipo} role="status">{mensaje.texto}</p>}
        {credenciales && (
          <div className="credenciales">
            <p><strong>Credenciales de acceso</strong> (solo se muestran ahora):</p>
            <p>Email: <code>{credenciales.email}</code></p>
            <p>Contraseña temporal: <code>{credenciales.password}</code></p>
            <button className="btn-link" onClick={() => navigator.clipboard.writeText(`Email: ${credenciales.email}\nContraseña temporal: ${credenciales.password}`)}>Copiar</button>
          </div>
        )}
      </div>

      {editando && (
        <Modal titulo={editando === "nuevo" ? "Nuevo usuario" : `Editar: ${editando.nombre} ${editando.apellidos}`} onCerrar={() => setEditando(null)} ancho>
        <form className="form-modal" onSubmit={guardar}>
          <p className="nota">
            {editandoUsuario?.dni
              ? <>Entra con su DNI/NIE <strong>{editandoUsuario.dni}</strong>. El email es para avisos.</>
              : "Sin DNI/NIE: entra con su email. El email puede ser de cualquier dominio (Gmail, Outlook, corporativo…)."}
          </p>
          <div className="rejilla">
            <label>Email (avisos){!editandoUsuario?.dni && " y acceso"}<input type="email" value={form.email} onChange={set("email")} required /></label>
            <label>
              Correo profesional
              <input type="email" value={form.emailCorporativo} onChange={set("emailCorporativo")} placeholder="nombre@arquisocial.es" />
              <small className="nota">Si en a3 tiene un correo del grupo, se rellena solo.</small>
            </label>
            <label>Nombre<input value={form.nombre} onChange={set("nombre")} required /></label>
            <label>Apellidos<input value={form.apellidos} onChange={set("apellidos")} required /></label>
            <label>
              Empresa
              <select value={form.empresaId} onChange={set("empresaId")} required>
                <option value="">Selecciona…</option>
                {empresas.map((e) => <option key={e.id} value={e.id}>{e.nombre}</option>)}
              </select>
            </label>
            <label>
              Perfil
              <select value={form.tipoPerfil} onChange={set("tipoPerfil")}>
                <option value="">(Sin definir)</option>
                <option value="ESTRUCTURA">Estructura (departamento)</option>
                <option value="DELEGACION">Delegación (centro)</option>
              </select>
            </label>
            {form.tipoPerfil === "ESTRUCTURA" ? (
              <>
                <label>
                  Departamento
                  <select value={form.departamentoId} onChange={set("departamentoId")}>
                    <option value="">(Sin departamento)</option>
                    {departamentos.filter((d) => d.activo || String(d.id) === form.departamentoId).map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
                  </select>
                </label>
                <label>
                  Manager (solo si dirige un departamento)
                  <SelectorPersona
                    personas={candidatosManager.map((u) => ({ id: u.id, nombre: `${u.nombre} ${u.apellidos}`, detalle: u.departamento ?? u.centro }))}
                    valor={form.managerId}
                    onCambio={(v) => setForm({ ...form, managerId: v })}
                    vacio="Ninguno · CEO"
                  />
                  <small className="nota">Le aprueba esta persona cuando es manager de un departamento o no tiene departamento. Si no, le aprueba el manager de su departamento.</small>
                </label>
                <label>
                  Centro de trabajo (sede)
                  <select value={form.centroId} onChange={set("centroId")} disabled={!form.empresaId}>
                    <option value="">(Sin centro)</option>
                    {centrosEmpresa.map((c) => <option key={c.id} value={c.id}>{c.codigoServicio ? `${c.codigoServicio} · ` : ""}{c.nombre}</option>)}
                  </select>
                  <small className="nota">Solo para su calendario de festivos y avisos. Le sigue aprobando su departamento, no el coordinador del centro.</small>
                </label>
              </>
            ) : (
              <label>
                Centro
                <select value={form.centroId} onChange={set("centroId")} disabled={!form.empresaId}>
                  <option value="">(Sin centro)</option>
                  {centrosEmpresa.map((c) => <option key={c.id} value={c.id}>{c.codigoServicio ? `${c.codigoServicio} · ` : ""}{c.nombre}</option>)}
                </select>
                {form.tipoPerfil === "DELEGACION" && <small className="nota">Le aprueba el coordinador del centro (al coordinador, el gestor).</small>}
              </label>
            )}
            <label>
              Rol (permisos)
              <select value={form.rol} onChange={set("rol")}>
                {ROLES.map((r) => <option key={r} value={r}>{ETIQUETA_ROL[r]}</option>)}
              </select>
              <small className="nota">{AYUDA_ROL[form.rol]}</small>
            </label>
            {editando !== "nuevo" && (
              <label className="check"><input type="checkbox" checked={form.activo} onChange={set("activo")} /> Activo</label>
            )}
          </div>
          {editandoUsuario && (
            <p className="nota">
              Aprobador actual: <strong>{editandoUsuario.aprobador ?? "ninguno"}</strong>
              {editandoUsuario.esCoordinador && " · Es coordinador de centro"}
              {editandoUsuario.esManagerDepartamento && " · Es manager de departamento"}
            </p>
          )}
          {editando === "nuevo" && (
            <p className="nota">Contraseña temporal generada: <code>{pwTemporal}</code> <button type="button" className="btn-link" onClick={() => setPwTemporal(generarPasswordTemporal())}>Generar otra</button></p>
          )}
          {mensaje?.tipo === "error" && <p className="error" role="alert">{mensaje.texto}</p>}
          <div className="modal-acciones">
            <button type="button" className="btn btn-secundario" onClick={() => setEditando(null)}>Cancelar</button>
            <button className="btn btn-primario">Guardar</button>
          </div>
        </form>
        </Modal>
      )}

      {usuarios === null ? (
        <div className="tarjeta"><div className="centrado-bloque"><div className="spinner" aria-label="Cargando" /></div></div>
      ) : (
        <ListadoUsuarios usuarios={usuarios} onEditar={abrirEditar} onResetear={resetear} />
      )}
    </section>
  );
}
