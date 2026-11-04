import { app } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { ipCliente } from "../lib/auth";
import { json, error, leerJson, conSesion } from "../lib/http";
import { auditar } from "../lib/auditoria";
import { cargarOrg, nombreDe } from "../lib/organizacion";
import { fechaLocal, TipoFichaje } from "../lib/jornada";
import { fichajesEfectivos, localAUtc } from "../lib/correcciones";
import {
  TIPOS_INCIDENCIA, TipoIncidencia, Propuesta, puedeResolver, solicitantesDe, quienResuelve, contarPendientes,
  errorSecuencia, entorno, errorFecha,
} from "../lib/incidencias";
import { contarAvisosEscalados } from "../lib/horarios";

/* Incidencias de fichaje (ver lib/incidencias.ts y db/007_incidencias.sql).
   El fichaje original nunca se modifica: al aceptar se registra una corrección (LEDGER) que la app aplica encima. */

const TZ = () => process.env.TZ_APP || "Europe/Madrid";
const TIPOS_FICHAJE: TipoFichaje[] = ["ENTRADA", "SALIDA", "PAUSA_INICIO", "PAUSA_FIN"];
const DIA = 86400000;
const MAX_PENDIENTES = 20;

const SELECT = `
  SELECT i.IncidenciaId AS id, i.UsuarioId AS usuarioId, s.Nombre + N' ' + s.Apellidos AS solicitante,
         c.Nombre AS centro, c.CodigoServicio AS codigoServicio, d.Nombre AS departamento,
         i.Tipo AS tipo, i.FichajeId AS fichajeId, i.TipoFichaje AS tipoFichaje,
         i.FechaHoraOriginalUtc AS originalUtc, i.FechaHoraPropuestaUtc AS propuestaUtc,
         i.Comentario AS comentario, i.Estado AS estado, i.CreadoUtc AS creadoUtc,
         r.Nombre + N' ' + r.Apellidos AS resueltaPor, i.ResueltaUtc AS resueltaUtc, i.MotivoRechazo AS motivoRechazo
    FROM fich.Incidencias i
    JOIN fich.Usuarios s ON s.UsuarioId = i.UsuarioId
    LEFT JOIN fich.Centros c ON c.CentroId = s.CentroId
    LEFT JOIN fich.Departamentos d ON d.DepartamentoId = s.DepartamentoId
    LEFT JOIN fich.Usuarios r ON r.UsuarioId = i.ResueltaPorId`;

const texto = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const hhmm = (d: Date | null) => (d ? d.toLocaleTimeString("es-ES", { timeZone: TZ(), hour: "2-digit", minute: "2-digit" }) : "—");
const fyh = (d: Date | null) => (d ? `${fechaLocal(d, TZ())} ${hhmm(d)}` : "—");

/* ---------- Mis incidencias ---------- */
app.http("misIncidencias", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "incidencias/mias",
  handler: conSesion(async (_req, _ctx, u) => {
    const pool = await getPool();
    const r = await pool
      .request()
      .input("uid", sql.Int, u.usuarioId)
      .query(`${SELECT} WHERE i.UsuarioId = @uid AND (i.Estado = 'PENDIENTE' OR i.CreadoUtc >= DATEADD(DAY, -120, SYSUTCDATETIME())) ORDER BY i.CreadoUtc DESC`);
    const org = await cargarOrg();
    return json(200, { resuelve: quienResuelve(org, u.usuarioId), incidencias: r.recordset });
  }),
});

