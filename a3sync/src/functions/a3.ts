import { app, HttpRequest, InvocationContext } from "@azure/functions";
import { getPool, sql, leerSecreto, guardarSecreto, SECRETO_CLIENTE, SECRETO_REFRESCO } from "../lib/infra";
import { canjearCodigo, usuarioDeTokens, DIAS_REFRESCO } from "../lib/oauth";
import { leerConexion, marcarConexion, invalidarToken } from "../lib/conexion";
import { sincronizar, auditar } from "../lib/sync";

/* Funciones del conector a3:
   - a3/callback (HTTP): vuelta del login de Wolters Kluwer tras «Conectar con a3» en la app.
   - solicitudes (cada 5 min): atiende las sincronizaciones pedidas desde la app.
   - nocturna (01:30 UTC ≈ 02:30 en invierno / 03:30 en verano): sincronización diaria; los domingos, completa. */

const MAX_STATE_MIN = 15;
const MAX_EN_CURSO_H = 3;

const redirigir = (url: string, estado: "ok" | "error", motivo?: string) => ({
  status: 302,
  headers: { Location: `${url}${url.includes("?") ? "&" : "?"}conexion=${estado}${motivo ? `&motivo=${encodeURIComponent(motivo)}` : ""}`, "Cache-Control": "no-store" },
});

app.http("a3Callback", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "a3/callback",
  handler: async (req: HttpRequest, ctx: InvocationContext) => {
    let retorno = "/";
    try {
      const con = await leerConexion();
      retorno = con.urlRetornoApp;
      const state = req.query.get("state") ?? "";
      const code = req.query.get("code") ?? "";
      const pool = await getPool();
      // El state solo vale una vez y durante 15 minutos
      const s = await pool
        .request()
        .input("s", sql.VarChar(64), state)
        .input("min", sql.Int, MAX_STATE_MIN)
        .query(
          `UPDATE fich.A3Conexion SET OAuthState = NULL, OAuthStateUtc = NULL
           OUTPUT DELETED.OAuthPorId AS porId
           WHERE Id = 1 AND OAuthState IS NOT NULL AND OAuthState = @s AND OAuthStateUtc > DATEADD(MINUTE, -@min, SYSUTCDATETIME())`
        );
      if (!state || !s.recordset.length) return redirigir(retorno, "error", "La solicitud de conexión no es válida o ha caducado. Vuelve a pulsar «Conectar con a3».");
      const porId: number | null = s.recordset[0].porId ?? null;
      if (req.query.get("error") || !code) return redirigir(retorno, "error", `Wolters Kluwer no autorizó la conexión (${req.query.get("error") ?? "sin código"}).`);
      if (!con.redirectUri) return redirigir(retorno, "error", "Falta la redirect_uri en fich.A3Conexion.");

      const secreto = await leerSecreto(SECRETO_CLIENTE);
      if (!secreto) return redirigir(retorno, "error", "Falta el secreto a3-client-secret en Key Vault.");
      const t = await canjearCodigo(con.clientId, secreto, code, con.redirectUri);
      if (!t.refresh_token) return redirigir(retorno, "error", "Wolters Kluwer no devolvió permiso de acceso continuado (offline_access).");
      const caduca = new Date(Date.now() + DIAS_REFRESCO * 86400000);
      await guardarSecreto(SECRETO_REFRESCO, t.refresh_token, caduca);
      invalidarToken();
      const usuarioA3 = usuarioDeTokens(t);
      await pool
        .request()
        .input("u", sql.NVarChar(254), usuarioA3)
        .input("c", sql.DateTime2(0), caduca)
        .input("por", sql.Int, porId)
        .query(
          `UPDATE fich.A3Conexion SET Estado = 'CONECTADA', UsuarioA3 = @u, ConectadaUtc = SYSUTCDATETIME(), CaducaUtc = @c,
                  ConectadaPorId = @por, UltimoError = NULL WHERE Id = 1`
        );
      await auditar(pool, "A3_CONECTAR", "A3Conexion", 1, `Conectado con el usuario de a3 ${usuarioA3 ?? "(desconocido)"}`, porId);
      return redirigir(retorno, "ok");
    } catch (e: any) {
      ctx.error(e);
      await marcarConexion("ERROR", String(e?.message ?? e)).catch(() => {});
      return redirigir(retorno, "error", "No se pudo completar la conexión con a3. Revisa el estado en la app.");
    }
  },
});

