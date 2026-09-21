// Pruebas de la ficha por persona -- ver lib/personas.js. Nombres ficticios.
//
// Corre con: node --test lib/

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { agruparPersonas, buscarPersonas, horasDelCaso, formatearDuracion, resumenPersona } from "./personas.js";

const n = (o) => ({ grado: "S3", apellidos: "LOPEZ GARAY", nombres: "Juan Carlos", fecha_falta: "2026-09-01", hora_falta: "07:00:00", fecha_reincorporacion: null, hora_reincorporacion: null, codigo_infraccion: "", ...o });

const NOTAS = [
  n({ fecha_falta: "2026-08-10", fecha_reincorporacion: "2026-08-10", hora_reincorporacion: "18:00:00", codigo_infraccion: "L21" }),
  n({ fecha_falta: "2026-09-01", fecha_reincorporacion: "2026-09-03", hora_reincorporacion: "07:00:00", codigo_infraccion: "G39", orden_sancion_generada_at: "2026-09-10T00:00:00Z" }),
  n({ nombres: "Juan", fecha_falta: "2026-09-15", codigo_infraccion: "" }), // mismo Juan, sin reincorporar
  n({ apellidos: "LOPEZ CASTRO", nombres: "Ana", grado: "S2", fecha_falta: "2026-09-05" }),
  n({ apellidos: "LOZANO RIOS", nombres: "Pedro", fecha_falta: "2026-09-06" }),
  n({ apellidos: "PAREDES LUNA", nombres: "Carla", fecha_falta: "2026-09-07" }),
];

describe("agruparPersonas", () => {
  const grupos = agruparPersonas(NOTAS);
  test("junta los expedientes de la misma persona aunque el nombre varíe", () => {
    assert.equal(grupos.length, 4);
    const juan = grupos.find((g) => g.apellidos === "LOPEZ GARAY");
    assert.equal(juan.notas.length, 3);
  });
  test("ordena los casos del más nuevo al más antiguo y usa el nombre del más reciente", () => {
    const juan = grupos.find((g) => g.apellidos === "LOPEZ GARAY");
    assert.deepEqual(juan.notas.map((x) => x.fecha_falta), ["2026-09-15", "2026-09-01", "2026-08-10"]);
    assert.equal(juan.nombres, "Juan");
  });
  test("mismos apellidos y otro nombre son personas distintas", () => {
    const g = agruparPersonas([n({ nombres: "Juan" }), n({ nombres: "Pedro" })]);
    assert.equal(g.length, 2);
  });
  test("tolera lista ausente", () => {
    assert.deepEqual(agruparPersonas(undefined), []);
  });
});

describe("buscarPersonas", () => {
  const personas = agruparPersonas(NOTAS);
  const apellidos = (lista) => lista.map((p) => p.apellidos);

  test("'lo' lista a todos los que empiezan así, primero el que más faltas tiene", () => {
    assert.deepEqual(apellidos(buscarPersonas(personas, "lo")), ["LOPEZ GARAY", "LOPEZ CASTRO", "LOZANO RIOS"]);
  });
  test("'loz' deja solo a Lozano", () => {
    assert.deepEqual(apellidos(buscarPersonas(personas, "loz")), ["LOZANO RIOS"]);
  });
  test("varias palabras: 'lopez gar' -> López Garay", () => {
    assert.deepEqual(apellidos(buscarPersonas(personas, "lopez gar")), ["LOPEZ GARAY"]);
  });
  test("también busca por nombre y sin importar tildes ni mayúsculas", () => {
    assert.deepEqual(apellidos(buscarPersonas(personas, "CARLA")), ["PAREDES LUNA"]);
    assert.deepEqual(apellidos(buscarPersonas(personas, "lópez")), ["LOPEZ GARAY", "LOPEZ CASTRO"]);
  });
  test("con menos de 2 letras no propone nada", () => {
    assert.deepEqual(buscarPersonas(personas, "l"), []);
    assert.deepEqual(buscarPersonas(personas, ""), []);
    assert.deepEqual(buscarPersonas(personas, "   "), []);
  });
  test("sin coincidencias devuelve lista vacía", () => {
    assert.deepEqual(buscarPersonas(personas, "zzz"), []);
  });
  test("respeta el límite", () => {
    assert.equal(buscarPersonas(personas, "lo", 2).length, 2);
  });
  test("el apellido gana sobre una coincidencia en el nombre", () => {
    const lista = agruparPersonas([n({ apellidos: "SOTO RUIZ", nombres: "Lopez" }), n({ apellidos: "LOPEZ VEGA", nombres: "Ana" })]);
    assert.deepEqual(apellidos(buscarPersonas(lista, "lopez")), ["LOPEZ VEGA", "SOTO RUIZ"]);
  });
});