/* ---------- Abrir incidencia ---------- */
app.http("crearIncidencia", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "incidencias",
  handler: conSesion(async (req, _ctx, u) => {
    const b = await leerJson(req);
    const tipo = b?.tipo as TipoIncidencia;
    if (!TIPOS_INCIDENCIA.includes(tipo)) return error(400, "Tipo de incidencia no válido");
    const comentario = texto(b?.comentario);
    if (comentario.length < 5) return error(400, "El comentario es obligatorio (mínimo 5 caracteres)");
    if (comentario.length > 500) return error(400, "El comentario no puede superar 500 caracteres");

    const ahora = new Date();
    let nuevaUtc: Date | null = null;
    if (tipo !== "ANULAR") {
      nuevaUtc = localAUtc(String(b?.fecha ?? ""), String(b?.hora ?? ""), TZ());
      if (!nuevaUtc) return error(400, "Indica la fecha y la nueva hora");
      const e = errorFecha(nuevaUtc, ahora);
      if (e) return error(400, e);
    }

    const pool = await getPool();
    let fichajeId: number | null = null;
    let tipoFichaje: TipoFichaje;
    let originalUtc: Date | null = null;
    let referencia: Date;

    if (tipo === "ANADIR") {
      tipoFichaje = b?.tipoFichaje;
      if (!TIPOS_FICHAJE.includes(tipoFichaje)) return error(400, "Indica qué fichaje olvidaste (entrada, salida o pausa)");
      referencia = nuevaUtc!;
    } else {
      fichajeId = Number(b?.fichajeId);
      if (!Number.isInteger(fichajeId) || fichajeId <= 0) return error(400, "Indica el fichaje a corregir");
      const f = await pool
        .request()
        .input("id", sql.BigInt, fichajeId)
        .input("uid", sql.Int, u.usuarioId)
        .query("SELECT FichajeId, FechaHoraUtc FROM fich.Fichajes WHERE FichajeId = @id AND UsuarioId = @uid");
      if (!f.recordset[0]) return error(404, "Fichaje no encontrado");
      // Estado actual del fichaje (puede tener ya una corrección aceptada)
      const lista = await entorno(u.usuarioId, f.recordset[0].FechaHoraUtc);
      const actual = lista.find((x) => x.id === fichajeId);
      if (!actual || actual.anulado) return error(409, "Ese fichaje ya está anulado");
      const e = errorFecha(actual.fechaHoraUtc, ahora);
      if (e) return error(400, e);
      tipoFichaje = actual.tipo;
      originalUtc = actual.fechaHoraUtc;
      referencia = originalUtc;
      if (tipo === "CAMBIAR_HORA") {
        if (Math.abs(nuevaUtc!.getTime() - originalUtc.getTime()) < 60000) return error(400, "La nueva hora es igual a la actual");
        if (Math.abs(nuevaUtc!.getTime() - originalUtc.getTime()) > DIA) return error(400, "La nueva hora no puede distar más de 24 horas de la original. Si es otro día, anula este fichaje y añade el correcto.");
      }
      const dup = await pool
        .request()
        .input("id", sql.BigInt, fichajeId)
        .query("SELECT TOP 1 IncidenciaId FROM fich.Incidencias WHERE FichajeId = @id AND Estado = 'PENDIENTE'");
      if (dup.recordset[0]) return error(409, "Ya tienes una incidencia pendiente sobre ese fichaje. Retírala si quieres cambiarla.");
    }

    const p: Propuesta = { tipo, fichajeId, tipoFichaje, nuevaUtc };
    const eSec = errorSecuencia(await entorno(u.usuarioId, referencia), p, referencia);
    if (eSec) return error(400, eSec);

    const pend = await pool.request().input("uid", sql.Int, u.usuarioId).query("SELECT COUNT(*) AS n FROM fich.Incidencias WHERE UsuarioId = @uid AND Estado = 'PENDIENTE'");
    if (pend.recordset[0].n >= MAX_PENDIENTES) return error(409, `Tienes ${MAX_PENDIENTES} incidencias pendientes. Espera a que se resuelvan.`);

    const r = await pool
      .request()
      .input("uid", sql.Int, u.usuarioId)
      .input("tipo", sql.VarChar(15), tipo)
      .input("fid", sql.BigInt, fichajeId)
      .input("tf", sql.VarChar(20), tipoFichaje)
      .input("orig", sql.DateTime2, originalUtc)
      .input("prop", sql.DateTime2, nuevaUtc)
      .input("com", sql.NVarChar(500), comentario)
      .query(
        `INSERT INTO fich.Incidencias (UsuarioId, Tipo, FichajeId, TipoFichaje, FechaHoraOriginalUtc, FechaHoraPropuestaUtc, Comentario)
         OUTPUT INSERTED.IncidenciaId VALUES (@uid, @tipo, @fid, @tf, @orig, @prop, @com)`
      );
    const id = r.recordset[0].IncidenciaId;
    await auditar(u.usuarioId, "CREAR_INCIDENCIA", "Incidencia", id, `${tipo} ${tipoFichaje} fichaje=${fichajeId ?? "-"} original=${fyh(originalUtc)} propuesta=${fyh(nuevaUtc)}`, ipCliente(req));
    return json(201, { id });
  }),
});

