import { useEffect, useMemo, useState } from "react";
import {
  api, ApiError, DetalleEmpleado, EmpleadoEquipo, IncidenciaEquipo, MiCadena,
  duracion, fechaLarga, hora, hoyLocal, ETIQUETA_TIPO, ETIQUETA_PERFIL,
} from "../api";
import { useSesion } from "../sesion";
import Modal from "../components/Modal";
import ChipFichaje from "../components/ChipFichaje";

/* "Mi equipo": fichajes de las personas que aprueba el usuario (sus directos y, durante una suplencia,
   los del titular) o de todos (RRHH y ADMIN). Incluye la gestión de la propia suplencia. */

type Modo = "mes" | "rango";
type Formato = "pdf" | "xlsx";
const MAX_DIAS = 92;

const mesActual = () => hoyLocal().slice(0, 7);
const ultimoDia = (yyyyMm: string) => {
  const [y, m] = yyyyMm.split("-").map(Number);
  return `${yyyyMm}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};
const dias = (a: string, b: string) => Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / 86400000);
const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;
/** Centro (delegación) o departamento (estructura) de una persona. */
const grupoDe = (c: { codigoServicio: string | null; centro?: string | null; departamento?: string | null }) =>
  c.centro ? `${c.codigoServicio ? `${c.codigoServicio} · ` : ""}${c.centro}` : c.departamento ? `Dpto. ${c.departamento}` : "Sin asignar";

async function descargarInformes(ids: number[], desde: string, hasta: string, formato: Formato) {
  const { informes } = await api.equipoExportar(ids, desde, hasta, formato);
  if (formato === "pdf") await (await import("../exportar/pdf")).exportarPdf(informes);
  else await (await import("../exportar/excel")).exportarExcel(informes);
}

const IconoPdf = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M9 13h6M9 17h4" /></svg>
);
const IconoExcel = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Zm0 5h16M4 15h16M10 10v11" /></svg>
);

export default function MiEquipo() {
  const { usuario } = useSesion();
  const [grupo, setGrupo] = useState("");
  const [modo, setModo] = useState<Modo>("mes");
  const [mes, setMes] = useState(mesActual());
  const [desde, setDesde] = useState(`${mesActual()}-01`);
  const [hasta, setHasta] = useState(hoyLocal());
  const [periodo, setPeriodo] = useState<[string, string]>([`${mesActual()}-01`, hoyLocal()]);
  const [datos, setDatos] = useState<{ empleados: EmpleadoEquipo[]; incidencias: IncidenciaEquipo[] } | null>(null);
  const [pestana, setPestana] = useState<"empleados" | "incidencias">("empleados");
  const [filtro, setFiltro] = useState("");
  const [verInactivos, setVerInactivos] = useState(false);
  const [seleccion, setSeleccion] = useState<Set<number>>(new Set());
  const [generando, setGenerando] = useState<"" | Formato>("");
  const [error, setError] = useState("");
  const [detalle, setDetalle] = useState<EmpleadoEquipo | { id: number; nombre: string; apellidos: string } | null>(null);

  function calcularPeriodo(): [string, string] | string {
    const hoy = hoyLocal();
    if (modo === "mes") {
      if (!/^\d{4}-\d{2}$/.test(mes)) return "Selecciona un mes.";
      const fin = ultimoDia(mes);
      return [`${mes}-01`, fin > hoy ? hoy : fin];
    }
    if (!desde || !hasta || desde > hasta) return "Revisa las fechas del periodo.";
    if (dias(desde, hasta) > MAX_DIAS) return `Para consultar el equipo el periodo máximo es de ${MAX_DIAS} días.`;
    return [desde, hasta];
  }

  async function cargar(p: [string, string] = periodo) {
    setError("");
    setDatos(null);
    try {
      const r = await api.equipoResumen(p[0], p[1]);
      setDatos({ empleados: r.empleados, incidencias: r.incidencias });
      setSeleccion(new Set());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los datos del equipo");
      setDatos({ empleados: [], incidencias: [] });
    }
  }

  useEffect(() => {
    cargar();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function consultar(e: React.FormEvent) {
    e.preventDefault();
    const p = calcularPeriodo();
    if (typeof p === "string") return setError(p);
    setPeriodo(p);
    cargar(p);
  }

  const grupos = useMemo(() => [...new Set((datos?.empleados ?? []).map(grupoDe))].sort((a, b) => a.localeCompare(b, "es")), [datos]);

  const empleados = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    return (datos?.empleados ?? []).filter(
      (e) => (verInactivos || e.activo) && (!grupo || grupoDe(e) === grupo) && (!q || `${e.nombre} ${e.apellidos} ${e.email} ${grupoDe(e)}`.toLowerCase().includes(q))
    );
  }, [datos, filtro, verInactivos, grupo]);

  const incidencias = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    return (datos?.incidencias ?? []).filter((i) => (!grupo || grupoDe(i) === grupo) && (!q || `${i.nombre} ${i.apellidos} ${grupoDe(i)}`.toLowerCase().includes(q)));
  }, [datos, filtro, grupo]);

  const todosMarcados = empleados.length > 0 && empleados.every((e) => seleccion.has(e.id));
  function marcarTodos() {
    const s = new Set(seleccion);
    if (todosMarcados) empleados.forEach((e) => s.delete(e.id));
    else empleados.forEach((e) => s.add(e.id));
    setSeleccion(s);
  }
  function marcar(id: number) {
    const s = new Set(seleccion);
    s.has(id) ? s.delete(id) : s.add(id);
    setSeleccion(s);
  }

  async function exportar(formato: Formato) {
    setError("");
    setGenerando(formato);
    try {
      await descargarInformes([...seleccion], periodo[0], periodo[1], formato);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo generar el archivo. Inténtalo de nuevo.");
    } finally {
      setGenerando("");
    }
  }

  const totalHoras = empleados.reduce((s, e) => s + e.minutosTrabajados, 0);
  const trabajandoAhora = empleados.filter((e) => e.enCurso).length;

  return (
    <section className="equipo">
      <div className="tarjeta">
        <div className="titulo-acciones">
          <div>
            <h2>Mi equipo</h2>
            <p className="sub">{usuario?.rol === "ADMIN" ? "Fichajes de todos los empleados del grupo." : usuario?.rol === "RRHH" ? "Fichajes de las personas que supervisas." : "Fichajes de las personas que apruebas."}</p>
          </div>
        </div>

        {(
          <form className="equipo-filtros" onSubmit={consultar}>
            <label>
              Centro / departamento
              <select value={grupo} onChange={(e) => setGrupo(e.target.value)}>
                <option value="">Todos ({grupos.length})</option>
                {grupos.map((g) => <option key={g} value={g}>{g}</option>)}
              </select>
            </label>
            <div className="equipo-periodo">
              <div className="segmentado" role="tablist" aria-label="Tipo de periodo">
                <button type="button" role="tab" aria-selected={modo === "mes"} className={modo === "mes" ? "activo" : ""} onClick={() => setModo("mes")}>Mes</button>
                <button type="button" role="tab" aria-selected={modo === "rango"} className={modo === "rango" ? "activo" : ""} onClick={() => setModo("rango")}>Rango de fechas</button>
              </div>
              {modo === "mes" ? (
                <label>Mes<input type="month" value={mes} max={mesActual()} onChange={(e) => setMes(e.target.value)} /></label>
              ) : (
                <div className="fila-fechas">
                  <label>Desde<input type="date" value={desde} max={hasta || hoyLocal()} onChange={(e) => setDesde(e.target.value)} /></label>
                  <label>Hasta<input type="date" value={hasta} min={desde} max={hoyLocal()} onChange={(e) => setHasta(e.target.value)} /></label>
                </div>
              )}
            </div>
            <button className="btn btn-primario">Consultar</button>
          </form>
        )}
        {error && <p className="error" role="alert">{error}</p>}
      </div>

      {datos && (
        <div className="equipo-kpis">
          <div className="kpi"><strong>{empleados.length}</strong><span>Empleados</span></div>
          <div className="kpi"><strong>{duracion(totalHoras)}</strong><span>Horas trabajadas</span></div>
          <div className="kpi"><strong>{trabajandoAhora}</strong><span>Trabajando ahora</span></div>
          <div className={`kpi${incidencias.length ? " kpi-alerta" : ""}`}><strong>{incidencias.length}</strong><span>Incidencias</span></div>
        </div>
      )}

      <div className="tarjeta tabla-contenedor">
        <div className="equipo-barra">
          <div className="pestanas" role="tablist">
            <button role="tab" aria-selected={pestana === "empleados"} className={pestana === "empleados" ? "activo" : ""} onClick={() => setPestana("empleados")}>
              Empleados <span className="contador">{empleados.length}</span>
            </button>
            <button role="tab" aria-selected={pestana === "incidencias"} className={pestana === "incidencias" ? "activo" : ""} onClick={() => setPestana("incidencias")}>
              Incidencias <span className={`contador${incidencias.length ? " contador-alerta" : ""}`}>{incidencias.length}</span>
            </button>
          </div>
          <input className="buscador" placeholder="Buscar empleado o centro…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
        </div>
        <p className="nota equipo-periodo-texto">Periodo: {fechaCorta(periodo[0])} – {fechaCorta(periodo[1])}{grupo ? ` · ${grupo}` : ""}</p>

        {!datos ? (
          <div className="centrado-bloque"><div className="spinner" aria-label="Cargando" /></div>
        ) : pestana === "empleados" ? (
          <>
            {seleccion.size > 0 && (
              <div className="seleccion-barra" role="region" aria-label="Exportar selección">
                <span><strong>{seleccion.size}</strong> seleccionado(s) · {fechaCorta(periodo[0])} – {fechaCorta(periodo[1])}</span>
                <div className="exportar-botones">
                  <button className="btn btn-exportar" onClick={() => exportar("pdf")} disabled={!!generando}><IconoPdf />{generando === "pdf" ? "Generando…" : "Descargar PDF"}</button>
                  <button className="btn btn-exportar" onClick={() => exportar("xlsx")} disabled={!!generando}><IconoExcel />{generando === "xlsx" ? "Generando…" : "Descargar Excel"}</button>
                  <button className="btn-link" onClick={() => setSeleccion(new Set())}>Quitar selección</button>
                </div>
              </div>
            )}
            {empleados.length === 0 ? (
              <p className="nota vacio">No hay empleados que mostrar.</p>
            ) : (
              <table className="tabla">
                <thead>
                  <tr>
                    <th className="col-check"><input type="checkbox" aria-label="Seleccionar todos" checked={todosMarcados} onChange={marcarTodos} /></th>
                    <th>Empleado/a</th><th>Centro / departamento</th><th>Trabajado</th><th>Justificado</th><th>Días</th><th>Incidencias</th><th>Estado</th><th />
                  </tr>
                </thead>
                <tbody>
                  {empleados.map((e) => (
                    <tr key={e.id} className={`${e.activo ? "" : "inactivo"}${seleccion.has(e.id) ? " marcada" : ""}`}>
                      <td className="col-check"><input type="checkbox" aria-label={`Seleccionar a ${e.nombre} ${e.apellidos}`} checked={seleccion.has(e.id)} onChange={() => marcar(e.id)} /></td>
                      <td><strong>{e.apellidos}, {e.nombre}</strong><div className="nota">{e.tipoPerfil ? ETIQUETA_PERFIL[e.tipoPerfil] : "Sin perfil"}</div></td>
                      <td>{grupoDe(e)}</td>
                      <td className="nowrap"><strong>{duracion(e.minutosTrabajados)}</strong></td>
                      <td className="nowrap">{e.minutosJustificados ? duracion(e.minutosJustificados) : "—"}</td>
                      <td>{e.diasTrabajados}</td>
                      <td>{e.diasConIncidencia ? <span className="chip chip-salida">{e.diasConIncidencia} día(s)</span> : <span className="nota">—</span>}</td>
                      <td>
                        {!e.activo ? <span className="chip">Inactivo</span> : e.enCurso ? <span className="chip chip-entrada">Trabajando</span> : <span className="nota">—</span>}
                      </td>
                      <td className="acciones-fila"><button className="btn-link" onClick={() => setDetalle(e)}>Ver fichajes</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <div className="equipo-pie">
              <label className="check"><input type="checkbox" checked={verInactivos} onChange={(e) => setVerInactivos(e.target.checked)} /> Mostrar usuarios inactivos</label>
              <span className="nota">Marca empleados para exportar su registro de jornada del periodo (máx. 100 por archivo).</span>
            </div>
          </>
        ) : incidencias.length === 0 ? (
          <p className="nota vacio">Sin incidencias en el periodo.</p>
        ) : (
          <table className="tabla">
            <thead><tr><th>Fecha</th><th>Empleado/a</th><th>Centro / departamento</th><th>Incidencia</th><th /></tr></thead>
            <tbody>
              {incidencias.map((i, n) => (
                <tr key={n}>
                  <td className="nowrap capitalizar">{fechaLarga(i.fecha)}</td>
                  <td><strong>{i.apellidos}, {i.nombre}</strong></td>
                  <td>{grupoDe(i)}</td>
                  <td><span className={`chip ${i.tipo === "SIN_CERRAR" ? "chip-salida" : "chip-pausa_inicio"}`}>{i.detalle}</span></td>
                  <td className="acciones-fila"><button className="btn-link" onClick={() => setDetalle({ id: i.empleadoId, nombre: i.nombre, apellidos: i.apellidos })}>Ver fichajes</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <MiSuplencia />

      {detalle && <DetalleModal empleado={detalle} periodo={periodo} onCerrar={() => setDetalle(null)} />}
    </section>
  );
}

const TEXTO_UBI: Record<string, string> = {
  OK: "Con ubicación",
  DENEGADA: "Sin ubicación (permiso denegado)",
  TIMEOUT: "Sin ubicación (tiempo agotado)",
  NO_SOPORTADA: "Sin ubicación (navegador no compatible)",
  NO_DISPONIBLE: "Sin ubicación (no disponible)",
  SIN_DATO: "Sin dato de ubicación",
  CORRECCION: "Añadido por corrección aprobada",
};

function DetalleModal({ empleado, periodo, onCerrar }: { empleado: { id: number; nombre: string; apellidos: string }; periodo: [string, string]; onCerrar: () => void }) {
  const [d, setD] = useState<DetalleEmpleado | null>(null);
  const [error, setError] = useState("");
  const [generando, setGenerando] = useState<"" | Formato>("");

  useEffect(() => {
    api.equipoDetalle(empleado.id, periodo[0], periodo[1]).then(setD).catch((err) => setError(err instanceof ApiError ? err.message : "No se pudo cargar el detalle"));
  }, [empleado.id, periodo]);

  async function exportar(formato: Formato) {
    setError("");
    setGenerando(formato);
    try {
      await descargarInformes([empleado.id], periodo[0], periodo[1], formato);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo generar el archivo");
    } finally {
      setGenerando("");
    }
  }

  const total = (d?.dias ?? []).reduce((s, x) => s + x.minutosTrabajados, 0);
  const justif = new Map((d?.justificados ?? []).map((j) => [j.fecha, j]));
  const totalJustif = (d?.justificados ?? []).reduce((s, j) => s + j.minutos, 0);
  // Una fila por día con fichajes o con horas justificadas
  const filas = d
    ? [...new Set([...d.dias.map((x) => x.fecha), ...justif.keys()])].sort((a, b) => (a < b ? 1 : -1)).map((fecha) => ({ fecha, x: d.dias.find((y) => y.fecha === fecha) ?? null, j: justif.get(fecha) ?? null }))
    : [];
  const hoy = hoyLocal();

  return (
    <Modal titulo={`${empleado.nombre} ${empleado.apellidos}`} onCerrar={onCerrar} ancho>
      <div className="detalle-cabecera">
        <div>
          {d && <p className="nota">{grupoDe(d.empleado)} · {d.empleado.email}</p>}
          <p className="nota">Periodo: {fechaCorta(periodo[0])} – {fechaCorta(periodo[1])}{d ? <> · Total trabajado: <strong>{duracion(total)}</strong>{totalJustif > 0 && <> · Justificado: <strong>{duracion(totalJustif)}</strong></>}</> : null}</p>
        </div>
        <div className="exportar-botones">
          <button className="btn btn-exportar" onClick={() => exportar("pdf")} disabled={!!generando}><IconoPdf />{generando === "pdf" ? "Generando…" : "PDF"}</button>
          <button className="btn btn-exportar" onClick={() => exportar("xlsx")} disabled={!!generando}><IconoExcel />{generando === "xlsx" ? "Generando…" : "Excel"}</button>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {!d && !error ? (
        <div className="centrado-bloque"><div className="spinner" aria-label="Cargando" /></div>
      ) : d && filas.length === 0 ? (
        <p className="nota vacio">Sin fichajes en el periodo.</p>
      ) : d ? (
        <div className="detalle-tabla">
          <table className="tabla">
            <thead><tr><th>Día</th><th>Fichajes</th><th>Pausa</th><th>Trabajado</th><th>Justificado</th></tr></thead>
            <tbody>
              {filas.map(({ fecha, x, j }) => (
                <tr key={fecha}>
                  <td className="capitalizar nowrap">{fechaLarga(fecha)}</td>
                  <td>
                    <div className="chips">
                      {j && <span className="chip chip-ausencia">{j.motivos.join(", ")}</span>}
                      {x?.fichajes.map((f, i) => (
                        <ChipFichaje
                          key={i}
                          f={f}
                          extraClase={f.ubicacion === "OK" || f.ubicacion === "CORRECCION" ? "" : "chip-sin-ubi"}
                          sufijo={f.ubicacion === "OK" || f.ubicacion === "CORRECCION" ? "" : " ⚠"}
                          titulo={`${ETIQUETA_TIPO[f.tipo]} · ${TEXTO_UBI[f.ubicacion] ?? f.ubicacion}`}
                        />
                      ))}
                    </div>
                  </td>
                  <td className="nowrap">{x ? duracion(x.minutosPausa) : "—"}</td>
                  <td className="nowrap">
                    {x ? <strong>{duracion(x.minutosTrabajados)}</strong> : "—"}
                    {x?.abierto && <div className={x.fecha === hoy ? "nota" : "error-texto"}>{x.fecha === hoy ? "En curso" : "Sin cerrar"}</div>}
                  </td>
                  <td className="nowrap">{j ? duracion(j.minutos) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="nota">⚠ = fichaje sin ubicación (pasa el ratón por encima para ver el motivo).</p>
        </div>
      ) : null}
    </Modal>
  );
}

/* ---------- Mi aprobador y mi suplente ---------- */
function MiSuplencia() {
  const { usuario } = useSesion();
  const [c, setC] = useState<MiCadena | null>(null);
  const [directorio, setDirectorio] = useState<{ id: number; nombre: string }[]>([]);
  const [abierta, setAbierta] = useState(false);
  const [f, setF] = useState({ suplenteId: "", desde: hoyLocal(), hasta: hoyLocal() });
  const [msg, setMsg] = useState<{ tipo: "exito" | "error"; texto: string } | null>(null);
  const [guardando, setGuardando] = useState(false);

  const cargar = () => api.miCadena().then(setC).catch(() => setC(null));
  useEffect(() => { cargar(); }, []);

  async function abrir() {
    setMsg(null);
    setAbierta(true);
    if (!directorio.length) setDirectorio(await api.candidatosSuplente());
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (!f.suplenteId) return setMsg({ tipo: "error", texto: "Elige a tu suplente." });
    if (f.desde > f.hasta) return setMsg({ tipo: "error", texto: "La fecha de fin no puede ser anterior a la de inicio." });
    setGuardando(true);
    try {
      await api.crearSuplencia({ suplenteId: Number(f.suplenteId), desde: f.desde, hasta: f.hasta });
      setAbierta(false);
      setMsg({ tipo: "exito", texto: "Suplencia registrada. Durante esas fechas tu suplente aprobará y verá a tu equipo." });
      await cargar();
    } catch (err) {
      setMsg({ tipo: "error", texto: err instanceof ApiError ? err.message : "No se pudo registrar la suplencia" });
    } finally {
      setGuardando(false);
    }
  }

  async function anular(id: number) {
    setMsg(null);
    try {
      await api.anularSuplencia(id);
      setMsg({ tipo: "exito", texto: "Suplencia anulada." });
      await cargar();
    } catch (err) {
      setMsg({ tipo: "error", texto: err instanceof ApiError ? err.message : "No se pudo anular" });
    }
  }

  if (!c) return null;
  const hoy = hoyLocal();
  const propias = c.suplencias.filter((s) => s.titularId === usuario?.usuarioId);
  const supliendo = c.suplencias.filter((s) => s.suplenteId === usuario?.usuarioId);

  return (
    <div className="tarjeta suplencia">
      <div className="titulo-acciones">
        <div>
          <h3>Aprobación y suplencias</h3>
          <p className="nota">
            Tu aprobador: <strong>{c.aprobador ?? "ninguno"}</strong>
            {c.suplenteDeMiAprobador && <> · hoy le sustituye <strong>{c.suplenteDeMiAprobador}</strong></>}
          </p>
        </div>
        {c.esAprobador && !abierta && <button className="btn btn-secundario" onClick={abrir}>+ Designar suplente</button>}
      </div>
      {msg && <p className={msg.tipo} role="status">{msg.texto}</p>}
      {abierta && (
        <form className="equipo-filtros" onSubmit={guardar}>
          <label>
            Suplente
            <select value={f.suplenteId} onChange={(e) => setF({ ...f, suplenteId: e.target.value })} required>
              <option value="">Selecciona…</option>
              {directorio.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
            </select>
            <span className="nota">Tu responsable o, en estructura, un compañero de tu departamento.</span>
          </label>
          <div className="fila-fechas">
            <label>Desde<input type="date" value={f.desde} min={hoy} onChange={(e) => setF({ ...f, desde: e.target.value })} required /></label>
            <label>Hasta<input type="date" value={f.hasta} min={f.desde} onChange={(e) => setF({ ...f, hasta: e.target.value })} required /></label>
          </div>
          <div className="acciones-form">
            <button className="btn btn-primario" disabled={guardando}>{guardando ? "Guardando…" : "Guardar"}</button>
            <button type="button" className="btn btn-secundario" onClick={() => setAbierta(false)}>Cancelar</button>
          </div>
        </form>
      )}
      {propias.length > 0 && (
        <ul className="lista-suplencias">
          {propias.map((s) => (
            <li key={s.id}>
              <span>Te sustituye <strong>{s.suplente}</strong> del {fechaCorta(s.desde)} al {fechaCorta(s.hasta)}{s.desde <= hoy ? <span className="chip chip-entrada">En curso</span> : null}</span>
              <button className="btn-link" onClick={() => anular(s.id)}>Anular</button>
            </li>
          ))}
        </ul>
      )}
      {supliendo.length > 0 && (
        <ul className="lista-suplencias">
          {supliendo.map((s) => (
            <li key={s.id}><span>Sustituyes a <strong>{s.titular}</strong> del {fechaCorta(s.desde)} al {fechaCorta(s.hasta)}{s.desde <= hoy ? <span className="chip chip-entrada">En curso</span> : null}</span></li>
          ))}
        </ul>
      )}
      {!c.esAprobador && !supliendo.length && <p className="nota">No apruebas a nadie, así que no necesitas suplente.</p>}
    </div>
  );
}
