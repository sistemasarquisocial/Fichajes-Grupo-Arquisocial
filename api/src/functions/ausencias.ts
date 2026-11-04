import { app, HttpRequest } from "@azure/functions";
import { getPool, sql } from "../lib/db";
import { ipCliente } from "../lib/auth";
import { json, error, leerJson, conSesion } from "../lib/http";
import { auditar } from "../lib/auditoria";
import { cargarOrg, nombreDe } from "../lib/organizacion";
import { fechaLocal } from "../lib/jornada";
import { puedeResolver, solicitantesDe, quienResuelve } from "../lib/incidencias";
import { DIAS_ATRAS, DIAS_ADELANTE, MAX_DIAS, puedeVerJustificante, textoPeriodo } from "../lib/ausencias";
import { RE_HORA } from "../lib/horarios";
import { MAX_BYTES, almacenConfigurado, tipoArchivo, sha256, nombreSeguro, subir, borrar, enlaceLectura, existe, Contenedor } from "../lib/almacen";

/* Ausencias justificadas (ver lib/ausencias.ts y db/009_ausencias.sql) y sus justificantes (Azure Blob Storage). */

const TZ = () => process.env.TZ_APP || "Europe/Madrid";
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const DIA = 86400000;
const MAX_PENDIENTES = 20;
const MAX_DOCS = 5;

const texto = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
const sumarDias = (f: string, n: number) => new Date(Date.parse(`${f}T12:00:00Z`) + n * DIA).toISOString().slice(0, 10);
const diasEntre = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DIA);

const SELECT = `
  SELECT a.AusenciaId AS id, a.UsuarioId AS usuarioId, s.Nombre + N' ' + s.Apellidos AS solicitante,
         c.Nombre AS centro, c.CodigoServicio AS codigoServicio, d.Nombre AS departamento,
         a.MotivoId AS motivoId, m.Nombre AS motivo, m.RequiereJustificante AS requiereJustificante,
         CONVERT(char(10), a.FechaInicio, 23) AS fechaInicio, CONVERT(char(10), a.FechaFin, 23) AS fechaFin,
         CONVERT(char(5), a.HoraInicio, 108) AS horaInicio, CONVERT(char(5), a.HoraFin, 108) AS horaFin,
         a.Comentario AS comentario, a.Estado AS estado, a.CreadoUtc AS creadoUtc,
         r.Nombre + N' ' + r.Apellidos AS resueltaPor, a.ResueltaUtc AS resueltaUtc, a.MotivoRechazo AS motivoRechazo
    FROM fich.Ausencias a
    JOIN fich.MotivosAusencia m ON m.MotivoId = a.MotivoId
    JOIN fich.Usuarios s ON s.UsuarioId = a.UsuarioId
    LEFT JOIN fich.Centros c ON c.CentroId = s.CentroId
    LEFT JOIN fich.Departamentos d ON d.DepartamentoId = s.DepartamentoId
    LEFT JOIN fich.Usuarios r ON r.UsuarioId = a.ResueltaPorId`;

/** Añade los justificantes vigentes a cada ausencia. */
async function conDocumentos(lista: any[]) {
  for (const a of lista) { a.requiereJustificante = !!a.requiereJustificante; a.documentos = []; }
  if (!lista.length) return lista;
  const r = await (await getPool())
    .request()
    .input("ids", sql.NVarChar(sql.MAX), lista.map((a) => a.id).join(","))
    .query(
      `SELECT DocumentoId AS id, AusenciaId AS ausenciaId, NombreOriginal AS nombre, TipoMime AS tipo, Bytes AS bytes, SubidoUtc AS subidoUtc
         FROM fich.Documentos WHERE BorradoUtc IS NULL AND AusenciaId IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))
        ORDER BY SubidoUtc`
    );
  const porId = new Map(lista.map((a) => [a.id, a]));
  for (const d of r.recordset as any[]) porId.get(d.ausenciaId)?.documentos.push({ id: d.id, nombre: d.nombre, tipo: d.tipo, bytes: d.bytes, subidoUtc: d.subidoUtc });
  return lista;
}