describe("horasDelCaso y formatearDuracion", () => {
  const AHORA = new Date("2026-09-17T07:00:00");
  test("reincorporado con hora: diferencia exacta", () => {
    const h = horasDelCaso(n({ fecha_falta: "2026-09-01", fecha_reincorporacion: "2026-09-02", hora_reincorporacion: "10:30:00" }), AHORA);
    assert.equal(h.horas, 27.5);
    assert.equal(h.enCurso, false);
  });
  test("reincorporado sin horas: por días completos y marcado como aproximado", () => {
    const h = horasDelCaso(n({ hora_falta: null, fecha_falta: "2026-09-01", fecha_reincorporacion: "2026-09-04" }), AHORA);
    assert.equal(h.horas, 72);
    assert.equal(h.aproximado, true);
  });
  test("sin reincorporar: cuenta hasta ahora y queda en curso", () => {
    const h = horasDelCaso(n({ fecha_falta: "2026-09-15", hora_falta: "07:00:00" }), AHORA);
    assert.equal(h.horas, 48);
    assert.equal(h.enCurso, true);
  });
  test("datos rotos no dan NaN", () => {
    assert.equal(horasDelCaso({}, AHORA).horas, 0);
    assert.equal(horasDelCaso(n({ fecha_falta: "2026-09-20" }), AHORA).horas, 0); // falta "en el futuro"
  });
  test("formatea días y horas", () => {
    assert.equal(formatearDuracion(27.5), "1d 3h");
    assert.equal(formatearDuracion(5), "5h");
    assert.equal(formatearDuracion(0.75), "45m");
    assert.equal(formatearDuracion(72), "3d 0h");
    assert.equal(formatearDuracion(0), "0h");
    assert.equal(formatearDuracion(NaN), "0h");
  });
});

describe("resumenPersona", () => {
  const AHORA = new Date("2026-09-17T07:00:00");
  const juan = agruparPersonas(NOTAS).find((g) => g.apellidos === "LOPEZ GARAY").notas;
  const r = resumenPersona(juan, AHORA);

  test("cuenta faltas, casos en trámite y sanciones", () => {
    assert.equal(r.faltas, 3);
    assert.equal(r.sinReincorporar, 1);
    assert.equal(r.enCurso, 1);
    assert.equal(r.conSancion, 1);
  });
  test("acumula el tiempo ausente (incluido el caso en curso)", () => {
    // 11h (10/08 07:00-18:00) + 48h (01/09 07:00 -> 03/09 07:00) + 48h en curso (15/09 07:00 -> 17/09 07:00)
    assert.equal(r.horasTotales, 107);
    assert.equal(r.duracion, "4d 11h");
  });
  test("desglosa por código de infracción", () => {
    assert.deepEqual(r.porCodigo, { L21: 1, G39: 1, "(sin código)": 1 });
  });
  test("primera y última falta", () => {
    assert.equal(r.primeraFalta, "2026-08-10");
    assert.equal(r.ultimaFalta, "2026-09-15");
  });
  test("lista vacía no rompe", () => {
    const vacio = resumenPersona(undefined, AHORA);
    assert.equal(vacio.faltas, 0);
    assert.equal(vacio.duracion, "0h");
    assert.equal(vacio.ultimaFalta, null);
  });
});
