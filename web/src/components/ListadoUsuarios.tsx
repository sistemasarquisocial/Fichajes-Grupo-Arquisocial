import { ReactNode, useMemo, useState } from "react";
import { ETIQUETA_PERFIL, ETIQUETA_ROL, EstadoUsuario, UsuarioGestion } from "../api";
import SelectorPersona from "./SelectorPersona";

/* Listado de usuarios con filtros y varias vistas: lista (la de siempre) y árboles por centro, responsable, puesto o contrato. */

type Vista = "lista" | "centro" | "responsable" | "puesto" | "contrato";
const VISTAS: { v: Vista; t: string }[] = [
  { v: "lista", t: "Lista" },
  { v: "centro", t: "Por centro" },
  { v: "responsable", t: "Por responsable" },
  { v: "puesto", t: "Por puesto" },
  { v: "contrato", t: "Por contrato" },
];
const ESTADOS: { v: EstadoUsuario | ""; t: string }[] = [
  { v: "ALTA", t: "En alta" },
  { v: "BAJA_PROGRAMADA", t: "Baja programada" },
  { v: "BAJA", t: "De baja" },
  { v: "", t: "Todos" },
];
const POR_PAGINA = 200;
const POR_GRUPO = 50;

const sinAcentos = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const fecha = (f: string | null) => (f ? f.split("-").reverse().join("/") : "");
const porNombre = (a: UsuarioGestion, b: UsuarioGestion) => `${a.apellidos} ${a.nombre}`.localeCompare(`${b.apellidos} ${b.nombre}`, "es");

/** Personas de un grupo del árbol: se muestran de 50 en 50 (fuera del componente para no perder el estado). */
function PersonasGrupo({ personas, tabla }: { personas: UsuarioGestion[]; tabla: (l: UsuarioGestion[], mas?: ReactNode) => ReactNode }) {
  const [ver, setVer] = useState(POR_GRUPO);
  if (!personas.length) return null;
  const quedan = personas.length - ver;
  return <>{tabla(personas.slice(0, ver), quedan > 0 && <button className="btn-link" onClick={() => setVer(ver + POR_GRUPO * 4)}>Ver {Math.min(quedan, POR_GRUPO * 4)} más (quedan {quedan})</button>)}</>;
}

interface Props {
  usuarios: UsuarioGestion[];
  onEditar: (u: UsuarioGestion) => void;
  onResetear: (u: UsuarioGestion) => void;
}

