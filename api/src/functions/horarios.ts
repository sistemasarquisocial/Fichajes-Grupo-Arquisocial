import { app } from "@azure/functions";
import { cargarAusencias } from "../lib/ausencias";
import { getPool, sql } from "../lib/db";
import { ipCliente, ROLES_VEN_TODO, UsuarioSesion } from "../lib/auth";
import { json, error, leerJson, conSesion } from "../lib/http";
import { auditar } from "../lib/auditoria";
import { cargarOrg, idsVisibles, puedeVerEmpleado, Org, representados, centrosGestionados, centrosZona } from "../lib/organizacion";
import { fechaLocal } from "../lib/jornada";
import { fichajesEfectivos } from "../lib/correcciones";
import {
  TZ, TIPOS_HORARIO, TipoHorario, Tramo, TramoDia, RE_HORA, RE_MES, cargarHorarios, cargarCambios, resumenMes,
  estadoAhora, resumenHorario, minutosTramo, intervaloUtc, planDia, cargarParams, festivosPorUbicacion,
} from "../lib/horarios";
import { cargarFestivosManuales } from "../lib/calendario";

/* Horarios, saldo y bolsa de horas, presencia en vivo, propuesta de cobertura y turnos de centro.
   Gestionan el horario de una persona: su aprobador (titular o suplente), RRHH y ADMIN. Nadie el suyo propio
   salvo RRHH/ADMIN. Los turnos de un centro los gestionan su coordinador, su gestor (o quien les suple), RRHH y ADMIN.
   Se ven los del centro donde está ubicado, los que coordina o gestiona y los de su zona; RRHH y ADMIN, todos. */

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;
const veTodo = (u: UsuarioSesion) => ROLES_VEN_TODO.includes(u.rol);
const mesActual = () => fechaLocal(new Date(), TZ()).slice(0, 7);

async function puedeGestionarHorario(u: UsuarioSesion, empleadoId: number) {
  if (empleadoId === u.usuarioId && !veTodo(u)) return false;
  return puedeVerEmpleado(u, empleadoId);
}

/** Centros cuyos turnos gestiona (null = todos). */
function centrosTurnos(org: Org, u: UsuarioSesion): number[] | null {
  if (veTodo(u)) return null;
  const r = new Set<number>([...representados(org, u.usuarioId)].flatMap((t) => org.centrosQueCoordina.get(t) ?? []));
  for (const c of centrosGestionados(org, u.usuarioId)) r.add(c);
  return [...r];
}

/** Centros cuyos turnos puede ver (null = todos): donde está ubicado, los que gestiona y los de su zona. */
function centrosTurnosVisibles(org: Org, u: UsuarioSesion): number[] | null {
  if (veTodo(u)) return null;
  const r = new Set<number>([...(centrosTurnos(org, u) ?? []), ...centrosZona(org, u.usuarioId)]);
  const yo = org.usuarios.get(u.usuarioId);
  if (yo?.centroId) r.add(yo.centroId);
  return [...r];
}

/** Valida los tramos del patrón. */
function leerTramos(v: unknown, semanas: number): Tramo[] | string {
  if (!Array.isArray(v)) return [];
  if (v.length > 8 * 7 * 4) return "Demasiados tramos";
  const r: Tramo[] = [];
  for (const x of v as any[]) {
    const semana = Number(x?.semana), dia = Number(x?.dia);
    const inicio = String(x?.inicio ?? ""), fin = String(x?.fin ?? "");
    if (!Number.isInteger(semana) || semana < 1 || semana > semanas) return "Semana del patrón no válida";
    if (!Number.isInteger(dia) || dia < 1 || dia > 7) return "Día de la semana no válido";
    if (!RE_HORA.test(inicio) || !RE_HORA.test(fin) || inicio === fin) return "Revisa las horas de los tramos";
    if (minutosTramo({ inicio, fin }) > 16 * 60) return "Un tramo no puede durar más de 16 horas";
    r.push({ semana, dia, inicio, fin, turnoId: x?.turnoId ? Number(x.turnoId) : null });
  }
  // Sin solapes dentro del mismo día (minutos desde el inicio del día; un tramo nocturno se alarga más allá de 1440)
  const ini = (t: TramoDia) => Number(t.inicio.slice(0, 2)) * 60 + Number(t.inicio.slice(3));
  for (const t of r)
    for (const o of r)
      if (o !== t && o.semana === t.semana && o.dia === t.dia && ini(t) < ini(o) + minutosTramo(o) && ini(o) < ini(t) + minutosTramo(t))
        return "Hay tramos que se solapan en el mismo día";
  return r;
}

