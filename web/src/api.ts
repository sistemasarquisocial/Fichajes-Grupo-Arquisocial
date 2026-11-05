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
  /** Incidencias pendientes que le toca resolver. */
  pendientesAprobacion?: number;
}

/** Fichaje tal como se muestra: con las correcciones aprobadas aplicadas. */
export interface FichajeDia {
  tipo: TipoFichaje;
  fechaHoraUtc: string;
  /** Id del fichaje original (null si se añadió por incidencia). */
  id?: number | null;
  corregido?: boolean;
  originalUtc?: string | null;
  anadido?: boolean;
  anulado?: boolean;
}

export interface ResumenDia {
  fecha: string;
  minutosTrabajados: number;
  minutosPausa: number;
  abierto: boolean;
  fichajes: FichajeDia[];
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
  fichajes: { id: number; tipo: TipoFichaje; fechaHoraUtc: string; ubicacion: string; precision: number | null; corregido?: boolean; originalUtc?: string | null; anadido?: boolean; anulado?: boolean }[];
  /** Ausencias justificadas aprobadas por día (columna aparte de lo trabajado). */
  justificados?: Justificado[];
}

export interface Empresa { id: number; nombre: string }
export interface EmpresaGestion { id: number; nombre: string; activa: boolean; creadoUtc: string; centros: number; usuariosActivos: number }
export interface Centro {
  id: number; codigoServicio: string | null; nombre: string; empresaId: number; empresa: string;
  direccion: string | null; codigoPostal: string | null; ciudad: string | null; telefono: string | null;
  activo: boolean; creadoUtc: string; usuariosActivos: number;
  coordinadorId: number | null; coordinador: string | null; gestorId: number | null; gestor: string | null;
  comunidad: string | null; margenMinutos: number; escaladoMinutos: number; umbralSobrecargaHoras: number; maxHorasSinSalida: number;
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
  minutosTrabajados: number; minutosPausa: number; minutosJustificados: number; diasTrabajados: number; diasConIncidencia: number; enCurso: boolean;
}
export interface IncidenciaEquipo {
  empleadoId: number; nombre: string; apellidos: string; centro: string | null; codigoServicio: string | null; departamento: string | null;
  fecha: string; tipo: "SIN_CERRAR" | "SIN_UBICACION"; detalle: string;
}
export interface DetalleEmpleado {
  empleado: { id: number; nombre: string; apellidos: string; email: string; activo: boolean; centro: string | null; codigoServicio: string | null; departamento: string | null };
  desde: string; hasta: string;
  dias: { fecha: string; minutosTrabajados: number; minutosPausa: number; abierto: boolean; fichajes: (FichajeDia & { ubicacion: string })[] }[];
  justificados: Justificado[];
}

