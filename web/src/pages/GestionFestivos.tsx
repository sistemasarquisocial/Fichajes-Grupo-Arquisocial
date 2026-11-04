import { FormEvent, useEffect, useState } from "react";
import { api, ApiError, CalendarioCentros, Festivo, FestivoManual, fechaLarga } from "../api";
import Modal from "../components/Modal";

type Datos = { anio: number; calendarios: CalendarioCentros[]; sinDatos: string[]; manuales: FestivoManual[]; automaticos: Record<string, Festivo[]> };
const ORIGEN: Record<Festivo["origen"], string> = { NACIONAL: "Nacional", AUTONOMICO: "Autonómico", LOCAL: "Local", MANUAL: "Añadido" };
const clave = (c: { provincia: string | null; municipio: string | null }) => `${c.provincia}|${c.municipio}`;

/** Calendario laboral por municipio (ADMIN): nacionales y autonómicos automáticos + 2 locales por municipio. */
export default function GestionFestivos() {
  const [anio, setAnio] = useState(new Date().getFullYear());
  const [datos, setDatos] = useState<Datos | null>(null);
  const [sel, setSel] = useState("");
  const [mensaje, setMensaje] = useState<{ tipo: "exito" | "error"; texto: string } | null>(null);
  const [nuevo, setNuevo] = useState(false);

  async function cargar(a = anio) {
    try {
      const d = await api.calendarios(a);
      setDatos(d);
      if (!sel || !d.calendarios.some((c) => clave(c) === sel)) setSel(d.calendarios[0] ? clave(d.calendarios[0]) : "");
    } catch (err) {
      setMensaje({ tipo: "error", texto: err instanceof ApiError ? err.message : "No se pudo cargar el calendario" });
    }
  }
  useEffect(() => { cargar(anio); }, [anio]); // eslint-disable-line react-hooks/exhaustive-deps

  const cal = datos?.calendarios.find((c) => clave(c) === sel) ?? null;
  const manualDe = (f: Festivo) => (f.id ? datos?.manuales.find((m) => m.id === f.id) : undefined);
  // Automáticos quitados para la comunidad del calendario elegido
  const quitados = (datos?.manuales ?? []).filter((m) => m.quitar && m.ambito === "COMUNIDAD" && m.comunidad === cal?.comunidad);

  async function ejecutar(f: () => Promise<unknown>, texto: string) {
    setMensaje(null);
    try { await f(); setMensaje({ tipo: "exito", texto }); await cargar(); } catch (err) { setMensaje({ tipo: "error", texto: err instanceof ApiError ? err.message : "No se pudo guardar" }); }
  }

  return (
    <section>
      <div className="titulo-acciones">
        <div>
          <h2>Calendario laboral</h2>
          <p className="sub">Los festivos nacionales y autonómicos se cargan solos según el código postal del centro. Añade aquí los 2 festivos locales de cada municipio.</p>
        </div>
        <label className="campo-corto">Año
          <select value={anio} onChange={(e) => setAnio(Number(e.target.value))}>
            {[0, 1, 2].map((k) => new Date().getFullYear() - 1 + k).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </label>
      </div>
      {mensaje && <p className={mensaje.tipo} role={mensaje.tipo === "error" ? "alert" : "status"}>{mensaje.texto}</p>}
      {datos && datos.sinDatos.length > 0 && <p className="aviso">Centros sin código postal o ciudad (solo tendrán festivos nacionales): {datos.sinDatos.join(", ")}. Complétalos en Gestión de centros.</p>}

      {!datos ? (
        <div className="centrado-bloque"><div className="spinner" aria-label="Cargando" /></div>
      ) : (
        <div className="calendario-layout">
          <ul className="lista-calendarios">
            {datos.calendarios.map((c) => (
              <li key={clave(c)}>
                <button className={clave(c) === sel ? "activo" : ""} onClick={() => setSel(clave(c))}>
                  <strong>{c.ciudad ?? "Sin municipio"}</strong>
                  <small>{c.nombreComunidad ?? "Sin comunidad"} · {c.centros.length} centro(s)</small>
                  {c.municipio && c.locales < 2 && <span className="chip chip-pausa_inicio">{c.locales}/2 locales</span>}
                </button>
              </li>
            ))}
          </ul>
          {cal && (
            <div className="tarjeta">
              <div className="titulo-acciones">
                <div>
                  <h3>{cal.ciudad ?? "Sin municipio"} · {cal.nombreComunidad ?? "sin comunidad"}</h3>
                  <p className="nota">Centros: {cal.centros.join(", ")}</p>
                </div>
                {cal.municipio && <button className="btn btn-primario" onClick={() => setNuevo(true)}>+ Festivo local</button>}
              </div>
              <table className="tabla">
                <thead><tr><th>Fecha</th><th>Festivo</th><th>Tipo</th><th /></tr></thead>
                <tbody>
                  {cal.festivos.map((f) => {
                    const m = manualDe(f);
                    return (
                      <tr key={f.fecha}>
                        <td className="capitalizar nowrap">{fechaLarga(f.fecha)}</td>
                        <td>{f.nombre}</td>
                        <td><span className={`chip ${f.origen === "LOCAL" ? "chip-activa" : f.origen === "AUTONOMICO" ? "chip-pausa_inicio" : ""}`}>{ORIGEN[f.origen]}</span></td>
                        <td className="acciones-fila">
                          {m ? (
                            <button className="btn-link" onClick={() => ejecutar(() => api.borrarFestivo(m.id), "Festivo eliminado.")}>Eliminar</button>
                          ) : cal.comunidad && (
                            <button className="btn-link" title="Si este año no es festivo en la comunidad" onClick={() => ejecutar(() => api.crearFestivo({ fecha: f.fecha, ambito: "COMUNIDAD", comunidad: cal.comunidad, quitar: true, nombre: `No festivo: ${f.nombre}` }), "Festivo quitado para la comunidad.")}>No aplica</button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {quitados.length > 0 && (
                <p className="nota">Quitados en {cal.nombreComunidad}: {quitados.map((q) => (
                  <span key={q.id}>{q.fecha.split("-").reverse().join("/")} <button className="btn-link" onClick={() => ejecutar(() => api.borrarFestivo(q.id), "Festivo restaurado.")}>restaurar</button> </span>
                ))}</p>
              )}
              <p className="nota">Los automáticos siguen las reglas de cada comunidad; si un año la comunidad traslada un festivo, marca «No aplica» y añade el correcto.</p>
              {cal.comunidad && (
                <button className="btn-link" onClick={() => setNuevo(true)}>+ Añadir festivo autonómico que falte</button>
              )}
            </div>
          )}
        </div>
      )}
      {nuevo && cal && <NuevoFestivo cal={cal} anio={anio} onCerrar={() => setNuevo(false)} onGuardado={async (t) => { setNuevo(false); setMensaje({ tipo: "exito", texto: t }); await cargar(); }} />}
    </section>
  );
}

function NuevoFestivo({ cal, anio, onCerrar, onGuardado }: { cal: CalendarioCentros; anio: number; onCerrar: () => void; onGuardado: (t: string) => void }) {
  const [ambito, setAmbito] = useState<"MUNICIPIO" | "COMUNIDAD">(cal.municipio ? "MUNICIPIO" : "COMUNIDAD");
  const [fecha, setFecha] = useState(`${anio}-01-01`);
  const [nombre, setNombre] = useState("");
  const [error, setError] = useState("");
  async function guardar(e: FormEvent) {
    e.preventDefault();
    if (!fecha.startsWith(String(anio))) return setError(`La fecha debe ser de ${anio}.`);
    if (nombre.trim().length < 3) return setError("Indica el nombre del festivo.");
    try {
      await api.crearFestivo(ambito === "MUNICIPIO"
        ? { fecha, nombre: nombre.trim(), ambito, provincia: cal.provincia, municipio: cal.municipio }
        : { fecha, nombre: nombre.trim(), ambito, comunidad: cal.comunidad });
      onGuardado("Festivo añadido.");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo guardar");
    }
  }
  return (
    <Modal titulo="Añadir festivo" onCerrar={onCerrar}>
      <form onSubmit={guardar} className="form-modal">
        <label>Ámbito
          <select value={ambito} onChange={(e) => setAmbito(e.target.value as "MUNICIPIO" | "COMUNIDAD")}>
            {cal.municipio && <option value="MUNICIPIO">Local de {cal.ciudad}</option>}
            {cal.comunidad && <option value="COMUNIDAD">Autonómico de {cal.nombreComunidad}</option>}
          </select>
        </label>
        <label>Fecha<input type="date" value={fecha} min={`${anio}-01-01`} max={`${anio}-12-31`} onChange={(e) => setFecha(e.target.value)} /></label>
        <label>Nombre<input value={nombre} maxLength={100} onChange={(e) => setNombre(e.target.value)} placeholder="Ej.: San Valero" /></label>
        {ambito === "MUNICIPIO" && <p className="nota">Se aplica a todos los centros de {cal.ciudad}. Máximo 2 locales por año.</p>}
        {error && <p className="error" role="alert">{error}</p>}
        <div className="modal-acciones">
          <button type="button" className="btn btn-secundario" onClick={onCerrar}>Cancelar</button>
          <button className="btn btn-primario">Añadir</button>
        </div>
      </form>
    </Modal>
  );
}
