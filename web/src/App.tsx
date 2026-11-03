import { useEffect, useState } from "react";
import { Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { api } from "./api";
import { useSesion } from "./sesion";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import CambiarPassword from "./pages/CambiarPassword";
import Fichar from "./pages/Fichar";
import Historial from "./pages/Historial";
import Admin from "./pages/Admin";
import MiEquipo from "./pages/MiEquipo";
import Aprobaciones from "./pages/Aprobaciones";

export default function App() {
  const { usuario, cargando, salir } = useSesion();
  const ubicacion = useLocation();
  const [pendientes, setPendientes] = useState(0);
  const supervisa = !!usuario?.tieneEquipo && !usuario?.debeCambiarPassword;

  useEffect(() => { setPendientes(usuario?.pendientesAprobacion ?? 0); }, [usuario]);
  // Contador de aprobaciones: se refresca al cambiar de página y cada 2 minutos
  useEffect(() => {
    if (!supervisa) return;
    const leer = () => api.contadorAprobaciones().then((r) => setPendientes(r.pendientes)).catch(() => {});
    leer();
    const t = setInterval(leer, 120000);
    return () => clearInterval(t);
  }, [supervisa, ubicacion.pathname]);

  if (cargando) return <div className="centrado"><div className="spinner" aria-label="Cargando" /></div>;

  if (!usuario) {
    return (
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  if (usuario.debeCambiarPassword) return <CambiarPassword obligatorio />;

  const esAdmin = usuario.rol === "ADMIN";

  return (
    <div className="app">
      <header className="cabecera">
        <div className="cabecera-int">
          <NavLink to="/" className="marca" aria-label="Fichajes · Grupo Arquisocial">
            <img src="/mariposa.svg" alt="" width={30} height={28} />
            <span className="marca-texto">Fichajes</span>
          </NavLink>
          <nav className="nav" aria-label="Principal">
            <NavLink to="/" end>Fichar</NavLink>
            <NavLink to="/historial">Mi historial</NavLink>
            {supervisa && <NavLink to="/equipo">Mi equipo</NavLink>}
            {supervisa && (
              <NavLink to="/aprobaciones" aria-label={pendientes ? `Aprobaciones (${pendientes} pendientes)` : "Aprobaciones"}>
                Aprobaciones{pendientes > 0 && <span className="contador">{pendientes > 99 ? "99+" : pendientes}</span>}
              </NavLink>
            )}
            <NavLink to="/cuenta">Mi cuenta</NavLink>
            {esAdmin && <NavLink to="/admin">Admin</NavLink>}
          </nav>
          <div className="usuario">
            <span className="usuario-nombre">{usuario.nombre}</span>
            <button className="btn-salir" onClick={salir}>Salir</button>
          </div>
        </div>
      </header>
      <main className="contenido">
        <Routes>
          <Route path="/" element={<Fichar />} />
          <Route path="/historial" element={<Historial />} />
          <Route path="/cuenta" element={<CambiarPassword />} />
          {supervisa && <Route path="/equipo" element={<MiEquipo />} />}
          {supervisa && <Route path="/aprobaciones" element={<Aprobaciones onPendientes={setPendientes} />} />}
          {esAdmin && <Route path="/admin/*" element={<Admin />} />}
          {esAdmin && <Route path="/gestion/*" element={<Navigate to="/admin" replace />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