/* ---------- Motivos activos (para el formulario) ---------- */
app.http("motivosAusencia", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "ausencias/motivos",
  handler: conSesion(async () => {
    const r = await (await getPool())
      .request()
      .query("SELECT MotivoId AS id, Nombre AS nombre, RequiereJustificante AS requiereJustificante FROM fich.MotivosAusencia WHERE Activo = 1 ORDER BY Orden, Nombre");
    return json(200, { motivos: r.recordset.map((m: any) => ({ ...m, requiereJustificante: !!m.requiereJustificante })) });
  }),
});

/* ---------- Mis ausencias ---------- */
app.http("misAusencias", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "ausencias/mias",
  handler: conSesion(async (_req, _ctx, u) => {
    const r = await (await getPool())
      .request()
      .input("uid", sql.Int, u.usuarioId)
      .query(
        `${SELECT} WHERE a.UsuarioId = @uid
           AND (a.Estado = 'PENDIENTE' OR a.FechaFin >= CAST(SYSUTCDATETIME() AS date) OR a.CreadoUtc >= DATEADD(DAY, -120, SYSUTCDATETIME()))
         ORDER BY a.FechaInicio DESC, a.HoraInicio DESC`
      );
    const org = await cargarOrg();
    return json(200, { resuelve: quienResuelve(org, u.usuarioId), ausencias: await conDocumentos(r.recordset), almacen: almacenConfigurado() });
  }),
});

/* ---------- Justificar una ausencia ---------- */
app.http("crearAusencia", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "ausencias",
  handler: conSesion(async (req, _ctx, u) => {
    const b = await leerJson(req);
    const motivoId = Number(b?.motivoId);
    const fi = String(b?.fechaInicio ?? "");
    const ff = String(b?.fechaFin ?? fi);
    const hi = b?.horaInicio ? String(b.horaInicio) : null;
    const hf = b?.horaFin ? String(b.horaFin) : null;
    const comentario = texto(b?.comentario);
    if (!Number.isInteger(motivoId) || motivoId <= 0) return error(400, "Indica el motivo");
    if (!RE_FECHA.test(fi) || !RE_FECHA.test(ff) || isNaN(Date.parse(fi)) || isNaN(Date.parse(ff))) return error(400, "Indica las fechas");
    if (ff < fi) return error(400, "La fecha de fin no puede ser anterior a la de inicio");
    const hoy = fechaLocal(new Date(), TZ());
    if (fi < sumarDias(hoy, -DIAS_ATRAS)) return error(400, `Solo se pueden justificar ausencias de los últimos ${DIAS_ATRAS} días`);
    if (ff > sumarDias(hoy, DIAS_ADELANTE)) return error(400, "La ausencia no puede terminar dentro de más de un año");
    if (diasEntre(fi, ff) + 1 > MAX_DIAS) return error(400, `Como máximo ${MAX_DIAS} días por solicitud`);
    if ((hi === null) !== (hf === null)) return error(400, "Indica la hora de inicio y la de fin");
    if (hi !== null) {
      if (fi !== ff) return error(400, "Una ausencia por horas debe ser de un solo día");
      if (!RE_HORA.test(hi) || !RE_HORA.test(hf!)) return error(400, "Hora no válida");
      if (hf! <= hi) return error(400, "La hora de fin debe ser posterior a la de inicio");
    }
    if (comentario.length > 500) return error(400, "El comentario no puede superar 500 caracteres");

    const pool = await getPool();
    const m = await pool.request().input("id", sql.Int, motivoId).query("SELECT Nombre, Activo FROM fich.MotivosAusencia WHERE MotivoId = @id");
    if (!m.recordset[0]?.Activo) return error(400, "Motivo no válido");

    // No puede solaparse con otra ausencia pendiente o aprobada
    const sol = await pool
      .request()
      .input("uid", sql.Int, u.usuarioId)
      .input("fi", sql.Date, fi)
      .input("ff", sql.Date, ff)
      .input("hi", sql.VarChar(5), hi)
      .input("hf", sql.VarChar(5), hf)
      .query(
        `SELECT TOP 1 AusenciaId FROM fich.Ausencias
          WHERE UsuarioId = @uid AND Estado IN ('PENDIENTE','APROBADA') AND FechaInicio <= @ff AND FechaFin >= @fi
            AND (@hi IS NULL OR HoraInicio IS NULL OR (HoraInicio < CAST(@hf AS time) AND HoraFin > CAST(@hi AS time)))`
      );
    if (sol.recordset[0]) return error(409, "Ya tienes una ausencia pendiente o aprobada que coincide con esas fechas u horas");

    const pend = await pool.request().input("uid", sql.Int, u.usuarioId).query("SELECT COUNT(*) AS n FROM fich.Ausencias WHERE UsuarioId = @uid AND Estado = 'PENDIENTE'");
    if (pend.recordset[0].n >= MAX_PENDIENTES) return error(409, `Tienes ${MAX_PENDIENTES} ausencias pendientes. Espera a que se resuelvan.`);

    const r = await pool
      .request()
      .input("uid", sql.Int, u.usuarioId)
      .input("mot", sql.Int, motivoId)
      .input("fi", sql.Date, fi)
      .input("ff", sql.Date, ff)
      .input("hi", sql.VarChar(5), hi)
      .input("hf", sql.VarChar(5), hf)
      .input("com", sql.NVarChar(500), comentario || null)
      .query(
        `INSERT INTO fich.Ausencias (UsuarioId, MotivoId, FechaInicio, FechaFin, HoraInicio, HoraFin, Comentario)
         OUTPUT INSERTED.AusenciaId VALUES (@uid, @mot, @fi, @ff, CAST(@hi AS time), CAST(@hf AS time), @com)`
      );
    const id = r.recordset[0].AusenciaId;
    await auditar(u.usuarioId, "CREAR_AUSENCIA", "Ausencia", id, `${m.recordset[0].Nombre} ${textoPeriodo({ fechaInicio: fi, fechaFin: ff, horaInicio: hi, horaFin: hf })}`, ipCliente(req));
    return json(201, { id });
  }),
});

