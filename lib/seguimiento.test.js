// Pruebas de la detección de notas que NO son una falta nueva (continúa
// faltando, reincorporación). Los nombres son ficticios; los escenarios
// reproducen dos errores reales del 2026-09-19 -- ver lib/seguimiento.js.
//
// Corre con: node --test lib/

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mismaPersona, entradasSeguimiento, clasificarNotaEntrante } from "./seguimiento.js";

// Expediente abierto de Luis, con una falta grupal (la misma nota cubre a Marco).
const LUIS_ABIERTO = {
  id: "n1", apellidos: "TORRES VEGA", nombres: "Luis Alberto",
  numero_nota_falta: "202601600621", numero_nota_reincorporacion: null, seguimiento_faltas: [],
};
const MARCO_ABIERTO = {
  id: "n2", apellidos: "SALAS RIOS", nombres: "Marco Antonio",
  numero_nota_falta: "202601600621", numero_nota_reincorporacion: null, seguimiento_faltas: [],
};
// Expediente de Carla ya cerrado con su reincorporación N.º 202601594612.
const CARLA_CERRADA = {
  id: "n3", apellidos: "PAREDES LUNA", nombres: "Carla",
  numero_nota_falta: "202601565310", numero_nota_reincorporacion: "202601594612",
  seguimiento_faltas: [
    { fecha: "2026-09-14", numero_nota: "202601578652", oficial_constato: null },
    { fecha: "2026-09-13", numero_nota: "202601572076", oficial_constato: null },
  ],
};

describe("mismaPersona", () => {
  test("ignora mayúsculas, tildes y espacios de más", () => {
    assert.equal(mismaPersona({ apellidos: "Núñez  Díaz", nombres: "josé" }, { apellidos: "NUNEZ DIAZ", nombres: "JOSE" }), true);
  });
  test("un PDF sin nombres solo con apellidos iguales sí coincide", () => {
    assert.equal(mismaPersona({ apellidos: "TORRES VEGA", nombres: "" }, LUIS_ABIERTO), true);
  });
  test("mismos apellidos pero nombres distintos son personas distintas", () => {
    assert.equal(mismaPersona({ apellidos: "TORRES VEGA", nombres: "Pedro" }, LUIS_ABIERTO), false);
  });
  test("sin apellidos nunca coincide", () => {
    assert.equal(mismaPersona({ apellidos: "", nombres: "Luis" }, { apellidos: "", nombres: "Luis" }), false);
  });
});

describe("entradasSeguimiento", () => {
  test("ordena por fecha sin tocar el arreglo original", () => {
    const original = CARLA_CERRADA.seguimiento_faltas;
    const orden = entradasSeguimiento(CARLA_CERRADA).map((s) => s.fecha);
    assert.deepEqual(orden, ["2026-09-13", "2026-09-14"]);
    assert.equal(original[0].fecha, "2026-09-14");
  });
  test("tolera null, ausente y filas rotas", () => {
    assert.deepEqual(entradasSeguimiento({ seguimiento_faltas: null }), []);
    assert.deepEqual(entradasSeguimiento({}), []);
    assert.deepEqual(entradasSeguimiento(undefined), []);
    assert.deepEqual(entradasSeguimiento({ seguimiento_faltas: [null, {}, { fecha: "2026-09-01" }] }).length, 1);
  });
});

