import { useEffect, useMemo, useState } from "react";
import { api, ApiError, ResumenDia, FichajeDia, Incidencia, duracion, fechaLarga, hoyLocal, restarDias } from "../api";
import ExportarHistorial from "./ExportarHistorial";
import ChipFichaje from "../components/ChipFichaje";
import IncidenciaModal, { DIAS_INCIDENCIA } from "./IncidenciaModal";
import MisIncidencias from "./MisIncidencias";

export default function Historial() {
  const [hasta, setHasta] = useState(hoyLocal());
  const [desde, setDesde] = useState(restarDias(hoyLocal(), 30));
  const [dias, setDias] = useState<ResumenDia[] | null>(null);
  const [error, setError] = useState("");
  const [incidencias, setIncidencias] = useState<Incidencia[]>([]);
  const [resuelve, setResuelve] = useState("");
  const [corregir, setCorregir] = useState<FichajeDia | null>(null);
  const [anadir, setAnadir] = useState<string | null>(null);
  const [aviso, setAviso] = useState("");
  const limite = restarDias(hoyLocal(), DIAS_INCIDENCIA);

  async function cargar() {
    setError("");
    setDias(null);
    try {
      const r = await api.historial(desde, hasta);
      setDias(r.dias);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el historial");
      setDias([]);
    }
  }

  async function cargarIncidencias() {
    try {
      const r = await api.misIncidencias();
      setIncidencias(r.incidencias);
      setResuelve(r.resuelve);
    } catch {
      /* la tarjeta simplemente no se muestra */
    }
  }

  useEffect(() => { cargar(); cargarIncidencias(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pendientesPorFichaje = useMemo(
    () => new Set(incidencias.filter((i) => i.estado === "PENDIENTE" && i.fichajeId).map((i) => i.fichajeId!)),
    [incidencias]
  );
  const total = (dias ?? []).reduce((s, d) => s + d.minutosTrabajados, 0);

  async function creada() {
    setCorregir(null);
    setAnadir(null);
    setAviso("Incidencia enviada a tu responsable. Puedes seguirla en «Mis incidencias».");
    await Promise.all([cargarIncidencias(), cargar()]);
  }

  return (
    <section>
      <div className="tarjeta">
        <div className="titulo-acciones">
          <h2>Mi historial</h2>
          <button className="btn btn-secundario" onClick={() => { setAviso(""); setAnadir(hoyLocal()); }}>+ Añadir fichaje olvidado</button>
        </div>
        <form className="filtros" onSubmit={(e) => { e.preventDefault(); cargar(); }}>
          <label>Desde<input type="date" value={desde} max={hasta} onChange={(e) => setDesde(e.target.value)} required /></label>
          <label>Hasta<input type="date" value={hasta} min={desde} max={hoyLocal()} onChange={(e) => setHasta(e.target.value)} required /></label>
          <button className="btn btn-secundario">Consultar</button>
        </form>
        {error && <p className="error">{error}</p>}
        {dias && <p className="nota">Total trabajado en el periodo: <strong>{duracion(total)}</strong> · {dias.length} día(s) con fichajes</p>}
        <p className="nota">¿Te equivocaste al fichar? Pulsa sobre un fichaje de los últimos {DIAS_INCIDENCIA} días para corregir la hora o anularlo, o añade el que olvidaste. Lo aprobará tu responsable.</p>
        {aviso && <p className="exito" role="status">{aviso}</p>}
      </div>

      <MisIncidencias lista={incidencias} resuelve={resuelve} onCambio={() => { setAviso(""); cargarIncidencias(); }} />

      <ExportarHistorial desdeInicial={desde} hastaInicial={hasta} />

      {dias === null ? (
        <div className="centrado-bloque"><div className="spinner" /></div>
      ) : dias.length === 0 ? (
        <p className="nota centrado-bloque">No hay fichajes en este periodo.</p>
      ) : (
        <div className="tabla-contenedor tarjeta">
          <table className="tabla">
            <thead>
              <tr><th>Día</th><th>Fichajes</th><th>Pausa</th><th>Trabajado</th><th /></tr>
            </thead>
            <tbody>
              {dias.map((d) => {
                const corregible = d.fecha >= limite;
                return (
                  <tr key={d.fecha}>
                    <td className="capitalizar">{fechaLarga(d.fecha)}</td>
                    <td>
                      <div className="chips">
                        {d.fichajes.map((f, i) => {
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
                      </div>
                    </td>
                    <td>{duracion(d.minutosPausa)}</td>
                    <td><strong>{duracion(d.minutosTrabajados)}</strong>{d.abierto && <span className="nota"> (en curso)</span>}</td>
                    <td className="acciones-fila">
                      {corregible && <button className="btn-link" onClick={() => { setAviso(""); setAnadir(d.fecha); }}>+ Añadir</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {corregir && <IncidenciaModal fichaje={corregir} onCerrar={() => setCorregir(null)} onCreada={creada} />}
      {anadir && <IncidenciaModal fecha={anadir} onCerrar={() => setAnadir(null)} onCreada={creada} />}
    </section>
  );
}