/* ---------- Retirar (la propia persona, mientras esté pendiente) ---------- */
app.http("retirarAusencia", {
  methods: ["PUT"],
  authLevel: "anonymous",
  route: "ausencias/{id:int}/retirar",
  handler: conSesion(async (req, _ctx, u) => {
    const id = Number(req.params.id);
    const r = await (await getPool())
      .request()
      .input("id", sql.Int, id)
      .input("uid", sql.Int, u.usuarioId)
      .query(
        `UPDATE fich.Ausencias SET Estado = 'RETIRADA', ResueltaPorId = @uid, ResueltaUtc = SYSUTCDATETIME()
          WHERE AusenciaId = @id AND UsuarioId = @uid AND Estado = 'PENDIENTE'`
      );
    if (!r.rowsAffected[0]) return error(409, "La ausencia no existe o ya no está pendiente");
    await auditar(u.usuarioId, "RETIRAR_AUSENCIA", "Ausencia", id, null, ipCliente(req));
    return json(200, { ok: true });
  }),
});

/* ---------- Justificante: subir (cuerpo binario) ---------- */
async function ausenciaPropiaPendiente(id: number, uid: number) {
  const r = await (await getPool())
    .request()
    .input("id", sql.Int, id)
    .input("uid", sql.Int, uid)
    .query("SELECT AusenciaId, Estado FROM fich.Ausencias WHERE AusenciaId = @id AND UsuarioId = @uid");
  return r.recordset[0] as { AusenciaId: number; Estado: string } | undefined;
}

async function leerBinario(req: HttpRequest): Promise<Buffer | null> {
  const largo = Number(req.headers.get("content-length") ?? 0);
  if (largo > MAX_BYTES) return null;
  const b = Buffer.from(await req.arrayBuffer());
  return b.length > MAX_BYTES ? null : b;
}

