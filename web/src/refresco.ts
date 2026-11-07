import { useEffect, useRef } from "react";

/** Ejecuta `fn` cada `ms` solo mientras la pestaña está visible. Al volver a la pestaña, refresca si ha pasado ese
    tiempo. Así una pestaña olvidada en segundo plano no consulta el servidor (ni despierta la base de datos). */
export function useRefrescoVisible(fn: () => void, ms: number, activo = true) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (!activo) return;
    let ultimo = Date.now();
    const correr = () => {
      ultimo = Date.now();
      ref.current();
    };
    const t = setInterval(() => {
      if (document.visibilityState === "visible") correr();
    }, ms);
    const alVolver = () => {
      if (document.visibilityState === "visible" && Date.now() - ultimo >= ms) correr();
    };
    document.addEventListener("visibilitychange", alVolver);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", alVolver);
    };
  }, [ms, activo]);
}
