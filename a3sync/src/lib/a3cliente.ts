/* Cliente de la API a3innuva Nómina (https://a3api.wolterskluwer.es/Laboral).
   - Cabeceras: Authorization: Bearer <access_token> + Ocp-Apim-Subscription-Key.
   - Paginación: pageNumber (desde 1) y pageSize (máx. 50); se pide hasta que una página trae menos de 50.
   - Límite Conectia: 3.000 llamadas/min y 150.000/día. 429 → esperar Retry-After.
   - 401 → se invalida el token y se reintenta una vez. 5xx/red → reintentos con espera. 404 → null. */

export const BASE_A3 = "https://a3api.wolterskluwer.es/Laboral";
export const TAM_PAGINA = 50;

export interface OpcionesCliente {
  apikey: string;
  token: () => Promise<string>;
  invalidarToken: () => void;
  fetch?: typeof fetch;
  base?: string;
  /** Llamadas por segundo como máximo (por defecto 30 ≈ 1.800/min, por debajo del límite). */
  porSegundo?: number;
  espera?: (ms: number) => Promise<void>;
}

export class ErrorA3 extends Error {
  constructor(public status: number, mensaje: string) {
    super(mensaje);
  }
}

export class A3Cliente {
  llamadas = 0;
  private f: typeof fetch;
  private base: string;
  private intervalo: number;
  private siguiente = 0;
  private espera: (ms: number) => Promise<void>;

  constructor(private o: OpcionesCliente) {
    this.f = o.fetch ?? fetch;
    this.base = o.base ?? BASE_A3;
    this.intervalo = 1000 / (o.porSegundo ?? 30);
    this.espera = o.espera ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  /** Reparte las llamadas en el tiempo para no pasar del límite por minuto. */
  private async turno() {
    const ahora = Date.now();
    const t = Math.max(ahora, this.siguiente);
    this.siguiente = t + this.intervalo;
    if (t > ahora) await this.espera(t - ahora);
  }

  /** GET con reintentos. Devuelve el JSON o null si 404. */
  async get<T = any>(ruta: string, query: Record<string, string | number | undefined> = {}): Promise<T | null> {
    const qs = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    const url = this.base + ruta + (qs ? `?${qs}` : "");
    let reintento401 = false;
    for (let intento = 1; ; intento++) {
      await this.turno();
      this.llamadas++;
      let resp: Response;
      try {
        resp = await this.f(url, {
          headers: {
            Authorization: `Bearer ${await this.o.token()}`,
            "Ocp-Apim-Subscription-Key": this.o.apikey,
            Accept: "application/json",
          },
        });
      } catch (e: any) {
        if (intento >= 4) throw new ErrorA3(0, `Sin respuesta de a3 (${ruta}): ${e?.message ?? e}`);
        await this.espera(2000 * intento);
        continue;
      }
      if (resp.ok) {
        const txt = await resp.text();
        return (txt ? JSON.parse(txt) : null) as T;
      }
      if (resp.status === 404) return null;
      if (resp.status === 401 && !reintento401) {
        reintento401 = true;
        this.o.invalidarToken();
        continue;
      }
      if (resp.status === 429 && intento < 10) {
        const s = Number(resp.headers.get("retry-after")) || 60;
        await this.espera(Math.min(s, 300) * 1000);
        continue;
      }
      if (resp.status >= 500 && intento < 4) {
        await this.espera(3000 * intento);
        continue;
      }
      const cuerpo = (await resp.text().catch(() => "")).slice(0, 300);
      throw new ErrorA3(resp.status, `a3 respondió ${resp.status} en ${ruta}: ${cuerpo}`);
    }
  }

  /** Recorre todas las páginas de un listado. */
  async todas<T = any>(ruta: string, query: Record<string, string | undefined> = {}): Promise<T[]> {
    const r: T[] = [];
    for (let p = 1; p <= 99999; p++) {
      const pagina = await this.get<T[] | T>(ruta, { ...query, pageNumber: p, pageSize: TAM_PAGINA });
      const lista = pagina === null ? [] : Array.isArray(pagina) ? pagina : [pagina];
      r.push(...lista);
      if (lista.length < TAM_PAGINA) break;
    }
    return r;
  }
}

/** Ejecuta fn sobre cada elemento con como mucho `n` en paralelo. */
export async function enParalelo<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const r: R[] = new Array(items.length);
  let i = 0;
  const trabajador = async () => {
    while (i < items.length) {
      const k = i++;
      r[k] = await fn(items[k], k);
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, trabajador));
  return r;
}
