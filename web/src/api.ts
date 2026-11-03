export type Rol = "EMPLEADO" | "RRHH" | "ADMIN";
export const ROLES: Rol[] = ["EMPLEADO", "RRHH", "ADMIN"];
export const ETIQUETA_ROL: Record<Rol, string> = { EMPLEADO: "Empleado", RRHH: "RRHH", ADMIN: "Administrador" };
export type TipoPerfil = "ESTRUCTURA" | "DELEGACION";
export const ETIQUETA_PERFIL: Record<TipoPerfil, string> = { ESTRUCTURA: "Estructura", DELEGACION: "Delegación" };
export type TipoFichaje = "ENTRADA" | "SALIDA" | "PAUSA_INICIO" | "PAUSA_FIN";
export type Estado = "FUERA" | "TRABAJANDO" | "EN_PAUSA";

export interface Usuario {
  usuarioId: number;
  email: string;
  nombre: string;
  apellidos: string;
  rol: Rol;
  empresaId: number;
  debeCambiarPassword: boolean;
  /** Tiene personas a su cargo hoy (propias o por suplencia) o es RRHH/ADMIN. */
  tieneEquipo?: boolean;
}

export interface ResumenDia {
  fecha: string;
  minutosTrabajados: number;
  minutosPausa: number;
  abierto: boolean;
  fichajes: { tipo: TipoFichaje; fechaHoraUtc: string }[];
}

export interface EstadoFichaje {
  estado: Estado;
  acciones: TipoFichaje[];
  ultimo: { tipo: TipoFichaje; fechaHoraUtc: string } | null;
  hoy: ResumenDia | null;
}

export interface DatosExportacion {
  empleado: { nombre: string; apellidos: string; email: string; empresa: string; centro: string | null; codigoServicio: string | null; departamento?: string | null };
  /** Nombre de quien exporta cuando no es el propio empleado. */
  exportadoPor?: string | null;
  desde: string;
  hasta: string;
  generadoUtc: string;
  codigo: string;
  dias: { fecha: string; minutosTrabajados: number; minutosPausa: number; abierto: boolean }[];
  fichajes: { id: number; tipo: TipoFichaje; fechaHoraUtc: string; ubicacion: string; precision: number | null }[];
}

export interface Empresa { id: number; nombre: string }
export interface EmpresaGestion { id: number; nombre: string; activa: boolean; creadoUtc: string; centros: number; usuariosActivos: number }
export interface Centro {
  id: number; codigoServicio: string | null; nombre: string; empresaId: number; empresa: string;
  direccion: string | null; codigoPostal: string | null; ciudad: string | null; telefono: string | null;
  activo: boolean; creadoUtc: string; usuariosActivos: number;
  coordinadorId: number | null; coordinador: string | null; gestorId: number | null; gestor: string | null;
}
export interface DatosCentro {
  empresaId: number; codigoServicio: string; nombre: string;
  direccion: string; codigoPostal: string; ciudad: string; telefono: string;
}
export interface UsuarioGestion {
  id: number; email: string; nombre: string; apellidos: string;
  empresaId: number; empresa: string; centroId: number | null; centro: string | null; codigoServicio: string | null;
  tipoPerfil: TipoPerfil | null; departamentoId: number | null; departamento: string | null; managerId: number | null; manager: string | null;
  aprobador: string | null; suplente: string | null; esCoordinador: boolean; esManagerDepartamento: boolean;
  rol: Rol; activo: boolean; debeCambiarPassword: boolean; bloqueado: number;
  ultimoAccesoUtc: string | null; creadoUtc: string;
}

/* ---------- Mi equipo ---------- */
export interface Departamento { id: number; nombre: string; activo: boolean; creadoUtc: string; managerId: number | null; manager: string | null; miembros: number }
export interface Suplencia { id: number; titularId: number; titular: string; suplenteId: number; suplente: string; desde: string; hasta: string; creadoPor: string; creadoUtc: string }
export interface MiCadena { aprobador: string | null; suplenteDeMiAprobador: string | null; esAprobador: boolean; directos: number; suplencias: Suplencia[] }
export interface EmpleadoEquipo {
  id: number; nombre: string; apellidos: string; email: string; activo: boolean; tipoPerfil: TipoPerfil | null;
  centroId: number | null; centro: string | null; codigoServicio: string | null; departamentoId: number | null; departamento: string | null;
  minutosTrabajados: number; minutosPausa: number; diasTrabajados: number; diasConIncidencia: number; enCurso: boolean;
}
export interface IncidenciaEquipo {
  empleadoId: number; nombre: string; apellidos: string; centro: string | null; codigoServicio: string | null; departamento: string | null;
  fecha: string; tipo: "SIN_CERRAR" | "SIN_UBICACION"; detalle: string;
}
export interface DetalleEmpleado {
  empleado: { id: number; nombre: string; apellidos: string; email: string; activo: boolean; centro: string | null; codigoServicio: string | null; departamento: string | null };
  desde: string; hasta: string;
  dias: { fecha: string; minutosTrabajados: number; minutosPausa: number; abierto: boolean; fichajes: { tipo: TipoFichaje; fechaHoraUtc: string; ubicacion: string }[] }[];
}

