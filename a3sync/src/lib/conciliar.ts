import { normEmail, dniValido } from "./normalizar";

/* Conciliación a3 → usuarios de la app (función pura, sin BD; probada en test/conciliar.test.ts).
   Reglas (decididas por Víctor el 05/11/2026):
   - Una persona = un DNI. Si está en alta en varias empresas, vale el alta más reciente.
   - Solo se aplican las personas cuyo centro a3 tiene servicio asignado y con email válido y libre.
     Email: el profesional; si no hay, el personal.
   - Perfil: ESTRUCTURA si el servicio es un centro OH (EsEstructura), si no DELEGACION.
   - Nunca se tocan rol, departamento, manager, horarios ni suplencias.
   - Usuarios creados a mano (OrigenA3 = 0) que se enlazan: solo se rellenan los datos de a3 y lo que esté vacío.
   - Cambio de email en a3 → pendiente (el email de acceso no cambia solo).
   - Baja en a3 → se desactiva (solo si la empresa se ha leído bien en esta sincronización).
     Si vuelve a estar en alta y la baja la puso a3, se reactiva. */

export interface RegistroA3 {
  empresaA3: number;
  empleadoA3: string;
  idA3: string | null;
  dni: string;
  nombre: string;
  apellidos: string;
  centroA3: number;
  fechaAlta: string | null;
  fechaBaja: string | null;
  emailProfesional: string | null;
  emailPersonal: string | null;
}

export interface UsuarioApp {
  id: number;
  email: string;
  nombre: string;
  apellidos: string;
  empresaId: number;
  centroId: number | null;
  tipoPerfil: "ESTRUCTURA" | "DELEGACION" | null;
  activo: boolean;
  dni: string | null;
  empresaA3: number | null;
  empleadoA3: string | null;
  idA3: string | null;
  fechaAltaA3: string | null;
  fechaBajaA3: string | null;
  origenA3: boolean;
  desactivadoPorA3: boolean;
}

export interface EntradaConciliacion {
  hoy: string;
  registros: RegistroA3[];
  /** codigoA3 → empresa de la app (solo las que se importan). */
  empresas: Map<number, { empresaId: number }>;
  /** "empresa-centro" → servicio de la app (null = sin asignar). */
  centros: Map<string, { centroId: number | null; nombre: string }>;
  /** centroId → es centro OH. */
  estructura: Set<number>;
  usuarios: UsuarioApp[];
  /** Empresas a3 cuyo listado de trabajadores se ha leído sin errores (para poder dar bajas). */
  empresasLeidas: Set<number>;
}

export type Campos = Partial<Omit<UsuarioApp, "id" | "email" | "origenA3">>;

export interface NuevoUsuario {
  email: string;
  nombre: string;
  apellidos: string;
  empresaId: number;
  centroId: number;
  tipoPerfil: "ESTRUCTURA" | "DELEGACION";
  dni: string;
  empresaA3: number;
  empleadoA3: string;
  idA3: string | null;
  fechaAltaA3: string | null;
  fechaBajaA3: string | null;
}

export interface Pendiente {
  tipo: "CENTRO_SIN_SERVICIO" | "SIN_EMAIL" | "EMAIL_DUPLICADO" | "EMAIL_CAMBIADO" | "DNI_INVALIDO" | "USUARIO_DESACTIVADO";
  clave: string;
  empresaA3: number | null;
  empleadoA3: string | null;
  centroA3: number | null;
  detalle: string;
}

export interface ResultadoConciliacion {
  crear: NuevoUsuario[];
  actualizar: { id: number; campos: Campos }[];
  desactivar: { id: number; fechaBajaA3: string | null }[];
  /** Registro a3 → usuario de la app (existente). Los nuevos se enlazan al insertarlos. */
  enlaces: { empresaA3: number; empleadoA3: string; usuarioId: number }[];
  pendientes: Pendiente[];
  omitidosSinServicio: number;
}

const nombreCompleto = (r: RegistroA3) => `${r.nombre} ${r.apellidos}`;
const claveCentro = (e: number, c: number) => `${e}-${c}`;