/* ---------- Resumen del equipo: horario, saldo del mes y bolsa ---------- */
app.http("horariosEquipo", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "horarios/equipo",
  handler: conSesion(async (req, _ctx, u) => {
    const mes = req.query.get("mes") ?? mesActual();
    if (!RE_MES.test(mes) || mes > mesActual()) return error(400, "Mes no válido");
    const vis = await idsVisibles(u);
    const pool = await getPool();
    const emp = await pool
      .request()
      .input("ids", sql.NVarChar(sql.MAX), (vis ?? []).join(","))
      .query(
        `SELECT u.UsuarioId AS id, u.Nombre AS nombre, u.Apellidos AS apellidos, u.TipoPerfil AS tipoPerfil,
                u.CentroId AS centroId, c.Nombre AS centro, c.CodigoServicio AS codigoServicio, d.Nombre AS departamento
           FROM fich.Usuarios u
           LEFT JOIN fich.Centros c ON c.CentroId = u.CentroId
           LEFT JOIN fich.Departamentos d ON d.DepartamentoId = u.DepartamentoId
          WHERE u.Activo = 1 AND ${vis === null ? "1 = 1" : "u.UsuarioId IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))"}
          ORDER BY u.Apellidos, u.Nombre`
      );
    const ids = (emp.recordset as any[]).map((e) => e.id as number);
    const [res, horarios] = await Promise.all([resumenMes(ids, mes), cargarHorarios(ids)]);
    const empleados = (emp.recordset as any[]).map((e) => {
      const h = horarios.get(e.id);
      return { ...e, horario: h ? { tipo: h.tipo, resumen: resumenHorario(h) } : null, saldo: res.get(e.id) ?? null, propio: e.id === u.usuarioId };
    });
    return json(200, { mes, empleados });
  }),
});

/* ---------- Detalle del horario de una persona ---------- */
app.http("horarioDetalle", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "horarios/{id:int}",
  handler: conSesion(async (req, _ctx, u) => {
    const id = Number(req.params.id);
    if (!(await puedeVerEmpleado(u, id))) return error(403, "No tienes acceso a este empleado");
    const hoy = fechaLocal(new Date(), TZ());
    const desde = `${hoy.slice(0, 7)}-01`;
    const hasta = new Date(Date.parse(`${hoy}T12:00:00Z`) + 90 * 86400000).toISOString().slice(0, 10);
    const [horarios, cambios] = await Promise.all([cargarHorarios([id]), cargarCambios([id], desde, hasta)]);
    const pool = await getPool();
    const aj = await pool
      .request()
      .input("u", sql.Int, id)
      .query(
        `SELECT a.Mes AS mes, a.Horas AS horas, a.Motivo AS motivo, c.Nombre + N' ' + c.Apellidos AS creadoPor
           FROM fich.AjustesMes a JOIN fich.Usuarios c ON c.UsuarioId = a.CreadoPorId
          WHERE a.UsuarioId = @u ORDER BY a.Mes DESC`
      );
    const h = horarios.get(id) ?? null;
    return json(200, {
      horario: h,
      resumen: resumenHorario(h ?? undefined),
      cambios: [...(cambios.get(id) ?? new Map()).entries()].map(([fecha, tramos]) => ({ fecha, tramos })),
      ajustes: aj.recordset.map((x: any) => ({ ...x, horas: Number(x.horas) })),
      editable: await puedeGestionarHorario(u, id),
    });
  }),
});