/* ---------- Incidencias ---------- */
export type TipoIncidencia = "CAMBIAR_HORA" | "ANADIR" | "ANULAR";
export type EstadoIncidencia = "PENDIENTE" | "ACEPTADA" | "RECHAZADA" | "RETIRADA";
export const ETIQUETA_INCIDENCIA: Record<TipoIncidencia, string> = { CAMBIAR_HORA: "Cambiar la hora", ANADIR: "Añadir fichaje olvidado", ANULAR: "Anular fichaje erróneo" };
export const ETIQUETA_ESTADO_INC: Record<EstadoIncidencia, string> = { PENDIENTE: "Pendiente", ACEPTADA: "Aceptada", RECHAZADA: "Rechazada", RETIRADA: "Retirada" };
export interface Incidencia {
  id: number; usuarioId: number; solicitante: string; centro: string | null; codigoServicio: string | null; departamento: string | null;
  tipo: TipoIncidencia; fichajeId: number | null; tipoFichaje: TipoFichaje;
  originalUtc: string | null; propuestaUtc: string | null; comentario: string;
  estado: EstadoIncidencia; creadoUtc: string; resueltaPor: string | null; resueltaUtc: string | null; motivoRechazo: string | null;
  /** Fichajes del día afectado (solo en pendientes de aprobación). */
  contexto?: FichajeDia[];
}
/* ---------- Ausencias justificadas ---------- */
export type EstadoAusencia = "PENDIENTE" | "APROBADA" | "RECHAZADA" | "RETIRADA";
export const ETIQUETA_ESTADO_AUS: Record<EstadoAusencia, string> = { PENDIENTE: "Pendiente", APROBADA: "Aprobada", RECHAZADA: "Rechazada", RETIRADA: "Retirada" };
export interface MotivoAusencia { id: number; nombre: string; requiereJustificante: boolean }
export interface MotivoGestion extends MotivoAusencia { orden: number; activo: boolean; usos: number }
export interface Documento { id: number; nombre: string; tipo: string; bytes: number; subidoUtc: string }
export interface Ausencia {
  id: number; usuarioId: number; solicitante: string; centro: string | null; codigoServicio: string | null; departamento: string | null;
  motivoId: number; motivo: string; requiereJustificante: boolean;
  fechaInicio: string; fechaFin: string; horaInicio: string | null; horaFin: string | null; comentario: string | null;
  estado: EstadoAusencia; creadoUtc: string; resueltaPor: string | null; resueltaUtc: string | null; motivoRechazo: string | null;
  documentos: Documento[];
}
export interface AusenciaDia { id: number; motivo: string; estado: EstadoAusencia; fechaInicio: string; fechaFin: string; horaInicio: string | null; horaFin: string | null; periodo: string }
export interface Justificado { fecha: string; minutos: number; motivos: string[] }
export interface NuevaAusencia { motivoId: number; fechaInicio: string; fechaFin: string; horaInicio?: string; horaFin?: string; comentario?: string }
export const DIAS_AUSENCIA = 30;
const fechaCortaAus = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;
/** "12/11/2026 10:00–12:00", "12/11/2026 (día completo)", "12/11/2026 – 14/11/2026". */
export const periodoAusencia = (a: Pick<Ausencia, "fechaInicio" | "fechaFin" | "horaInicio" | "horaFin">) =>
  a.horaInicio ? `${fechaCortaAus(a.fechaInicio)} de ${a.horaInicio} a ${a.horaFin}` : a.fechaInicio === a.fechaFin ? `${fechaCortaAus(a.fechaInicio)} (día completo)` : `${fechaCortaAus(a.fechaInicio)} – ${fechaCortaAus(a.fechaFin)}`;

/** Sube un justificante (cuerpo binario). */
async function subirArchivo(ruta: string, archivo: Blob, nombre: string): Promise<Documento> {
  const res = await fetch(`/api/${ruta}`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/octet-stream", "X-Requested-With": "fichajes", "X-Nombre-Archivo": encodeURIComponent(nombre) },
    body: archivo,
  });
  let datos: any = null;
  try { datos = await res.json(); } catch { /* sin cuerpo */ }
  if (!res.ok) throw new ApiError(res.status, datos?.error ?? (res.status === 413 ? "El archivo no puede superar 10 MB" : `Error ${res.status}`));
  return datos as Documento;
}

export interface NuevaIncidencia { tipo: TipoIncidencia; fichajeId?: number; tipoFichaje?: TipoFichaje; fecha?: string; hora?: string; comentario: string }