/* ---------- Retirar (solo el propio empleado, mientras esté pendiente) ---------- */
app.http("retirarIncidencia", {
  methods: ["PUT"],
  authLevel: "anonymous",
  route: "incidencias/{id:int}/retirar",
  handler: conSesion(async (req, _ctx, u) => {
    const id = Number(req.params.id);
    const pool = await getPool();
    const r = await pool
      .request()
      .input("id", sql.Int, id)
      .input("uid", sql.Int, u.usuarioId)
      .query(
        `UPDATE fich.Incidencias SET Estado = 'RETIRADA', ResueltaPorId = @uid, ResueltaUtc = SYSUTCDATETIME()
          WHERE IncidenciaId = @id AND UsuarioId = @uid AND Estado = 'PENDIENTE'`
      );
    if (!r.rowsAffected[0]) return error(409, "La incidencia no existe o ya no está pendiente");
    await auditar(u.usuarioId, "RETIRAR_INCIDENCIA", "Incidencia", id, null, ipCliente(req));
    return json(200, { ok: true });
  }),
});

/* ---------- Aprobaciones: pendientes (con el contexto del día) o resueltas ---------- */
app.http("aprobaciones", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "aprobaciones",
  handler: conSesion(async (req, _ctx, u) => {
    const historico = req.query.get("estado") === "RESUELTAS";
    const org = await cargarOrg();
    const ids = solicitantesDe(org, u);
    if (!ids.length) return json(200, { incidencias: [] });
    const pool = await getPool();
    const r = await pool
      .request()
      .input("ids", sql.NVarChar(sql.MAX), ids.join(","))
      .query(
        `${SELECT} WHERE i.UsuarioId IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))
           AND ${historico ? "i.Estado <> 'PENDIENTE' AND i.CreadoUtc >= DATEADD(DAY, -90, SYSUTCDATETIME())" : "i.Estado = 'PENDIENTE'"}
         ORDER BY i.CreadoUtc ${historico ? "DESC" : "ASC"}`
      );
    const incidencias = r.recordset as any[];
    if (!historico && incidencias.length) {
      // Fichajes del día afectado, para que el aprobador vea el contexto
      const refs = incidencias.map((i) => (i.propuestaUtc ?? i.originalUtc) as Date);
      const ini = new Date(Math.min(...refs.map((d) => d.getTime())) - 2 * DIA);
      const fin = new Date(Math.max(...refs.map((d) => d.getTime())) + 2 * DIA);
      const ef = await fichajesEfectivos([...new Set(incidencias.map((i) => i.usuarioId as number))], ini, fin);
      for (const i of incidencias) {
        const dias = new Set([i.originalUtc, i.propuestaUtc].filter(Boolean).map((d: Date) => fechaLocal(d, TZ())));
        i.contexto = (ef.get(i.usuarioId) ?? [])
          .filter((f) => dias.has(fechaLocal(f.fechaHoraUtc, TZ())))
          .map((f) => ({ id: f.id, tipo: f.tipo, fechaHoraUtc: f.fechaHoraUtc.toISOString(), corregido: f.corregido, anadido: f.anadido, anulado: f.anulado }));
      }
    }
    return json(200, { incidencias });
  }),
});

app.http("aprobacionesContador", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "aprobaciones/contador",
  handler: conSesion(async (_req, _ctx, u) => {
    const org = await cargarOrg();
    const [pendientes, avisosEquipo] = await Promise.all([contarPendientes(org, u), contarAvisosEscalados(org, u.usuarioId)]);
    return json(200, { pendientes, avisosEquipo });
  }),
});