/* ---------- Asignar horario a una o varias personas ---------- */
app.http("horarioGuardar", {
  methods: ["PUT"],
  authLevel: "anonymous",
  route: "horarios",
  handler: conSesion(async (req, _ctx, u) => {
    const b = await leerJson(req);
    const ids = [...new Set(((b?.ids ?? []) as unknown[]).map(Number).filter((x) => Number.isInteger(x) && x > 0))];
    if (!ids.length) return error(400, "Selecciona al menos una persona");
    if (ids.length > 200) return error(400, "Máximo 200 personas a la vez");
    for (const id of ids) if (!(await puedeGestionarHorario(u, id))) return error(403, "No puedes configurar el horario de alguna de las personas seleccionadas");

    const tipo = b?.tipo as TipoHorario;
    if (!TIPOS_HORARIO.includes(tipo)) return error(400, "Tipo de horario no válido");
    let horasMes: number | null = null;
    let semanas = 1;
    let inicioPatron: string | null = null;
    let tramos: Tramo[] = [];
    const descuentaFestivos = b?.descuentaFestivos !== false;
    if (tipo === "VARIABLE") {
      horasMes = Number(b?.horasMes);
      if (!Number.isFinite(horasMes) || horasMes < 0 || horasMes > 400) return error(400, "Las horas al mes deben estar entre 0 y 400");
      horasMes = Math.round(horasMes * 100) / 100;
    } else {
      if (tipo === "ROTATIVO") {
        semanas = Number(b?.semanas);
        if (!Number.isInteger(semanas) || semanas < 1 || semanas > 8) return error(400, "El patrón rotativo debe tener entre 1 y 8 semanas");
        inicioPatron = String(b?.inicioPatron ?? "");
        if (!RE_FECHA.test(inicioPatron) || new Date(`${inicioPatron}T12:00:00Z`).getUTCDay() !== 1) return error(400, "El patrón debe empezar en lunes");
      }
      const t = leerTramos(b?.tramos, semanas);
      if (typeof t === "string") return error(400, t);
      if (!t.length) return error(400, "Añade al menos un tramo al horario");
      tramos = t;
    }
    const mes = mesActual();

    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      for (const id of ids) {
        const prev = await new sql.Request(tx).input("u", sql.Int, id).query("SELECT Tipo, BolsaDesde FROM fich.Horarios WITH (UPDLOCK) WHERE UsuarioId = @u");
        const p = prev.recordset[0];
        // La bolsa empieza el mes en que pasa a VARIABLE y se conserva si ya lo era
        const bolsaDesde = tipo === "VARIABLE" ? (p?.Tipo === "VARIABLE" && p.BolsaDesde ? p.BolsaDesde : mes) : null;
        await new sql.Request(tx).input("u", sql.Int, id).query("DELETE FROM fich.HorarioTramos WHERE UsuarioId = @u");
        const rq = new sql.Request(tx)
          .input("u", sql.Int, id)
          .input("t", sql.VarChar(10), tipo)
          .input("h", sql.Decimal(6, 2), horasMes)
          .input("s", sql.TinyInt, semanas)
          .input("i", sql.Date, inicioPatron)
          .input("b", sql.Char(7), bolsaDesde)
          .input("f", sql.Bit, descuentaFestivos)
          .input("por", sql.Int, u.usuarioId);
        await rq.query(
          p
            ? `UPDATE fich.Horarios SET Tipo = @t, HorasMes = @h, Semanas = @s, InicioPatron = @i, BolsaDesde = @b, DescuentaFestivos = @f,
                      ModificadoPorId = @por, ModificadoUtc = SYSUTCDATETIME() WHERE UsuarioId = @u`
            : `INSERT INTO fich.Horarios (UsuarioId, Tipo, HorasMes, Semanas, InicioPatron, BolsaDesde, DescuentaFestivos, ModificadoPorId)
               VALUES (@u, @t, @h, @s, @i, @b, @f, @por)`
        );
        for (const t of tramos) {
          await new sql.Request(tx)
            .input("u", sql.Int, id)
            .input("s", sql.TinyInt, t.semana)
            .input("d", sql.TinyInt, t.dia)
            .input("a", sql.VarChar(5), t.inicio)
            .input("z", sql.VarChar(5), t.fin)
            .input("tu", sql.Int, t.turnoId)
            .query("INSERT INTO fich.HorarioTramos (UsuarioId, Semana, DiaSemana, HoraInicio, HoraFin, TurnoId) VALUES (@u, @s, @d, @a, @z, @tu)");
        }
      }
      await auditar(
        u.usuarioId, "ASIGNAR_HORARIO", "Usuario", ids.length === 1 ? ids[0] : null,
        `${tipo}${horasMes !== null ? ` ${horasMes} h/mes` : ""}${tipo === "ROTATIVO" ? ` ${semanas} sem desde ${inicioPatron}` : ""} tramos=${tramos.length} usuarios=${ids.join(",")}`,
        ipCliente(req), tx
      );
      await tx.commit();
      return json(200, { ok: true, actualizados: ids.length });
    } catch (e) {
      await tx.rollback().catch(() => {});
      throw e;
    }
  }),
});

