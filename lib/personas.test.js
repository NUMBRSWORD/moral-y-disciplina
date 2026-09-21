// Pruebas de la ficha por persona -- ver lib/personas.js. Nombres ficticios.
//
// Corre con: node --test lib/

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { agruparPersonas, buscarPersonas, horasDelCaso, formatearDuracion, resumenPersona, resumenDelMes } from "./personas.js";

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
    assert.equal(formatearDuracion(27.5), "1d 3h 30m");
    assert.equal(formatearDuracion(5), "5h");
    assert.equal(formatearDuracion(0.75), "45m");
    assert.equal(formatearDuracion(72), "3d 0h");
    assert.equal(formatearDuracion(0), "0h");
    // los minutos no se pierden: 23:30 no es "23h"
    assert.equal(formatearDuracion(23.5), "23h 30m");
    assert.equal(formatearDuracion(24), "1d 0h");
    assert.equal(formatearDuracion(47.25), "1d 23h 15m");
    assert.equal(formatearDuracion(NaN), "0h");
  });
});

describe("resumenDelMes", () => {
  const AHORA = new Date("2026-09-17T07:00:00");
  const sep = resumenDelMes(NOTAS, "2026-09", AHORA);

  test("solo cuenta las faltas de ese mes", () => {
    assert.equal(sep.total, 5);
    assert.equal(sep.efectivos.length, 4);
    const ago = resumenDelMes(NOTAS, "2026-08", AHORA);
    assert.equal(ago.total, 1);
    assert.equal(ago.efectivos[0].apellidos, "LOPEZ GARAY");
  });
  test("ordena de quien más faltó a quien menos; a igualdad, más tiempo ausente primero", () => {
    assert.deepEqual(sep.efectivos.map((e) => e.apellidos), ["LOPEZ GARAY", "LOPEZ CASTRO", "LOZANO RIOS", "PAREDES LUNA"]);
    assert.deepEqual(sep.efectivos.map((e) => e.faltas), [2, 1, 1, 1]);
  });
  test("el tiempo ausente es solo el del mes (no arrastra otros meses)", () => {
    const juan = sep.efectivos[0];
    assert.equal(juan.horasTotales, 96); // 48h (01/09→03/09) + 48h en curso (15/09→17/09), sin las 11h de agosto
    assert.equal(juan.duracion, "4d 0h");
    assert.equal(juan.enCurso, 1);
  });
  test("lista las fechas de falta, sin repetir el día", () => {
    assert.deepEqual(sep.efectivos[0].fechas, ["2026-09-01", "2026-09-15"]);
    const dosEnUnDia = resumenDelMes([n({ fecha_falta: "2026-09-02" }), n({ fecha_falta: "2026-09-02", hora_falta: "15:00:00" })], "2026-09", AHORA);
    assert.equal(dosEnUnDia.efectivos[0].faltas, 2);
    assert.deepEqual(dosEnUnDia.efectivos[0].fechas, ["2026-09-02"]);
  });
  test("conserva los expedientes de cada efectivo para poder abrir su ficha", () => {
    assert.equal(sep.efectivos[0].notas.length, 2);
  });
  test("mes sin faltas o lista ausente no rompe", () => {
    assert.deepEqual(resumenDelMes(NOTAS, "2025-01", AHORA), { total: 0, efectivos: [] });
    assert.deepEqual(resumenDelMes(undefined, "2026-09", AHORA), { total: 0, efectivos: [] });
  });
});

describe("retrasos acumulados", () => {
  const AHORA = new Date("2026-09-21T12:00:00");
  const retraso = (dia) => n({ fecha_falta: `2026-09-${dia}`, hora_falta: "07:00:00", fecha_reincorporacion: `2026-09-${String(Number(dia) + 1).padStart(2, "0")}`, hora_reincorporacion: "06:30:00" });
  test("dos faltas de 23:30 h suman 47:00 h = 1d 23h, como una sola ausencia", () => {
    const r = resumenPersona([retraso("01"), retraso("10")], AHORA);
    assert.equal(r.horasTotales, 47);
    assert.equal(r.duracion, "1d 23h");
    assert.equal(formatearDuracion(horasDelCaso(retraso("01"), AHORA).horas), "23h 30m");
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