describe("clasificarNotaEntrante", () => {
  test("una falta realmente nueva no se marca", () => {
    const nueva = { apellidos: "CASTRO ORTIZ", nombres: "Ana", numero_nota_falta: "202601700001", referencia: null };
    assert.equal(clasificarNotaEntrante(nueva, [LUIS_ABIERTO, CARLA_CERRADA], [nueva]), null);
  });

  test("reincorporación subida como falta: su N.º ya es la reincorporación de un expediente de la misma persona", () => {
    const entrante = { apellidos: "PAREDES LUNA", nombres: "Carla", numero_nota_falta: "202601594612", referencia: null };
    const r = clasificarNotaEntrante(entrante, [CARLA_CERRADA, LUIS_ABIERTO], [entrante]);
    assert.equal(r.motivo, "reincorporacion");
    assert.equal(r.nota.id, "n3");
  });

  test("un 'Continúan faltos' ya guardado, subido otra vez como falta, se detecta", () => {
    const entrante = { apellidos: "PAREDES LUNA", nombres: "Carla", numero_nota_falta: "202601572076", referencia: null };
    const r = clasificarNotaEntrante(entrante, [CARLA_CERRADA], [entrante]);
    assert.equal(r.motivo, "seguimiento");
    assert.equal(r.nota.id, "n3");
  });

  test("el mismo N.º de otra persona (nota grupal) NO cuenta", () => {
    const entrante = { apellidos: "SALAS RIOS", nombres: "Marco Antonio", numero_nota_falta: "202601594612", referencia: null };
    assert.equal(clasificarNotaEntrante(entrante, [CARLA_CERRADA], [entrante]), null);
  });

  test("continúa faltando con la nota madre YA en la base: su REF. la delata", () => {
    const continua = { apellidos: "TORRES VEGA", nombres: "Luis Alberto", numero_nota_falta: "202601607830", referencia: "202601600621" };
    const r = clasificarNotaEntrante(continua, [LUIS_ABIERTO, MARCO_ABIERTO], [continua]);
    assert.equal(r.motivo, "continuacion");
    assert.equal(r.nota.id, "n1"); // la de Luis, no la de Marco que comparte el N.º
  });

  test("continúa faltando en el MISMO lote que la nota madre (caso real Mejía)", () => {
    const madre = { apellidos: "TORRES VEGA", nombres: "Luis Alberto", numero_nota_falta: "202601600621", referencia: null };
    const continua = { apellidos: "TORRES VEGA", nombres: "Luis Alberto", numero_nota_falta: "202601607830", referencia: "202601600621" };
    const lote = [madre, continua];
    assert.equal(clasificarNotaEntrante(madre, [], lote), null, "la madre sí se crea");
    const r = clasificarNotaEntrante(continua, [], lote);
    assert.equal(r.motivo, "continuacion");
    assert.equal(r.fila, madre);
  });

  test("el orden de los archivos en el lote no importa: la continuación puede ir antes que su madre", () => {
    const madre = { apellidos: "TORRES VEGA", nombres: "Luis Alberto", numero_nota_falta: "202601600621", referencia: null };
    const continua = { apellidos: "TORRES VEGA", nombres: "Luis Alberto", numero_nota_falta: "202601607830", referencia: "202601600621" };
    const lote = [continua, madre];
    assert.equal(clasificarNotaEntrante(continua, [], lote).motivo, "continuacion");
    assert.equal(clasificarNotaEntrante(madre, [], lote), null);
  });

  test("en una nota grupal, la REF. de un efectivo no se confunde con la madre de otro", () => {
    const madreMarco = { apellidos: "SALAS RIOS", nombres: "Marco Antonio", numero_nota_falta: "202601600621", referencia: null };
    const continuaLuis = { apellidos: "TORRES VEGA", nombres: "Luis Alberto", numero_nota_falta: "202601607830", referencia: "202601600621" };
    assert.equal(clasificarNotaEntrante(continuaLuis, [], [madreMarco, continuaLuis]), null);
  });

  test("REF. igual a su propio N.º no cuenta como continuación de sí misma", () => {
    const rara = { apellidos: "TORRES VEGA", nombres: "Luis Alberto", numero_nota_falta: "202601600621", referencia: "202601600621" };
    assert.equal(clasificarNotaEntrante(rara, [], [rara]), null);
  });

  test("el mismo PDF dos veces en el lote: la primera se crea, la segunda es repetida", () => {
    const a = { apellidos: "CASTRO ORTIZ", nombres: "Ana", numero_nota_falta: "202601700001", referencia: null };
    const b = { ...a };
    const lote = [a, b];
    assert.equal(clasificarNotaEntrante(a, [], lote), null);
    const r = clasificarNotaEntrante(b, [], lote);
    assert.equal(r.motivo, "repetida_en_lote");
    assert.equal(r.fila, a);
  });

  test("sin N.º ni REF. no se puede afirmar nada", () => {
    const vacia = { apellidos: "TORRES VEGA", nombres: "Luis Alberto", numero_nota_falta: "", referencia: null };
    assert.equal(clasificarNotaEntrante(vacia, [LUIS_ABIERTO], [vacia]), null);
  });

  test("tolera notas o lote ausentes", () => {
    const e = { apellidos: "CASTRO ORTIZ", nombres: "Ana", numero_nota_falta: "1", referencia: "2" };
    assert.equal(clasificarNotaEntrante(e, undefined, undefined), null);
  });
});