/* ---------- Ajuste de las horas de un mes (null = quitar ajuste) ---------- */
app.http("horarioAjuste", {
  methods: ["PUT"],
  authLevel: "anonymous",
  route: "horarios/{id:int}/ajuste",
  handler: conSesion(async (req, _ctx, u) => {
    const id = Number(req.params.id);
    if (!(await puedeGestionarHorario(u, id))) return error(403, "No puedes ajustar el horario de esta persona");
    const b = await leerJson(req);
    const mes = String(b?.mes ?? "");
    if (!RE_MES.test(mes)) return error(400, "Mes no válido");
    if (b?.horas !== null && !(await cargarHorarios([id])).get(id)) return error(400, "Asigna primero un horario a esta persona");
    if (mes < mesActual()) {
      const c = await (await getPool()).request().input("u", sql.Int, id).input("m", sql.Char(7), mes).query("SELECT 1 AS x FROM fich.CierresMes WHERE UsuarioId = @u AND Mes = @m");
      if (c.recordset.length) return error(409, "Ese mes ya está cerrado en la bolsa de horas y no se puede ajustar");
    }
    const pool = await getPool();
    if (b?.horas === null) {
      await pool.request().input("u", sql.Int, id).input("m", sql.Char(7), mes).query("DELETE FROM fich.AjustesMes WHERE UsuarioId = @u AND Mes = @m");
      await auditar(u.usuarioId, "QUITAR_AJUSTE_MES", "Usuario", id, mes, ipCliente(req));
      return json(200, { ok: true });
    }
    const horas = Number(b?.horas);
    const motivo = String(b?.motivo ?? "").replace(/\s+/g, " ").trim();
    if (!Number.isFinite(horas) || horas < 0 || horas > 400) return error(400, "Las horas deben estar entre 0 y 400");
    if (motivo.length < 3) return error(400, "Indica el motivo del ajuste");
    await pool
      .request()
      .input("u", sql.Int, id)
      .input("m", sql.Char(7), mes)
      .input("h", sql.Decimal(6, 2), Math.round(horas * 100) / 100)
      .input("mo", sql.NVarChar(200), motivo.slice(0, 200))
      .input("por", sql.Int, u.usuarioId)
      .query(
        `MERGE fich.AjustesMes AS t USING (SELECT @u AS UsuarioId, @m AS Mes) AS s ON t.UsuarioId = s.UsuarioId AND t.Mes = s.Mes
         WHEN MATCHED THEN UPDATE SET Horas = @h, Motivo = @mo, CreadoPorId = @por, CreadoUtc = SYSUTCDATETIME()
         WHEN NOT MATCHED THEN INSERT (UsuarioId, Mes, Horas, Motivo, CreadoPorId) VALUES (@u, @m, @h, @mo, @por);`
      );
    await auditar(u.usuarioId, "AJUSTE_MES", "Usuario", id, `${mes} ${horas} h: ${motivo}`, ipCliente(req));
    return json(200, { ok: true });
  }),
});

