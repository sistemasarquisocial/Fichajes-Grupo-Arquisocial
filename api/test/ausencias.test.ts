import { test } from "node:test";
import assert from "node:assert/strict";
import { restarAusencias, minutosJustificados, minutosDia, Ausencia, textoPeriodo } from "../src/lib/ausencias";
import { tipoArchivo, nombreSeguro } from "../src/lib/almacen";
import { laborablesMes } from "../src/lib/horarios";

const base: Ausencia = {
  id: 1, usuarioId: 1, motivoId: 1, motivo: "Enfermedad o visita médica", requiereJustificante: true,
  fechaInicio: "2026-11-10", fechaFin: "2026-11-10", horaInicio: "10:00", horaFin: "12:00", estado: "APROBADA",
};
const dia = { ...base, horaInicio: null, horaFin: null };
const plan = [{ inicio: "08:00", fin: "15:00" }];

test("ausencias: horas dentro del horario cuentan solo la parte que coincide", () => {
  assert.equal(minutosJustificados(base, "2026-11-10", plan, null, true), 120);
  assert.equal(minutosJustificados({ ...base, horaInicio: "14:00", horaFin: "17:00" }, "2026-11-10", plan, null, true), 60);
  // Sin horario ese día: la duración indicada
  assert.equal(minutosJustificados(base, "2026-11-10", [], null, true), 120);
  assert.equal(minutosJustificados(base, "2026-11-11", plan, null, true), 0);
});

test("ausencias: un día completo cuenta como un día trabajado", () => {
  // Fijo/rotativo: las horas de su horario ese día (también turnos de noche)
  assert.equal(minutosJustificados(dia, "2026-11-10", plan, null, true), 420);
  assert.equal(minutosJustificados(dia, "2026-11-10", [{ inicio: "22:00", fin: "06:00" }], null, true), 480);
  // Variable: su jornada media solo si el día es laborable
  assert.equal(minutosJustificados(dia, "2026-11-10", [], 360, true), 360);
  assert.equal(minutosJustificados(dia, "2026-11-14", [], 360, false), 0);
  // Varias ausencias el mismo día no superan la jornada
  assert.equal(minutosDia([base, { ...base, id: 2, horaInicio: "07:00", horaFin: "16:00" }], "2026-11-10", plan, null, true), 420);
});

test("ausencias: silencian los avisos de esas horas", () => {
  assert.deepEqual(restarAusencias("2026-11-10", plan[0], [base]), [{ inicio: "08:00", fin: "10:00" }, { inicio: "12:00", fin: "15:00" }]);
  assert.deepEqual(restarAusencias("2026-11-10", plan[0], [{ ...base, horaInicio: "08:00", horaFin: "10:00" }]), [{ inicio: "10:00", fin: "15:00" }]);
  assert.deepEqual(restarAusencias("2026-11-10", plan[0], [dia]), []);
  assert.deepEqual(restarAusencias("2026-11-11", plan[0], [dia]), plan);
  // Turno de noche: el trozo que queda conserva el paso de medianoche
  assert.deepEqual(restarAusencias("2026-11-10", { inicio: "22:00", fin: "06:00" }, [{ ...base, horaInicio: "22:00", horaFin: "23:00" }]), [{ inicio: "23:00", fin: "06:00" }]);
});

test("ausencias: días laborables del mes y texto del periodo", () => {
  assert.equal(laborablesMes("2026-11", new Set()), 21);
  assert.equal(laborablesMes("2026-11", new Set(["2026-11-02"])), 20);
  assert.equal(textoPeriodo(base), "10/11/2026 10:00–12:00");
  assert.equal(textoPeriodo({ ...dia, fechaFin: "2026-11-12" }), "10/11/2026 – 12/11/2026");
});

test("documentos: tipo real por la firma y nombre seguro", () => {
  assert.equal(tipoArchivo(Buffer.from("%PDF-1.7 ..."))?.mime, "application/pdf");
  assert.equal(tipoArchivo(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))?.ext, "jpg");
  assert.equal(tipoArchivo(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))?.ext, "png");
  assert.equal(tipoArchivo(Buffer.from("<html>")), null);
  assert.equal(nombreSeguro("../parte\u0000 médico", "pdf"), "..parte médico.pdf");
  assert.equal(nombreSeguro("foto.JPEG", "jpg"), "foto.JPEG");
  assert.equal(nombreSeguro("", "png"), "justificante.png");
});
