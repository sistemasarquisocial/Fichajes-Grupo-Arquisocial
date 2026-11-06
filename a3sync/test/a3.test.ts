import { test } from "node:test";
import assert from "node:assert/strict";
import { normDni, dniValido, fechaA3, partirNombre, direccionCentro, aplanarOrganigrama, normEmail } from "../src/lib/normalizar";
import { conciliar, EntradaConciliacion, RegistroA3, UsuarioApp } from "../src/lib/conciliar";
import { A3Cliente, enParalelo } from "../src/lib/a3cliente";
import { urlAutorizacion, usuarioDeTokens } from "../src/lib/oauth";

/* ---------- Normalización (formatos reales vistos en a3 el 05/11/2026) ---------- */
test("normalización de datos de a3", () => {
  assert.equal(normDni("0X1234567L"), "X1234567L"); // a3 antepone un 0 a algunos NIE
  assert.equal(normDni(" 12345678z "), "12345678Z");
  assert.equal(dniValido("12345678Z"), true);
  assert.equal(dniValido("12345678A"), false);
  assert.equal(dniValido("X1234567L"), true);
  assert.equal(dniValido("Y12345678Z"), false); // NIE con 8 dígitos
  assert.equal(fechaA3("0001-01-01T00:00:00Z"), null); // a3: «sin baja»
  assert.equal(fechaA3("2022-07-08T00:00:00Z"), "2022-07-08");
  assert.deepEqual(partirNombre("PEREZ GOMEZ, LUCIA"), { nombre: "Lucia", apellidos: "Perez Gomez" });
  assert.deepEqual(partirNombre("GARCIA DE LA TORRE, MARIA DEL CARMEN"), { nombre: "Maria del Carmen", apellidos: "Garcia de la Torre" });
  assert.deepEqual(partirNombre("LOPEZ SANCHEZ-VILLA, IRENE"), { nombre: "Irene", apellidos: "Lopez Sanchez-Villa" });
  assert.equal(direccionCentro({ acronym: "Calle", streetName: "RIO SAN PEDRO", buildingNumber: "6", stairWell: "", floor: "", gate: "Bajo" }), "Calle RIO SAN PEDRO 6, Bajo");
  assert.equal(normEmail(" Ana.Perez@Arquisocial.ES "), "ana.perez@arquisocial.es");
  assert.equal(normEmail("sin-arroba"), null);
});

test("organigrama: árbol → filas con padre", () => {
  const raiz = {
    orgUnitNodeID: "a", orgUnitName: "Dirección", orgUnitManagerIdentifierNumber: "0X1234567L",
    children: [{ orgUnitNodeID: "b", orgUnitName: "RRHH", children: [{ orgUnitNodeID: "c", orgUnitName: "Nóminas", children: [] }] }],
  };
  const f = aplanarOrganigrama(raiz, 355);
  assert.deepEqual(f.map((n) => [n.nodoId, n.padreNodoId]), [["a", null], ["b", "a"], ["c", "b"]]);
  assert.equal(f[0].responsableDNI, "X1234567L");
});

/* ---------- Conciliación ---------- */
const reg = (x: Partial<RegistroA3>): RegistroA3 => ({
  empresaA3: 355, empleadoA3: "000001", idA3: null, dni: "12345678Z", nombre: "Ana", apellidos: "Pérez", centroA3: 109,
  fechaAlta: "2024-01-01", fechaBaja: null, emailProfesional: "ana@arquisocial.es", emailPersonal: null, ...x,
});
const usu = (x: Partial<UsuarioApp>): UsuarioApp => ({
  id: 1, email: "x@x.es", nombre: "X", apellidos: "Y", empresaId: 10, centroId: 500, tipoPerfil: "DELEGACION", activo: true,
  dni: null, empresaA3: null, empleadoA3: null, idA3: null, fechaAltaA3: null, fechaBajaA3: null, origenA3: false, desactivadoPorA3: false, ...x,
});
const base = (x: Partial<EntradaConciliacion> = {}): EntradaConciliacion => ({
  hoy: "2026-11-05",
  registros: [],
  empresas: new Map([[355, { empresaId: 10 }], [356, { empresaId: 11 }]]),
  centros: new Map([["355-109", { centroId: 500, nombre: "Almería" }], ["355-1", { centroId: 600, nombre: "Estructura" }], ["356-1", { centroId: 700, nombre: "Fepas Zgz" }], ["355-2", { centroId: null, nombre: "Madrid" }]]),
  estructura: new Set([600]),
  usuarios: [],
  empresasLeidas: new Set([355, 356]),
  ...x,
});

test("alta nueva con perfil según el centro y email profesional o personal", () => {
  const r = conciliar(base({ registros: [
    reg({}),
    reg({ empleadoA3: "000002", dni: "87654321X", centroA3: 1, emailProfesional: "", emailPersonal: "Luis@Gmail.com", nombre: "Luis" }),
  ] }));
  assert.equal(r.crear.length, 2);
  assert.equal(r.crear[0].tipoPerfil, "DELEGACION");
  assert.equal(r.crear[1].tipoPerfil, "ESTRUCTURA");
  assert.equal(r.crear[1].email, "luis@gmail.com");
  assert.equal(r.pendientes.length, 0);
});

