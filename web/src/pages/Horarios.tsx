import { useRefrescoVisible } from "../refresco";
import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  api, ApiError, EmpleadoHorario, PresenciaEmpleado, Turno, CandidatoCobertura, Estado,
  duracion, horasConSigno, hora, hoyLocal, ETIQUETA_HORARIO,
} from "../api";
import { useSesion } from "../sesion";
import Modal from "../components/Modal";
import { EditorHorario, FichaHorario } from "./EditorHorario";
import { copiarHorario, horarioParaPegar, useHorarioCopiado } from "../portapapelesHorario";

/* Horarios: presencia en vivo y avisos, horario/saldo/bolsa de cada persona, turnos de centro y propuesta de cobertura. */

type Pestana = "ahora" | "horarios" | "turnos";
const mesActual = () => hoyLocal().slice(0, 7);
const grupoDe = (c: { codigoServicio: string | null; centro: string | null; departamento: string | null }) =>
  c.centro ? `${c.codigoServicio ? `${c.codigoServicio} · ` : ""}${c.centro}` : c.departamento ? `Dpto. ${c.departamento}` : "Sin asignar";
const ESTADO: Record<Estado, string> = { TRABAJANDO: "Trabajando", EN_PAUSA: "En pausa", FUERA: "Fuera" };

