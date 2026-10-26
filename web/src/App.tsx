import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { useSesion } from "./sesion";
import Login from "./pages/Login";
import Setup from "./pages/Setup";
import CambiarPassword from "./pages/CambiarPassword";
import Fichar from "./pages/Fichar";
import Historial from "./pages/Historial";
import GestionUsuarios from "./pages/GestionUsuarios";

export default function App() {
  const { usuario, cargando, salir } = useSesion();

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

  const esGestor = usuario.rol === "ADMIN" || usuario.rol === "RRHH";

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
            {esGestor && <NavLink to="/gestion/usuarios">Usuarios</NavLink>}
            <NavLink to="/cuenta">Mi cuenta</NavLink>
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
          {esGestor && <Route path="/gestion/usuarios" element={<GestionUsuarios />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}