test("baja pasada no se importa; baja futura sí; varias empresas → alta más reciente", () => {
  const r = conciliar(base({ registros: [
    reg({ fechaBaja: "2026-10-01" }),
    reg({ empleadoA3: "000009", dni: "87654321X", fechaBaja: "2026-12-31", emailProfesional: "b@a.es" }),
    reg({ empresaA3: 356, empleadoA3: "000101", dni: "11111111H", centroA3: 1, fechaAlta: "2020-01-01", emailProfesional: "m@a.es" }),
    reg({ empresaA3: 355, empleadoA3: "000202", dni: "11111111H", centroA3: 109, fechaAlta: "2025-03-01", emailProfesional: "m@a.es" }),
  ] }));
  assert.deepEqual(r.crear.map((c) => [c.dni, c.empresaId, c.centroId]).sort(), [["11111111H", 10, 500], ["87654321X", 10, 500]]);
});

test("centro sin servicio, sin email y emails duplicados van a pendientes", () => {
  const r = conciliar(base({
    registros: [
      reg({ centroA3: 2 }),
      reg({ empleadoA3: "000002", dni: "87654321X", emailProfesional: null }),
      reg({ empleadoA3: "000003", dni: "11111111H", emailProfesional: "dup@a.es" }),
      reg({ empleadoA3: "000004", dni: "22222222J", emailProfesional: "dup@a.es" }),
      reg({ empleadoA3: "000005", dni: "33333333P", emailProfesional: "usado@a.es" }),
    ],
    usuarios: [usu({ id: 9, email: "usado@a.es", dni: "99999999R" })],
  }));
  assert.equal(r.crear.length, 0);
  assert.deepEqual(r.pendientes.map((p) => p.tipo).sort(), ["CENTRO_SIN_SERVICIO", "EMAIL_DUPLICADO", "EMAIL_DUPLICADO", "EMAIL_DUPLICADO", "SIN_EMAIL"]);
  assert.equal(r.omitidosSinServicio, 1);
});

test("usuario manual se enlaza por email sin pisar su perfil; usuario de a3 se actualiza; email distinto → pendiente", () => {
  const r = conciliar(base({
    registros: [
      reg({ emailProfesional: "ana@arquisocial.es", centroA3: 1 }),
      reg({ empleadoA3: "000002", dni: "87654321X", emailProfesional: "nuevo@a.es", nombre: "Luis", apellidos: "Gómez", centroA3: 1 }),
    ],
    usuarios: [
      usu({ id: 1, email: "Ana@arquisocial.es", centroId: 500, tipoPerfil: "DELEGACION" }),
      usu({ id: 2, email: "luis@a.es", dni: "87654321X", origenA3: true, nombre: "L", apellidos: "G", centroId: 500, empresaA3: 355, empleadoA3: "000002" }),
    ],
  }));
  const a1 = r.actualizar.find((a) => a.id === 1)!;
  assert.equal(a1.campos.dni, "12345678Z");
  assert.equal(a1.campos.centroId, undefined); // manual: no se cambia su centro
  assert.equal(a1.campos.tipoPerfil, undefined);
  const a2 = r.actualizar.find((a) => a.id === 2)!;
  assert.equal(a2.campos.nombre, "Luis");
  assert.equal(a2.campos.centroId, 600);
  assert.equal(a2.campos.tipoPerfil, "ESTRUCTURA");
  assert.deepEqual(r.pendientes.map((p) => p.tipo), ["EMAIL_CAMBIADO"]);
  assert.equal(r.crear.length, 0);
});

test("bajas: se desactiva solo si su empresa se leyó bien; reactivación si la baja era de a3", () => {
  const usuarios = [
    usu({ id: 1, dni: "12345678Z", empresaA3: 355, empleadoA3: "000001", origenA3: true }),
    usu({ id: 2, dni: "87654321X", empresaA3: 356, empleadoA3: "000002", origenA3: true }),
    usu({ id: 3, dni: "11111111H", empresaA3: 355, empleadoA3: "000003", origenA3: true, activo: false, desactivadoPorA3: true, email: "c@a.es" }),
  ];
  const r = conciliar(base({
    registros: [reg({ fechaBaja: "2026-10-31" }), reg({ empleadoA3: "000003", dni: "11111111H", emailProfesional: "c@a.es" })],
    usuarios,
    empresasLeidas: new Set([355]),
  }));
  assert.deepEqual(r.desactivar, [{ id: 1, fechaBajaA3: "2026-10-31" }]); // el 2 no: su empresa no se leyó
  const re = r.actualizar.find((a) => a.id === 3)!;
  assert.equal(re.campos.activo, true);
  assert.equal(re.campos.desactivadoPorA3, false);
});

