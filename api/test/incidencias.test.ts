import { test } from "node:test";
import assert from "node:assert/strict";
import { aplicarCorrecciones, localAUtc, Original, Correccion } from "../src/lib/correcciones";
import { errorSecuencia, puedeResolver, solicitantesDe } from "../src/lib/incidencias";
import { resumirPorDia } from "../src/lib/jornada";
import { Org } from "../src/lib/organizacion";

const d = (s: string) => new Date(s);
const O = (id: number, tipo: any, t: string): Original => ({ UsuarioId: 1, FichajeId: id, Tipo: tipo, FechaHoraUtc: d(t), UbicacionEstado: "OK", PrecisionM: 10 });
const C = (id: number, tipo: any, fid: number | null, tf: any, t: string | null): Correccion => ({ CorreccionId: id, UsuarioId: 1, Tipo: tipo, FichajeId: fid, TipoFichaje: tf, FechaHoraUtc: t ? d(t) : null });

test("hora local de Madrid a UTC (invierno y verano)", () => {
  assert.equal(localAUtc("2026-01-15", "09:00", "Europe/Madrid")!.toISOString(), "2026-01-15T08:00:00.000Z");
  assert.equal(localAUtc("2026-07-15", "09:00", "Europe/Madrid")!.toISOString(), "2026-07-15T07:00:00.000Z");
  assert.equal(localAUtc("2026-07-15", "9:00", "Europe/Madrid"), null);
});

test("aplicar correcciones: cambiar hora, añadir y anular", () => {
  const orig = [O(1, "ENTRADA", "2026-10-20T07:30:00Z"), O(2, "SALIDA", "2026-10-20T16:00:00Z"), O(3, "ENTRADA", "2026-10-21T07:00:00Z"), O(4, "ENTRADA", "2026-10-21T07:05:00Z")];
  const corr = [
    C(1, "CAMBIAR_HORA", 1, "ENTRADA", "2026-10-20T07:00:00Z"),
    C(2, "ANULAR", 4, "ENTRADA", null),
    C(3, "ANADIR", null, "SALIDA", "2026-10-21T15:00:00Z"),
  ];
  const ef = aplicarCorrecciones(orig, corr);
  assert.equal(ef[0].fechaHoraUtc.toISOString(), "2026-10-20T07:00:00.000Z");
  assert.equal(ef[0].corregido, true);
  assert.equal(ef[0].originalUtc!.toISOString(), "2026-10-20T07:30:00.000Z");
  assert.equal(ef.find((f) => f.id === 4)!.anulado, true);
  const anadido = ef.find((f) => f.anadido)!;
  assert.equal(anadido.ubicacion, "CORRECCION");
  // El resumen cuenta la jornada corregida y no los anulados
  const dias = resumirPorDia(ef, "Europe/Madrid", d("2026-10-22T00:00:00Z"));
  const d20 = dias.find((x) => x.fecha === "2026-10-20")!;
  const d21 = dias.find((x) => x.fecha === "2026-10-21")!;
  assert.equal(d20.minutosTrabajados, 9 * 60);
  assert.equal(d21.minutosTrabajados, 8 * 60);
  assert.equal(d21.abierto, false);
  assert.equal(d21.fichajes.filter((f) => f.anulado).length, 1);
  assert.equal(d20.fichajes[0].originalUtc, "2026-10-20T07:30:00.000Z");
});

test("validación de secuencia: no permite descuadrar, sí arreglar", () => {
  const ef = aplicarCorrecciones([O(1, "ENTRADA", "2026-10-20T07:00:00Z"), O(2, "ENTRADA", "2026-10-21T07:00:00Z"), O(3, "SALIDA", "2026-10-21T15:00:00Z")], []);
  const ref = d("2026-10-20T16:00:00Z");
  // Olvidó la salida del día 20: añadirla arregla la secuencia
  assert.equal(errorSecuencia(ef, { tipo: "ANADIR", fichajeId: null, tipoFichaje: "SALIDA", nuevaUtc: ref }, ref), null);
  // Añadir otra ENTRADA la empeora
  assert.notEqual(errorSecuencia(ef, { tipo: "ANADIR", fichajeId: null, tipoFichaje: "ENTRADA", nuevaUtc: ref }, ref), null);
  // Mover una salida antes de su entrada la empeora
  const ok = aplicarCorrecciones([O(1, "ENTRADA", "2026-10-20T07:00:00Z"), O(2, "SALIDA", "2026-10-20T15:00:00Z"), O(3, "ENTRADA", "2026-10-21T07:00:00Z"), O(4, "SALIDA", "2026-10-21T15:00:00Z")], []);
  assert.notEqual(errorSecuencia(ok, { tipo: "CAMBIAR_HORA", fichajeId: 4, tipoFichaje: "SALIDA", nuevaUtc: d("2026-10-21T06:00:00Z") }, d("2026-10-21T15:00:00Z")), null);
  // Anular una entrada deja la salida huérfana: la empeora
  assert.notEqual(errorSecuencia(ok, { tipo: "ANULAR", fichajeId: 3, tipoFichaje: "ENTRADA", nuevaUtc: null }, d("2026-10-21T07:00:00Z")), null);
  // Cambiar la hora sin alterar el orden es válido
  assert.equal(errorSecuencia(ef, { tipo: "CAMBIAR_HORA", fichajeId: 3, tipoFichaje: "SALIDA", nuevaUtc: d("2026-10-21T16:00:00Z") }, d("2026-10-21T15:00:00Z")), null);
});

test("quién resuelve: aprobador, suplente o RRHH/ADMIN si no hay aprobador", () => {
  const U = (id: number, tipo: any, dep: number | null, man: number | null) => [id, { id, nombre: "N" + id, apellidos: "A", activo: true, tipo, departamentoId: dep, centroId: null, managerId: man }] as const;
  const o: Org = {
    usuarios: new Map([U(1, "ESTRUCTURA", 10, null), U(2, "ESTRUCTURA", 11, 1), U(3, "ESTRUCTURA", 11, null), U(4, "ESTRUCTURA", 11, null), U(5, "ESTRUCTURA", 12, null)]),
    deps: new Map([[10, { id: 10, nombre: "Dirección", managerId: 1 }], [11, { id: 11, nombre: "Gestión", managerId: 2 }], [12, { id: 12, nombre: "RRHH", managerId: null }]]),
    centros: new Map(),
    suplencias: new Map([[2, { titularId: 2, suplenteId: 4, hasta: "2099-12-31" }]]),
    depsQueDirige: new Map([[1, [10]], [2, [11]]]),
    centrosQueCoordina: new Map(),
    centrosRrhh: new Map(),
  };
  const s = (usuarioId: number, rol: any = "EMPLEADO") => ({ usuarioId, rol } as any);
  assert.equal(puedeResolver(o, s(2), 3), true); // titular
  assert.equal(puedeResolver(o, s(4), 3), true); // suplente
  assert.equal(puedeResolver(o, s(4), 4), false); // nunca a sí mismo
  assert.equal(puedeResolver(o, s(5, "RRHH"), 3), false); // RRHH solo si no hay aprobador
  assert.equal(puedeResolver(o, s(5, "RRHH"), 1), true); // CEO → RRHH/ADMIN
  assert.deepEqual(solicitantesDe(o, s(5, "ADMIN")).sort(), [1]);
});