app.http("subirJustificante", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "ausencias/{id:int}/justificantes",
  handler: conSesion(async (req, _ctx, u) => {
    if (!almacenConfigurado()) return error(503, "El almacenamiento de documentos no está configurado");
    const id = Number(req.params.id);
    const a = await ausenciaPropiaPendiente(id, u.usuarioId);
    if (!a) return error(404, "Ausencia no encontrada");
    if (a.Estado !== "PENDIENTE") return error(409, "Solo se pueden añadir justificantes mientras la ausencia está pendiente");
    const pool = await getPool();
    const n = await pool.request().input("id", sql.Int, id).query("SELECT COUNT(*) AS n FROM fich.Documentos WHERE AusenciaId = @id AND BorradoUtc IS NULL");
    if (n.recordset[0].n >= MAX_DOCS) return error(409, `Como máximo ${MAX_DOCS} archivos por ausencia`);

    const datos = await leerBinario(req);
    if (!datos) return error(413, "El archivo no puede superar 10 MB");
    if (!datos.length) return error(400, "El archivo está vacío");
    const tipo = tipoArchivo(datos);
    if (!tipo) return error(415, "Solo se admiten archivos PDF, JPG o PNG");
    let original = "";
    try { original = decodeURIComponent(req.headers.get("x-nombre-archivo") ?? ""); } catch { /* nombre por defecto */ }
    const nombre = nombreSeguro(original, tipo.ext);
    const huella = sha256(datos);

    const contenedor: Contenedor = "justificantes";
    const ruta = await subir(contenedor, `${u.usuarioId}/${id}`, datos, tipo.mime, tipo.ext);
    try {
      const r = await pool
        .request()
        .input("uid", sql.Int, u.usuarioId)
        .input("aus", sql.Int, id)
        .input("cont", sql.VarChar(63), contenedor)
        .input("ruta", sql.NVarChar(400), ruta)
        .input("nom", sql.NVarChar(200), nombre)
        .input("mime", sql.VarChar(100), tipo.mime)
        .input("bytes", sql.Int, datos.length)
        .input("sha", sql.Char(64), huella)
        .query(
          `INSERT INTO fich.Documentos (Tipo, UsuarioId, AusenciaId, Contenedor, Ruta, NombreOriginal, TipoMime, Bytes, Sha256, SubidoPorId)
           OUTPUT INSERTED.DocumentoId VALUES ('JUSTIFICANTE', @uid, @aus, @cont, @ruta, @nom, @mime, @bytes, @sha, @uid)`
        );
      const docId = r.recordset[0].DocumentoId;
      await auditar(u.usuarioId, "SUBIR_JUSTIFICANTE", "Documento", docId, `ausencia=${id} ${nombre} ${datos.length} bytes sha256=${huella}`, ipCliente(req));
      return json(201, { id: docId, nombre, tipo: tipo.mime, bytes: datos.length });
    } catch (e) {
      await borrar(contenedor, ruta).catch(() => {});
      throw e;
    }
  }),
});

/* ---------- Justificante: quitar (la propia persona, mientras esté pendiente) ---------- */
app.http("borrarJustificante", {
  methods: ["DELETE"],
  authLevel: "anonymous",
  route: "ausencias/{id:int}/justificantes/{doc:int}",
  handler: conSesion(async (req, _ctx, u) => {
    const id = Number(req.params.id);
    const doc = Number(req.params.doc);
    const a = await ausenciaPropiaPendiente(id, u.usuarioId);
    if (!a) return error(404, "Ausencia no encontrada");
    if (a.Estado !== "PENDIENTE") return error(409, "Solo se pueden quitar justificantes mientras la ausencia está pendiente");
    const pool = await getPool();
    const r = await pool
      .request()
      .input("doc", sql.Int, doc)
      .input("aus", sql.Int, id)
      .query(
        `UPDATE fich.Documentos SET BorradoUtc = SYSUTCDATETIME() OUTPUT INSERTED.Contenedor, INSERTED.Ruta, INSERTED.NombreOriginal
          WHERE DocumentoId = @doc AND AusenciaId = @aus AND BorradoUtc IS NULL`
      );
    const d = r.recordset[0];
    if (!d) return error(404, "Justificante no encontrado");
    await borrar(d.Contenedor, d.Ruta).catch(() => {});
    await auditar(u.usuarioId, "BORRAR_JUSTIFICANTE", "Documento", doc, `ausencia=${id} ${d.NombreOriginal}`, ipCliente(req));
    return json(200, { ok: true });
  }),
});

