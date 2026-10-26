import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import GestionUsuarios from "./GestionUsuarios";
import GestionEmpresas from "./GestionEmpresas";

const IconoUsuarios = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="M16 19v-1.2a3.8 3.8 0 0 0-3.8-3.8H7.8A3.8 3.8 0 0 0 4 17.8V19M10 10.5a3.25 3.25 0 1 0 0-6.5 3.25 3.25 0 0 0 0 6.5ZM20 19v-1.2a3.8 3.8 0 0 0-2.8-3.66M15.5 4.2a3.25 3.25 0 0 1 0 6.1" />
  </svg>
);
const IconoEmpresas = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" d="M4 20V6.5L11 4v16M11 9h9v11M2.5 20h19M7 8.5v.01M7 12v.01M7 15.5v.01M14.5 12.5h2M14.5 16h2" />
  </svg>
);

/** Panel de administración: agrupa la gestión de usuarios (ADMIN y RRHH) y de empresas (solo ADMIN). */
export default function Admin({ esAdmin }: { esAdmin: boolean }) {
  return (
    <section className="admin">
      <div className="admin-titulo">
        <h1>Panel de administración</h1>
        <p className="sub">Gestión de usuarios{esAdmin ? " y empresas" : ""} de Grupo Arquisocial.</p>
      </div>
      <div className="admin-layout">
        <nav className="admin-menu" aria-label="Secciones de administración">
          <NavLink to="usuarios">
            <IconoUsuarios />
            <span><strong>Gestión de usuarios</strong><small>Altas, roles, centros y contraseñas</small></span>
          </NavLink>
          {esAdmin && (
            <NavLink to="empresas">
              <IconoEmpresas />
              <span><strong>Gestión de empresas</strong><small>Alta, edición y desactivación</small></span>
            </NavLink>
          )}
        </nav>
        <div className="admin-contenido">
          <Routes>
            <Route index element={<Navigate to="usuarios" replace />} />
            <Route path="usuarios" element={<GestionUsuarios />} />
            {esAdmin && <Route path="empresas" element={<GestionEmpresas />} />}
            <Route path="*" element={<Navigate to="usuarios" replace />} />
          </Routes>
        </div>
      </div>
    </section>
  );
}
