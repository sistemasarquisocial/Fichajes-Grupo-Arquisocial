import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  api, ApiError, EstadoA3, PendienteA3, EmpresaA3, CentroA3, ServicioA3, NodoOrganigramaA3, EmpresaGestion,
  ETIQUETA_PENDIENTE_A3, TipoPendienteA3,
} from "../api";

/* Integración con a3innuva Nómina (ADMIN): conexión, sincronización, pendientes, centros a3 ↔ servicios,
   empresas y organigrama. La sincronización la hace el conector (Function App) cada noche o cuando se pide aquí. */

type Vista = "estado" | "pendientes" | "centros" | "empresas" | "organigrama";
type Mensaje = { tipo: "exito" | "error"; texto: string } | null;

const fechaHora = (s: string | null) =>
  s ? new Date(s).toLocaleString("es-ES", { timeZone: "Europe/Madrid", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const fecha = (s: string | null) => (s ? new Date(s).toLocaleDateString("es-ES", { timeZone: "Europe/Madrid" }) : "—");
const err = (e: unknown, def: string) => (e instanceof ApiError ? e.message : def);

const ETIQUETA_CONEXION = { DESCONECTADA: "Sin conectar", CONECTADA: "Conectada", CADUCADA: "Caducada", ERROR: "Error" } as const;
const ETIQUETA_SYNC = { PENDIENTE: "En cola", EN_CURSO: "En curso", OK: "Correcta", ERROR: "Con errores" } as const;

export default function IntegracionA3() {
  const [vista, setVista] = useState<Vista>("estado");
  const [filtroCentro, setFiltroCentro] = useState<string>("");
  const pestana = (v: Vista, t: string) => (
    <button role="tab" aria-selected={vista === v} className={vista === v ? "activo" : ""} onClick={() => setVista(v)}>{t}</button>
  );
  return (
    <section className="a3">
      <div className="titulo-acciones">
        <div>
          <h2>Integración con a3innuva</h2>
          <p className="sub">Empresas, centros y trabajadores llegan de a3 cada noche. Aquí se conecta, se revisa lo que no se ha podido importar y se relacionan los centros de a3 con los servicios.</p>
        </div>
      </div>
      <div className="pestanas" role="tablist">
        {pestana("estado", "Estado")}
        {pestana("pendientes", "Pendientes")}
        {pestana("centros", "Centros a3")}
        {pestana("empresas", "Empresas a3")}
        {pestana("organigrama", "Organigrama a3")}
      </div>
      <div className="a3-cuerpo">
        {vista === "estado" && <EstadoConexion irA={setVista} />}
        {vista === "pendientes" && <Pendientes onAsignar={(k) => { setFiltroCentro(k); setVista("centros"); }} />}
        {vista === "centros" && <Centros filtroInicial={filtroCentro} />}
        {vista === "empresas" && <Empresas />}
        {vista === "organigrama" && <Organigrama />}
      </div>
    </section>
  );
}

/* ---------- Estado, conexión y sincronizaciones ---------- */
function EstadoConexion({ irA }: { irA: (v: Vista) => void }) {
  const [e, setE] = useState<EstadoA3 | null>(null);
  const [msg, setMsg] = useState<Mensaje>(null);
  const [ocupado, setOcupado] = useState(false);
  const [params, setParams] = useSearchParams();

  async function cargar() {
    try { setE(await api.a3Estado()); } catch (x) { setMsg({ tipo: "error", texto: err(x, "No se pudo cargar el estado") }); }
  }
  useEffect(() => {
    const c = params.get("conexion");
    if (c) {
      setMsg(c === "ok" ? { tipo: "exito", texto: "Conexión con a3 realizada." } : { tipo: "error", texto: params.get("motivo") || "No se pudo conectar con a3." });
      params.delete("conexion"); params.delete("motivo"); setParams(params, { replace: true });
    }
    cargar();
  }, []);
  const enMarcha = !!e?.sincronizaciones.some((s) => s.estado === "PENDIENTE" || s.estado === "EN_CURSO");
  useEffect(() => {
    if (!enMarcha) return;
    const t = setInterval(cargar, 20000);
    return () => clearInterval(t);
  }, [enMarcha]);

  async function conectar() {
    setOcupado(true); setMsg(null);
    try { window.location.href = (await api.a3Conectar()).url; }
    catch (x) { setMsg({ tipo: "error", texto: err(x, "No se pudo iniciar la conexión") }); setOcupado(false); }
  }
  async function sincronizar(completa: boolean) {
    setOcupado(true); setMsg(null);
    try {
      await api.a3Sincronizar(completa);
      setMsg({ tipo: "exito", texto: "Sincronización en cola: el conector la empieza en menos de 5 minutos." });
      await cargar();
    } catch (x) { setMsg({ tipo: "error", texto: err(x, "No se pudo pedir la sincronización") }); }
    setOcupado(false);
  }

  if (!e) return msg ? <p className={msg.tipo} role="alert">{msg.texto}</p> : <div className="centrado-bloque"><div className="spinner" aria-label="Cargando" /></div>;
  const c = e.conexion;
  const totalPend = Object.values(e.pendientes).reduce((a, b) => a + b, 0);
  return (
    <>
      {msg && <p className={msg.tipo} role={msg.tipo === "error" ? "alert" : "status"}>{msg.texto}</p>}
      <div className="tarjeta a3-conexion">
        <div className="titulo-acciones">
          <div>
            <h3>Conexión <span className={`chip a3-chip-${c.estado.toLowerCase()}`}>{ETIQUETA_CONEXION[c.estado]}</span></h3>
            {c.estado !== "DESCONECTADA" && (
              <p className="nota">
                Usuario de a3: <strong>{c.usuarioA3 ?? "—"}</strong> · conectada el {fechaHora(c.conectadaUtc)}{c.conectadaPor ? ` por ${c.conectadaPor}` : ""} · el permiso caduca el <strong>{fecha(c.caducaUtc)}</strong>
              </p>
            )}
            {c.ultimaSyncOkUtc && <p className="nota">Última sincronización correcta: {fechaHora(c.ultimaSyncOkUtc)}</p>}
          </div>
          <div className="exportar-botones">
            <button className={`btn ${c.estado === "CONECTADA" ? "btn-secundario" : "btn-primario"}`} disabled={ocupado || !c.configurada} onClick={conectar}>
              {c.estado === "DESCONECTADA" ? "Conectar con a3" : "Reconectar con a3"}
            </button>
          </div>
        </div>
        {!c.configurada && <p className="error" role="alert">Falta configurar la dirección de vuelta del conector (RedirectUri en fich.A3Conexion). Avisa a Sistemas.</p>}
        {c.avisoCaducidad && <p className="error" role="alert">El permiso de a3 caduca en {c.diasParaCaducar} día(s). Pulsa «Reconectar con a3» e inicia sesión con el usuario funcional de a3innuva.</p>}
        {(c.estado === "CADUCADA" || c.estado === "ERROR") && <p className="error" role="alert">La sincronización está parada. {c.ultimoError ?? ""} Pulsa «Reconectar con a3».</p>}
        <p className="nota">Inicia sesión con el <strong>usuario funcional de a3innuva</strong> (no con el tuyo). El permiso dura 30 días; la app avisa 7 días antes.</p>
      </div>

      <div className="equipo-kpis">
        <div className="kpi"><strong>{e.usuariosA3}</strong><span>Usuarios creados desde a3</span></div>
        <button className={`kpi kpi-boton ${totalPend ? "kpi-alerta" : ""}`} onClick={() => irA("pendientes")}><strong>{totalPend}</strong><span>Pendientes de revisar</span></button>
        <button className={`kpi kpi-boton ${e.centrosA3.sinServicio ? "kpi-alerta" : ""}`} onClick={() => irA("centros")}><strong>{e.centrosA3.sinServicio} / {e.centrosA3.total}</strong><span>Centros a3 sin servicio</span></button>
        <button className={`kpi kpi-boton ${e.centrosEstructura ? "" : "kpi-alerta"}`} onClick={() => irA("centros")}><strong>{e.centrosEstructura}</strong><span>Centros OH (estructura)</span></button>
      </div>

      <div className="tarjeta">
        <div className="titulo-acciones">
          <div>
            <h3>Sincronización</h3>
            <p className="nota">Cada noche se traen los cambios; los domingos, todo. «Completa» vuelve a leer todos los trabajadores y sus emails (unas 22.000 llamadas, varios minutos).</p>
          </div>
          <div className="exportar-botones">
            <button className="btn btn-secundario" disabled={ocupado || enMarcha || c.estado !== "CONECTADA"} onClick={() => sincronizar(true)}>Sincronización completa</button>
            <button className="btn btn-primario" disabled={ocupado || enMarcha || c.estado !== "CONECTADA"} onClick={() => sincronizar(false)}>Sincronizar ahora</button>
          </div>
        </div>
        {!e.centrosEstructura && <p className="error" role="alert">Antes de la primera sincronización marca los centros OH (Zaragoza, Madrid, Cádiz y Oviedo) en «Centros a3»: su personal se importa como Estructura.</p>}
        {e.sincronizaciones.length === 0 ? (
          <p className="nota">Todavía no hay sincronizaciones.</p>
        ) : (
          <div className="tabla-contenedor">
            <table className="tabla">
              <thead><tr><th>Fecha</th><th>Tipo</th><th>Estado</th><th>Leídos</th><th>Altas</th><th>Cambios</th><th>Bajas</th><th>Pendientes</th><th>Llamadas</th></tr></thead>
              <tbody>
                {e.sincronizaciones.map((s) => (
                  <tr key={s.id}>
                    <td>{fechaHora(s.inicioUtc ?? s.solicitadaUtc)}{s.finUtc && s.inicioUtc ? <div className="nota">{Math.max(1, Math.round((Date.parse(s.finUtc) - Date.parse(s.inicioUtc)) / 60000))} min</div> : null}</td>
                    <td>{s.tipo === "NOCTURNA" ? "Nocturna" : "Manual"}{s.completa ? " (completa)" : ""}{s.solicitadaPor && <div className="nota">{s.solicitadaPor}</div>}</td>
                    <td><span className={`chip a3-sync-${s.estado.toLowerCase()}`}>{ETIQUETA_SYNC[s.estado]}</span>{s.error && <div className="nota a3-error-sync">{s.error}</div>}</td>
                    <td>{s.empleadosLeidos}</td><td>{s.creados}</td><td>{s.actualizados}</td><td>{s.desactivados}</td><td>{s.pendientes}</td><td>{s.llamadas}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

/* ---------- Pendientes ---------- */
function Pendientes({ onAsignar }: { onAsignar: (clave: string) => void }) {
  const [estado, setEstado] = useState<"abiertos" | "resueltos">("abiertos");
  const [tipo, setTipo] = useState<"" | TipoPendienteA3>("");
  const [lista, setLista] = useState<PendienteA3[] | null>(null);
  const [msg, setMsg] = useState<Mensaje>(null);
  async function cargar() {
    setLista(null);
    try { setLista(await api.a3Pendientes(estado)); } catch (x) { setMsg({ tipo: "error", texto: err(x, "No se pudieron cargar los pendientes") }); setLista([]); }
  }
  useEffect(() => { cargar(); }, [estado]);
  async function ignorar(p: PendienteA3) {
    setMsg(null);
    try { await api.a3IgnorarPendiente(p.id); setMsg({ tipo: "exito", texto: "Pendiente ignorado: no volverá a aparecer." }); await cargar(); }
    catch (x) { setMsg({ tipo: "error", texto: err(x, "No se pudo ignorar") }); }
  }
  const visibles = (lista ?? []).filter((p) => !tipo || p.tipo === tipo);
  const cuenta = (t: TipoPendienteA3) => (lista ?? []).filter((p) => p.tipo === t).length;
  return (
    <>
      {msg && <p className={msg.tipo} role={msg.tipo === "error" ? "alert" : "status"}>{msg.texto}</p>}
      <div className="filtros">
        <label>Mostrar
          <select value={estado} onChange={(e) => setEstado(e.target.value as any)}>
            <option value="abiertos">Abiertos</option>
            <option value="resueltos">Resueltos e ignorados</option>
          </select>
        </label>
        <label>Tipo
          <select value={tipo} onChange={(e) => setTipo(e.target.value as any)}>
            <option value="">Todos ({lista?.length ?? 0})</option>
            {(Object.keys(ETIQUETA_PENDIENTE_A3) as TipoPendienteA3[]).map((t) => <option key={t} value={t}>{ETIQUETA_PENDIENTE_A3[t]} ({cuenta(t)})</option>)}
          </select>
        </label>
      </div>
      <p className="nota">Se cierran solos cuando en la siguiente sincronización ya no se dan (p. ej. al asignar el servicio o corregir el email en a3). «Ignorar» los oculta para siempre.</p>
      <div className="tarjeta tabla-contenedor">
        {!lista ? <div className="centrado-bloque"><div className="spinner" aria-label="Cargando" /></div> : visibles.length === 0 ? <p className="nota a3-vacio">No hay pendientes.</p> : (
          <table className="tabla">
            <thead><tr><th>Tipo</th><th>Detalle</th><th>Desde</th><th /></tr></thead>
            <tbody>
              {visibles.map((p) => (
                <tr key={p.id}>
                  <td><span className="chip a3-chip-pendiente">{ETIQUETA_PENDIENTE_A3[p.tipo] ?? p.tipo}</span></td>
                  <td>{p.detalle}{p.resueltoUtc && <div className="nota">{p.resolucion === "IGNORADO" ? `Ignorado por ${p.resueltoPor ?? "—"}` : "Resuelto"} el {fechaHora(p.resueltoUtc)}</div>}</td>
                  <td>{fecha(p.creadoUtc)}</td>
                  <td className="acciones-fila">
                    {!p.resueltoUtc && p.tipo === "CENTRO_SIN_SERVICIO" && <button className="btn-link" onClick={() => onAsignar(`${p.empresaA3}-${p.centroA3}`)}>Asignar servicio</button>}
                    {!p.resueltoUtc && <button className="btn-link" onClick={() => ignorar(p)}>Ignorar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/* ---------- Centros a3 ↔ servicios y centros OH ---------- */
function Centros({ filtroInicial }: { filtroInicial: string }) {
  const [centros, setCentros] = useState<CentroA3[] | null>(null);
  const [servicios, setServicios] = useState<ServicioA3[]>([]);
  const [msg, setMsg] = useState<Mensaje>(null);
  const [empresa, setEmpresa] = useState(filtroInicial ? filtroInicial.split("-")[0] : "");
  const [soloSin, setSoloSin] = useState(true);
  const [texto, setTexto] = useState("");
  const [nuevoOh, setNuevoOh] = useState("");

  async function cargar() {
    try {
      const [c, s] = await Promise.all([api.a3Centros(), api.a3Servicios()]);
      setCentros(c); setServicios(s);
    } catch (x) { setMsg({ tipo: "error", texto: err(x, "No se pudieron cargar los centros") }); setCentros([]); }
  }
  useEffect(() => { cargar(); }, []);

  async function asignar(c: CentroA3, valor: string) {
    setMsg(null);
    try {
      await api.a3AsignarCentro(c.empresaA3, c.centroA3, valor ? Number(valor) : null);
      setMsg({ tipo: "exito", texto: `Centro ${c.centroA3} «${c.nombre}» ${valor ? "asignado" : "sin servicio"}. Se aplicará en la próxima sincronización.` });
      await cargar();
    } catch (x) { setMsg({ tipo: "error", texto: err(x, "No se pudo guardar") }); }
  }
  async function marcarOh(id: number, v: boolean) {
    setMsg(null);
    try { await api.a3MarcarEstructura(id, v); setNuevoOh(""); await cargar(); }
    catch (x) { setMsg({ tipo: "error", texto: err(x, "No se pudo guardar") }); }
  }

  const empresas = useMemo(() => [...new Map((centros ?? []).map((c) => [c.empresaA3, c.empresa])).entries()], [centros]);
  const t = texto.trim().toLowerCase();
  const visibles = (centros ?? []).filter((c) =>
    (!empresa || String(c.empresaA3) === empresa) &&
    (!soloSin || (!c.centroId && c.activo)) &&
    (!t || `${c.centroA3} ${c.nombre} ${c.ciudad ?? ""} ${c.servicio ?? ""} ${c.codigoServicio ?? ""}`.toLowerCase().includes(t))
  );
  const oh = servicios.filter((s) => s.esEstructura);
  const etiquetaServicio = (s: ServicioA3) => `${s.codigoServicio ? `${s.codigoServicio} · ` : ""}${s.nombre} (${s.empresa})`;

  return (
    <>
      {msg && <p className={msg.tipo} role={msg.tipo === "error" ? "alert" : "status"}>{msg.texto}</p>}
      <div className="tarjeta">
        <h3>Centros de estructura (OH)</h3>
        <p className="nota">El personal de los centros a3 asignados a estos servicios se importa como <strong>Estructura</strong>; el resto, como Delegación. El departamento se asigna después en la app.</p>
        <div className="a3-oh">
          {oh.length === 0 && <span className="nota">Ninguno marcado.</span>}
          {oh.map((s) => (
            <span key={s.id} className="chip chip-activa">{etiquetaServicio(s)} <button className="btn-link" aria-label={`Quitar ${s.nombre}`} onClick={() => marcarOh(s.id, false)}>Quitar</button></span>
          ))}
        </div>
        <div className="filtros">
          <label className="a3-select-largo">Marcar como OH
            <select value={nuevoOh} onChange={(e) => setNuevoOh(e.target.value)}>
              <option value="">Selecciona un servicio…</option>
              {servicios.filter((s) => !s.esEstructura).map((s) => <option key={s.id} value={s.id}>{etiquetaServicio(s)}</option>)}
            </select>
          </label>
          <button className="btn btn-secundario" disabled={!nuevoOh} onClick={() => marcarOh(Number(nuevoOh), true)}>Marcar</button>
        </div>
      </div>

      <div className="tarjeta">
        <h3>Centros de a3 → servicio de la app</h3>
        <p className="nota">Cada centro de a3 con personal debe tener su servicio (código de servicio). Varios centros de a3 pueden ir al mismo servicio. Los trabajadores de un centro sin servicio no se importan.</p>
        <div className="filtros">
          <label>Empresa
            <select value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
              <option value="">Todas</option>
              {empresas.map(([k, n]) => <option key={k} value={k}>{k} · {n}</option>)}
            </select>
          </label>
          <label className="a3-buscar">Buscar<input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Código, nombre, ciudad o servicio" /></label>
          <label className="check"><input type="checkbox" checked={soloSin} onChange={(e) => setSoloSin(e.target.checked)} /> Solo sin servicio</label>
        </div>
        <div className="tabla-contenedor">
          {!centros ? <div className="centrado-bloque"><div className="spinner" aria-label="Cargando" /></div> : visibles.length === 0 ? <p className="nota a3-vacio">No hay centros con ese filtro.</p> : (
            <table className="tabla">
              <thead><tr><th>Empresa</th><th>Centro a3</th><th>Ubicación</th><th>En alta</th><th>Servicio de la app</th></tr></thead>
              <tbody>
                {visibles.map((c) => (
                  <tr key={`${c.empresaA3}-${c.centroA3}`} className={c.activo ? "" : "inactivo"}>
                    <td>{c.empresaA3}</td>
                    <td><strong>{c.centroA3}</strong> · {c.nombre}{!c.activo && <div className="nota">Ya no existe en a3</div>}</td>
                    <td>{[c.direccion, [c.codigoPostal, c.ciudad].filter(Boolean).join(" ")].filter(Boolean).join(" · ") || "—"}</td>
                    <td>{c.enAlta}</td>
                    <td>
                      <select aria-label={`Servicio del centro ${c.centroA3}`} value={c.centroId ?? ""} onChange={(e) => asignar(c, e.target.value)}>
                        <option value="">— Sin servicio —</option>
                        {servicios.map((s) => <option key={s.id} value={s.id}>{etiquetaServicio(s)}{s.esEstructura ? " · OH" : ""}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}

/* ---------- Empresas a3 ---------- */
function Empresas() {
  const [lista, setLista] = useState<EmpresaA3[] | null>(null);
  const [app, setApp] = useState<EmpresaGestion[]>([]);
  const [msg, setMsg] = useState<Mensaje>(null);
  async function cargar() {
    try {
      const [a, b] = await Promise.all([api.a3Empresas(), api.empresasGestion()]);
      setLista(a); setApp(b);
    } catch (x) { setMsg({ tipo: "error", texto: err(x, "No se pudieron cargar las empresas") }); setLista([]); }
  }
  useEffect(() => { cargar(); }, []);
  async function guardar(e: EmpresaA3, cambios: Partial<{ importar: boolean; empresaId: number | null }>) {
    setMsg(null);
    try {
      await api.a3EditarEmpresa(e.codigoA3, { importar: cambios.importar ?? e.importar, empresaId: cambios.empresaId !== undefined ? cambios.empresaId : e.empresaId });
      setMsg({ tipo: "exito", texto: `Empresa a3 ${e.codigoA3} guardada.` });
      await cargar();
    } catch (x) { setMsg({ tipo: "error", texto: err(x, "No se pudo guardar") }); }
  }
  return (
    <>
      {msg && <p className={msg.tipo} role={msg.tipo === "error" ? "alert" : "status"}>{msg.texto}</p>}
      <p className="nota">Las empresas de a3 que se importan y no están enlazadas se crean en la app en la siguiente sincronización. Las copias de prueba de a3 no se importan.</p>
      <div className="tarjeta tabla-contenedor">
        {!lista ? <div className="centrado-bloque"><div className="spinner" aria-label="Cargando" /></div> : lista.length === 0 ? <p className="nota a3-vacio">Aún no se ha leído ninguna empresa de a3.</p> : (
          <table className="tabla">
            <thead><tr><th>Código a3</th><th>Empresa en a3</th><th>CIF</th><th>En alta</th><th>Centros</th><th>Importar</th><th>Empresa en la app</th></tr></thead>
            <tbody>
              {lista.map((e) => (
                <tr key={e.codigoA3} className={e.importar ? "" : "inactivo"}>
                  <td>{e.codigoA3}</td>
                  <td><strong>{e.nombre}</strong></td>
                  <td>{e.cif ?? "—"}</td>
                  <td>{e.enAlta}</td>
                  <td>{e.centros}</td>
                  <td><input type="checkbox" aria-label={`Importar ${e.nombre}`} checked={e.importar} onChange={(x) => guardar(e, { importar: x.target.checked })} /></td>
                  <td>
                    <select aria-label={`Empresa de la app para ${e.nombre}`} value={e.empresaId ?? ""} onChange={(x) => guardar(e, { empresaId: x.target.value ? Number(x.target.value) : null })}>
                      <option value="">{e.importar ? "(se creará al sincronizar)" : "—"}</option>
                      {app.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

/* ---------- Organigrama ---------- */
function Organigrama() {
  const [nodos, setNodos] = useState<NodoOrganigramaA3[] | null>(null);
  const [empresa, setEmpresa] = useState("");
  const [msg, setMsg] = useState<Mensaje>(null);
  useEffect(() => {
    api.a3Organigrama().then(setNodos).catch((x) => { setMsg({ tipo: "error", texto: err(x, "No se pudo cargar el organigrama") }); setNodos([]); });
  }, []);
  const empresas = useMemo(() => [...new Map((nodos ?? []).map((n) => [n.empresaA3, n.empresa])).entries()], [nodos]);
  const filas = useMemo(() => {
    const lista = (nodos ?? []).filter((n) => !empresa || String(n.empresaA3) === empresa);
    const hijos = new Map<string | null, NodoOrganigramaA3[]>();
    const ids = new Set(lista.map((n) => n.id));
    for (const n of lista) {
      const p = n.padreId && ids.has(n.padreId) ? n.padreId : null;
      if (!hijos.has(p)) hijos.set(p, []);
      hijos.get(p)!.push(n);
    }
    const r: { n: NodoOrganigramaA3; nivel: number }[] = [];
    const visitar = (p: string | null, nivel: number) => { for (const n of hijos.get(p) ?? []) { r.push({ n, nivel }); visitar(n.id, nivel + 1); } };
    visitar(null, 0);
    return r;
  }, [nodos, empresa]);
  return (
    <>
      {msg && <p className="error" role="alert">{msg.texto}</p>}
      <div className="filtros">
        <label>Empresa
          <select value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
            <option value="">Todas</option>
            {empresas.map(([k, n]) => <option key={k} value={k}>{k} · {n}</option>)}
          </select>
        </label>
      </div>
      <p className="nota">Organigrama y responsables tal como están en a3 (solo lectura). Si el responsable tiene usuario en la app, aparece enlazado por su DNI.</p>
      <div className="tarjeta tabla-contenedor">
        {!nodos ? <div className="centrado-bloque"><div className="spinner" aria-label="Cargando" /></div> : filas.length === 0 ? <p className="nota a3-vacio">No hay organigrama en a3 o aún no se ha sincronizado.</p> : (
          <table className="tabla">
            <thead><tr><th>Unidad</th><th>Tipo</th><th>Responsable en a3</th><th>Usuario en la app</th></tr></thead>
            <tbody>
              {filas.map(({ n, nivel }) => (
                <tr key={n.id} className={n.fechaBaja ? "inactivo" : ""}>
                  <td><span className="a3-org" style={{ paddingLeft: `${nivel * 18}px` }}>{nivel > 0 && "└ "}<strong>{n.nombre ?? n.codigo ?? "—"}</strong>{n.codigo && n.nombre ? <span className="nota"> · {n.codigo}</span> : null}</span>{!empresa && nivel === 0 && <div className="nota">{n.empresaA3} · {n.empresa}</div>}</td>
                  <td>{n.tipo ?? "—"}</td>
                  <td>{n.responsable ?? "—"}</td>
                  <td>{n.usuario ?? <span className="nota">{n.responsable ? "Sin usuario" : "—"}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