export default function Horarios({ onAvisos }: { onAvisos: (n: number) => void }) {
  const { usuario } = useSesion();
  const [pestana, setPestana] = useState<Pestana>("ahora");
  const [grupo, setGrupo] = useState("");
  const [filtro, setFiltro] = useState("");
  const [cubrir, setCubrir] = useState(false);
  const [centros, setCentros] = useState<{ id: number; nombre: string }[]>([]);

  return (
    <section className="equipo">
      <div className="tarjeta horarios-tarjeta">
        <div className="titulo-acciones">
          <div>
            <h2>Horarios</h2>
            <p className="sub">{usuario?.rol === "ADMIN" ? "Presencia, horarios y bolsa de horas de todo el grupo." : usuario?.rol === "RRHH" ? "Presencia, horarios y bolsa de horas de las personas que supervisas." : "Presencia, horarios y bolsa de horas de las personas que apruebas."}</p>
          </div>
          <button className="btn btn-primario" onClick={() => setCubrir(true)} disabled={!centros.length}>Cubrir un hueco</button>
        </div>
        <div className="equipo-barra">
          <div className="pestanas" role="tablist">
            <button role="tab" aria-selected={pestana === "ahora"} className={pestana === "ahora" ? "activo" : ""} onClick={() => setPestana("ahora")}>Ahora</button>
            <button role="tab" aria-selected={pestana === "horarios"} className={pestana === "horarios" ? "activo" : ""} onClick={() => setPestana("horarios")}>Horarios y bolsa</button>
            <button role="tab" aria-selected={pestana === "turnos"} className={pestana === "turnos" ? "activo" : ""} onClick={() => setPestana("turnos")}>Turnos</button>
          </div>
          {pestana !== "turnos" && <input className="buscador" placeholder="Buscar persona…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />}
        </div>
        {pestana === "ahora" && <Ahora grupo={grupo} setGrupo={setGrupo} filtro={filtro} onAvisos={onAvisos} onCentros={setCentros} />}
        {pestana === "horarios" && <HorariosBolsa grupo={grupo} setGrupo={setGrupo} filtro={filtro} onCentros={setCentros} />}
        {pestana === "turnos" && <Turnos />}
      </div>
      {cubrir && <Cubrir centros={centros} onCerrar={() => setCubrir(false)} />}
    </section>
  );
}

function SelectorGrupo({ grupos, grupo, setGrupo }: { grupos: string[]; grupo: string; setGrupo: (g: string) => void }) {
  if (grupos.length < 2) return null;
  return (
    <label className="selector-grupo">
      Centro / departamento
      <select value={grupo} onChange={(e) => setGrupo(e.target.value)}>
        <option value="">Todos ({grupos.length})</option>
        {grupos.map((g) => <option key={g} value={g}>{g}</option>)}
      </select>
    </label>
  );
}

const centrosDe = (lista: { centroId: number | null; centro: string | null; codigoServicio: string | null }[]) => {
  const m = new Map<number, string>();
  for (const e of lista) if (e.centroId && e.centro) m.set(e.centroId, `${e.codigoServicio ? `${e.codigoServicio} · ` : ""}${e.centro}`);
  return [...m.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
};

/* ---------- Ahora: quién está, quién falta y avisos ---------- */
function Ahora({ grupo, setGrupo, filtro, onAvisos, onCentros }: {
  grupo: string; setGrupo: (g: string) => void; filtro: string; onAvisos: (n: number) => void; onCentros: (c: { id: number; nombre: string }[]) => void;
}) {
  const [lista, setLista] = useState<PresenciaEmpleado[] | null>(null);
  const [error, setError] = useState("");
  const [actualizado, setActualizado] = useState("");

  async function cargar() {
    try {
      const r = await api.equipoAhora();
      setLista(r.empleados);
      setActualizado(hora(r.ahoraUtc));
      onAvisos(r.empleados.filter((e) => e.avisos.some((a) => a.escalado)).length);
      onCentros(centrosDe(r.empleados));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar la presencia");
      setLista([]);
    }
  }
  useEffect(() => { cargar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Presencia: cada 3 min y solo con la pestaña visible
  useRefrescoVisible(cargar, 180000);

  const grupos = useMemo(() => [...new Set((lista ?? []).map(grupoDe))].sort((a, b) => a.localeCompare(b, "es")), [lista]);
  const vis = (lista ?? []).filter((e) => (!grupo || grupoDe(e) === grupo) && (!filtro || `${e.nombre} ${e.apellidos}`.toLowerCase().includes(filtro.toLowerCase())));
  const conAviso = vis.filter((e) => e.avisos.some((a) => a.tipo !== "RETRASO"));
  const resto = vis.filter((e) => !e.avisos.some((a) => a.tipo !== "RETRASO"));
  const orden = (e: PresenciaEmpleado) => (e.estado === "TRABAJANDO" ? 0 : e.estado === "EN_PAUSA" ? 1 : e.planHoy.length ? 2 : 3);

  if (!lista) return <div className="centrado-bloque"><div className="spinner" aria-label="Cargando" /></div>;
  return (
    <>
      <div className="ahora-cabecera">
        <SelectorGrupo grupos={grupos} grupo={grupo} setGrupo={setGrupo} />
        <p className="nota">Actualizado a las {actualizado} · se refresca cada minuto · {vis.filter((e) => e.estado !== "FUERA").length} dentro de {vis.length}</p>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
      {conAviso.length > 0 && (
        <div className="avisos-equipo">
          <h3>Requieren atención ({conAviso.length})</h3>
          {conAviso.map((e) => <FilaPresencia key={e.id} e={e} />)}
        </div>
      )}
      <table className="tabla">
        <thead><tr><th>Persona</th><th>Estado</th><th>Horario hoy</th><th>Avisos</th></tr></thead>
        <tbody>
          {[...resto].sort((a, b) => orden(a) - orden(b)).map((e) => (
            <tr key={e.id}>
              <td><strong>{e.nombre} {e.apellidos}</strong><div className="nota">{grupoDe(e)}</div></td>
              <td><span className={`chip chip-estado-${e.estado.toLowerCase()}`}>{ESTADO[e.estado]}</span>{e.ultimoUtc && <div className="nota">desde {hora(e.ultimoUtc)}</div>}</td>
              <td className="nowrap">{e.planHoy.length ? e.planHoy.map((t) => `${t.inicio}–${t.fin}`).join(" · ") : <span className="nota">—</span>}</td>
              <td>{e.avisos.map((a, i) => <div key={i} className="nota">{a.texto}</div>)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!vis.length && <p className="nota vacio">No hay personas que mostrar.</p>}
    </>
  );
}

function FilaPresencia({ e }: { e: PresenciaEmpleado }) {
  return (
    <div className="aviso-fila">
      <div><strong>{e.nombre} {e.apellidos}</strong> <span className="nota">{grupoDe(e)}</span></div>
      {e.avisos.filter((a) => a.tipo !== "RETRASO").map((a, i) => <div key={i} className="error-texto">{a.texto} · hace {duracion(a.minutos)}</div>)}
    </div>
  );
}

/* ---------- Horarios y bolsa ---------- */
function HorariosBolsa({ grupo, setGrupo, filtro, onCentros }: { grupo: string; setGrupo: (g: string) => void; filtro: string; onCentros: (c: { id: number; nombre: string }[]) => void }) {
  const [mes, setMes] = useState(mesActual());
  const [lista, setLista] = useState<EmpleadoHorario[] | null>(null);
  const [error, setError] = useState("");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [ficha, setFicha] = useState<EmpleadoHorario | null>(null);
  const [masivo, setMasivo] = useState(false);
  const [pegarEn, setPegarEn] = useState<{ ids: number[]; centroId: number | null; titulo: string } | null>(null);
  const [ok, setOk] = useState("");
  const copiado = useHorarioCopiado();

  async function copiar(e: EmpleadoHorario) {
    setError(""); setOk("");
    try {
      const d = await api.horarioDetalle(e.id);
      if (!d.horario) return setError("Esa persona no tiene horario que copiar.");
      copiarHorario({ origenId: e.id, nombre: `${e.nombre} ${e.apellidos}`, centroId: e.centroId, horario: d.horario });
      setOk(`Horario de ${e.nombre} ${e.apellidos} copiado. Pulsa «Pegar» en otra persona o selecciona varias.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo copiar el horario");
    }
  }

  async function cargar(m = mes) {
    setLista(null);
    setError("");
    try {
      const r = await api.horariosEquipo(m);
      setLista(r.empleados);
      onCentros(centrosDe(r.empleados));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los horarios");
      setLista([]);
    }
  }
  useEffect(() => { cargar(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const grupos = useMemo(() => [...new Set((lista ?? []).map(grupoDe))].sort((a, b) => a.localeCompare(b, "es")), [lista]);
  const vis = (lista ?? []).filter((e) => (!grupo || grupoDe(e) === grupo) && (!filtro || `${e.nombre} ${e.apellidos}`.toLowerCase().includes(filtro.toLowerCase())));
  const editables = vis.filter((e) => !e.propio);
  const toggle = (id: number) => { const s = new Set(sel); s.has(id) ? s.delete(id) : s.add(id); setSel(s); };
  const todosSel = editables.length > 0 && editables.every((e) => sel.has(e.id));
  const seleccionados = (lista ?? []).filter((e) => sel.has(e.id));
  const centroComun = seleccionados.length && seleccionados.every((e) => e.centroId === seleccionados[0].centroId) ? seleccionados[0].centroId : null;

  return (
    <>
      <form className="ahora-cabecera" onSubmit={(e: FormEvent) => { e.preventDefault(); cargar(mes); }}>
        <SelectorGrupo grupos={grupos} grupo={grupo} setGrupo={setGrupo} />
        <label>Mes<input type="month" value={mes} max={mesActual()} onChange={(e) => setMes(e.target.value)} /></label>
        <button className="btn btn-secundario">Ver</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {ok && <p className="exito" role="status">{ok}</p>}
      {copiado && sel.size === 0 && (
        <p className="nota">Horario copiado: <strong>{copiado.nombre}</strong>. Pulsa «Pegar» en una persona o selecciona varias. <button className="btn-link" onClick={() => copiarHorario(null)}>Descartar</button></p>
      )}
      {sel.size > 0 && (
        <div className="seleccion-barra">
          <span><strong>{sel.size}</strong> seleccionada(s)</span>
          <div className="exportar-botones">
            <button className="btn btn-primario" onClick={() => setMasivo(true)}>Asignar el mismo horario</button>
            {copiado && (
              <button className="btn btn-secundario" onClick={() => setPegarEn({ ids: [...sel], centroId: centroComun, titulo: `Horario de ${copiado.nombre} para ${sel.size} persona(s)` })}>
                Pegar horario de {copiado.nombre}
              </button>
            )}
            <button className="btn-link" onClick={() => setSel(new Set())}>Quitar selección</button>
          </div>
        </div>
      )}
      {!lista ? (
        <div className="centrado-bloque"><div className="spinner" aria-label="Cargando" /></div>
      ) : (
        <table className="tabla">
          <thead>
            <tr>
              <th className="col-check"><input type="checkbox" aria-label="Seleccionar todos" checked={todosSel} onChange={() => setSel(todosSel ? new Set() : new Set(editables.map((e) => e.id)))} /></th>
              <th>Persona</th><th>Horario</th><th>Horas del mes</th><th>Trabajado</th><th>Saldo</th><th>Bolsa de horas</th><th />
            </tr>
          </thead>
          <tbody>
            {vis.map((e) => {
              const s = e.saldo;
              const refObj = s ? s.objetivoHastaHoyMin ?? s.objetivoMin : 0;
              return (
                <tr key={e.id}>
                  <td className="col-check">{!e.propio && <input type="checkbox" aria-label={`Seleccionar ${e.nombre}`} checked={sel.has(e.id)} onChange={() => toggle(e.id)} />}</td>
                  <td><strong>{e.nombre} {e.apellidos}</strong><div className="nota">{grupoDe(e)}</div></td>
                  <td>{e.horario ? e.horario.resumen : <span className="chip chip-pausa_inicio">Sin horario</span>}</td>
                  <td className="nowrap">{s && e.horario ? <>{duracion(s.objetivoMin)}{s.ajuste && <div className="nota" title={s.ajuste.motivo}>ajustado</div>}</> : "—"}</td>
                  <td className="nowrap">{s ? duracion(s.trabajadoMin) : "—"}{s && s.justificadoMin > 0 && <div className="nota">+ {duracion(s.justificadoMin)} justificado</div>}</td>
                  <td className="nowrap">
                    {s && e.horario && s.tipo !== "VARIABLE" ? (
                      <>
                        <span className={s.trabajadoMin + s.justificadoMin - refObj < 0 ? "error-texto" : ""}>{horasConSigno(s.trabajadoMin + s.justificadoMin - refObj)}</span>
                        {s.objetivoHastaHoyMin !== null && mes === mesActual() && <div className="nota">hasta hoy</div>}
                        {s.sobrecarga && <div><span className="chip chip-salida" title={`Más de ${s.umbralHoras} h por encima`}>Sobrecarga</span></div>}
                      </>
                    ) : s?.sobrecarga ? <span className="chip chip-salida" title={`Más de ${s.umbralHoras} h por encima`}>Sobrecarga</span> : "—"}
                  </td>
                  <td className="nowrap">
                    {s?.tipo === "VARIABLE" ? (
                      <>
                        <strong>{duracion(Math.max(0, s.pendienteMin ?? 0))}</strong> <span className="nota">pendientes</span>
                        <div className="nota">{duracion(s.bolsaAnteriorMin ?? 0)} de meses anteriores</div>
                      </>
                    ) : <span className="nota">—</span>}
                  </td>
                  <td className="acciones-fila">
                    <button className="btn-link" onClick={() => setFicha(e)}>{e.propio ? "Ver" : "Horario"}</button>
                    {e.horario && <button className="btn-link" onClick={() => copiar(e)}>Copiar</button>}
                    {copiado && !e.propio && copiado.origenId !== e.id && (
                      <button className="btn-link" title={`Pegar el horario de ${copiado.nombre}`} onClick={() => setPegarEn({ ids: [e.id], centroId: e.centroId, titulo: `Horario de ${e.nombre} ${e.apellidos} (copiado de ${copiado.nombre})` })}>Pegar</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {lista && !vis.length && <p className="nota vacio">No hay personas que mostrar.</p>}
      <p className="nota">Fijo y rotativo: el saldo es informativo. Variable: pendientes = bolsa de meses anteriores + horas del mes aún no trabajadas; al cerrar el mes, lo no trabajado pasa a la bolsa y lo trabajado de más la compensa.</p>

      {ficha && <FichaHorario id={ficha.id} nombre={`${ficha.nombre} ${ficha.apellidos}`} centroId={ficha.centroId} onCerrar={() => setFicha(null)} onCambio={() => cargar()} />}
      {pegarEn && copiado && (
        <EditorHorario
          ids={pegarEn.ids} titulo={pegarEn.titulo} inicial={horarioParaPegar(copiado, pegarEn.centroId)} centroId={pegarEn.centroId}
          onCerrar={() => setPegarEn(null)}
          onGuardado={() => { const n = pegarEn.ids.length; setPegarEn(null); setOk(`Horario de ${copiado.nombre} aplicado a ${n} persona(s).`); setSel(new Set()); cargar(); }}
        />
      )}
      {masivo && (
        <EditorHorario
          ids={[...sel]} titulo={`Horario para ${sel.size} personas`} inicial={null} centroId={centroComun}
          onCerrar={() => setMasivo(false)}
          onGuardado={() => { setMasivo(false); setOk(`Horario asignado a ${sel.size} personas.`); setSel(new Set()); cargar(); }}
        />
      )}
    </>
  );
}

/* ---------- Turnos de centro ---------- */
function Turnos() {
  const [datos, setDatos] = useState<{ turnos: Turno[]; centrosEditables: number[] | null } | null>(null);
  const [centros, setCentros] = useState<{ id: number; nombre: string }[]>([]);
  const [editando, setEditando] = useState<Turno | "nuevo" | null>(null);
  const [error, setError] = useState("");

  async function cargar() {
    try {
      const [t, h] = await Promise.all([api.turnos(), api.horariosEquipo(mesActual())]);
      setDatos(t);
      const m = new Map<number, string>();
      for (const x of t.turnos) m.set(x.centroId, x.centro);
      for (const c of centrosDe(h.empleados)) m.set(c.id, c.nombre);
      setCentros([...m.entries()].filter(([id]) => t.centrosEditables === null || t.centrosEditables.includes(id)).map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, "es")));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudieron cargar los turnos");
    }
  }
  useEffect(() => { cargar(); }, []);

  if (!datos) return error ? <p className="error">{error}</p> : <div className="centrado-bloque"><div className="spinner" aria-label="Cargando" /></div>;
  const porCentro = new Map<string, Turno[]>();
  for (const t of datos.turnos) porCentro.set(t.centro, [...(porCentro.get(t.centro) ?? []), t]);
  return (
    <>
      <div className="ahora-cabecera">
        <p className="nota">Plantillas para montar horarios rápido. Cambiar un turno no modifica los horarios ya asignados.</p>
        {centros.length > 0 && <button className="btn btn-secundario" onClick={() => setEditando("nuevo")}>+ Nuevo turno</button>}
      </div>
      {!datos.turnos.length && <p className="nota vacio">Todavía no hay turnos.</p>}
      {[...porCentro.entries()].map(([centro, ts]) => (
        <div key={centro} className="turnos-centro">
          <h3>{centro}</h3>
          <div className="chips">
            {ts.map((t) => (
              <button key={t.id} type="button" className={`chip chip-boton${t.activo ? "" : " chip-anulado"}`} disabled={!t.editable} onClick={() => setEditando(t)} title={t.editable ? "Editar" : ""}>
                {t.nombre} · {t.inicio}–{t.fin}
              </button>
            ))}
          </div>
        </div>
      ))}
      {editando && <EditarTurno turno={editando === "nuevo" ? null : editando} centros={centros} onCerrar={() => setEditando(null)} onGuardado={() => { setEditando(null); cargar(); }} />}
    </>
  );
}

function EditarTurno({ turno, centros, onCerrar, onGuardado }: { turno: Turno | null; centros: { id: number; nombre: string }[]; onCerrar: () => void; onGuardado: () => void }) {
  const [f, setF] = useState({ centroId: turno ? String(turno.centroId) : centros.length === 1 ? String(centros[0].id) : "", nombre: turno?.nombre ?? "", inicio: turno?.inicio ?? "07:00", fin: turno?.fin ?? "15:00", activo: turno?.activo ?? true });
  const [error, setError] = useState("");
  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!f.centroId) return setError("Elige el centro.");
    if (f.nombre.trim().length < 2) return setError("Pon un nombre al turno.");
    try {
      if (turno) await api.editarTurno(turno.id, { nombre: f.nombre.trim(), inicio: f.inicio, fin: f.fin, activo: f.activo });
      else await api.crearTurno({ centroId: Number(f.centroId), nombre: f.nombre.trim(), inicio: f.inicio, fin: f.fin });
      onGuardado();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el turno");
    }
  }
  return (
    <Modal titulo={turno ? "Editar turno" : "Nuevo turno"} onCerrar={onCerrar}>
      <form onSubmit={guardar} className="form-modal">
        <label>Centro
          <select value={f.centroId} onChange={(e) => setF({ ...f, centroId: e.target.value })} disabled={!!turno}>
            <option value="">Selecciona…</option>
            {centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            {turno && !centros.some((c) => c.id === turno.centroId) && <option value={turno.centroId}>{turno.centro}</option>}
          </select>
        </label>
        <label>Nombre<input value={f.nombre} maxLength={50} onChange={(e) => setF({ ...f, nombre: e.target.value })} placeholder="Ej.: Mañana" /></label>
        <div className="fila">
          <label>Inicio<input type="time" value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} /></label>
          <label>Fin<input type="time" value={f.fin} onChange={(e) => setF({ ...f, fin: e.target.value })} /></label>
        </div>
        {turno && <label className="check"><input type="checkbox" checked={f.activo} onChange={(e) => setF({ ...f, activo: e.target.checked })} /> Activo</label>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="modal-acciones">
          <button type="button" className="btn btn-secundario" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-primario">Guardar</button>
        </div>
      </form>
    </Modal>
  );
}

/* ---------- Cubrir un hueco ---------- */
function Cubrir({ centros, onCerrar }: { centros: { id: number; nombre: string }[]; onCerrar: () => void }) {
  const [f, setF] = useState({ centroId: centros.length === 1 ? String(centros[0].id) : "", fecha: hoyLocal(), inicio: "08:00", fin: "15:00" });
  const [r, setR] = useState<{ candidatos: CandidatoCobertura[]; descartados: CandidatoCobertura[]; horasHueco: number } | null>(null);
  const [error, setError] = useState("");
  const [buscando, setBuscando] = useState(false);
  async function buscar(e: FormEvent) {
    e.preventDefault();
    if (!f.centroId) return setError("Elige el centro.");
    setError("");
    setBuscando(true);
    try { setR(await api.cubrir(Number(f.centroId), f.fecha, f.inicio, f.fin)); } catch (err) { setError(err instanceof ApiError ? err.message : "No se pudo calcular la propuesta"); }
    setBuscando(false);
  }
  const fila = (c: CandidatoCobertura, i?: number) => (
    <tr key={c.id}>
      {i !== undefined && <td>{i + 1}</td>}
      <td><strong>{c.nombre} {c.apellidos}</strong><div className="nota">{c.tipo ? ETIQUETA_HORARIO[c.tipo] : "Sin horario"}</div></td>
      <td className="nowrap">{c.debeMin > 0 ? <strong>{duracion(c.debeMin)}</strong> : <span className="nota">{horasConSigno(-c.debeMin)} de más</span>}</td>
      <td className="nowrap">{duracion(c.trabajadoMin)} / {duracion(c.objetivoMin)}</td>
      {c.motivo !== null && <td>{c.motivo}</td>}
    </tr>
  );
  return (
    <Modal titulo="Cubrir un hueco" onCerrar={onCerrar} ancho>
      <form onSubmit={buscar} className="form-modal">
        <p className="nota">La app propone a las personas del centro que más horas deben (bolsa de horas y horas pendientes del mes) y descarta a quien ya trabaja en ese horario o está sobrecargado.</p>
        <div className="fila-acciones">
          <label className="campo-ancho">Centro
            <select value={f.centroId} onChange={(e) => setF({ ...f, centroId: e.target.value })}>
              <option value="">Selecciona…</option>
              {centros.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </label>
          <label>Día<input type="date" value={f.fecha} onChange={(e) => setF({ ...f, fecha: e.target.value })} /></label>
          <label>Desde<input type="time" value={f.inicio} onChange={(e) => setF({ ...f, inicio: e.target.value })} /></label>
          <label>Hasta<input type="time" value={f.fin} onChange={(e) => setF({ ...f, fin: e.target.value })} /></label>
          <button className="btn btn-primario" disabled={buscando}>{buscando ? "Calculando…" : "Proponer"}</button>
        </div>
        {error && <p className="error" role="alert">{error}</p>}
      </form>
      {r && (
        <>
          <h3>Propuesta ({r.horasHueco} h)</h3>
          {r.candidatos.length ? (
            <table className="tabla">
              <thead><tr><th>#</th><th>Persona</th><th>Pendientes</th><th>Trabajado / objetivo mes</th></tr></thead>
              <tbody>{r.candidatos.map((c, i) => fila(c, i))}</tbody>
            </table>
          ) : <p className="nota">Nadie disponible en ese centro para ese horario.</p>}
          {r.descartados.length > 0 && (
            <details className="descartados">
              <summary>Descartados ({r.descartados.length})</summary>
              <table className="tabla">
                <thead><tr><th>Persona</th><th>Pendientes</th><th>Trabajado / objetivo mes</th><th>Motivo</th></tr></thead>
                <tbody>{r.descartados.map((c) => fila(c))}</tbody>
              </table>
            </details>
          )}
        </>
      )}
    </Modal>
  );
}