/* ---------- Abrir un documento: comprueba permisos, audita y da un enlace de 5 minutos ---------- */
app.http("enlaceDocumento", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "documentos/{id:int}/enlace",
  handler: conSesion(async (req, _ctx, u) => {
    if (!almacenConfigurado()) return error(503, "El almacenamiento de documentos no está configurado");
    const id = Number(req.params.id);
    const r = await (await getPool())
      .request()
      .input("id", sql.Int, id)
      .query("SELECT DocumentoId, Tipo, UsuarioId, AusenciaId, Contenedor, Ruta, NombreOriginal FROM fich.Documentos WHERE DocumentoId = @id AND BorradoUtc IS NULL");
    const d = r.recordset[0];
    if (!d || d.Tipo !== "JUSTIFICANTE") return error(404, "Documento no encontrado");
    const org = await cargarOrg();
    if (!puedeVerJustificante(org, u, d.UsuarioId)) return error(403, "No tienes permiso para ver este documento");
    if (!(await existe(d.Contenedor, d.Ruta))) return error(410, "El documento ya no está disponible (se borran a los 18 meses)");
    const url = await enlaceLectura(d.Contenedor, d.Ruta, d.NombreOriginal);
    await auditar(
      u.usuarioId, "ABRIR_JUSTIFICANTE", "Documento", id,
      `ausencia=${d.AusenciaId} de ${d.UsuarioId} (${nombreDe(org, d.UsuarioId)})${d.UsuarioId === u.usuarioId ? " (propio)" : ""}`,
      ipCliente(req)
    );
    return json(200, { url });
  }),
});

/* ---------- Aprobaciones de ausencias ---------- */
app.http("aprobacionesAusencias", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "aprobaciones/ausencias",
  handler: conSesion(async (req, _ctx, u) => {
    const historico = req.query.get("estado") === "RESUELTAS";
    const org = await cargarOrg();
    const ids = solicitantesDe(org, u);
    if (!ids.length) return json(200, { ausencias: [] });
    const r = await (await getPool())
      .request()
      .input("ids", sql.NVarChar(sql.MAX), ids.join(","))
      .query(
        `${SELECT} WHERE a.UsuarioId IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))
           AND ${historico ? "a.Estado <> 'PENDIENTE' AND a.CreadoUtc >= DATEADD(DAY, -90, SYSUTCDATETIME())" : "a.Estado = 'PENDIENTE'"}
         ORDER BY ${historico ? "a.ResueltaUtc DESC" : "a.FechaInicio ASC"}`
      );
    return json(200, { ausencias: await conDocumentos(r.recordset) });
  }),
});

