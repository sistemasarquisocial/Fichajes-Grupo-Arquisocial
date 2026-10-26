import { ReactNode, useEffect } from "react";

/** Ventana modal reutilizable: cierra con Escape o al pulsar fuera. */
export default function Modal({ titulo, onCerrar, children, ancho = false }: { titulo: string; onCerrar: () => void; children: ReactNode; ancho?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onCerrar(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onCerrar]);
  return (
    <div className="modal-fondo" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div className={`modal${ancho ? " modal-ancho" : ""}`} role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="modal-cabecera">
          <h2>{titulo}</h2>
          <button className="modal-cerrar" onClick={onCerrar} aria-label="Cerrar">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