/** ¿El registro está en alta hoy? (sin baja o con baja programada a partir de hoy) */
export const enAlta = (r: { fechaBaja: string | null }, hoy: string) => !r.fechaBaja || r.fechaBaja >= hoy;

export function conciliar(e: EntradaConciliacion): ResultadoConciliacion {
  const res: ResultadoConciliacion = { crear: [], actualizar: [], desactivar: [], enlaces: [], pendientes: [], omitidosSinServicio: 0 };

  // 1. Registros en alta de empresas importadas, agrupados por DNI → el alta más reciente
  const porDni = new Map<string, RegistroA3>();
  for (const r of e.registros) {
    if (!e.empresas.has(r.empresaA3) || !enAlta(r, e.hoy) || !r.dni) continue;
    const prev = porDni.get(r.dni);
    if (!prev || (r.fechaAlta ?? "") > (prev.fechaAlta ?? "") || ((r.fechaAlta ?? "") === (prev.fechaAlta ?? "") && r.empleadoA3 > prev.empleadoA3)) {
      porDni.set(r.dni, r);
    }
  }

  // 2. Índices de usuarios de la app
  const uDni = new Map<string, UsuarioApp>();
  const uA3 = new Map<string, UsuarioApp>();
  const uEmail = new Map<string, UsuarioApp>();
  for (const u of e.usuarios) {
    if (u.dni) uDni.set(u.dni, u);
    if (u.empresaA3 !== null && u.empleadoA3) uA3.set(`${u.empresaA3}-${u.empleadoA3.trim()}`, u);
    uEmail.set(u.email.trim().toLowerCase(), u);
  }

  // Email elegido de cada persona y personas de a3 que comparten email
  const emailDe = new Map<string, string | null>();
  const dnisPorEmail = new Map<string, Set<string>>();
  for (const [dni, r] of porDni) {
    const em = normEmail(r.emailProfesional) ?? normEmail(r.emailPersonal);
    emailDe.set(dni, em);
    if (em) {
      if (!dnisPorEmail.has(em)) dnisPorEmail.set(em, new Set());
      dnisPorEmail.get(em)!.add(dni);
    }
  }

  const sinServicio = new Map<string, { r: RegistroA3; n: number; nombre: string }>();
  const usados = new Set<number>();

  for (const [dni, r] of porDni) {
    if (!dniValido(dni))
      res.pendientes.push({ tipo: "DNI_INVALIDO", clave: dni, empresaA3: r.empresaA3, empleadoA3: r.empleadoA3, centroA3: r.centroA3, detalle: `${nombreCompleto(r)}: el DNI/NIE «${dni}» no es válido. Corregirlo en a3.` });

    const c = e.centros.get(claveCentro(r.empresaA3, r.centroA3));
    if (!c?.centroId) {
      const k = claveCentro(r.empresaA3, r.centroA3);
      const x = sinServicio.get(k);
      if (x) x.n++;
      else sinServicio.set(k, { r, n: 1, nombre: c?.nombre ?? `Centro ${r.centroA3}` });
      res.omitidosSinServicio++;
      continue;
    }
    const empresaId = e.empresas.get(r.empresaA3)!.empresaId;
    const perfil: "ESTRUCTURA" | "DELEGACION" = e.estructura.has(c.centroId) ? "ESTRUCTURA" : "DELEGACION";
    const email = emailDe.get(dni) ?? null;
    const porEmail = email ? uEmail.get(email) : undefined;
    const u = uDni.get(dni) ?? uA3.get(`${r.empresaA3}-${r.empleadoA3}`) ?? (porEmail && !porEmail.dni ? porEmail : undefined);

    if (u) {
      usados.add(u.id);
      res.enlaces.push({ empresaA3: r.empresaA3, empleadoA3: r.empleadoA3, usuarioId: u.id });
      const deseado: Campos = {
        dni,
        empresaA3: r.empresaA3,
        empleadoA3: r.empleadoA3,
        idA3: r.idA3,
        fechaAltaA3: r.fechaAlta,
        fechaBajaA3: r.fechaBaja,
      };
      if (u.origenA3) {
        Object.assign(deseado, { nombre: r.nombre, apellidos: r.apellidos, empresaId, centroId: c.centroId, tipoPerfil: perfil });
      } else {
        if (!u.centroId) deseado.centroId = c.centroId;
        if (!u.tipoPerfil) deseado.tipoPerfil = perfil;
      }
      if (!u.activo) {
        if (u.desactivadoPorA3) Object.assign(deseado, { activo: true, desactivadoPorA3: false });
        else
          res.pendientes.push({ tipo: "USUARIO_DESACTIVADO", clave: dni, empresaA3: r.empresaA3, empleadoA3: r.empleadoA3, centroA3: r.centroA3, detalle: `${nombreCompleto(r)} está en alta en a3 pero su usuario está desactivado en la app.` });
      }
      const campos: Campos = {};
      for (const [k, v] of Object.entries(deseado) as [keyof Campos, any][]) if ((u as any)[k] !== v) (campos as any)[k] = v;
      if (Object.keys(campos).length) res.actualizar.push({ id: u.id, campos });
      if (email && email !== u.email.trim().toLowerCase())
        res.pendientes.push({ tipo: "EMAIL_CAMBIADO", clave: dni, empresaA3: r.empresaA3, empleadoA3: r.empleadoA3, centroA3: r.centroA3, detalle: `${nombreCompleto(r)}: en a3 el email es ${email} y en la app ${u.email}. El acceso sigue con el de la app.` });
      continue;
    }

    if (!email) {
      res.pendientes.push({ tipo: "SIN_EMAIL", clave: dni, empresaA3: r.empresaA3, empleadoA3: r.empleadoA3, centroA3: r.centroA3, detalle: `${nombreCompleto(r)} (empresa ${r.empresaA3}, trabajador ${r.empleadoA3}) no tiene email válido en a3.` });
      continue;
    }
    if ((dnisPorEmail.get(email)?.size ?? 0) > 1) {
      res.pendientes.push({ tipo: "EMAIL_DUPLICADO", clave: email, empresaA3: r.empresaA3, empleadoA3: r.empleadoA3, centroA3: r.centroA3, detalle: `El email ${email} lo tienen en a3 varias personas (${[...dnisPorEmail.get(email)!].join(", ")}).` });
      continue;
    }
    if (porEmail) {
      res.pendientes.push({ tipo: "EMAIL_DUPLICADO", clave: email, empresaA3: r.empresaA3, empleadoA3: r.empleadoA3, centroA3: r.centroA3, detalle: `${nombreCompleto(r)}: el email ${email} ya lo usa en la app ${porEmail.nombre} ${porEmail.apellidos}.` });
      continue;
    }
    res.crear.push({
      email, nombre: r.nombre, apellidos: r.apellidos, empresaId, centroId: c.centroId, tipoPerfil: perfil,
      dni, empresaA3: r.empresaA3, empleadoA3: r.empleadoA3, idA3: r.idA3, fechaAltaA3: r.fechaAlta, fechaBajaA3: r.fechaBaja,
    });
  }

  for (const [k, x] of sinServicio) {
    res.pendientes.push({ tipo: "CENTRO_SIN_SERVICIO", clave: k, empresaA3: x.r.empresaA3, empleadoA3: null, centroA3: x.r.centroA3, detalle: `${x.nombre} (empresa ${x.r.empresaA3}, centro ${x.r.centroA3}): ${x.n} trabajador(es) en alta sin importar. Asígnale su servicio en «Centros a3».` });
  }

  // 3. Bajas: usuarios enlazados a a3 que ya no están en alta en ninguna empresa importada
  for (const u of e.usuarios) {
    if (!u.activo || !u.dni || u.empresaA3 === null || usados.has(u.id)) continue;
    if (porDni.has(u.dni)) continue; // en alta pero sin servicio: no se toca
    if (!e.empresasLeidas.has(u.empresaA3)) continue;
    const ultimo = e.registros.filter((r) => r.dni === u.dni).sort((a, b) => (b.fechaBaja ?? "").localeCompare(a.fechaBaja ?? ""))[0];
    res.desactivar.push({ id: u.id, fechaBajaA3: ultimo?.fechaBaja ?? null });
  }

  return res;
}
