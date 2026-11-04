import { test } from "node:test";
import assert from "node:assert/strict";
import { planDia, semanaPatron, objetivoMes, bolsaTrasMes, calcularAvisos, minutosTramo, Horario, PARAMS_DEFECTO } from "../src/lib/horarios";
import { festivosDe, comunidadDeCP, normalizarMunicipio } from "../src/lib/calendario";
import { aplicarCorrecciones, Original } from "../src/lib/correcciones";

const fijo: Horario = {
  usuarioId: 1, tipo: "FIJO", horasMes: null, semanas: 1, inicioPatron: null, bolsaDesde: null, descuentaFestivos: true,
  tramos: [1, 2, 3, 4, 5].map((dia) => ({ semana: 1, dia, inicio: "08:00", fin: "15:00", turnoId: null })),
};
const rotativo: Horario = {
  usuarioId: 2, tipo: "ROTATIVO", horasMes: null, semanas: 2, inicioPatron: "2026-11-02", bolsaDesde: null, descuentaFestivos: false,
  tramos: [
    ...[1, 2, 3, 4, 5].map((dia) => ({ semana: 1, dia, inicio: "07:00", fin: "15:00", turnoId: null })),
    ...[1, 2, 3, 4, 5].map((dia) => ({ semana: 2, dia, inicio: "15:00", fin: "23:00", turnoId: null })),
  ],
};

test("calendario: comunidad por CP, municipio normalizado y festivos locales", () => {
  assert.equal(comunidadDeCP("50001"), "AR");
  assert.equal(comunidadDeCP("28013"), "MD");
  assert.equal(normalizarMunicipio("  Alcalá  de Henares "), "ALCALA DE HENARES");
  const u = { comunidad: "AR", provincia: "50", municipio: "ZARAGOZA" };
  const f = festivosDe(u, "2027-01-01", "2027-12-31", [
    { id: 1, fecha: "2027-10-12", nombre: "x", ambito: "COMUNIDAD", provincia: null, municipio: null, comunidad: "AR", quitar: true },
    { id: 2, fecha: "2027-01-29", nombre: "San Valero", ambito: "MUNICIPIO", provincia: "50", municipio: "ZARAGOZA", comunidad: null, quitar: false },
    { id: 3, fecha: "2027-05-15", nombre: "San Isidro", ambito: "MUNICIPIO", provincia: "28", municipio: "MADRID", comunidad: null, quitar: false },
  ]);
  const fechas = f.map((x) => x.fecha);
  assert.ok(fechas.includes("2027-04-23")); // Día de Aragón (automático)
  assert.ok(fechas.includes("2027-01-29")); // local de Zaragoza
  assert.ok(!fechas.includes("2027-10-12")); // quitado
  assert.ok(!fechas.includes("2027-05-15")); // local de otro municipio
});

test("plan del día: fijo, rotativo, festivo y cambio puntual", () => {
  assert.equal(minutosTramo({ inicio: "22:00", fin: "06:00" }), 480);
  const festivos = new Set(["2026-12-08"]);
  assert.deepEqual(planDia(fijo, "2026-12-07", new Map(), festivos), [{ inicio: "08:00", fin: "15:00" }]);
  assert.deepEqual(planDia(fijo, "2026-12-08", new Map(), festivos), []); // festivo
  assert.deepEqual(planDia(fijo, "2026-12-12", new Map(), festivos), []); // sábado
  assert.equal(semanaPatron(rotativo, "2026-11-04"), 1);
  assert.equal(semanaPatron(rotativo, "2026-11-11"), 2);
  assert.equal(semanaPatron(rotativo, "2026-11-18"), 1);
  assert.equal(semanaPatron(rotativo, "2026-10-28"), 2); // antes del inicio también rota
  assert.deepEqual(planDia(rotativo, "2026-12-08", new Map(), festivos), [{ inicio: "15:00", fin: "23:00" }]); // trabaja festivos
  const cambios = new Map([["2026-12-07", [] as { inicio: string; fin: string }[]]]);
  assert.deepEqual(planDia(fijo, "2026-12-07", cambios, festivos), []); // libre por cambio
});

test("objetivo del mes y bolsa de horas", () => {
  const festivos = new Set(["2026-12-08", "2026-12-25"]);
  // Diciembre 2026: 23 laborables - 2 festivos = 21 días x 7 h
  assert.equal(objetivoMes(fijo, "2026-12", new Map(), festivos, null).total, 21 * 7 * 60);
  assert.equal(objetivoMes(fijo, "2026-12", new Map(), festivos, 100).total, 6000); // ajuste
  const variable: Horario = { ...fijo, tipo: "VARIABLE", horasMes: 120, tramos: [] };
  assert.equal(objetivoMes(variable, "2026-12", new Map(), festivos, null).total, 7200);
  // 120 h contratadas, trabaja 96 -> debe 24 h; mes siguiente trabaja 130 -> compensa 10 y queda 14
  const b1 = bolsaTrasMes(0, 7200, 96 * 60);
  assert.equal(b1, 24 * 60);
  assert.equal(bolsaTrasMes(b1, 7200, 130 * 60), 14 * 60);
  assert.equal(bolsaTrasMes(60, 7200, 200 * 60), 0); // nunca negativa
});

test("avisos: sin entrada, escalado, retraso y salida", () => {
  const O = (id: number, tipo: any, t: string): Original => ({ UsuarioId: 1, FichajeId: id, Tipo: tipo, FechaHoraUtc: new Date(t), UbicacionEstado: "OK", PrecisionM: 5 });
  const tramos = [{ fecha: "2026-12-07", t: { inicio: "08:00", fin: "15:00" } }]; // 07:00Z - 14:00Z
  // 08:05 local: dentro del margen, sin aviso
  assert.equal(calcularAvisos(tramos, [], PARAMS_DEFECTO, new Date("2026-12-07T07:05:00Z")).length, 0);
  // 08:20: sin entrada, no escalado; 08:45: escalado (10 + 30 min)
  const a1 = calcularAvisos(tramos, [], PARAMS_DEFECTO, new Date("2026-12-07T07:20:00Z"));
  assert.equal(a1[0].tipo, "SIN_ENTRADA");
  assert.equal(a1[0].escalado, false);
  assert.equal(calcularAvisos(tramos, [], PARAMS_DEFECTO, new Date("2026-12-07T07:45:00Z"))[0].escalado, true);
  // Entró a las 08:25: retraso
  const conEntrada = aplicarCorrecciones([O(1, "ENTRADA", "2026-12-07T07:25:00Z")], []);
  const a2 = calcularAvisos(tramos, conEntrada, PARAMS_DEFECTO, new Date("2026-12-07T09:00:00Z"));
  assert.deepEqual(a2.map((a) => a.tipo), ["RETRASO"]);
  // 15:20 local y sigue dentro: sin salida
  const a3 = calcularAvisos(tramos, conEntrada, PARAMS_DEFECTO, new Date("2026-12-07T14:20:00Z"));
  assert.ok(a3.some((a) => a.tipo === "SIN_SALIDA" && !a.escalado));
  // Variable sin plan: aviso a las 12 h
  const a4 = calcularAvisos([], conEntrada, PARAMS_DEFECTO, new Date("2026-12-07T19:30:00Z"));
  assert.ok(a4.some((a) => a.tipo === "SIN_SALIDA" && a.prevista === null));
});
