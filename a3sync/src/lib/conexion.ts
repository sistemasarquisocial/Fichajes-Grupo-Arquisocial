import { getPool, sql, leerSecreto, guardarSecreto, SECRETO_CLIENTE, SECRETO_REFRESCO, SECRETO_APIKEY } from "./infra";
import { refrescar, ErrorOAuth } from "./oauth";
import { A3Cliente } from "./a3cliente";

/* Token de acceso a a3: se obtiene con el refresh token guardado en Key Vault y se cachea en memoria.
   Si WKA devuelve un refresh token nuevo, se guarda. Si el refresh token ya no vale, la conexión pasa a CADUCADA
   y un ADMIN debe pulsar «Reconectar con a3» en la app. */

export interface Conexion {
  clientId: string;
  redirectUri: string | null;
  urlRetornoApp: string;
  estado: string;
  caducaUtc: Date | null;
  marcaEmpleados: string | null;
}

export async function leerConexion(): Promise<Conexion> {
  const r = await (await getPool()).request().query(
    `SELECT ClientId, RedirectUri, UrlRetornoApp, Estado, CaducaUtc, CONVERT(char(10), MarcaEmpleados, 23) AS Marca
       FROM fich.A3Conexion WHERE Id = 1`
  );
  const c = r.recordset[0];
  if (!c) throw new Error("Falta la fila de fich.A3Conexion (script 010)");
  return { clientId: c.ClientId, redirectUri: c.RedirectUri, urlRetornoApp: c.UrlRetornoApp, estado: c.Estado, caducaUtc: c.CaducaUtc, marcaEmpleados: c.Marca };
}

export async function marcarConexion(estado: string, error: string | null) {
  await (await getPool())
    .request()
    .input("e", sql.VarChar(12), estado)
    .input("err", sql.NVarChar(1000), error ? error.slice(0, 1000) : null)
    .query("UPDATE fich.A3Conexion SET Estado = @e, UltimoError = @err WHERE Id = 1");
}

export class ConexionNoDisponible extends Error {
  name = "ConexionNoDisponible";
}

let cache: { token: string; expira: number } | null = null;

export async function tokenAcceso(): Promise<string> {
  if (cache && cache.expira > Date.now() + 120000) return cache.token;
  const con = await leerConexion();
  if (con.estado === "DESCONECTADA") throw new ConexionNoDisponible("No hay conexión con a3: un ADMIN debe pulsar «Conectar con a3».");
  const [secreto, refresco] = await Promise.all([leerSecreto(SECRETO_CLIENTE), leerSecreto(SECRETO_REFRESCO)]);
  if (!secreto) throw new ConexionNoDisponible(`Falta el secreto ${SECRETO_CLIENTE} en Key Vault`);
  if (!refresco) {
    await marcarConexion("CADUCADA", "No hay refresh token guardado");
    throw new ConexionNoDisponible("La conexión con a3 no tiene permiso guardado: reconectar.");
  }
  try {
    const t = await refrescar(con.clientId, secreto, refresco);
    if (t.refresh_token && t.refresh_token !== refresco) await guardarSecreto(SECRETO_REFRESCO, t.refresh_token, con.caducaUtc ?? undefined);
    cache = { token: t.access_token, expira: Date.now() + (t.expires_in ?? 3600) * 1000 };
    if (con.estado !== "CONECTADA") await marcarConexion("CONECTADA", null);
    return cache.token;
  } catch (e: any) {
    if (e instanceof ErrorOAuth && (e.codigo === "invalid_grant" || e.status === 400)) {
      await marcarConexion("CADUCADA", e.message);
      throw new ConexionNoDisponible("El permiso de a3 ha caducado: un ADMIN debe pulsar «Reconectar con a3».");
    }
    throw e;
  }
}

export const invalidarToken = () => (cache = null);

/** Cliente de la API listo para usar (Apikey de Key Vault + token de acceso). */
export async function crearCliente(): Promise<A3Cliente> {
  const apikey = await leerSecreto(SECRETO_APIKEY);
  if (!apikey) throw new ConexionNoDisponible(`Falta el secreto ${SECRETO_APIKEY} en Key Vault`);
  await tokenAcceso(); // falla pronto si la conexión no vale
  const max = Number(process.env.A3_MAX_LLAMADAS);
  return new A3Cliente({ apikey, token: tokenAcceso, invalidarToken, maxLlamadas: Number.isInteger(max) && max > 0 ? max : 40000 });
}