/** Toma la siguiente sincronización pendiente (si no hay otra en curso) y la ejecuta. */
async function atenderSolicitud(ctx: InvocationContext) {
  const pool = await getPool();
  await pool
    .request()
    .input("h", sql.Int, MAX_EN_CURSO_H)
    .query(
      `UPDATE fich.A3Sincronizaciones SET Estado = 'ERROR', FinUtc = SYSUTCDATETIME(), Error = N'Interrumpida (más de ' + CAST(@h AS NVARCHAR(3)) + N' h en curso)'
        WHERE Estado = 'EN_CURSO' AND InicioUtc < DATEADD(HOUR, -@h, SYSUTCDATETIME())`
    );
  const r = await pool.request().query(
    `UPDATE TOP (1) s SET Estado = 'EN_CURSO', InicioUtc = SYSUTCDATETIME()
       OUTPUT INSERTED.SincronizacionId AS id, INSERTED.Completa AS completa, INSERTED.Tipo AS tipo
       FROM fich.A3Sincronizaciones s WITH (UPDLOCK, READPAST)
      WHERE s.Estado = 'PENDIENTE'
        AND NOT EXISTS (SELECT 1 FROM fich.A3Sincronizaciones x WHERE x.Estado = 'EN_CURSO')
        AND s.SincronizacionId = (SELECT MIN(SincronizacionId) FROM fich.A3Sincronizaciones WHERE Estado = 'PENDIENTE')`
  );
  const job = r.recordset[0];
  if (!job) return;
  const log = (m: string) => ctx.log(`[a3 #${job.id}] ${m}`);
  log(`Inicio (${job.tipo}${job.completa ? ", completa" : ""})`);
  try {
    const est = await sincronizar(!!job.completa, log);
    await pool
      .request()
      .input("id", sql.Int, job.id)
      .input("estado", sql.VarChar(10), est.errores.length ? "ERROR" : "OK")
      .input("ll", sql.Int, est.llamadas)
      .input("em", sql.Int, est.empresas)
      .input("ce", sql.Int, est.centros)
      .input("le", sql.Int, est.empleadosLeidos)
      .input("cr", sql.Int, est.usuariosCreados)
      .input("ac", sql.Int, est.usuariosActualizados)
      .input("de", sql.Int, est.usuariosDesactivados)
      .input("pe", sql.Int, est.pendientes)
      .input("err", sql.NVarChar(1000), est.errores.length ? est.errores.join(" | ").slice(0, 1000) : null)
      .query(
        `UPDATE fich.A3Sincronizaciones SET Estado = @estado, FinUtc = SYSUTCDATETIME(), Llamadas = @ll, Empresas = @em, Centros = @ce,
                EmpleadosLeidos = @le, UsuariosCreados = @cr, UsuariosActualizados = @ac, UsuariosDesactivados = @de, Pendientes = @pe, Error = @err
          WHERE SincronizacionId = @id`
      );
    log(`Fin: ${JSON.stringify(est)}`);
  } catch (e: any) {
    ctx.error(e);
    await pool
      .request()
      .input("id", sql.Int, job.id)
      .input("err", sql.NVarChar(1000), String(e?.message ?? e).slice(0, 1000))
      .query("UPDATE fich.A3Sincronizaciones SET Estado = 'ERROR', FinUtc = SYSUTCDATETIME(), Error = @err WHERE SincronizacionId = @id");
  }
}

app.timer("a3Solicitudes", {
  schedule: "0 */5 * * * *",
  handler: async (_t, ctx) => {
    await atenderSolicitud(ctx);
  },
});

app.timer("a3Nocturna", {
  schedule: "0 30 1 * * *",
  handler: async (_t, ctx) => {
    const pool = await getPool();
    // Conexión caducada por fecha: se marca para que la app avise
    await pool.request().query("UPDATE fich.A3Conexion SET Estado = 'CADUCADA' WHERE Id = 1 AND Estado = 'CONECTADA' AND CaducaUtc < SYSUTCDATETIME()");
    const con = await leerConexion();
    if (con.estado !== "CONECTADA") {
      ctx.warn(`Sincronización nocturna omitida: conexión ${con.estado}`);
      return;
    }
    const domingo = new Date().getUTCDay() === 0;
    await pool
      .request()
      .input("c", sql.Bit, domingo)
      .query(
        `IF NOT EXISTS (SELECT 1 FROM fich.A3Sincronizaciones WHERE Estado IN ('PENDIENTE','EN_CURSO'))
         INSERT INTO fich.A3Sincronizaciones (Tipo, Completa) VALUES ('NOCTURNA', @c)`
      );
    await atenderSolicitud(ctx);
  },
});
