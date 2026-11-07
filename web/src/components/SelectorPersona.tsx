import { KeyboardEvent, useEffect, useId, useMemo, useRef, useState } from "react";

/** Persona elegible: id, nombre visible y un detalle opcional (centro, departamento…). */
export interface OpcionPersona {
  id: number;
  nombre: string;
  detalle?: string | null;
}

interface Props {
  personas: OpcionPersona[];
  /** Id elegido como texto ("" = ninguno), igual que los <select> que sustituye. */
  valor: string;
  onCambio: (valor: string) => void;
  /** Texto de la opción «ninguno» (p. ej. «Sin coordinador»). Si no se indica, no se puede dejar vacío. */
  vacio?: string;
  placeholder?: string;
  requerido?: boolean;
  deshabilitado?: boolean;
}

const MAX_RESULTADOS = 50;
const sinAcentos = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Desplegable con buscador: se escribe parte del nombre (en cualquier orden, sin acentos) y se elige de la lista. */
export default function SelectorPersona({ personas, valor, onCambio, vacio, placeholder = "Escribe para buscar…", requerido, deshabilitado }: Props) {
  const elegida = useMemo(() => personas.find((p) => String(p.id) === valor) ?? null, [personas, valor]);
  const [texto, setTexto] = useState(elegida?.nombre ?? "");
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(0);
  const lista = useRef<HTMLUListElement>(null);
  const idLista = useId();

  // Si cambia la persona elegida desde fuera (o llegan las personas), se muestra su nombre
  useEffect(() => { if (!abierto) setTexto(elegida?.nombre ?? ""); }, [elegida, abierto]);

  const resultados = useMemo(() => {
    const palabras = sinAcentos(texto).split(/\s+/).filter(Boolean);
    const buscando = palabras.length > 0 && texto !== elegida?.nombre;
    const r = buscando
      ? personas.filter((p) => { const t = sinAcentos(`${p.nombre} ${p.detalle ?? ""}`); return palabras.every((w) => t.includes(w)); })
      : personas;
    return { total: r.length, items: r.slice(0, MAX_RESULTADOS) };
  }, [personas, texto, elegida]);

  const opciones: (OpcionPersona | null)[] = vacio !== undefined ? [null, ...resultados.items] : resultados.items;

  function elegir(p: OpcionPersona | null) {
    onCambio(p ? String(p.id) : "");
    setTexto(p?.nombre ?? "");
    setAbierto(false);
  }

  function teclas(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!abierto) return setAbierto(true);
      const n = opciones.length;
      const sig = n ? (activo + (e.key === "ArrowDown" ? 1 : -1) + n) % n : 0;
      setActivo(sig);
      lista.current?.children[sig]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && abierto) {
      e.preventDefault();
      if (opciones.length) elegir(opciones[Math.min(activo, opciones.length - 1)]);
    } else if (e.key === "Escape" && abierto) {
      e.preventDefault();
      setAbierto(false);
      setTexto(elegida?.nombre ?? "");
    }
  }

  return (
    <div className="selector-persona">
      <input
        role="combobox"
        aria-expanded={abierto}
        aria-controls={idLista}
        aria-autocomplete="list"
        autoComplete="off"
        value={texto}
        placeholder={elegida || vacio === undefined ? placeholder : vacio}
        disabled={deshabilitado}
        required={requerido && !valor}
        onFocus={(e) => { e.target.select(); setActivo(0); setAbierto(true); }}
        onChange={(e) => { setTexto(e.target.value); setActivo(vacio !== undefined ? 1 : 0); setAbierto(true); }}
        onBlur={() => { setAbierto(false); setTexto(elegida?.nombre ?? ""); }}
        onKeyDown={teclas}
      />
      {valor && vacio !== undefined && !deshabilitado && (
        <button type="button" className="selector-persona-quitar" aria-label={`Quitar (${vacio})`} title="Quitar" onMouseDown={(e) => e.preventDefault()} onClick={() => elegir(null)}>×</button>
      )}
      {abierto && (
        <ul className="selector-persona-lista" role="listbox" id={idLista} ref={lista}>
          {opciones.map((p, i) => (
            <li
              key={p ? p.id : "vacio"}
              role="option"
              aria-selected={i === activo}
              className={`${i === activo ? "activo" : ""} ${p && String(p.id) === valor ? "elegido" : ""} ${p ? "" : "vacio"}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActivo(i)}
              onClick={() => elegir(p)}
            >
              {p ? <><span>{p.nombre}</span>{p.detalle && <small>{p.detalle}</small>}</> : <span>({vacio})</span>}
            </li>
          ))}
          {!resultados.total && <li className="sin-resultados">Nadie coincide con «{texto}».</li>}
          {resultados.total > MAX_RESULTADOS && <li className="sin-resultados">{resultados.total - MAX_RESULTADOS} más… sigue escribiendo para afinar.</li>}
        </ul>
      )}
    </div>
  );
}
