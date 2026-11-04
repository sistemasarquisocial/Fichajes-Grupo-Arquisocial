import { useEffect, useMemo, useState } from "react";
import {
  api, ApiError, ResumenDia, FichajeDia, Incidencia, Ausencia, AusenciaDia, Justificado, ETIQUETA_ESTADO_AUS,
  duracion, fechaLarga, hoyLocal, restarDias,
} from "../api";
import ExportarHistorial from "./ExportarHistorial";
import ChipFichaje from "../components/ChipFichaje";
import Modal from "../components/Modal";
import IncidenciaModal, { DIAS_INCIDENCIA } from "./IncidenciaModal";
import AusenciaModal from "./AusenciaModal";
import MisIncidencias from "./MisIncidencias";
import MisAusencias from "./MisAusencias";

interface Fila { fecha: string; dia: ResumenDia | null; justificado: Justificado | null; ausencias: AusenciaDia[] }

export default function Historial() {
  const [hasta, setHasta] = useState(hoyLocal());
  const [desde, setDesde] = useState(restarDias(hoyLocal(), 30));
  const [datos, setDatos] = useState<{ dias: ResumenDia[]; justificados: Justificado[]; ausencias: AusenciaDia[] } | null>(null);
  const [error, setError] = useState("");
  const [incidencias, setIncidencias] = useState<Incidencia[]>([]);
  const [resuelve, setResuelve] = useState("");
  const [ausencias, setAusencias] = useState<Ausencia[]>([]);
  const [almacen, setAlmacen] = useState(true);
  const [corregir, setCorregir] = useState<FichajeDia | null>(null);
  const [anadir, setAnadir] = useState<string | null>(null);
  const [ausencia, setAusencia] = useState<string | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");
  const limite = restarDias(hoyLocal(), DIAS_INCIDENCIA);

  async function cargar() {
    setError("");
    setDatos(null);
    try {
      const r = await api.historial(desde, hasta);
      setDatos({ dias: r.dias, justificados: r.justificados ?? [], ausencias: r.ausencias ?? [] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el historial");
      setDatos({ dias: [], justificados: [], ausencias: [] });
    }
  }

  async function cargarSolicitudes() {
    try {
      const [i, a] = await Promise.all([api.misIncidencias(), api.misAusencias()]);
      setIncidencias(i.incidencias);
      setResuelve(i.resuelve);
      setAusencias(a.ausencias);
      setAlmacen(a.almacen);
    } catch {
      /* las tarjetas simplemente no se muestran */
    }
  }

  useEffect(() => { cargar(); cargarSolicitudes(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pendientesPorFichaje = useMemo(
    () => new Set(incidencias.filter((i) => i.estado === "PENDIENTE" && i.fichajeId).map((i) => i.fichajeId!)),
    [incidencias]
  );

  // Una fila por día con fichajes, horas justificadas o ausencias pendientes
  const filas = useMemo<Fila[] | null>(() => {
    if (!datos) return null;
    const m = new Map<string, Fila>();
    const fila = (fecha: string) => {
      if (!m.has(fecha)) m.set(fecha, { fecha, dia: null, justificado: null, ausencias: [] });
      return m.get(fecha)!;
    };
    for (const d of datos.dias) fila(d.fecha).dia = d;
    for (const j of datos.justificados) fila(j.fecha).justificado = j;
    for (const a of datos.ausencias) {
      for (let f = a.fechaInicio; f <= a.fechaFin; f = restarDias(f, -1)) if (f >= desde && f <= hasta) fila(f).ausencias.push(a);
    }
    return [...m.values()].sort((a, b) => (a.fecha < b.fecha ? 1 : -1));
  }, [datos]); // eslint-disable-line react-hooks/exhaustive-deps

  const total = (datos?.dias ?? []).reduce((s, d) => s + d.minutosTrabajados, 0);
  const totalJustificado = (datos?.justificados ?? []).reduce((s, j) => s + j.minutos, 0);

  async function creada(texto: string) {
    setCorregir(null);
    setAnadir(null);
    setAusencia(null);
    setAviso(texto);
    await Promise.all([cargarSolicitudes(), cargar()]);
  }

  return (
    <section>
      <div className="tarjeta">
        <div className="titulo-acciones">
          <h2>Mi historial</h2>
          <button className="btn btn-secundario" onClick={() => { setAviso(""); setMenu(hoyLocal()); }}>+ Incidencia o ausencia</button>
        </div>
        <form className="filtros" onSubmit={(e) => { e.preventDefault(); cargar(); }}>
          <label>Desde<input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} required /></label>
          <label>Hasta<input type="date" value={hasta} min={desde} max={hoyLocal()} onChange={(e) => setHasta(e.target.value)} required /></label>
          <button className="btn btn-secundario">Consultar</button>
        </form>
        {error && <p className="error">{error}</p>}
        {datos && (
          <p className="nota">
            Total trabajado en el periodo: <strong>{duracion(total)}</strong> · {datos.dias.length} día(s) con fichajes
            {totalJustificado > 0 && <> · Justificado: <strong>{duracion(totalJustificado)}</strong></>}
          </p>
        )}
        <p className="nota">
          ¿Falta o sobra un fichaje, o tuviste que ausentarte (médico, fuerza mayor…)? Pulsa «Incidencia o ausencia» en el día, o pulsa sobre un fichaje de los últimos {DIAS_INCIDENCIA} días para corregirlo. Lo aprobará tu responsable.
        </p>
        {aviso && <p className="exito" role="status">{aviso}</p>}
      </div>

      <MisAusencias lista={ausencias} resuelve={resuelve} almacen={almacen} onCambio={() => { setAviso(""); cargarSolicitudes(); cargar(); }} />
      <MisIncidencias lista={incidencias} resuelve={resuelve} onCambio={() => { setAviso(""); cargarSolicitudes(); }} />

      <ExportarHistorial desdeInicial={desde} hastaInicial={hasta} />

      {filas === null ? (
        <div className="centrado-bloque"><div className="spinner" /></div>
      ) : filas.length === 0 ? (
        <p className="nota centrado-bloque">No hay fichajes en este periodo.</p>
      ) : (
        <div className="tabla-contenedor tarjeta">
          <table className="tabla">
            <thead>
              <tr><th>Día</th><th>Fichajes</th><th>Pausa</th><th>Trabajado</th><th>Justificado</th><th /></tr>
            </thead>
            <tbody>
              {filas.map(({ fecha, dia: d, justificado, ausencias: aus }) => {
                const corregible = fecha >= limite;
                return (
                  <tr key={fecha}>
                    <td className="capitalizar">{fechaLarga(fecha)}</td>
                    <td>
                      <div className="chips">
                        {d?.fichajes.map((f, i) => {
                          const editable = corregible && !!f.id && !f.anulado && !pendientesPorFichaje.has(f.id);
                          return (
                            <ChipFichaje
                              key={i}
                              f={f}
                              pendiente={!!f.id && pendientesPorFichaje.has(f.id)}
                              onClick={editable ? () => { setAviso(""); setCorregir(f); } : undefined}
                            />
                          );
                        })}
                        {aus.map((a) => (
                          <span key={a.id} className={`chip chip-ausencia${a.estado === "PENDIENTE" ? " chip-pendiente" : ""}`} title={`Ausencia ${ETIQUETA_ESTADO_AUS[a.estado].toLowerCase()} · ${a.periodo}`}>
                            {a.motivo}{a.horaInicio ? ` ${a.horaInicio}–${a.horaFin}` : ""}{a.estado === "PENDIENTE" ? " (pendiente)" : ""}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>{d ? duracion(d.minutosPausa) : "—"}</td>
                    <td>{d ? <><strong>{duracion(d.minutosTrabajados)}</strong>{d.abierto && <span className="nota"> (en curso)</span>}</> : "—"}</td>
                    <td>{justificado ? <span title={justificado.motivos.join(", ")}>{duracion(justificado.minutos)}</span> : "—"}</td>
                    <td className="acciones-fila">
                      {corregible && <button className="btn-link nowrap" onClick={() => { setAviso(""); setMenu(fecha); }}>Incidencia o ausencia</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {menu && (
        <Modal titulo={`¿Qué quieres comunicar? · ${fechaLarga(menu)}`} onCerrar={() => setMenu(null)}>
          <div className="menu-opciones">
            <button className="opcion" onClick={() => { const f = menu; setMenu(null); setAnadir(f); }}>
              <strong>Añadir un fichaje olvidado</strong>
              <span className="nota">No fichaste la entrada, la salida o una pausa.</span>
            </button>
            {filas?.find((x) => x.fecha === menu)?.dia?.fichajes.some((f) => f.id && !f.anulado) && (
              <button className="opcion" onClick={() => { setMenu(null); setAviso("Pulsa en la tabla sobre el fichaje que quieras corregir o anular."); }}>
                <strong>Corregir o anular un fichaje</strong>
                <span className="nota">La hora está mal o fichaste por error. Después pulsa sobre el fichaje.</span>
              </button>
            )}
            <button className="opcion" onClick={() => { const f = menu; setMenu(null); setAusencia(f); }}>
              <strong>Justificar una ausencia</strong>
              <span className="nota">Médico, fuerza mayor, un permiso… con su justificante.</span>
            </button>
          </div>
        </Modal>
      )}
      {corregir && <IncidenciaModal fichaje={corregir} onCerrar={() => setCorregir(null)} onCreada={() => creada("Incidencia enviada a tu responsable. Puedes seguirla en «Mis incidencias».")} />}
      {anadir && <IncidenciaModal fecha={anadir} onCerrar={() => setAnadir(null)} onCreada={() => creada("Incidencia enviada a tu responsable. Puedes seguirla en «Mis incidencias».")} />}
      {ausencia && <AusenciaModal fecha={ausencia} onCerrar={() => setAusencia(null)} onCreada={creada} />}
    </section>
  );
}