/* ---------- Cambio puntual de un día (tramos vacíos = día libre; quitar = volver al plan) ---------- */
app.http("horarioCambioDia", {
  methods: ["PUT"],
  authLevel: "anonymous",
  route: "horarios/{id:int}/cambio",
  handler: conSesion(async (req, _ctx, u) => {
    const id = Number(req.params.id);
    if (!(await puedeGestionarHorario(u, id))) return error(403, "No puedes cambiar el horario de esta persona");
    const b = await leerJson(req);
    const fecha = String(b?.fecha ?? "");
    if (!RE_FECHA.test(fecha)) return error(400, "Fecha no válida");
    const hoy = fechaLocal(new Date(), TZ());
    if (fecha < `${hoy.slice(0, 7)}-01`) return error(400, "Solo se pueden cambiar días del mes en curso o posteriores");
    const quitar = b?.quitar === true;
    let tramos: TramoDia[] = [];
    if (!quitar) {
      if (!Array.isArray(b?.tramos) || b.tramos.length > 4) return error(400, "Indica hasta 4 tramos (o ninguno para día libre)");
      for (const t of b.tramos) {
        if (!RE_HORA.test(t?.inicio) || !RE_HORA.test(t?.fin) || t.inicio === t.fin) return error(400, "Revisa las horas del cambio");
        tramos.push({ inicio: t.inicio, fin: t.fin });
      }
    }
    const pool = await getPool();
    const tx = new sql.Transaction(pool);
    await tx.begin();
    try {
      await new sql.Request(tx).input("u", sql.Int, id).input("f", sql.Date, fecha).query("DELETE FROM fich.CambiosDia WHERE UsuarioId = @u AND Fecha = @f");
      if (!quitar) {
        const filas = tramos.length ? tramos : [null];
        for (const t of filas)
          await new sql.Request(tx)
            .input("u", sql.Int, id)
            .input("f", sql.Date, fecha)
            .input("a", sql.VarChar(5), t?.inicio ?? null)
            .input("z", sql.VarChar(5), t?.fin ?? null)
            .input("por", sql.Int, u.usuarioId)
            .query("INSERT INTO fich.CambiosDia (UsuarioId, Fecha, HoraInicio, HoraFin, CreadoPorId) VALUES (@u, @f, @a, @z, @por)");
      }
      await auditar(u.usuarioId, quitar ? "QUITAR_CAMBIO_DIA" : "CAMBIO_DIA", "Usuario", id, `${fecha} ${quitar ? "" : tramos.length ? tramos.map((t) => `${t.inicio}-${t.fin}`).join(",") : "libre"}`, ipCliente(req), tx);
      await tx.commit();
      return json(200, { ok: true });
    } catch (e) {
      await tx.rollback().catch(() => {});
      throw e;
    }
  }),
});

/* ---------- Presencia en vivo y avisos del equipo ---------- */
app.http("equipoAhora", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "equipo/ahora",
  handler: conSesion(async (_req, _ctx, u) => {
    const vis = await idsVisibles(u);
    const pool = await getPool();
    const emp = await pool
      .request()
      .input("ids", sql.NVarChar(sql.MAX), (vis ?? []).join(","))
      .query(
        `SELECT u.UsuarioId AS id, u.Nombre AS nombre, u.Apellidos AS apellidos, u.CentroId AS centroId, c.Nombre AS centro,
                c.CodigoServicio AS codigoServicio, d.Nombre AS departamento
           FROM fich.Usuarios u LEFT JOIN fich.Centros c ON c.CentroId = u.CentroId LEFT JOIN fich.Departamentos d ON d.DepartamentoId = u.DepartamentoId
          WHERE u.Activo = 1 AND u.UsuarioId <> ${u.usuarioId} AND ${vis === null ? "1 = 1" : "u.UsuarioId IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@ids, ','))"}
          ORDER BY u.Apellidos, u.Nombre`
      );
    const ids = (emp.recordset as any[]).map((e) => e.id as number);
    const est = await estadoAhora(ids);
    return json(200, {
      ahoraUtc: new Date().toISOString(),
      empleados: (emp.recordset as any[]).map((e) => {
        const x = est.get(e.id)!;
        // Al aprobador solo le llegan los avisos de falta de fichaje ya escalados; los retrasos son informativos
        return { ...e, estado: x.estado, ultimoUtc: x.ultimoUtc, planHoy: x.planHoy, avisos: x.avisos.filter((a) => a.tipo === "RETRASO" || a.escalado) };
      }),
    });
  }),
});