/* ---------- Resolver: aceptar (registra la corrección) o rechazar (motivo obligatorio) ---------- */
app.http("resolverIncidencia", {
  methods: ["PUT"],
  authLevel: "anonymous",
  route: "aprobaciones/{id:int}/resolver",
  handler: conSesion(async (req, _ctx, u) => {
    const id = Number(req.params.id);
    const b = await leerJson(req);
    const accion = b?.accion;
    if (accion !== "ACEPTAR" && accion !== "RECHAZAR") return error(400, "Acción no válida");
    const motivo = texto(b?.motivo);
    if (accion === "RECHAZAR" && motivo.length < 5) return error(400, "Indica el motivo del rechazo (mínimo 5 caracteres)");
    if (motivo.length > 500) return error(400, "El motivo no puede superar 500 caracteres");

    const org = await cargarOrg();
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      const r = await new sql.Request(tx)
        .input("id", sql.Int, id)
        .query(
          `SELECT IncidenciaId, UsuarioId, Tipo, FichajeId, TipoFichaje, FechaHoraOriginalUtc, FechaHoraPropuestaUtc, Estado
             FROM fich.Incidencias WITH (UPDLOCK, ROWLOCK) WHERE IncidenciaId = @id`
        );
      const inc = r.recordset[0];
      if (!inc) { await tx.rollback(); return error(404, "Incidencia no encontrada"); }
      if (!puedeResolver(org, u, inc.UsuarioId)) { await tx.rollback(); return error(403, "No te corresponde resolver esta incidencia"); }
      if (inc.Estado !== "PENDIENTE") { await tx.rollback(); return error(409, "La incidencia ya no está pendiente"); }

      if (accion === "ACEPTAR") {
        // Serializa con los fichajes del empleado y comprueba que todo sigue igual que cuando la abrió
        await new sql.Request(tx).input("uid", sql.Int, inc.UsuarioId).query("SELECT UsuarioId FROM fich.Usuarios WITH (UPDLOCK, ROWLOCK) WHERE UsuarioId = @uid");
        const fid = inc.FichajeId === null ? null : Number(inc.FichajeId);
        const p: Propuesta = { tipo: inc.Tipo, fichajeId: fid, tipoFichaje: inc.TipoFichaje, nuevaUtc: inc.FechaHoraPropuestaUtc };
        const referencia: Date = inc.FechaHoraOriginalUtc ?? inc.FechaHoraPropuestaUtc;
        const lista = await entorno(inc.UsuarioId, referencia, tx);
        if (fid !== null) {
          const actual = lista.find((f) => f.id === fid);
          if (!actual || actual.anulado || actual.fechaHoraUtc.getTime() !== new Date(inc.FechaHoraOriginalUtc).getTime()) {
            await tx.rollback();
            return error(409, "El fichaje ha cambiado desde que se abrió la incidencia. Recházala para que el empleado abra una nueva.");
          }
        }
        const eSec = errorSecuencia(lista, p, referencia);
        if (eSec) {
          await tx.rollback();
          return error(409, "Ya no se puede aplicar: los fichajes han cambiado y quedarían descuadrados. Recházala indicando que abra una nueva.");
        }
        await new sql.Request(tx)
          .input("inc", sql.Int, id)
          .input("uid", sql.Int, inc.UsuarioId)
          .input("tipo", sql.VarChar(15), inc.Tipo)
          .input("fid", sql.BigInt, fid)
          .input("tf", sql.VarChar(20), inc.TipoFichaje)
          .input("fh", sql.DateTime2, inc.FechaHoraPropuestaUtc)
          .input("apr", sql.Int, u.usuarioId)
          .query(
            `INSERT INTO fich.CorreccionesFichaje (IncidenciaId, UsuarioId, Tipo, FichajeId, TipoFichaje, FechaHoraUtc, AprobadaPorId)
             VALUES (@inc, @uid, @tipo, @fid, @tf, @fh, @apr)`
          );
      }

      await new sql.Request(tx)
        .input("id", sql.Int, id)
        .input("estado", sql.VarChar(12), accion === "ACEPTAR" ? "ACEPTADA" : "RECHAZADA")
        .input("por", sql.Int, u.usuarioId)
        .input("motivo", sql.NVarChar(500), accion === "RECHAZAR" ? motivo : null)
        .query("UPDATE fich.Incidencias SET Estado = @estado, ResueltaPorId = @por, ResueltaUtc = SYSUTCDATETIME(), MotivoRechazo = @motivo WHERE IncidenciaId = @id");
      await auditar(
        u.usuarioId,
        accion === "ACEPTAR" ? "ACEPTAR_INCIDENCIA" : "RECHAZAR_INCIDENCIA",
        "Incidencia",
        id,
        `empleado=${inc.UsuarioId} (${nombreDe(org, inc.UsuarioId)}) ${inc.Tipo} ${inc.TipoFichaje} original=${fyh(inc.FechaHoraOriginalUtc)} propuesta=${fyh(inc.FechaHoraPropuestaUtc)}${accion === "RECHAZAR" ? ` motivo=${motivo}` : ""}`,
        ipCliente(req),
        tx
      );
      await tx.commit();
      return json(200, { ok: true });
    } catch (e) {
      await tx.rollback().catch(() => {});
      throw e;
    }
  }),
});