/* ---------- Horarios ---------- */
export type TipoHorario = "FIJO" | "ROTATIVO" | "VARIABLE";
export const ETIQUETA_HORARIO: Record<TipoHorario, string> = { FIJO: "Fijo", ROTATIVO: "Rotativo", VARIABLE: "Variable (bolsa de horas)" };
export interface TramoHorario { semana: number; dia: number; inicio: string; fin: string; turnoId: number | null }
export interface TramoDia { inicio: string; fin: string }
export interface Horario {
  usuarioId: number; tipo: TipoHorario; horasMes: number | null; semanas: number; inicioPatron: string | null;
  bolsaDesde: string | null; descuentaFestivos: boolean; tramos: TramoHorario[];
}
export interface SaldoMes {
  tipo: TipoHorario | null; objetivoMin: number; objetivoHastaHoyMin: number | null; trabajadoMin: number; justificadoMin: number;
  ajuste: { horas: number; motivo: string } | null; bolsaAnteriorMin: number | null; pendienteMin: number | null;
  excesoMin: number; sobrecarga: boolean; umbralHoras: number; centroId: number | null;
}
export interface EmpleadoHorario {
  id: number; nombre: string; apellidos: string; tipoPerfil: TipoPerfil | null; centroId: number | null; centro: string | null;
  codigoServicio: string | null; departamento: string | null; horario: { tipo: TipoHorario; resumen: string } | null; saldo: SaldoMes | null; propio: boolean;
}
export interface DetalleHorario {
  horario: Horario | null; resumen: string; cambios: { fecha: string; tramos: TramoDia[] }[];
  ajustes: { mes: string; horas: number; motivo: string; creadoPor: string }[]; editable: boolean;
}
export interface Aviso { tipo: "SIN_ENTRADA" | "SIN_SALIDA" | "RETRASO"; prevista: string | null; desdeUtc: string; minutos: number; escalado: boolean; texto: string }
export interface PresenciaEmpleado {
  id: number; nombre: string; apellidos: string; centroId: number | null; centro: string | null; codigoServicio: string | null; departamento: string | null;
  estado: Estado; ultimoUtc: string | null; planHoy: TramoDia[]; avisos: Aviso[];
}
export interface Turno { id: number; centroId: number; centro: string; nombre: string; inicio: string; fin: string; activo: boolean; editable: boolean }
export interface CandidatoCobertura {
  id: number; nombre: string; apellidos: string; tipo: TipoHorario | null; debeMin: number; bolsaMin: number | null;
  trabajadoMin: number; objetivoMin: number; excesoMin: number; motivo: string | null;
}
export interface Festivo { fecha: string; nombre: string; origen: "NACIONAL" | "AUTONOMICO" | "LOCAL" | "MANUAL"; id?: number }
export interface FestivoManual { id: number; fecha: string; nombre: string; ambito: "MUNICIPIO" | "COMUNIDAD"; provincia: string | null; municipio: string | null; comunidad: string | null; quitar: boolean }
export interface CalendarioCentros {
  comunidad: string | null; provincia: string | null; municipio: string | null; nombreComunidad: string | null; ciudad: string | null;
  centros: string[]; festivos: Festivo[]; locales: number;
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
    llamar<{ desde: string; hasta: string; dias: ResumenDia[]; justificados: Justificado[]; ausencias: AusenciaDia[] }>("GET", `fichajes/historial?desde=${desde}&hasta=${hasta}`),

  motivosAusencia: () => llamar<{ motivos: MotivoAusencia[] }>("GET", "ausencias/motivos"),
  misAusencias: () => llamar<{ resuelve: string; ausencias: Ausencia[]; almacen: boolean }>("GET", "ausencias/mias"),
  crearAusencia: (d: NuevaAusencia) => llamar<{ id: number }>("POST", "ausencias", d),
  retirarAusencia: (id: number) => llamar("PUT", `ausencias/${id}/retirar`),
  subirJustificante: (id: number, archivo: Blob, nombre: string) => subirArchivo(`ausencias/${id}/justificantes`, archivo, nombre),
  borrarJustificante: (id: number, doc: number) => llamar("DELETE", `ausencias/${id}/justificantes/${doc}`),
  enlaceDocumento: (id: number, descargar = false) => llamar<{ url: string }>("GET", `documentos/${id}/enlace${descargar ? "?descargar=1" : ""}`),
  aprobacionesAusencias: (estado: "PENDIENTES" | "RESUELTAS") => llamar<{ ausencias: Ausencia[] }>("GET", `aprobaciones/ausencias?estado=${estado}`),
  resolverAusencia: (id: number, accion: "ACEPTAR" | "RECHAZAR", motivo?: string) => llamar("PUT", `aprobaciones/ausencias/${id}/resolver`, { accion, motivo }),
  motivosGestion: () => llamar<{ motivos: MotivoGestion[] }>("GET", "gestion/motivos-ausencia"),
  crearMotivo: (d: { nombre: string; requiereJustificante: boolean; orden: number }) => llamar<{ id: number }>("POST", "gestion/motivos-ausencia", d),
  editarMotivo: (id: number, d: { nombre: string; requiereJustificante: boolean; orden: number; activo: boolean }) => llamar("PUT", `gestion/motivos-ausencia/${id}`, d),

  misIncidencias: () => llamar<{ resuelve: string; incidencias: Incidencia[] }>("GET", "incidencias/mias"),
  crearIncidencia: (d: NuevaIncidencia) => llamar<{ id: number }>("POST", "incidencias", d),
  retirarIncidencia: (id: number) => llamar("PUT", `incidencias/${id}/retirar`),
  aprobaciones: (estado: "PENDIENTES" | "RESUELTAS") => llamar<{ incidencias: Incidencia[] }>("GET", `aprobaciones?estado=${estado}`),
  contadorAprobaciones: () => llamar<{ pendientes: number; avisosEquipo: number }>("GET", "aprobaciones/contador"),
  resolverIncidencia: (id: number, accion: "ACEPTAR" | "RECHAZAR", motivo?: string) => llamar("PUT", `aprobaciones/${id}/resolver`, { accion, motivo }),

