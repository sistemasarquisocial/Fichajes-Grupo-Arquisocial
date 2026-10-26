import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, ApiError } from "../api";
import { useSesion } from "../sesion";

export default function Login() {
  const { setUsuario } = useSesion();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verPassword, setVerPassword] = useState(false);
  const [recordar, setRecordar] = useState(false);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [necesitaSetup, setNecesitaSetup] = useState(false);

  useEffect(() => {
    api.setupEstado().then((r) => setNecesitaSetup(r.necesitaSetup)).catch(() => {});
  }, []);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setError("");
    setEnviando(true);
    try {
      const r = await api.login(email, password, recordar);
      setUsuario(r.usuario);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo conectar. Inténtalo de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="acceso">
      <main className="acceso-panel">
        <img className="acceso-logo" src="/logo-arquisocial.svg" alt="Grupo Arquisocial" />
        <p className="acceso-titulo">Registro de jornada</p>

        <form className="acceso-form" onSubmit={enviar}>
          <label className="acceso-campo">
            <span>Usuario</span>
            <input
              type="email"
              inputMode="email"
              autoComplete="username"
              placeholder="Correo electrónico"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </label>

          <label className="acceso-campo">
            <span>Contraseña</span>
            <div className="acceso-password">
              <input
                type={verPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="Contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <button
                type="button"
                className="acceso-ojo"
                onClick={() => setVerPassword((v) => !v)}
                aria-label={verPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                aria-pressed={verPassword}
              >
                {verPassword ? (
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6 0 9.5 7 9.5 7a17 17 0 0 1-3.1 3.9M6.3 6.3A16.6 16.6 0 0 0 2.5 12S6 19 12 19a9.9 9.9 0 0 0 4.7-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="1.8" d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" /><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" /></svg>
                )}
              </button>
            </div>
          </label>

          <label className="acceso-recordar">
            <input type="checkbox" checked={recordar} onChange={(e) => setRecordar(e.target.checked)} />
            <span className="acceso-check" aria-hidden="true" />
            <span>Recordarme en este dispositivo</span>
          </label>

          {error && <p className="acceso-error" role="alert">{error}</p>}

          <button className="acceso-boton" disabled={enviando}>
            {enviando ? "Accediendo…" : "Acceder"}
          </button>
        </form>

        <p className="acceso-nota">¿Has olvidado tu contraseña? Contacta con RRHH o con Sistemas.</p>
        {necesitaSetup && (
          <p className="acceso-nota"><Link to="/setup">Configuración inicial</Link></p>
        )}
      </main>
      <footer className="acceso-pie">© {new Date().getFullYear()} Grupo Arquisocial</footer>
    </div>
  );
}