export default function ListadoUsuarios({ usuarios, onEditar, onResetear }: Props) {
  const [q, setQ] = useState("");
  const [fEstado, setFEstado] = useState<EstadoUsuario | "">("ALTA");
  const [fEmpresa, setFEmpresa] = useState("");
  const [fCentro, setFCentro] = useState("");
  const [fPerfil, setFPerfil] = useState("");
  const [fRol, setFRol] = useState("");
  const [fContrato, setFContrato] = useState("");
  const [vista, setVista] = useState<Vista>("lista");
  const [paginas, setPaginas] = useState(1);
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());

  const empresas = useMemo(() => [...new Set(usuarios.map((u) => u.empresa))].sort((a, b) => a.localeCompare(b, "es")), [usuarios]);
  const centros = useMemo(() => {
    const m = new Map<number, { id: number; nombre: string; detalle: string }>();
    for (const u of usuarios)
      if (u.centroId && (!fEmpresa || u.empresa === fEmpresa) && !m.has(u.centroId))
        m.set(u.centroId, { id: u.centroId, nombre: u.centro ?? "", detalle: [u.empresa, u.codigoServicio, u.centroA3 && `a3 ${u.centroA3}`].filter(Boolean).join(" · ") });
    return [...m.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [usuarios, fEmpresa]);
  const contratos = useMemo(() => [...new Set(usuarios.map((u) => u.contrato).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "es")), [usuarios]);

  // Todos los filtros menos el estado (para contar cuántos hay en cada estado)
  const sinEstado = useMemo(() => {
    const palabras = sinAcentos(q).split(/\s+/).filter(Boolean);
    return usuarios.filter((u) => {
      if (fEmpresa && u.empresa !== fEmpresa) return false;
      if (fCentro && String(u.centroId) !== fCentro) return false;
      if (fPerfil && (u.tipoPerfil ?? "SIN") !== fPerfil) return false;
      if (fRol && u.rol !== fRol) return false;
      if (fContrato && (u.contrato ?? "SIN") !== fContrato) return false;
      if (!palabras.length) return true;
      const t = sinAcentos(`${u.nombre} ${u.apellidos} ${u.email} ${u.empresa} ${u.centro ?? ""} ${u.codigoServicio ?? ""} ${u.centroA3 ?? ""} ${u.departamento ?? ""} ${u.puesto ?? ""} ${u.contrato ?? ""} ${u.responsableA3 ?? ""} ${u.aprobador ?? ""} ${u.empleadoA3 ?? ""}`);
      return palabras.every((w) => t.includes(w));
    });
  }, [usuarios, q, fEmpresa, fCentro, fPerfil, fRol, fContrato]);

  const cuenta = useMemo(() => {
    const c: Record<string, number> = { "": sinEstado.length, ALTA: 0, BAJA_PROGRAMADA: 0, BAJA: 0 };
    for (const u of sinEstado) c[u.estado]++;
    return c;
  }, [sinEstado]);

  const filtrados = useMemo(
    () => (fEstado === "ALTA" ? sinEstado.filter((u) => u.estado !== "BAJA") : fEstado ? sinEstado.filter((u) => u.estado === fEstado) : sinEstado),
    [sinEstado, fEstado]
  );

  const hayFiltros = !!(q || fEmpresa || fCentro || fPerfil || fRol || fContrato || fEstado !== "ALTA");
  const quitarFiltros = () => { setQ(""); setFEmpresa(""); setFCentro(""); setFPerfil(""); setFRol(""); setFContrato(""); setFEstado("ALTA"); setPaginas(1); };
  const alternar = (k: string) => setAbiertos((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });

  /* ---------- Árboles ---------- */
  interface Nodo { clave: string; titulo: ReactNode; detalle?: string; personas: UsuarioGestion[]; hijos: Nodo[]; total: number }

  const arbol = useMemo<Nodo[]>(() => {
    const agrupar = (lista: UsuarioGestion[], clave: (u: UsuarioGestion) => string, prefijo: string, vacio: string): Nodo[] => {
      const m = new Map<string, UsuarioGestion[]>();
      for (const u of lista) { const k = clave(u) || ""; (m.get(k) ?? m.set(k, []).get(k)!).push(u); }
      return [...m.entries()]
        .sort(([a], [b]) => (a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "es")))
        .map(([k, ps]) => ({ clave: `${prefijo}:${k}`, titulo: k || vacio, personas: ps.sort(porNombre), hijos: [], total: ps.length }));
    };
    if (vista === "centro") {
      return agrupar(filtrados, (u) => u.empresa, "e", "Sin empresa").map((e) => {
        const hijos = agrupar(e.personas, (u) => (u.tipoPerfil === "ESTRUCTURA" ? `Estructura · ${u.departamento ?? "sin departamento"}` : u.centro ?? ""), `${e.clave}|c`, "Sin centro");
        for (const h of hijos) { const p = h.personas[0]; if (p?.centroId && p.tipoPerfil !== "ESTRUCTURA") h.detalle = [p.codigoServicio, p.centroA3 && `a3 ${p.centroA3}`].filter(Boolean).join(" · "); }
        return { ...e, personas: [], hijos };
      });
    }
    if (vista === "puesto") return agrupar(filtrados, (u) => u.puesto ?? "", "p", "Sin puesto en a3");
    if (vista === "contrato") return agrupar(filtrados, (u) => u.contrato ?? "", "k", "Sin contrato en a3");
    if (vista === "responsable") {
      const enLista = new Map(filtrados.map((u) => [u.id, u]));
      const equipo = new Map<number, UsuarioGestion[]>();
      for (const u of filtrados) if (u.responsableA3Id && enLista.has(u.responsableA3Id)) (equipo.get(u.responsableA3Id) ?? equipo.set(u.responsableA3Id, []).get(u.responsableA3Id)!).push(u);
      const visto = new Set<number>();
      const nodo = (u: UsuarioGestion): Nodo => {
        visto.add(u.id);
        // Los que a su vez tienen equipo son subnodos; el resto se listan en la tabla del nodo
        const directos = (equipo.get(u.id) ?? []).filter((x) => !visto.has(x.id)).sort(porNombre);
        directos.forEach((x) => visto.add(x.id));
        const hijos = directos.filter((x) => equipo.has(x.id)).map(nodo);
        const personas = directos.filter((x) => !equipo.has(x.id));
        return { clave: `r:${u.id}`, titulo: `${u.apellidos}, ${u.nombre}`, detalle: [u.puesto, u.centro ?? u.departamento].filter(Boolean).join(" · "), personas, hijos, total: personas.length + hijos.reduce((n, h) => n + 1 + h.total, 0) };
      };
      const raices = filtrados.filter((u) => equipo.has(u.id) && !(u.responsableA3Id && enLista.has(u.responsableA3Id))).sort(porNombre).map(nodo);
      const sueltos = filtrados.filter((u) => !visto.has(u.id) && !equipo.has(u.id)).sort(porNombre);
      // Responsables que solo aparecen como texto en a3 (no tienen usuario en la app)
      const porTexto = agrupar(sueltos.filter((u) => u.responsableA3), (u) => u.responsableA3 ?? "", "rt", "");
      for (const n of porTexto) n.detalle = "sin usuario en la app";
      const sin = sueltos.filter((u) => !u.responsableA3);
      return [...raices, ...porTexto, ...(sin.length ? [{ clave: "r:sin", titulo: "Sin responsable en a3", personas: sin, hijos: [], total: sin.length }] : [])];
    }
    return [];
  }, [filtrados, vista]);

  const expandirTodo = () => {
    const s = new Set<string>();
    const rec = (ns: Nodo[]) => ns.forEach((n) => { if (n.hijos.length || (vista === "responsable" && n.personas.length)) { s.add(n.clave); rec(n.hijos); } });
    rec(arbol);
    setAbiertos(s);
  };

  /* ---------- Filas ---------- */
  const estadoChip = (u: UsuarioGestion) =>
    u.estado === "BAJA" ? (
      <span className="chip chip-salida">Baja{u.fechaBajaA3 ? ` · ${fecha(u.fechaBajaA3)}` : ""}</span>
    ) : u.estado === "BAJA_PROGRAMADA" ? (
      <span className="chip chip-pausa_inicio">Baja el {fecha(u.fechaBajaA3)}</span>
    ) : u.bloqueado ? (
      <span className="chip chip-salida">Bloqueado</span>
    ) : u.debeCambiarPassword ? (
      <span className="chip chip-pausa_inicio">Pendiente de activar</span>
    ) : (
      <span className="chip chip-entrada">Alta</span>
    );

  const fila = (u: UsuarioGestion) => (
    <tr key={u.id} className={u.estado === "BAJA" ? "inactivo" : ""}>
      <td>
        <strong>{u.apellidos}, {u.nombre}</strong>
        <div className="nota">{u.email}{u.empleadoA3 ? ` · a3 ${u.empresaA3}/${u.empleadoA3}` : ""}</div>
      </td>
      <td>
        {u.puesto ?? <span className="nota">—</span>}
        {(u.contrato || u.jornada !== null) && <div className="nota">{[u.contrato, u.jornada !== null && u.jornada < 1 ? `${Math.round(u.jornada * 100)} % jornada` : null].filter(Boolean).join(" · ")}</div>}
      </td>
      <td>
        {u.tipoPerfil ? ETIQUETA_PERFIL[u.tipoPerfil] : <span className="chip chip-pausa_inicio">Sin perfil</span>}
        <div className="nota">{u.empresa}{u.tipoPerfil === "ESTRUCTURA" ? (u.departamento ? ` · ${u.departamento}` : " · sin departamento") : u.centro ? ` · ${u.codigoServicio ? `${u.codigoServicio} · ` : ""}${u.centro}` : ""}</div>
      </td>
      <td>
        {u.responsableA3 ?? <span className="nota">—</span>}
        <div className="nota">Aprueba: {u.aprobador ?? "nadie"}{u.suplente ? ` (hoy ${u.suplente})` : ""}</div>
      </td>
      <td>{ETIQUETA_ROL[u.rol] ?? u.rol}</td>
      <td>{estadoChip(u)}{u.fechaAltaA3 && <div className="nota">Alta {fecha(u.fechaAltaA3)}</div>}</td>
      <td className="acciones-fila">
        <button className="btn-link" onClick={() => onEditar(u)}>Editar</button>
        <button className="btn-link" onClick={() => onResetear(u)}>Resetear contraseña</button>
      </td>
    </tr>
  );

  const tabla = (lista: UsuarioGestion[], mas?: ReactNode) => (
    <table className="tabla">
      <thead>
        <tr><th>Persona</th><th>Puesto / contrato</th><th>Perfil</th><th>Responsable</th><th>Rol</th><th>Estado</th><th /></tr>
      </thead>
      <tbody>
        {lista.map(fila)}
        {mas && <tr><td colSpan={7} className="nota">{mas}</td></tr>}
      </tbody>
    </table>
  );

  const pintarNodo = (n: Nodo, nivel: number): ReactNode => {
    const abierto = abiertos.has(n.clave);
    const persona = vista === "responsable" && n.clave.startsWith("r:") && n.clave !== "r:sin";
    return (
      <li key={n.clave} className={`arbol-nodo nivel-${Math.min(nivel, 3)}`}>
        <button type="button" className="arbol-cabecera" aria-expanded={abierto} onClick={() => alternar(n.clave)}>
          <span className="arbol-flecha" aria-hidden>{abierto ? "▾" : "▸"}</span>
          <span className="arbol-titulo">{n.titulo}</span>
          {n.detalle && <span className="nota">{n.detalle}</span>}
          <span className="chip arbol-total">{persona ? `${n.total} a su cargo` : `${n.total} ${n.total === 1 ? "persona" : "personas"}`}</span>
        </button>
        {abierto && (
          <div className="arbol-contenido">
            {n.hijos.length > 0 && <ul className="arbol">{n.hijos.map((h) => pintarNodo(h, nivel + 1))}</ul>}
            <PersonasGrupo personas={n.personas} tabla={tabla} />
          </div>
        )}
      </li>
    );
  };

  const visibles = filtrados.slice(0, paginas * POR_PAGINA);

  return (
    <div className="tarjeta tabla-contenedor">
      <div className="tabla-buscador">
        <input className="buscador" placeholder="Buscar por nombre, email, puesto, contrato, centro, responsable o código a3…" value={q} onChange={(e) => { setQ(e.target.value); setPaginas(1); }} />
      </div>
      <div className="usuarios-barra">
      <div className="usuarios-estados" role="tablist" aria-label="Estado">
        {ESTADOS.map((e) => (
          <button key={e.v} type="button" role="tab" aria-selected={fEstado === e.v} className={`segmento ${fEstado === e.v ? "activo" : ""}`} onClick={() => { setFEstado(e.v); setPaginas(1); }}>
            {e.t} <span className="segmento-n">{e.v === "ALTA" ? cuenta.ALTA + cuenta.BAJA_PROGRAMADA : cuenta[e.v]}</span>
          </button>
        ))}
      </div>
      <div className="usuarios-estados" role="tablist" aria-label="Vista">
        <span className="nota">Ver:</span>
        {VISTAS.map((v) => (
          <button key={v.v} type="button" role="tab" aria-selected={vista === v.v} className={`segmento ${vista === v.v ? "activo" : ""}`} onClick={() => { setVista(v.v); setAbiertos(new Set()); }}>{v.t}</button>
        ))}
      </div>
      </div>
      <div className="centros-filtros">
        <label>
          Empresa
          <select value={fEmpresa} onChange={(e) => { setFEmpresa(e.target.value); setFCentro(""); setPaginas(1); }}>
            <option value="">Todas</option>
            {empresas.map((e) => <option key={e} value={e}>{e}</option>)}
          </select>
        </label>
        <label className="usuarios-filtro-centro">
          Centro
          <SelectorPersona personas={centros} valor={fCentro} onCambio={(v) => { setFCentro(v); setPaginas(1); }} vacio="Todos" placeholder="Escribe un centro…" />
        </label>
        <label>
          Perfil
          <select value={fPerfil} onChange={(e) => { setFPerfil(e.target.value); setPaginas(1); }}>
            <option value="">Todos</option>
            <option value="ESTRUCTURA">Estructura</option>
            <option value="DELEGACION">Delegación</option>
            <option value="SIN">Sin perfil</option>
          </select>
        </label>
        <label>
          Contrato
          <select value={fContrato} onChange={(e) => { setFContrato(e.target.value); setPaginas(1); }}>
            <option value="">Todos</option>
            {contratos.map((c) => <option key={c} value={c}>{c}</option>)}
            <option value="SIN">Sin contrato en a3</option>
          </select>
        </label>
        <label>
          Rol
          <select value={fRol} onChange={(e) => { setFRol(e.target.value); setPaginas(1); }}>
            <option value="">Todos</option>
            {Object.entries(ETIQUETA_ROL).map(([v, t]) => <option key={v} value={v}>{t}</option>)}
          </select>
        </label>
        <span className="nota centros-total">
          {filtrados.length} de {usuarios.length} usuarios
          {hayFiltros && <> · <button className="btn-link" onClick={quitarFiltros}>Quitar filtros</button></>}
          {vista !== "lista" && arbol.length > 0 && <> · <button className="btn-link" onClick={expandirTodo}>Expandir todo</button> · <button className="btn-link" onClick={() => setAbiertos(new Set())}>Contraer</button></>}
        </span>
      </div>

      {filtrados.length === 0 ? (
        <p className="nota vacio">Nadie coincide con la búsqueda o los filtros.</p>
      ) : vista === "lista" ? (
        tabla(visibles, filtrados.length > visibles.length && <button className="btn-link" onClick={() => setPaginas(paginas + 1)}>Mostrar {Math.min(POR_PAGINA, filtrados.length - visibles.length)} más (quedan {filtrados.length - visibles.length})</button>)
      ) : (
        <ul className="arbol arbol-raiz">{arbol.map((n) => pintarNodo(n, 0))}</ul>
      )}
    </div>
  );
}
