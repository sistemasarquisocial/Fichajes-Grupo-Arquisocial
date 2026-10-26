import { useState } from "react";
import { api, ApiError, hoyLocal } from "../api";

type Modo = "mes" | "rango";

const mesActual = () => hoyLocal().slice(0, 7);
const ultimoDia = (yyyyMm: string) => {
  const [y, m] = yyyyMm.split("-").map(Number);
  return `${yyyyMm}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
};

/** Exportación del propio registro de jornada a PDF o Excel (se genera en el navegador). */
export default function ExportarHistorial({ desdeInicial, hastaInicial }: { desdeInicial: string; hastaInicial: string }) {
  const [modo, setModo] = useState<Modo>("mes");
  const [mes, setMes] = useState(mesActual());
  const [desde, setDesde] = useState(desdeInicial);
  const [hasta, setHasta] = useState(hastaInicial);
  const [generando, setGenerando] = useState<"" | "pdf" | "xlsx">("");
  const [error, setError] = useState("");

  function periodo(): [string, string] | null {
    const hoy = hoyLocal();
    if (modo === "mes") {
      if (!/^\d{4}-\d{2}$/.test(mes)) return null;
      const fin = ultimoDia(mes);
      return [`${mes}-01`, fin > hoy ? hoy : fin];
    }
    return desde && hasta ? [desde, hasta] : null;
  }

  async function exportar(formato: "pdf" | "xlsx") {
    setError("");
    const p = periodo();
    if (!p || p[0] > p[1]) return setError("Revisa el periodo seleccionado.");
    setGenerando(formato);
    try {
      const datos = await api.exportar(p[0], p[1], formato);
      if (formato === "pdf") (await import("../exportar/pdf")).exportarPdf(datos);
      else await (await import("../exportar/excel")).exportarExcel(datos);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "No se pudo generar el archivo. Inténtalo de nuevo.");
    } finally {
      setGenerando("");
    }
  }

  return (
    <div className="tarjeta exportar">
      <div className="exportar-cabecera">
        <div>
          <h3>Exportar mi registro de jornada</h3>
          <p className="nota">Informe con la imagen de Grupo Arquisocial y código de verificación. Máximo 12 meses.</p>
        </div>
        <div className="segmentado" role="tablist" aria-label="Tipo de periodo">
          <button role="tab" aria-selected={modo === "mes"} className={modo === "mes" ? "activo" : ""} onClick={() => setModo("mes")}>Mes</button>
          <button role="tab" aria-selected={modo === "rango"} className={modo === "rango" ? "activo" : ""} onClick={() => setModo("rango")}>Rango de fechas</button>
        </div>
      </div>
      <div className="exportar-cuerpo">
        {modo === "mes" ? (
          <label>Mes<input type="month" value={mes} max={mesActual()} onChange={(e) => setMes(e.target.value)} /></label>
        ) : (
          <>
            <label>Desde<input type="date" value={desde} max={hasta || hoyLocal()} onChange={(e) => setDesde(e.target.value)} /></label>
            <label>Hasta<input type="date" value={hasta} min={desde} max={hoyLocal()} onChange={(e) => setHasta(e.target.value)} /></label>
          </>
        )}
        <div className="exportar-botones">
          <button className="btn btn-exportar" onClick={() => exportar("pdf")} disabled={!!generando}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Zm0 0v5h5M9 13h6M9 17h4" /></svg>
            {generando === "pdf" ? "Generando…" : "Descargar PDF"}
          </button>
          <button className="btn btn-exportar" onClick={() => exportar("xlsx")} disabled={!!generando}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5Zm0 5h16M4 15h16M10 10v11" /></svg>
            {generando === "xlsx" ? "Generando…" : "Descargar Excel"}
          </button>
        </div>
      </div>
      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}