app.http("resolverAusencia", {
  methods: ["PUT"],
  authLevel: "anonymous",
  route: "aprobaciones/ausencias/{id:int}/resolver",
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
          `SELECT a.AusenciaId, a.UsuarioId, a.Estado, m.Nombre AS Motivo, m.RequiereJustificante,
                  CONVERT(char(10), a.FechaInicio, 23) AS fechaInicio, CONVERT(char(10), a.FechaFin, 23) AS fechaFin,
                  CONVERT(char(5), a.HoraInicio, 108) AS horaInicio, CONVERT(char(5), a.HoraFin, 108) AS horaFin,
                  (SELECT COUNT(*) FROM fich.Documentos dc WHERE dc.AusenciaId = a.AusenciaId AND dc.BorradoUtc IS NULL) AS Docs
             FROM fich.Ausencias a WITH (UPDLOCK, ROWLOCK) JOIN fich.MotivosAusencia m ON m.MotivoId = a.MotivoId
            WHERE a.AusenciaId = @id`
        );
      const a = r.recordset[0];
      if (!a) { await tx.rollback(); return error(404, "Ausencia no encontrada"); }
      if (!puedeResolver(org, u, a.UsuarioId)) { await tx.rollback(); return error(403, "No te corresponde resolver esta ausencia"); }
      if (a.Estado !== "PENDIENTE") { await tx.rollback(); return error(409, "La ausencia ya no está pendiente"); }
      if (accion === "ACEPTAR" && a.RequiereJustificante && !a.Docs) {
        await tx.rollback();
        return error(409, "Este motivo exige justificante y todavía no lo ha adjuntado. Espera a que lo suba o recházala indicando el motivo.");
      }
      await new sql.Request(tx)
        .input("id", sql.Int, id)
        .input("estado", sql.VarChar(12), accion === "ACEPTAR" ? "APROBADA" : "RECHAZADA")
        .input("por", sql.Int, u.usuarioId)
        .input("motivo", sql.NVarChar(500), accion === "RECHAZAR" ? motivo : null)
        .query("UPDATE fich.Ausencias SET Estado = @estado, ResueltaPorId = @por, ResueltaUtc = SYSUTCDATETIME(), MotivoRechazo = @motivo WHERE AusenciaId = @id");
      await auditar(
        u.usuarioId,
        accion === "ACEPTAR" ? "ACEPTAR_AUSENCIA" : "RECHAZAR_AUSENCIA",
        "Ausencia",
        id,
        `empleado=${a.UsuarioId} (${nombreDe(org, a.UsuarioId)}) ${a.Motivo} ${textoPeriodo(a)}${accion === "RECHAZAR" ? ` motivo=${motivo}` : ""}`,
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

/* ---------- Gestión de motivos (ADMIN) ---------- */
app.http("gestionMotivos", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "gestion/motivos-ausencia",
  handler: conSesion(
    async (req, _ctx, u) => {
      const pool = await getPool();
      if (req.method === "GET") {
        const r = await pool.request().query(
          `SELECT m.MotivoId AS id, m.Nombre AS nombre, m.RequiereJustificante AS requiereJustificante, m.Orden AS orden, m.Activo AS activo,
                  (SELECT COUNT(*) FROM fich.Ausencias a WHERE a.MotivoId = m.MotivoId) AS usos
             FROM fich.MotivosAusencia m ORDER BY m.Activo DESC, m.Orden, m.Nombre`
        );
        return json(200, { motivos: r.recordset.map((m: any) => ({ ...m, requiereJustificante: !!m.requiereJustificante, activo: !!m.activo })) });
      }
      const b = await leerJson(req);
      const nombre = texto(b?.nombre);
      const orden = Number(b?.orden ?? 100);
      if (nombre.length < 3 || nombre.length > 100) return error(400, "El nombre debe tener entre 3 y 100 caracteres");
      if (!Number.isInteger(orden) || orden < 0 || orden > 9999) return error(400, "Orden no válido");
      const dup = await pool.request().input("n", sql.NVarChar(100), nombre).query("SELECT 1 FROM fich.MotivosAusencia WHERE Nombre = @n");
      if (dup.recordset[0]) return error(409, "Ya existe un motivo con ese nombre");
      const r = await pool
        .request()
        .input("n", sql.NVarChar(100), nombre)
        .input("j", sql.Bit, !!b?.requiereJustificante)
        .input("o", sql.Int, orden)
        .query("INSERT INTO fich.MotivosAusencia (Nombre, RequiereJustificante, Orden) OUTPUT INSERTED.MotivoId VALUES (@n, @j, @o)");
      const id = r.recordset[0].MotivoId;
      await auditar(u.usuarioId, "CREAR_MOTIVO_AUSENCIA", "MotivoAusencia", id, `${nombre} justificante=${!!b?.requiereJustificante}`, ipCliente(req));
      return json(201, { id });
    },
    { roles: ["ADMIN"] }
  ),
});

app.http("editarMotivo", {
  methods: ["PUT"],
  authLevel: "anonymous",
  route: "gestion/motivos-ausencia/{id:int}",
  handler: conSesion(
    async (req, _ctx, u) => {
      const id = Number(req.params.id);
      const b = await leerJson(req);
      const nombre = texto(b?.nombre);
      const orden = Number(b?.orden ?? 100);
      if (nombre.length < 3 || nombre.length > 100) return error(400, "El nombre debe tener entre 3 y 100 caracteres");
      if (!Number.isInteger(orden) || orden < 0 || orden > 9999) return error(400, "Orden no válido");
      const pool = await getPool();
      const dup = await pool.request().input("n", sql.NVarChar(100), nombre).input("id", sql.Int, id).query("SELECT 1 FROM fich.MotivosAusencia WHERE Nombre = @n AND MotivoId <> @id");
      if (dup.recordset[0]) return error(409, "Ya existe un motivo con ese nombre");
      const r = await pool
        .request()
        .input("id", sql.Int, id)
        .input("n", sql.NVarChar(100), nombre)
        .input("j", sql.Bit, !!b?.requiereJustificante)
        .input("o", sql.Int, orden)
        .input("a", sql.Bit, b?.activo !== false)
        .query("UPDATE fich.MotivosAusencia SET Nombre = @n, RequiereJustificante = @j, Orden = @o, Activo = @a WHERE MotivoId = @id");
      if (!r.rowsAffected[0]) return error(404, "Motivo no encontrado");
      await auditar(u.usuarioId, "EDITAR_MOTIVO_AUSENCIA", "MotivoAusencia", id, `${nombre} justificante=${!!b?.requiereJustificante} activo=${b?.activo !== false}`, ipCliente(req));
      return json(200, { ok: true });
    },
    { roles: ["ADMIN"] }
  ),
});
