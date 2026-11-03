import { test } from "node:test";
import assert from "node:assert/strict";
import { Org, aprobadorTitular, aprobadorEfectivo, directosDe, esAprobador } from "../src/lib/organizacion";

/* Organización de ejemplo:
   CEO(1) dirige Dirección(10); manager de ella: nadie.
   Director territorial(2) dirige Gestión Norte(11); su manager en ficha: CEO.
   Gestor(3) es de Gestión Norte. Coordinador(4) coordina centros 100 y 101 (gestor 3), y pertenece al 100.
   Empleado centro(5) en centro 100. Empleado centro(6) en centro 101.
   Jefa de RRHH(7) dirige RRHH(12); manager en ficha: CEO. Técnico RRHH(8) en RRHH.
   Usuario sin perfil(9). */
function org(): Org {
  const U = (id: number, tipo: any, dep: number | null, cen: number | null, man: number | null) =>
    [id, { id, nombre: "N" + id, apellidos: "A", activo: true, tipo, departamentoId: dep, centroId: cen, managerId: man }] as const;
  const o: Org = {
    usuarios: new Map([U(1, "ESTRUCTURA", 10, null, null), U(2, "ESTRUCTURA", 11, null, 1), U(3, "ESTRUCTURA", 11, null, null), U(4, "DELEGACION", null, 100, null),
      U(5, "DELEGACION", null, 100, null), U(6, "DELEGACION", null, 101, null), U(7, "ESTRUCTURA", 12, null, 1), U(8, "ESTRUCTURA", 12, null, null), U(9, null, null, null, null)]),
    deps: new Map([[10, { id: 10, nombre: "Dirección", managerId: 1 }], [11, { id: 11, nombre: "Gestión Norte", managerId: 2 }], [12, { id: 12, nombre: "RRHH", managerId: 7 }]]),
    centros: new Map([[100, { id: 100, coordinadorId: 4, gestorId: 3 }], [101, { id: 101, coordinadorId: 4, gestorId: 3 }]]),
    suplencias: new Map(),
    depsQueDirige: new Map([[1, [10]], [2, [11]], [7, [12]]]),
    centrosQueCoordina: new Map([[4, [100, 101]]]),
  };
  return o;
}

test("cadena de aprobación", () => {
  const o = org();
  assert.equal(aprobadorTitular(o, 1), null); // CEO
  assert.equal(aprobadorTitular(o, 2), 1); // director → CEO (manual)
  assert.equal(aprobadorTitular(o, 3), 2); // gestor → manager de Gestión
  assert.equal(aprobadorTitular(o, 4), 3); // coordinador → gestor
  assert.equal(aprobadorTitular(o, 5), 4); // empleado centro → coordinador
  assert.equal(aprobadorTitular(o, 6), 4);
  assert.equal(aprobadorTitular(o, 7), 1); // jefa RRHH → CEO
  assert.equal(aprobadorTitular(o, 8), 7);
  assert.equal(aprobadorTitular(o, 9), null); // sin perfil
});

test("directos y aprobadores", () => {
  const o = org();
  assert.deepEqual(directosDe(o, 1).sort(), [2, 7]);
  assert.deepEqual(directosDe(o, 2), [3]);
  assert.deepEqual(directosDe(o, 3), [4]);
  assert.deepEqual(directosDe(o, 4).sort(), [5, 6]);
  assert.deepEqual(directosDe(o, 5), []);
  assert.equal(esAprobador(o, 4), true);
  assert.equal(esAprobador(o, 8), false);
});

test("suplencia vigente", () => {
  const o = org();
  o.suplencias.set(4, { titularId: 4, suplenteId: 6, hasta: "2026-12-31" });
  assert.deepEqual(aprobadorEfectivo(o, 5), { titular: 4, efectivo: 6, suplenciaHasta: "2026-12-31" });
  // el suplente no se aprueba a sí mismo: sigue el titular
  assert.equal(aprobadorEfectivo(o, 6).efectivo, 4);
  // el suplente ve los directos del titular (incluido él mismo no)
  assert.deepEqual(directosDe(o, 6), [5]);
});
