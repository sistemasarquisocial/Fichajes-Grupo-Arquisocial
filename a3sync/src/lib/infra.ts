import sql from "mssql";
import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

/* Acceso a Azure SQL y Key Vault con la identidad administrada de la Function App (sin contraseñas).
   Variables de la Function App: SQL_SERVER, SQL_DATABASE, KEY_VAULT_URL. */

const credencial = new DefaultAzureCredential();
let poolPromise: Promise<sql.ConnectionPool> | null = null;
const TRANSITORIOS = new Set([4060, 40197, 40501, 40613, 49918, 49919, 49920, 4221, 10928, 10929]);

function crearPool() {
  const server = process.env.SQL_SERVER;
  const database = process.env.SQL_DATABASE;
  if (!server || !database) throw new Error("Faltan SQL_SERVER o SQL_DATABASE");
  const pool = new sql.ConnectionPool({
    server,
    database,
    authentication: { type: "azure-active-directory-default", options: {} } as any,
    options: { encrypt: true, trustServerCertificate: false },
    pool: { max: 5 },
    requestTimeout: 120000,
    connectionTimeout: 60000,
  });
  pool.on("error", () => (poolPromise = null));
  return pool.connect();
}

/** Pool de conexiones (reintenta mientras la BD serverless se reanuda). */
export async function getPool(): Promise<sql.ConnectionPool> {
  for (let i = 1; i <= 5; i++) {
    try {
      if (!poolPromise) poolPromise = crearPool();
      return await poolPromise;
    } catch (e: any) {
      poolPromise = null;
      const n = e?.originalError?.info?.number ?? e?.number;
      if (!(TRANSITORIOS.has(n) || e?.code === "ETIMEOUT" || e?.code === "ESOCKET") || i === 5) throw e;
      await new Promise((r) => setTimeout(r, 10000 * i));
    }
  }
  throw new Error("No se pudo conectar a la base de datos");
}

export { sql };

/* ---------- Key Vault ---------- */
export const SECRETO_CLIENTE = "a3-client-secret";
export const SECRETO_APIKEY = "a3-apikey";
export const SECRETO_REFRESCO = "a3-refresh-token";

let kv: SecretClient | null = null;
function cliente(): SecretClient {
  const url = process.env.KEY_VAULT_URL;
  if (!url) throw new Error("Falta KEY_VAULT_URL");
  return (kv ??= new SecretClient(url, credencial));
}

export async function leerSecreto(nombre: string): Promise<string | null> {
  try {
    return (await cliente().getSecret(nombre)).value ?? null;
  } catch (e: any) {
    if (e?.statusCode === 404) return null;
    throw e;
  }
}

export async function guardarSecreto(nombre: string, valor: string, caduca?: Date) {
  await cliente().setSecret(nombre, valor, { expiresOn: caduca, contentType: "text/plain" });
}
