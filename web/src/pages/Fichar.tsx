import { useRefrescoVisible } from "../refresco";
import { notaCorreccion } from "../components/ChipFichaje";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError, EstadoFichaje, TipoFichaje, Aviso, TramoDia, hora, duracion, ETIQUETA_TIPO, obtenerUbicacion, TEXTO_UBICACION } from "../api";
import { useSesion } from "../sesion";

const TEXTO_ESTADO = { FUERA: "Fuera de jornada", TRABAJANDO: "Trabajando", EN_PAUSA: "En pausa" } as const;
const BOTON: Record<TipoFichaje, { texto: string; clase: string }> = {
  ENTRADA: { texto: "Fichar entrada", clase: "btn-primario" },
  SALIDA: { texto: "Fichar salida", clase: "btn-peligro" },
  PAUSA_INICIO: { texto: "Iniciar pausa", clase: "btn-secundario" },
  PAUSA_FIN: { texto: "Terminar pausa", clase: "btn-primario" },
};

export default function Fichar() {
  const { usuario } = useSesion();
  const [datos, setDatos] = useState<EstadoFichaje | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [paso, setPaso] = useState("");
  const [ahora, setAhora] = useState(new Date());
  const [dia, setDia] = useState<{ planHoy: TramoDia[]; avisos: Aviso[] } | null>(null);

  const cargar = useCallback(async () => {
    try {
      setDatos(await api.estado());
      api.miDia().then(setDia).catch(() => setDia(null));
      setError("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo cargar el estado");
    }
  }, []);

  useEffect(() => { cargar(); }, [cargar]);
  useEffect(() => {
    const t = setInterval(() => setAhora(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  // El estado solo cambia al fichar; se relee cada 5 min con la pestaña visible (por si ficha desde otro dispositivo)
  useRefrescoVisible(cargar, 300000);

  async function fichar(tipo: TipoFichaje) {
    if (tipo === "SALIDA" && !confirm("¿Confirmas la salida y fin de tu jornada?")) return;
    setEnviando(true);
    setError("");
    setAviso("");
    try {
      setPaso("Obteniendo ubicación…");
      const ubi = await obtenerUbicacion();
      setPaso("Registrando…");
      const r = await api.fichar(tipo, ubi);
      const precision = r.ubicacion.estado === "OK" && r.ubicacion.precision != null ? ` (±${r.ubicacion.precision} m)` : "";
      setAviso(`${ETIQUETA_TIPO[r.tipo]} registrada a las ${hora(r.fechaHoraUtc)} · ${TEXTO_UBICACION[r.ubicacion.estado]}${precision}`);
      await cargar();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo registrar el fichaje");
      await cargar();
    } finally {
      setEnviando(false);
      setPaso("");
    }
  }

  if (!datos) return <div className="centrado-bloque">{error ? <p className="error">{error}</p> : <div className="spinner" />}</div>;

  return (
    <section className="fichar">
      <div className="tarjeta reloj">
        <p className="saludo">Hola, {usuario?.nombre}</p>
        <p className="hora-actual">{ahora.toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid" })}</p>
        <p className="fecha-actual">{ahora.toLocaleDateString("es-ES", { timeZone: "Europe/Madrid", weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>
        <span className={`estado estado-${datos.estado.toLowerCase()}`}>{TEXTO_ESTADO[datos.estado]}</span>
        {dia && dia.planHoy.length > 0 && <p className="nota">Tu horario hoy: {dia.planHoy.map((t) => `${t.inicio}–${t.fin}`).join(" · ")}</p>}
        {dia?.avisos.map((a, i) => (
          <p key={i} className="aviso" role="alert">{a.texto.replace("No ha fichado", "No has fichado").replace("Lleva más", "Llevas más").replace("(entró", "(entraste")}. Si se te olvidó, ficha ahora o abre una incidencia en Mi historial.</p>
        ))}
        {datos.ultimo && <p className="nota">Último: {ETIQUETA_TIPO[datos.ultimo.tipo]} a las {hora(datos.ultimo.fechaHoraUtc)}</p>}

        <div className="acciones">
          {datos.acciones.map((t) => (
            <button key={t} className={`btn btn-grande ${BOTON[t].clase}`} disabled={enviando} onClick={() => fichar(t)}>
              {BOTON[t].texto}
            </button>
          ))}
        </div>
        {paso && <p className="nota" role="status">{paso}</p>}
        <p className="nota nota-ubicacion">Al fichar se registra tu ubicación solo en ese momento. Si no das permiso, el fichaje se guarda igualmente sin ubicación.</p>
        {aviso && <p className="exito" role="status">{aviso}</p>}
        {error && <p className="error" role="alert">{error}</p>}
      </div>

      <div className="tarjeta">
        <h2>Hoy</h2>
        {!datos.hoy ? (
          <p className="nota">Todavía no hay fichajes hoy.</p>
        ) : (
          <>
            <div className="totales">
              <div><span className="cifra">{duracion(datos.hoy.minutosTrabajados)}</span><span className="etiqueta">trabajado{datos.hoy.abierto ? " (en curso)" : ""}</span></div>
              <div><span className="cifra">{duracion(datos.hoy.minutosPausa)}</span><span className="etiqueta">en pausa</span></div>
            </div>
            <ul className="lista-fichajes">
              {datos.hoy.fichajes.map((f, i) => (
                <li key={i} className={f.anulado ? "anulado" : ""} title={notaCorreccion(f) ?? undefined}>
                  <span className={`punto punto-${f.tipo.toLowerCase()}`} />{ETIQUETA_TIPO[f.tipo]}{f.corregido ? " (corregido)" : f.anadido ? " (añadido)" : f.anulado ? " (anulado)" : ""}<span className="hora">{hora(f.fechaHoraUtc)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}