  horariosEquipo: (mes: string) => llamar<{ mes: string; empleados: EmpleadoHorario[] }>("GET", `horarios/equipo?mes=${mes}`),
  horarioDetalle: (id: number) => llamar<DetalleHorario>("GET", `horarios/${id}`),
  guardarHorario: (d: { ids: number[]; tipo: TipoHorario; horasMes?: number; semanas?: number; inicioPatron?: string; descuentaFestivos: boolean; tramos: TramoHorario[] }) =>
    llamar<{ actualizados: number }>("PUT", "horarios", d),
  ajusteMes: (id: number, d: { mes: string; horas: number | null; motivo?: string }) => llamar("PUT", `horarios/${id}/ajuste`, d),
  cambioDia: (id: number, d: { fecha: string; tramos?: TramoDia[]; quitar?: boolean }) => llamar("PUT", `horarios/${id}/cambio`, d),
  equipoAhora: () => llamar<{ ahoraUtc: string; empleados: PresenciaEmpleado[] }>("GET", "equipo/ahora"),
  cubrir: (centroId: number, fecha: string, inicio: string, fin: string) =>
    llamar<{ candidatos: CandidatoCobertura[]; descartados: CandidatoCobertura[]; horasHueco: number }>("GET", `equipo/cubrir?centroId=${centroId}&fecha=${fecha}&inicio=${inicio}&fin=${fin}`),
  turnos: (centroId?: number) => llamar<{ turnos: Turno[]; centrosEditables: number[] | null }>("GET", `turnos${centroId ? `?centroId=${centroId}` : ""}`),
  crearTurno: (d: { centroId: number; nombre: string; inicio: string; fin: string }) => llamar<{ id: number }>("POST", "turnos", d),
  editarTurno: (id: number, d: { nombre: string; inicio: string; fin: string; activo: boolean }) => llamar("PUT", `turnos/${id}`, d),
  miDia: () => llamar<{ planHoy: TramoDia[]; avisos: Aviso[] }>("GET", "fichajes/mi-dia"),
  calendarios: (anio: number) =>
    llamar<{ anio: number; calendarios: CalendarioCentros[]; sinDatos: string[]; manuales: FestivoManual[]; automaticos: Record<string, Festivo[]> }>("GET", `gestion/calendarios?anio=${anio}`),
  crearFestivo: (d: { fecha: string; nombre?: string; ambito: "MUNICIPIO" | "COMUNIDAD"; provincia?: string | null; municipio?: string | null; comunidad?: string | null; quitar?: boolean }) =>
    llamar<{ id: number }>("POST", "gestion/festivos", d),
  borrarFestivo: (id: number) => llamar("DELETE", `gestion/festivos/${id}`),
  controlCentro: (id: number, d: { margenMinutos: number; escaladoMinutos: number; umbralSobrecargaHoras: number; maxHorasSinSalida: number }) =>
    llamar("PUT", `gestion/centros/${id}/control`, d),

  equipoResumen: (desde: string, hasta: string) =>
    llamar<{ desde: string; hasta: string; empleados: EmpleadoEquipo[]; incidencias: IncidenciaEquipo[] }>("GET", `equipo/resumen?desde=${desde}&hasta=${hasta}`),
  miCadena: () => llamar<MiCadena>("GET", "equipo/mi-cadena"),
  directorio: () => llamar<{ id: number; nombre: string }[]>("GET", "equipo/directorio"),
  candidatosSuplente: () => llamar<{ id: number; nombre: string }[]>("GET", "equipo/candidatos-suplente"),
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
export const fechaHora = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("es-ES", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" })} ${hora(iso)}`;
};
/** Fecha local YYYY-MM-DD de un instante. */
export const fechaDe = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(iso));
export const hoyLocal = () => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
export const restarDias = (yyyyMmDd: string, n: number) => {
  const d = new Date(`${yyyyMmDd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

/** Minutos con signo como "+3 h 20 min" / "−1 h 05 min". */
export const horasConSigno = (min: number) => `${min < 0 ? "−" : min > 0 ? "+" : ""}${duracion(Math.abs(Math.round(min)))}`;
export const DIAS_SEMANA = ["L", "M", "X", "J", "V", "S", "D"];

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