/* ---------- Propuesta para cubrir un hueco ---------- */
app.http("equipoCubrir", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "equipo/cubrir",
  handler: conSesion(async (req, _ctx, u) => {
    const centroId = Number(req.query.get("centroId"));
    const fecha = req.query.get("fecha") ?? "";
    const inicio = req.query.get("inicio") ?? "";
    const fin = req.query.get("fin") ?? "";
    if (!Number.isInteger(centroId) || !RE_FECHA.test(fecha) || !RE_HORA.test(inicio) || !RE_HORA.test(fin) || inicio === fin) return error(400, "Indica centro, día y horas");
    const hueco = intervaloUtc(fecha, { inicio, fin });
    if (!hueco) return error(400, "Horas no válidas");
    const vis = await idsVisibles(u);
    const pool = await getPool();
    const emp = await pool
      .request()
      .input("c", sql.Int, centroId)
      .query("SELECT UsuarioId AS id, Nombre AS nombre, Apellidos AS apellidos FROM fich.Usuarios WHERE Activo = 1 AND CentroId = @c");
    const candidatos = (emp.recordset as any[]).filter((e) => vis === null || vis.includes(e.id));
    if (!candidatos.length) return json(200, { candidatos: [], descartados: [] });
    const ids = candidatos.map((e) => e.id as number);
    const mes = fecha.slice(0, 7) > mesActual() ? mesActual() : fecha.slice(0, 7);
    const dia = (n: number) => new Date(Date.parse(`${fecha}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
    const [res, horarios, cambios, params, manuales, ausencias] = await Promise.all([
      resumenMes(ids, mes), cargarHorarios(ids), cargarCambios(ids, dia(-1), fecha), cargarParams(ids), cargarFestivosManuales(dia(-1), fecha),
      cargarAusencias(ids, fecha, fecha, ["PENDIENTE", "APROBADA"]),
    ]);
    const festivos = festivosPorUbicacion(manuales, dia(-1), fecha);
    const ef = await fichajesEfectivos(ids, new Date(hueco.ini.getTime() - 86400000), new Date(hueco.fin.getTime() + 86400000));
    const solapa = (a: { ini: Date; fin: Date }) => a.ini < hueco.fin && hueco.ini < a.fin;

    const lista = candidatos.map((e) => {
      const s = res.get(e.id)!;
      const p = params.get(e.id)!;
      const cm = cambios.get(e.id) ?? new Map();
      const fs = festivos(p.ubicacion);
      const plan = [
        ...planDia(horarios.get(e.id), dia(-1), cm, fs).map((t) => intervaloUtc(dia(-1), t)),
        ...planDia(horarios.get(e.id), fecha, cm, fs).map((t) => intervaloUtc(fecha, t)),
      ].filter(Boolean) as { ini: Date; fin: Date }[];
      // Tramos ya fichados que se solapan con el hueco
      const fich = (ef.get(e.id) ?? []).filter((f) => !f.anulado);
      const trabajados: { ini: Date; fin: Date }[] = [];
      let abierto: Date | null = null;
      for (const f of fich) {
        if (f.tipo === "ENTRADA" || f.tipo === "PAUSA_FIN") abierto = f.fechaHoraUtc;
        else if (abierto) { trabajados.push({ ini: abierto, fin: f.fechaHoraUtc }); abierto = null; }
      }
      if (abierto) trabajados.push({ ini: abierto, fin: new Date() });
      // Ausente ese día (ausencia pendiente o aprobada que coincide con el hueco)
      const ausente = (ausencias.get(e.id) ?? []).some((a) => !a.horaInicio || solapa(intervaloUtc(fecha, { inicio: a.horaInicio, fin: a.horaFin! })!));
      const motivo = ausente ? "Tiene una ausencia justificada ese día" : plan.some(solapa) ? "Ya tiene turno en ese horario" : trabajados.some(solapa) ? "Ya ha trabajado en ese horario" : s.sobrecarga ? `Sobrecargado/a (+${Math.round(s.excesoMin / 60)} h este mes)` : null;
      // Prioridad: lo que debe (bolsa + pendiente del mes en variables; objetivo hasta hoy - trabajado en el resto)
      const debe = s.pendienteMin ?? ((s.objetivoHastaHoyMin ?? s.objetivoMin) - s.trabajadoMin - s.justificadoMin);
      return { ...e, tipo: s.tipo, debeMin: debe, bolsaMin: s.bolsaAnteriorMin, trabajadoMin: s.trabajadoMin, objetivoMin: s.objetivoMin, excesoMin: s.excesoMin, motivo };
    });
    const orden = (a: any, b: any) => b.debeMin - a.debeMin;
    return json(200, {
      candidatos: lista.filter((x) => !x.motivo).sort(orden),
      descartados: lista.filter((x) => x.motivo).sort(orden),
      horasHueco: Math.round(minutosTramo({ inicio, fin }) / 6) / 10,
    });
  }),
});

/* ---------- Turnos de un centro ---------- */
app.http("turnosListar", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "turnos",
  handler: conSesion(async (req, _ctx, u) => {
    const org = await cargarOrg();
    const permitidos = centrosTurnos(org, u);
    const visibles = centrosTurnosVisibles(org, u);
    const centroId = req.query.get("centroId") ? Number(req.query.get("centroId")) : null;
    // Al editar el horario de alguien de su ámbito puede pedir los turnos de su centro para elegirlos
    let ambito: number[] = [];
    if (centroId && visibles !== null && !visibles.includes(centroId)) {
      const vis = await idsVisibles(u);
      ambito = (vis ?? []).filter((id) => org.usuarios.get(id)?.centroId === centroId);
      if (!ambito.length) return error(403, "No tienes acceso a los turnos de ese centro");
    }
    const filtro = visibles === null || ambito.length ? null : visibles;
    const pool = await getPool();
    const r = await pool
      .request()
      .input("c", sql.Int, centroId)
      .input("vis", sql.NVarChar(sql.MAX), (filtro ?? []).join(","))
      .query(
        `SELECT t.TurnoId AS id, t.CentroId AS centroId, c.Nombre AS centro, t.Nombre AS nombre,
                CONVERT(char(5), t.HoraInicio, 108) AS inicio, CONVERT(char(5), t.HoraFin, 108) AS fin, t.Activo AS activo
           FROM fich.Turnos t JOIN fich.Centros c ON c.CentroId = t.CentroId
          WHERE (@c IS NULL OR t.CentroId = @c)
            AND ${filtro === null ? "1 = 1" : "t.CentroId IN (SELECT CAST(value AS INT) FROM STRING_SPLIT(@vis, ','))"}
          ORDER BY c.Nombre, t.HoraInicio`
      );
    return json(200, {
      turnos: r.recordset.map((x: any) => ({ ...x, activo: !!x.activo, editable: permitidos === null || permitidos.includes(x.centroId) })),
      centrosEditables: permitidos,
    });
  }),
});

function leerTurno(b: any): { nombre: string; inicio: string; fin: string } | string {
  const nombre = String(b?.nombre ?? "").replace(/\s+/g, " ").trim();
  if (nombre.length < 2 || nombre.length > 50) return "El nombre del turno debe tener entre 2 y 50 caracteres";
  if (!RE_HORA.test(b?.inicio) || !RE_HORA.test(b?.fin) || b.inicio === b.fin) return "Revisa las horas del turno";
  if (minutosTramo({ inicio: b.inicio, fin: b.fin }) > 16 * 60) return "Un turno no puede durar más de 16 horas";
  return { nombre, inicio: b.inicio, fin: b.fin };
}

app.http("turnosCrear", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "turnos",
  handler: conSesion(async (req, _ctx, u) => {
    const b = await leerJson(req);
    const centroId = Number(b?.centroId);
    const permitidos = centrosTurnos(await cargarOrg(), u);
    if (!Number.isInteger(centroId) || (permitidos !== null && !permitidos.includes(centroId))) return error(403, "No gestionas los turnos de ese centro");
    const t = leerTurno(b);
    if (typeof t === "string") return error(400, t);
    const pool = await getPool();
    const dup = await pool.request().input("c", sql.Int, centroId).input("n", sql.NVarChar(50), t.nombre).query("SELECT 1 AS x FROM fich.Turnos WHERE CentroId = @c AND Nombre = @n");
    if (dup.recordset.length) return error(409, "Ya existe un turno con ese nombre en el centro");
    const r = await pool
      .request()
      .input("c", sql.Int, centroId)
      .input("n", sql.NVarChar(50), t.nombre)
      .input("a", sql.VarChar(5), t.inicio)
      .input("z", sql.VarChar(5), t.fin)
      .query("INSERT INTO fich.Turnos (CentroId, Nombre, HoraInicio, HoraFin) OUTPUT INSERTED.TurnoId VALUES (@c, @n, @a, @z)");
    await auditar(u.usuarioId, "CREAR_TURNO", "Turno", r.recordset[0].TurnoId, `centro=${centroId} ${t.nombre} ${t.inicio}-${t.fin}`, ipCliente(req));
    return json(201, { id: r.recordset[0].TurnoId });
  }),
});

app.http("turnosEditar", {
  methods: ["PUT"],
  authLevel: "anonymous",
  route: "turnos/{id:int}",
  handler: conSesion(async (req, _ctx, u) => {
    const id = Number(req.params.id);
    const pool = await getPool();
    const act = await pool.request().input("id", sql.Int, id).query("SELECT CentroId FROM fich.Turnos WHERE TurnoId = @id");
    if (!act.recordset[0]) return error(404, "Turno no encontrado");
    const permitidos = centrosTurnos(await cargarOrg(), u);
    if (permitidos !== null && !permitidos.includes(act.recordset[0].CentroId)) return error(403, "No gestionas los turnos de ese centro");
    const b = await leerJson(req);
    const t = leerTurno(b);
    if (typeof t === "string") return error(400, t);
    const dup = await pool
      .request()
      .input("c", sql.Int, act.recordset[0].CentroId)
      .input("n", sql.NVarChar(50), t.nombre)
      .input("id", sql.Int, id)
      .query("SELECT 1 AS x FROM fich.Turnos WHERE CentroId = @c AND Nombre = @n AND TurnoId <> @id");
    if (dup.recordset.length) return error(409, "Ya existe un turno con ese nombre en el centro");
    await pool
      .request()
      .input("id", sql.Int, id)
      .input("n", sql.NVarChar(50), t.nombre)
      .input("a", sql.VarChar(5), t.inicio)
      .input("z", sql.VarChar(5), t.fin)
      .input("ac", sql.Bit, b?.activo !== false)
      .query("UPDATE fich.Turnos SET Nombre = @n, HoraInicio = @a, HoraFin = @z, Activo = @ac WHERE TurnoId = @id");
    await auditar(u.usuarioId, "EDITAR_TURNO", "Turno", id, `${t.nombre} ${t.inicio}-${t.fin}${b?.activo === false ? " inactivo" : ""}`, ipCliente(req));
    // Cambiar un turno no modifica los horarios ya asignados (sus tramos guardan las horas)
    return json(200, { ok: true });
  }),
});

/* ---------- Mi día: horario de hoy y avisos propios (para la pantalla Fichar) ---------- */
app.http("miDia", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "fichajes/mi-dia",
  handler: conSesion(async (_req, _ctx, u) => {
    const x = (await estadoAhora([u.usuarioId])).get(u.usuarioId)!;
    return json(200, { planHoy: x.planHoy, avisos: x.avisos.filter((a) => a.tipo !== "RETRASO") });
  }),
});
