import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, Horario, TipoHorario, TramoHorario, TramoDia, Turno, DetalleHorario, ETIQUETA_HORARIO, hoyLocal, duracion } from "../api";
import Modal from "../components/Modal";

const minTramo = (t: TramoDia) => {
  const a = Number(t.inicio.slice(0, 2)) * 60 + Number(t.inicio.slice(3));
  const b = Number(t.fin.slice(0, 2)) * 60 + Number(t.fin.slice(3));
  return b > a ? b - a : b + 1440 - a;
};
const NOMBRE_DIA = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const fechaCorta = (f: string) => `${f.slice(8, 10)}/${f.slice(5, 7)}/${f.slice(0, 4)}`;
const nombreMes = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("es-ES", { month: "long", year: "numeric" });
/** Lunes de la semana de una fecha. */
const lunesDe = (f: string) => {
  const d = new Date(`${f}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};

/** Editor del horario de una o varias personas (fijo, rotativo o variable). */
export function EditorHorario({ ids, titulo, inicial, centroId, onCerrar, onGuardado }: {
  ids: number[]; titulo: string; inicial: Horario | null; centroId: number | null; onCerrar: () => void; onGuardado: () => void;
}) {
  const [tipo, setTipo] = useState<TipoHorario>(inicial?.tipo ?? "FIJO");
  const [horasMes, setHorasMes] = useState(inicial?.horasMes != null ? String(inicial.horasMes) : "");
  const [semanas, setSemanas] = useState(inicial?.semanas ?? 2);
  const [inicio, setInicio] = useState(inicial?.inicioPatron ?? lunesDe(hoyLocal()));
  const [festivos, setFestivos] = useState(inicial?.descuentaFestivos ?? true);
  const [tramos, setTramos] = useState<TramoHorario[]>(inicial?.tramos ?? []);
  const [turnos, setTurnos] = useState<Turno[]>([]);
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => {
    if (centroId) api.turnos(centroId).then((r) => setTurnos(r.turnos.filter((t) => t.activo))).catch(() => {});
  }, [centroId]);

  const nSemanas = tipo === "ROTATIVO" ? semanas : 1;
  const visibles = tramos.filter((t) => t.semana <= nSemanas);
  const horasSemana = (s: number) => visibles.filter((t) => t.semana === s).reduce((a, t) => a + minTramo(t), 0);

  const actualizar = (i: number, cambio: Partial<TramoHorario>) => setTramos(tramos.map((t, k) => (k === i ? { ...t, ...cambio } : t)));
  const quitar = (i: number) => setTramos(tramos.filter((_, k) => k !== i));
  const anadir = (semana: number, dia: number) => {
    const prev = [...tramos].reverse().find((t) => t.semana === semana);
    setTramos([...tramos, { semana, dia, inicio: prev?.inicio ?? "08:00", fin: prev?.fin ?? "15:00", turnoId: prev?.turnoId ?? null }]);
  };
  /** Copia los tramos del lunes al resto de días laborables (L–V) de esa semana. */
  const copiarLunes = (semana: number) => {
    const lunes = tramos.filter((t) => t.semana === semana && t.dia === 1);
    if (!lunes.length) return setError("Pon primero los tramos del lunes.");
    setError("");
    setTramos([...tramos.filter((t) => t.semana !== semana || t.dia === 1 || t.dia > 5), ...[2, 3, 4, 5].flatMap((dia) => lunes.map((t) => ({ ...t, dia })))]);
  };
  const aplicarTurno = (i: number, turnoId: string) => {
    const t = turnos.find((x) => String(x.id) === turnoId);
    actualizar(i, t ? { turnoId: t.id, inicio: t.inicio, fin: t.fin } : { turnoId: null });
  };

  async function guardar(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (tipo === "VARIABLE") {
      const h = Number(horasMes.replace(",", "."));
      if (!horasMes || !Number.isFinite(h) || h < 0 || h > 400) return setError("Indica las horas al mes (entre 0 y 400).");
    } else {
      if (!visibles.length) return setError("Añade al menos un tramo.");
      if (visibles.some((t) => !t.inicio || !t.fin || t.inicio === t.fin)) return setError("Revisa las horas de los tramos.");
      if (tipo === "ROTATIVO" && new Date(`${inicio}T12:00:00Z`).getUTCDay() !== 1) return setError("La semana 1 del patrón debe empezar en lunes.");
    }
    setGuardando(true);
    try {
      await api.guardarHorario({
        ids, tipo, descuentaFestivos: festivos,
        horasMes: tipo === "VARIABLE" ? Number(horasMes.replace(",", ".")) : undefined,
        semanas: tipo === "ROTATIVO" ? semanas : undefined,
        inicioPatron: tipo === "ROTATIVO" ? inicio : undefined,
        tramos: tipo === "VARIABLE" ? [] : visibles,
      });
      onGuardado();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar el horario");
      setGuardando(false);
    }
  }

  return (
    <Modal titulo={titulo} onCerrar={onCerrar} ancho>
      <form onSubmit={guardar} className="form-modal editor-horario">
        <div className="segmentado" role="radiogroup" aria-label="Tipo de horario">
          {(["FIJO", "ROTATIVO", "VARIABLE"] as TipoHorario[]).map((t) => (
            <button key={t} type="button" role="radio" aria-checked={tipo === t} className={tipo === t ? "activo" : ""} onClick={() => setTipo(t)}>{ETIQUETA_HORARIO[t]}</button>
          ))}
        </div>
        <p className="nota">
          {tipo === "FIJO" && "La misma semana siempre. Las horas del mes se calculan solas a partir del horario."}
          {tipo === "ROTATIVO" && "Un patrón de varias semanas (p. ej. semana 1 de mañanas y semana 2 de tardes) que se repite solo."}
          {tipo === "VARIABLE" && "Sin horario: solo las horas de contrato al mes. Lo que no trabaje se acumula en la bolsa de horas."}
        </p>

        {tipo === "VARIABLE" ? (
          <label className="campo-corto">Horas al mes *<input inputMode="decimal" value={horasMes} onChange={(e) => setHorasMes(e.target.value)} placeholder="Ej.: 120" /></label>
        ) : (
          <>
            {tipo === "ROTATIVO" && (
              <div className="fila">
                <label>Semanas del patrón
                  <select value={semanas} onChange={(e) => setSemanas(Number(e.target.value))}>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </label>
                <label>La semana 1 empieza el lunes<input type="date" value={inicio} onChange={(e) => setInicio(lunesDe(e.target.value))} /></label>
              </div>
            )}
            <label className="check"><input type="checkbox" checked={festivos} onChange={(e) => setFestivos(e.target.checked)} /> Los festivos no se trabajan (se descuentan de sus horas)</label>
            {Array.from({ length: nSemanas }, (_, k) => k + 1).map((s) => (
              <fieldset key={s} className="semana-horario">
                <legend>{tipo === "ROTATIVO" ? `Semana ${s}` : "Semana tipo"} · {duracion(horasSemana(s))}</legend>
                {NOMBRE_DIA.map((nd, i) => {
                  const dia = i + 1;
                  const idx = tramos.map((t, k) => ({ t, k })).filter(({ t }) => t.semana === s && t.dia === dia);
                  return (
                    <div key={dia} className="dia-horario">
                      <span className="dia-nombre">{nd}</span>
                      <div className="dia-tramos">
                        {idx.length === 0 && <span className="nota">Libre</span>}
                        {idx.map(({ t, k }) => (
                          <div key={k} className="tramo">
                            {turnos.length > 0 && (
                              <select value={t.turnoId ?? ""} onChange={(e) => aplicarTurno(k, e.target.value)} aria-label="Turno">
                                <option value="">Manual</option>
                                {turnos.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}
                              </select>
                            )}
                            <input type="time" value={t.inicio} onChange={(e) => actualizar(k, { inicio: e.target.value, turnoId: null })} aria-label="Inicio" />
                            <span>–</span>
                            <input type="time" value={t.fin} onChange={(e) => actualizar(k, { fin: e.target.value, turnoId: null })} aria-label="Fin" />
                            <button type="button" className="btn-link" onClick={() => quitar(k)} aria-label="Quitar tramo">✕</button>
                          </div>
                        ))}
                        <button type="button" className="btn-link" onClick={() => anadir(s, dia)}>+ tramo</button>
                      </div>
                    </div>
                  );
                })}
                <button type="button" className="btn-link" onClick={() => copiarLunes(s)}>Copiar el lunes de L a V</button>
              </fieldset>
            ))}
            <p className="nota">Si la hora de fin es anterior a la de inicio, el tramo termina al día siguiente (turno de noche).</p>
          </>
        )}
        {ids.length > 1 && <p className="aviso">Se aplicará el mismo horario a {ids.length} personas. Sustituye el que tuvieran.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="modal-acciones">
          <button type="button" className="btn btn-secundario" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-primario" disabled={guardando}>{guardando ? "Guardando…" : "Guardar horario"}</button>
        </div>
      </form>
    </Modal>
  );
}

/** Ficha de horario de una persona: resumen, editar, ajuste del mes y cambios de día. */
export function FichaHorario({ id, nombre, centroId, onCerrar, onCambio }: { id: number; nombre: string; centroId: number | null; onCerrar: () => void; onCambio: () => void }) {
  const [d, setD] = useState<DetalleHorario | null>(null);
  const [error, setError] = useState("");
  const [editar, setEditar] = useState(false);
  const mesHoy = hoyLocal().slice(0, 7);
  const [aj, setAj] = useState({ mes: mesHoy, horas: "", motivo: "" });
  const [cb, setCb] = useState({ fecha: hoyLocal(), libre: false, inicio: "08:00", fin: "15:00" });
  const [ok, setOk] = useState("");

  async function cargar() {
    try { setD(await api.horarioDetalle(id)); } catch (err) { setError(err instanceof ApiError ? err.message : "No se pudo cargar el horario"); }
  }
  useEffect(() => { cargar(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function accion(f: () => Promise<unknown>, texto: string) {
    setError(""); setOk("");
    try { await f(); setOk(texto); await cargar(); onCambio(); } catch (err) { setError(err instanceof ApiError ? err.message : "No se pudo guardar"); }
  }
  const guardarAjuste = (e: FormEvent) => {
    e.preventDefault();
    const h = Number(aj.horas.replace(",", "."));
    if (!aj.horas || !Number.isFinite(h)) return setError("Indica las horas del mes.");
    if (aj.motivo.trim().length < 3) return setError("Indica el motivo del ajuste.");
    accion(() => api.ajusteMes(id, { mes: aj.mes, horas: h, motivo: aj.motivo.trim() }), "Ajuste guardado.");
  };
  const guardarCambio = (e: FormEvent) => {
    e.preventDefault();
    if (!cb.libre && (!cb.inicio || !cb.fin || cb.inicio === cb.fin)) return setError("Revisa las horas del cambio.");
    accion(() => api.cambioDia(id, { fecha: cb.fecha, tramos: cb.libre ? [] : [{ inicio: cb.inicio, fin: cb.fin }] }), "Cambio de día guardado.");
  };

  if (editar && d)
    return <EditorHorario ids={[id]} titulo={`Horario de ${nombre}`} inicial={d.horario} centroId={centroId} onCerrar={() => setEditar(false)} onGuardado={() => { setEditar(false); setOk("Horario guardado."); cargar(); onCambio(); }} />;

  return (
    <Modal titulo={`Horario de ${nombre}`} onCerrar={onCerrar} ancho>
      {!d ? (
        error ? <p className="error">{error}</p> : <div className="centrado-bloque"><div className="spinner" aria-label="Cargando" /></div>
      ) : (
        <div className="ficha-horario">
          <div className="titulo-acciones">
            <div><strong>{d.resumen}</strong>{d.horario?.tipo === "VARIABLE" && d.horario.bolsaDesde && <div className="nota">Bolsa de horas desde {nombreMes(d.horario.bolsaDesde)}</div>}</div>
            {d.editable && <button className="btn btn-primario" onClick={() => setEditar(true)}>{d.horario ? "Cambiar horario" : "Asignar horario"}</button>}
          </div>
          {ok && <p className="exito" role="status">{ok}</p>}
          {error && <p className="error" role="alert">{error}</p>}

          <h3>Ajustes de horas del mes</h3>
          <p className="nota">Para vacaciones, bajas o meses distintos: sustituye las horas que le tocan ese mes.</p>
          {d.ajustes.length > 0 && (
            <ul className="lista-simple">
              {d.ajustes.map((a) => (
                <li key={a.mes}>
                  <span className="capitalizar-bloque">{nombreMes(a.mes)}</span>: <strong>{a.horas} h</strong> · {a.motivo} <span className="nota">({a.creadoPor})</span>
                  {d.editable && a.mes >= mesHoy && <button className="btn-link" onClick={() => accion(() => api.ajusteMes(id, { mes: a.mes, horas: null }), "Ajuste quitado.")}>Quitar</button>}
                </li>
              ))}
            </ul>
          )}
          {d.editable && (
            <form className="fila-acciones" onSubmit={guardarAjuste}>
              <label>Mes<input type="month" value={aj.mes} min={mesHoy} onChange={(e) => setAj({ ...aj, mes: e.target.value })} /></label>
              <label className="campo-corto">Horas<input inputMode="decimal" value={aj.horas} onChange={(e) => setAj({ ...aj, horas: e.target.value })} /></label>
              <label className="campo-ancho">Motivo<input value={aj.motivo} maxLength={200} onChange={(e) => setAj({ ...aj, motivo: e.target.value })} placeholder="Ej.: vacaciones del 10 al 24" /></label>
              <button className="btn btn-secundario">Guardar ajuste</button>
            </form>
          )}

          {d.horario && d.horario.tipo !== "VARIABLE" && (
            <>
              <h3>Cambios de un día</h3>
              <p className="nota">Cambio de turno o día libre puntual, sin tocar el horario.</p>
              {d.cambios.length > 0 && (
                <ul className="lista-simple">
                  {d.cambios.map((c) => (
                    <li key={c.fecha}>
                      {fechaCorta(c.fecha)}: <strong>{c.tramos.length ? c.tramos.map((t) => `${t.inicio}–${t.fin}`).join(", ") : "Libre"}</strong>
                      {d.editable && <button className="btn-link" onClick={() => accion(() => api.cambioDia(id, { fecha: c.fecha, quitar: true }), "Cambio quitado.")}>Quitar</button>}
                    </li>
                  ))}
                </ul>
              )}
              {d.editable && (
                <form className="fila-acciones" onSubmit={guardarCambio}>
                  <label>Día<input type="date" value={cb.fecha} min={`${mesHoy}-01`} onChange={(e) => setCb({ ...cb, fecha: e.target.value })} /></label>
                  <label className="check"><input type="checkbox" checked={cb.libre} onChange={(e) => setCb({ ...cb, libre: e.target.checked })} /> Libre</label>
                  {!cb.libre && (
                    <>
                      <label>Desde<input type="time" value={cb.inicio} onChange={(e) => setCb({ ...cb, inicio: e.target.value })} /></label>
                      <label>Hasta<input type="time" value={cb.fin} onChange={(e) => setCb({ ...cb, fin: e.target.value })} /></label>
                    </>
                  )}
                  <button className="btn btn-secundario">Guardar cambio</button>
                </form>
              )}
            </>
          )}
          <div className="modal-acciones"><button className="btn btn-secundario" onClick={onCerrar}>Cerrar</button></div>
        </div>
      )}
    </Modal>
  );
}

