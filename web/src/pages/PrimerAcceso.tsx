import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import { useSesion } from "../sesion";

/** Primer acceso de las personas dadas de alta desde a3: email + DNI/NIE → crean su contraseña y entran. */
export default function PrimerAcceso() {
  const { setUsuario } = useSesion();
  const [f, setF] = useState({ email: "", dni: "", password: "", repetir: "" });
  const [ver, setVer] = useState(false);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (f.password !== f.repetir) return setError("Las contraseñas no coinciden.");
    setEnviando(true);
    try {
      const r = await api.primerAcceso(f.email, f.dni, f.password);
      setUsuario(r.usuario);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar. Inténtalo de nuevo.");
      setEnviando(false);
    }
  }

  return (
    <div className="acceso">
      <main className="acceso-panel">
        <img className="acceso-logo" src="/logo-arquisocial.svg" alt="Grupo Arquisocial" />
        <p className="acceso-titulo">Primer acceso</p>
        <p className="acceso-nota acceso-intro">Si es la primera vez que entras, identifícate con tu correo y tu DNI/NIE y crea tu contraseña.</p>

        <form className="acceso-form" onSubmit={enviar}>
          <label className="acceso-campo">
            <span>Correo electrónico</span>
            <input type="email" inputMode="email" autoComplete="username" placeholder="Correo electrónico" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required autoFocus />
          </label>
          <label className="acceso-campo">
            <span>DNI/NIE</span>
            <input autoComplete="off" placeholder="12345678Z" value={f.dni} maxLength={12} onChange={(e) => setF({ ...f, dni: e.target.value.toUpperCase() })} required />
          </label>
          <label className="acceso-campo">
            <span>Nueva contraseña</span>
            <input type={ver ? "text" : "password"} autoComplete="new-password" placeholder="Mínimo 10 caracteres, con letras y números" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} required minLength={10} />
          </label>
          <label className="acceso-campo">
            <span>Repite la contraseña</span>
            <input type={ver ? "text" : "password"} autoComplete="new-password" placeholder="Repite la contraseña" value={f.repetir} onChange={(e) => setF({ ...f, repetir: e.target.value })} required />
          </label>
          <label className="acceso-recordar">
            <input type="checkbox" checked={ver} onChange={(e) => setVer(e.target.checked)} />
            <span className="acceso-check" aria-hidden="true" />
            <span>Mostrar contraseña</span>
          </label>

          {error && <p className="acceso-error" role="alert">{error}</p>}

          <button className="acceso-boton" disabled={enviando}>{enviando ? "Activando…" : "Crear contraseña y entrar"}</button>
        </form>

        <p className="acceso-nota"><Link to="/">Volver a Acceder</Link></p>
      </main>
      <footer className="acceso-pie">© {new Date().getFullYear()} Grupo Arquisocial</footer>
    </div>
  );
}
