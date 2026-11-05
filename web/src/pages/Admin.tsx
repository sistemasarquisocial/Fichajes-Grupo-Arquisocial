import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import GestionUsuarios from "./GestionUsuarios";
import GestionEmpresas from "./GestionEmpresas";
import GestionCentros from "./GestionCentros";
import GestionDepartamentos from "./GestionDepartamentos";
import GestionSuplencias from "./GestionSuplencias";
import GestionFestivos from "./GestionFestivos";
import GestionMotivos from "./GestionMotivos";
import IntegracionA3 from "./IntegracionA3";

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

const IconoCentros = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z" />
    <circle cx="12" cy="10" r="2.4" fill="none" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

const IconoDepartamentos = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" d="M9 3h6v5H9zM3 16h6v5H3zM15 16h6v5h-6zM12 8v4M6 16v-4h12v4" />
  </svg>
);
const IconoSuplencias = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M7 7h11l-3-3M17 17H6l3 3" />
  </svg>
);

const IconoCalendario = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v12a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-12ZM4 10h16M8 3v4M16 3v4M9 14h.01M12 14h.01M15 14h.01" />
  </svg>
);

const IconoMotivos = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" d="M7 3.5h7.5L19 8v12.5H7V3.5ZM14.5 3.5V8H19M10 12.5h6M10 16h6" />
  </svg>
);

const IconoA3 = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
    <path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M4 12a8 8 0 0 1 13.7-5.6L20 9M20 4v5h-5M20 12a8 8 0 0 1-13.7 5.6L4 15M4 20v-5h5" />
  </svg>
);

/** Panel de administración (solo ADMIN): usuarios, departamentos, centros, empresas y suplencias. */
export default function Admin() {
  return (
    <section className="admin">
      <div className="admin-titulo">
        <h1>Panel de administración</h1>
        <p className="sub">Usuarios, perfiles, cadena de aprobación, centros y empresas de Grupo Arquisocial.</p>
      </div>
      <div className="admin-layout">
        <nav className="admin-menu" aria-label="Secciones de administración">
          <NavLink to="usuarios">
            <IconoUsuarios />
            <span><strong>Gestión de usuarios</strong><small>Altas, perfil, manager, roles y contraseñas</small></span>
          </NavLink>
          <NavLink to="departamentos">
            <IconoDepartamentos />
            <span><strong>Gestión de departamentos</strong><small>Estructura y su manager</small></span>
          </NavLink>
          <NavLink to="centros">
            <IconoCentros />
            <span><strong>Gestión de centros</strong><small>Delegaciones, coordinador y gestor</small></span>
          </NavLink>
          <NavLink to="empresas">
            <IconoEmpresas />
            <span><strong>Gestión de empresas</strong><small>Alta, edición y desactivación</small></span>
          </NavLink>
          <NavLink to="calendario">
            <IconoCalendario />
            <span><strong>Calendario laboral</strong><small>Festivos por comunidad y municipio</small></span>
          </NavLink>
          <NavLink to="motivos">
            <IconoMotivos />
            <span><strong>Motivos de ausencia</strong><small>Permisos y si exigen justificante</small></span>
          </NavLink>
          <NavLink to="a3">
            <IconoA3 />
            <span><strong>Integración a3</strong><small>Conexión, sincronización y pendientes</small></span>
          </NavLink>
          <NavLink to="suplencias">
            <IconoSuplencias />
            <span><strong>Suplencias</strong><small>Sustitutos de aprobadores ausentes</small></span>
          </NavLink>
        </nav>
        <div className="admin-contenido">
          <Routes>
            <Route index element={<Navigate to="usuarios" replace />} />
            <Route path="usuarios" element={<GestionUsuarios />} />
            <Route path="departamentos" element={<GestionDepartamentos />} />
            <Route path="centros" element={<GestionCentros />} />
            <Route path="empresas" element={<GestionEmpresas />} />
            <Route path="calendario" element={<GestionFestivos />} />
            <Route path="motivos" element={<GestionMotivos />} />
            <Route path="suplencias" element={<GestionSuplencias />} />
            <Route path="a3" element={<IntegracionA3 />} />
            <Route path="*" element={<Navigate to="usuarios" replace />} />
          </Routes>
        </div>
      </div>
    </section>
  );
}