describe("clasificarNotaEntrante: 'continúa faltando' sin REF. (por lo que dice el PDF)", () => {
  const PERSONA = { apellidos: "TORRES VEGA", nombres: "Luis Alberto" };
  const continua = (extra = {}) => ({ ...PERSONA, numero_nota_falta: "202601607830", fecha_falta: "2026-09-18", referencia: null, esContinua: true, ...extra });

  test("sin REF., se asocia al expediente ABIERTO de esa persona en la base", () => {
    const abierta = { ...LUIS_ABIERTO, fecha_falta: "2026-09-17" };
    const c = continua();
    const r = clasificarNotaEntrante(c, [abierta, MARCO_ABIERTO], [c]);
    assert.equal(r.motivo, "continuacion");
    assert.equal(r.nota.id, "n1");
  });

  test("sin REF., se asocia a la falta del mismo lote aunque aún no esté guardada", () => {
    const madre = { ...PERSONA, numero_nota_falta: "202601600621", fecha_falta: "2026-09-17", referencia: null, esContinua: false };
    const c = continua();
    const r = clasificarNotaEntrante(c, [], [c, madre]);
    assert.equal(r.motivo, "continuacion");
    assert.equal(r.fila, madre);
  });

  test("elige la falta más reciente que no sea posterior al 'continúa'", () => {
    const vieja = { ...PERSONA, numero_nota_falta: "1", fecha_falta: "2026-09-01", referencia: null };
    const buena = { ...PERSONA, numero_nota_falta: "2", fecha_falta: "2026-09-17", referencia: null };
    const posterior = { ...PERSONA, numero_nota_falta: "3", fecha_falta: "2026-09-25", referencia: null };
    const c = continua();
    const r = clasificarNotaEntrante(c, [], [vieja, buena, posterior, c]);
    assert.equal(r.fila, buena);
  });

  test("un expediente ya cerrado (reincorporado) no se toma como madre por adivinanza", () => {
    const cerrada = { ...LUIS_ABIERTO, fecha_falta: "2026-09-10", fecha_reincorporacion: "2026-09-11" };
    const c = continua();
    assert.equal(clasificarNotaEntrante(c, [cerrada], [c]).motivo, "continua_sin_madre");
  });

  test("dice que continúa pero no hay ningún expediente de esa persona: se avisa, no se crea nada", () => {
    const c = continua({ apellidos: "CASTRO ORTIZ", nombres: "Ana" });
    assert.equal(clasificarNotaEntrante(c, [LUIS_ABIERTO], [c]).motivo, "continua_sin_madre");
  });

  test("un 'continúa' del lote nunca es madre de otro 'continúa'", () => {
    const c1 = continua({ numero_nota_falta: "10", fecha_falta: "2026-09-18" });
    const c2 = continua({ numero_nota_falta: "11", fecha_falta: "2026-09-19" });
    assert.equal(clasificarNotaEntrante(c2, [], [c1, c2]).motivo, "continua_sin_madre");
  });

  test("si el REF. resuelve, gana sobre la búsqueda por persona", () => {
    const otraAbierta = { ...LUIS_ABIERTO, id: "otra", numero_nota_falta: "999", fecha_falta: "2026-09-18" };
    const referida = { ...LUIS_ABIERTO, id: "referida", numero_nota_falta: "202601600621", fecha_falta: "2026-09-17" };
    const c = continua({ referencia: "202601600621" });
    const r = clasificarNotaEntrante(c, [otraAbierta, referida], [c]);
    assert.equal(r.nota.id, "referida");
  });

  test("una persona con el mismo apellido pero otros nombres no cuenta", () => {
    const otraPersona = { ...LUIS_ABIERTO, nombres: "Pedro" };
    const c = continua();
    assert.equal(clasificarNotaEntrante(c, [otraPersona], [c]).motivo, "continua_sin_madre");
  });

  test("sin N.º ni REF., pero con 'continúa', igual se evalúa", () => {
    const c = continua({ numero_nota_falta: "" });
    assert.equal(clasificarNotaEntrante(c, [{ ...LUIS_ABIERTO, fecha_falta: "2026-09-17" }], [c]).motivo, "continuacion");
  });

  test("una falta que NO dice 'continúa' sigue siendo nueva aunque haya un expediente abierto", () => {
    const nueva = { ...PERSONA, numero_nota_falta: "202601700001", fecha_falta: "2026-09-19", referencia: null, esContinua: false };
    assert.equal(clasificarNotaEntrante(nueva, [{ ...LUIS_ABIERTO, fecha_falta: "2026-09-17" }], [nueva]), null);
  });
});