export type EstadoUbicacion = "OK" | "DENEGADA" | "NO_DISPONIBLE" | "TIMEOUT" | "NO_SOPORTADA";
export interface ResultadoUbicacion {
  estado: EstadoUbicacion;
  coords?: { lat: number; lon: number; precision: number };
}

/** Pide la ubicación SOLO en el momento de fichar. Nunca lanza error: si falla, devuelve el motivo. */
export function obtenerUbicacion(timeoutMs = 10000): Promise<ResultadoUbicacion> {
  if (!("geolocation" in navigator)) return Promise.resolve({ estado: "NO_SOPORTADA" });
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ estado: "OK", coords: { lat: p.coords.latitude, lon: p.coords.longitude, precision: Math.round(p.coords.accuracy) } }),
      (e) => resolve({ estado: e.code === e.PERMISSION_DENIED ? "DENEGADA" : e.code === e.TIMEOUT ? "TIMEOUT" : "NO_DISPONIBLE" }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 }
    );
  });
}

export const TEXTO_UBICACION: Record<EstadoUbicacion, string> = {
  OK: "con ubicación",
  DENEGADA: "sin ubicación (permiso denegado)",
  NO_DISPONIBLE: "sin ubicación (no disponible)",
  TIMEOUT: "sin ubicación (tiempo agotado)",
  NO_SOPORTADA: "sin ubicación (navegador no compatible)",
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function llamar<T>(metodo: string, ruta: string, cuerpo?: unknown): Promise<T> {
  const res = await fetch(`/api/${ruta}`, {
    method: metodo,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-Requested-With": "fichajes" },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  let datos: any = null;
  try { datos = await res.json(); } catch { /* sin cuerpo */ }
  if (!res.ok) throw new ApiError(res.status, datos?.error ?? `Error ${res.status}`);
  return datos as T;
}

export const api = {
  setupEstado: () => llamar<{ necesitaSetup: boolean }>("GET", "setup/estado"),
  setup: (d: { setupKey: string; email: string; nombre: string; apellidos: string; empresaId: number; password: string }) => llamar("POST", "setup", d),
  empresas: () => llamar<Empresa[]>("GET", "empresas"),

  login: (email: string, password: string, recordar = false) =>
    llamar<{ usuario: Usuario }>("POST", "auth/login", { email, password, recordar }),
  logout: () => llamar("POST", "auth/logout"),
  me: () => llamar<{ usuario: Usuario }>("GET", "auth/me"),
  cambiarPassword: (actual: string, nueva: string) => llamar("POST", "auth/cambiar-password", { actual, nueva }),

  estado: () => llamar<EstadoFichaje>("GET", "fichajes/estado"),
  fichar: (tipo: TipoFichaje, ubi: ResultadoUbicacion) =>
    llamar<{ tipo: TipoFichaje; fechaHoraUtc: string; ubicacion: { estado: EstadoUbicacion; precision: number | null } }>(
      "POST",
      "fichajes",
      ubi.coords ? { tipo, ubicacion: ubi.coords } : { tipo, ubicacionEstado: ubi.estado }
    ),
  exportar: (desde: string, hasta: string, formato: "pdf" | "xlsx") =>
    llamar<DatosExportacion>("GET", `fichajes/exportar?desde=${desde}&hasta=${hasta}&formato=${formato}`),
  historial: (desde: string, hasta: string) =>
    llamar<{ desde: string; hasta: string; dias: ResumenDia[] }>("GET", `fichajes/historial?desde=${desde}&hasta=${hasta}`),

  equipoResumen: (desde: string, hasta: string) =>
    llamar<{ desde: string; hasta: string; empleados: EmpleadoEquipo[]; incidencias: IncidenciaEquipo[] }>("GET", `equipo/resumen?desde=${desde}&hasta=${hasta}`),
  miCadena: () => llamar<MiCadena>("GET", "equipo/mi-cadena"),
  directorio: () => llamar<{ id: number; nombre: string }[]>("GET", "equipo/directorio"),
  crearSuplencia: (d: { titularId?: number; suplenteId: number; desde: string; hasta: string }) => llamar<{ id: number }>("POST", "suplencias", d),
  anularSuplencia: (id: number) => llamar("PUT", `suplencias/${id}/anular`),
  suplenciasGestion: () => llamar<Suplencia[]>("GET", "gestion/suplencias"),
  departamentos: () => llamar<Departamento[]>("GET", "gestion/departamentos"),
  crearDepartamento: (d: { nombre: string; managerId: number | null }) => llamar<{ id: number }>("POST", "gestion/departamentos", d),
  editarDepartamento: (id: number, d: { nombre?: string; managerId?: number | null; activo?: boolean }) => llamar("PUT", `gestion/departamentos/${id}`, d),
  equipoDetalle: (id: number, desde: string, hasta: string) => llamar<DetalleEmpleado>("GET", `equipo/empleados/${id}/historial?desde=${desde}&hasta=${hasta}`),
  equipoExportar: (ids: number[], desde: string, hasta: string, formato: "pdf" | "xlsx") =>
    llamar<{ informes: DatosExportacion[] }>("GET", `equipo/exportar?ids=${ids.join(",")}&desde=${desde}&hasta=${hasta}&formato=${formato}`),

  usuarios: () => llamar<UsuarioGestion[]>("GET", "gestion/usuarios"),
  crearUsuario: (d: any) => llamar<{ id: number }>("POST", "gestion/usuarios", d),
  editarUsuario: (id: number, d: any) => llamar("PUT", `gestion/usuarios/${id}`, d),
  resetPassword: (id: number, passwordTemporal: string) => llamar("POST", `gestion/usuarios/${id}/reset-password`, { passwordTemporal }),
  centros: () => llamar<Centro[]>("GET", "gestion/centros"),
  empresasGestion: () => llamar<EmpresaGestion[]>("GET", "gestion/empresas"),
  crearEmpresa: (nombre: string) => llamar<{ id: number; nombre: string }>("POST", "gestion/empresas", { nombre }),
  editarEmpresa: (id: number, d: { nombre?: string; activa?: boolean }) => llamar("PUT", `gestion/empresas/${id}`, d),
  crearCentro: (d: DatosCentro) => llamar<{ id: number }>("POST", "gestion/centros", d),
  editarCentro: (id: number, d: DatosCentro) => llamar("PUT", `gestion/centros/${id}`, d),
  estadoCentro: (id: number, activo: boolean) => llamar("PUT", `gestion/centros/${id}/estado`, { activo }),
  responsablesCentro: (id: number, d: { coordinadorId: number | null; gestorId: number | null }) => llamar("PUT", `gestion/centros/${id}/responsables`, d),
};

/* ---------- utilidades de formato ---------- */
const TZ = "Europe/Madrid";
export const hora = (iso: string) => new Date(iso).toLocaleTimeString("es-ES", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });
export const fechaLarga = (yyyyMmDd: string) =>
  new Date(`${yyyyMmDd}T12:00:00Z`).toLocaleDateString("es-ES", { timeZone: TZ, weekday: "long", day: "numeric", month: "long" });
export const duracion = (min: number) => `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
export const hoyLocal = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
export const restarDias = (yyyyMmDd: string, n: number) => {
  const d = new Date(`${yyyyMmDd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

export const ETIQUETA_TIPO: Record<TipoFichaje, string> = {
  ENTRADA: "Entrada",
  SALIDA: "Salida",
  PAUSA_INICIO: "Inicio pausa",
  PAUSA_FIN: "Fin pausa",
};

/** Genera una contraseña temporal que cumple la política (10+ caracteres, letras y números). */
export function generarPasswordTemporal(): string {
  const letras = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  const numeros = "23456789";
  const todos = letras + numeros;
  const rnd = (s: string) => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length];
  let pw = rnd(letras) + rnd(numeros);
  for (let i = 0; i < 10; i++) pw += rnd(todos);
  return pw.split("").sort(() => crypto.getRandomValues(new Uint8Array(1))[0] - 128).join("");
}