/* ---------- Cliente de la API ---------- */
function falsaApi(respuestas: ((url: string, i: number) => { status: number; body?: any; headers?: Record<string, string> })) {
  const llamadas: string[] = [];
  const f = (async (url: string) => {
    llamadas.push(url);
    const r = respuestas(url, llamadas.length);
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status, headers: r.headers });
  }) as unknown as typeof fetch;
  return { f, llamadas };
}

test("cliente: paginación de 50 en 50 hasta página incompleta", async () => {
  const { f, llamadas } = falsaApi((url) => {
    const p = Number(new URL(url).searchParams.get("pageNumber"));
    return { status: 200, body: Array.from({ length: p < 3 ? 50 : 7 }, (_, i) => ({ n: (p - 1) * 50 + i })) };
  });
  const c = new A3Cliente({ apikey: "k", token: async () => "t", invalidarToken: () => {}, fetch: f, porSegundo: 1000, espera: async () => {} });
  const r = await c.todas("/api/companies/355/employees", { filter: "lastUpdate gt 2026-11-04" });
  assert.equal(r.length, 107);
  assert.equal(llamadas.length, 3);
  assert.match(llamadas[0], /pageNumber=1&pageSize=50$/);
  assert.match(llamadas[0], /filter=lastUpdate%20gt%202026-11-04/);
});

test("cliente: 429 espera Retry-After, 401 renueva token, 404 → null", async () => {
  const esperas: number[] = [];
  let invalidado = 0;
  const { f } = falsaApi((_u, i) => (i === 1 ? { status: 429, headers: { "Retry-After": "42" } } : i === 2 ? { status: 401 } : i === 3 ? { status: 200, body: [{ ok: 1 }] } : { status: 404 }));
  const c = new A3Cliente({ apikey: "k", token: async () => "t", invalidarToken: () => invalidado++, fetch: f, porSegundo: 1000, espera: async (ms) => { esperas.push(ms); } });
  assert.deepEqual(await c.get("/api/companies"), [{ ok: 1 }]);
  assert.ok(esperas.includes(42000));
  assert.equal(invalidado, 1);
  assert.equal(await c.get("/api/x"), null);
});

test("enParalelo respeta el límite y el orden", async () => {
  let activos = 0, max = 0;
  const r = await enParalelo([1, 2, 3, 4, 5, 6], 2, async (x) => { activos++; max = Math.max(max, activos); await new Promise((s) => setTimeout(s, 5)); activos--; return x * 2; });
  assert.deepEqual(r, [2, 4, 6, 8, 10, 12]);
  assert.equal(max, 2);
});

test("OAuth: URL de autorización y usuario del token", () => {
  const u = urlAutorizacion("WK.ES.API.a3innuvaNomina.96488.ITOPTRAINING", "https://f.example/api/a3/callback", "st", "no");
  assert.match(u, /^https:\/\/login\.wolterskluwer\.eu\/auth\/core\/connect\/authorize\?client_id=WK\.ES\.API/);
  assert.match(u, /scope=offline_access\+openid\+IDInfo\+WK\.ES\.A3EquipoContex/);
  const jwt = (p: object) => `x.${Buffer.from(JSON.stringify(p)).toString("base64url")}.y`;
  assert.equal(usuarioDeTokens({ access_token: jwt({ "wk.es.a3equipouserid": "sistemas@arquisocial.es" }) }), "sistemas@arquisocial.es");
});

/* ---------- Alcance de la carga progresiva ---------- */
test("alcance de la sincronización: por defecto solo empresas", async () => {
  const { alcanceConfigurado, empresasLimitadas } = await import("../src/lib/sync");
  assert.equal(alcanceConfigurado(undefined), "EMPRESAS");
  assert.equal(alcanceConfigurado(""), "EMPRESAS");
  assert.equal(alcanceConfigurado("otra cosa"), "EMPRESAS");
  assert.equal(alcanceConfigurado(" centros "), "CENTROS");
  assert.equal(alcanceConfigurado("TODO"), "TODO");
  assert.equal(empresasLimitadas(undefined), null);
  assert.equal(empresasLimitadas(" , x"), null);
  assert.deepEqual([...(empresasLimitadas("355, 1 ,356") ?? [])], [355, 1, 356]);
});

/* ---------- Tope de llamadas ---------- */
test("el cliente se para al llegar al tope de llamadas", async () => {
  const f = (async () => new Response("[]", { status: 200 })) as unknown as typeof fetch;
  const cli = new A3Cliente({ apikey: "k", token: async () => "t", invalidarToken: () => {}, fetch: f, porSegundo: 1000, maxLlamadas: 2, espera: async () => {} });
  await cli.get("/a");
  await cli.get("/b");
  await assert.rejects(cli.get("/c"), /tope de 2 llamadas/);
  assert.equal(cli.llamadas, 2);
});
