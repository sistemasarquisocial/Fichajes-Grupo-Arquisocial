/* OAuth 2.0 Authorization Code de Wolters Kluwer Account (WKA).
   - Autorización: https://login.wolterskluwer.eu/auth/core/connect/authorize
   - Token y refresco: https://login.wolterskluwer.eu/auth/core/connect/token
   - Scope: offline_access openid IDInfo WK.ES.A3EquipoContex
   - access_token: 1 h. refresh_token: caducidad absoluta de 30 días desde que se conecta. */

export const URL_AUTORIZAR = "https://login.wolterskluwer.eu/auth/core/connect/authorize";
export const URL_TOKEN = "https://login.wolterskluwer.eu/auth/core/connect/token";
export const SCOPE = "offline_access openid IDInfo WK.ES.A3EquipoContex";
export const DIAS_REFRESCO = 30;

export interface Tokens {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
}

export class ErrorOAuth extends Error {
  constructor(public status: number, public codigo: string, mensaje: string) {
    super(mensaje);
  }
}

async function pedirToken(campos: Record<string, string>, f: typeof fetch = fetch): Promise<Tokens> {
  const resp = await f(URL_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(campos).toString(),
  });
  const txt = await resp.text();
  let j: any = null;
  try {
    j = JSON.parse(txt);
  } catch {
    /* respuesta no JSON */
  }
  if (!resp.ok || !j?.access_token) {
    throw new ErrorOAuth(resp.status, j?.error ?? "error", `WKA respondió ${resp.status}: ${j?.error ?? ""} ${j?.error_description ?? txt.slice(0, 200)}`.trim());
  }
  return j as Tokens;
}

export const canjearCodigo = (clientId: string, secreto: string, code: string, redirectUri: string, f?: typeof fetch) =>
  pedirToken({ client_id: clientId, client_secret: secreto, code, grant_type: "authorization_code", redirect_uri: redirectUri }, f);

export const refrescar = (clientId: string, secreto: string, refreshToken: string, f?: typeof fetch) =>
  pedirToken({ client_id: clientId, client_secret: secreto, grant_type: "refresh_token", refresh_token: refreshToken }, f);

/** Lee el payload de un JWT sin validar la firma (se usa solo para mostrar quién conectó y la caducidad). */
export function payloadJwt(t: string | undefined): any {
  if (!t) return {};
  try {
    return JSON.parse(Buffer.from(t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return {};
  }
}

/** Usuario de a3 que autorizó la conexión, según los claims disponibles. */
export function usuarioDeTokens(t: Tokens): string | null {
  const a = payloadJwt(t.access_token);
  const i = payloadJwt(t.id_token);
  const v = a["wk.es.a3equipouserid"] ?? i.email ?? i.preferred_username ?? i.name ?? a.sub ?? null;
  return v ? String(v).slice(0, 254) : null;
}

/** URL de autorización que abre el navegador del administrador. */
export function urlAutorizacion(clientId: string, redirectUri: string, state: string, nonce: string): string {
  const q = new URLSearchParams({ client_id: clientId, response_type: "code", redirect_uri: redirectUri, scope: SCOPE, state, nonce });
  return `${URL_AUTORIZAR}?${q.toString().replace(/%20/g, "+")}`;
}
