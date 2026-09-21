// Pruebas del descuento por día faltado -- ver lib/descuento.js. Datos ficticios.
//
// Corre con: node --test lib/

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { REMUNERACION, INICIO_INFORME, DIAS_MINIMOS, claveGrado, montoMensual, cumpleMinimo, descuentoDeNotas, formatearSoles, textoDescuento, textoDias } from "./descuento.js";

const AHORA = new Date("2026-09-17T07:00:00");
const p = (x) => String(x).padStart(2, "0");
// Falta que dura `horas` (con decimales: 23.5 = 23:30) desde las 00:00 del día
// `desde` (YYYY-MM-DD).
const caso = (grado, horas, desde = "2026-09-01") => {
  const ini = new Date(`${desde}T00:00:00`);
  const fin = new Date(ini.getTime() + Math.round(horas * 60) * 60000);
  return {
    grado, fecha_falta: desde, hora_falta: "00:00:00",
    fecha_reincorporacion: `${fin.getFullYear()}-${p(fin.getMonth() + 1)}-${p(fin.getDate())}`,
    hora_reincorporacion: `${p(fin.getHours())}:${p(fin.getMinutes())}:00`,
  };
};
const dia = (grado) => descuentoDeNotas([caso(grado, 24)], AHORA).monto;

describe("montos por grado", () => {
  test("el descuento usa SOLO la remuneración, sin los S/ 1 200 de riesgo de vida", () => {
    assert.equal(REMUNERACION.S1, 3023.96);
    assert.equal(REMUNERACION.S2, 2967.87);
    assert.equal(REMUNERACION.S3, 2924.82);
  });
  test("reconoce el grado aunque venga con PNP, minúsculas o espacios", () => {
    assert.equal(claveGrado("S2 PNP"), "S2");
    assert.equal(claveGrado(" s3 "), "S3");
    assert.equal(montoMensual("s1"), 3023.96);
  });
  test("un grado sin monto da null (no se inventa)", () => {
    assert.equal(montoMensual("ST2"), null);
    assert.equal(montoMensual(""), null);
    assert.equal(montoMensual(undefined), null);
  });
});

describe("descuento por día faltado", () => {
  test("un día completo (24:00 h) = un treintavo de la remuneración", () => {
    assert.equal(dia("S2"), 98.93);
    assert.equal(dia("S1"), 100.8);
    assert.equal(dia("S3"), 97.49);
  });
  test("menos de 24:00 h no completa ningún día: 0 soles y las horas quedan pendientes", () => {
    const r = descuentoDeNotas([caso("S2", 23.5)], AHORA);
    assert.equal(r.dias, 0);
    assert.equal(r.monto, 0);
    assert.equal(r.minutosSobrantes, 23 * 60 + 30);
  });
  test("las horas de varias faltas se acumulan: 23:30 + 23:30 = 47:00 h = 1 día, sobran 23:00", () => {
    const r = descuentoDeNotas([caso("S2", 23.5), caso("S2", 23.5, "2026-09-10")], AHORA);
    assert.equal(r.dias, 1);
    assert.equal(r.monto, 98.93);
    assert.equal(r.minutosSobrantes, 23 * 60);
  });
  test("tres faltas de 23:30 = 70:30 h = 2 días, sobran 22:30", () => {
    const r = descuentoDeNotas([caso("S2", 23.5), caso("S2", 23.5, "2026-09-05"), caso("S2", 23.5, "2026-09-10")], AHORA);
    assert.equal(r.dias, 2);
    assert.equal(r.monto, 197.86);
    assert.equal(r.minutosSobrantes, 22 * 60 + 30);
  });
  test("una falta de 30 h = 1 día y sobran 6 h; 48 h = 2 días exactos", () => {
    const a = descuentoDeNotas([caso("S2", 30)], AHORA);
    assert.deepEqual([a.dias, a.monto, a.minutosSobrantes], [1, 98.93, 360]);
    const b = descuentoDeNotas([caso("S2", 48)], AHORA);
    assert.deepEqual([b.dias, b.monto, b.minutosSobrantes], [2, 197.86, 0]);
  });
  test("23:30 + 0:30 completan justo un día, sin perder minutos por decimales", () => {
    const r = descuentoDeNotas([caso("S2", 23.5), caso("S2", 0.5, "2026-09-10")], AHORA);
    assert.equal(r.dias, 1);
    assert.equal(r.minutosSobrantes, 0);
    // 72 faltas de 20 min = 24:00 h exactas; con decimales de coma flotante daría 23.999…
    const tercios = Array.from({ length: 72 }, (_, i) => caso("S2", 20 / 60, `2026-09-${p(1 + (i % 28))}`));
    assert.equal(descuentoDeNotas(tercios, AHORA).dias, 1);
  });
  test("sin reincorporar cuenta hasta ahora", () => {
    const enCurso = { grado: "S2", fecha_falta: "2026-09-15", hora_falta: "07:00:00" }; // 48 h hasta AHORA
    const r = descuentoDeNotas([enCurso], AHORA);
    assert.equal(r.dias, 2);
    assert.equal(r.monto, 197.86);
  });
  test("cada día se paga con el grado que tenía la persona al completarlo (ascenso)", () => {
    // S3 falta 23:00 h y luego, ya S2, falta 5:00 h: el día se completa en la falta S2
    const r = descuentoDeNotas([caso("S3", 23, "2026-09-01"), caso("S2", 5, "2026-09-10")], AHORA);
    assert.equal(r.dias, 1);
    assert.equal(r.monto, 98.93);
  });
  test("el orden de los expedientes no importa (se ordenan por fecha de falta)", () => {
    const r = descuentoDeNotas([caso("S2", 5, "2026-09-10"), caso("S3", 23, "2026-09-01")], AHORA);
    assert.equal(r.monto, 98.93);
  });
  test("lista vacía o ausente no rompe", () => {
    const vacio = { monto: 0, dias: 0, minutosSobrantes: 0, diasSinMonto: 0, gradosSinMonto: [] };
    assert.deepEqual(descuentoDeNotas([], AHORA), vacio);
    assert.deepEqual(descuentoDeNotas(undefined, AHORA), vacio);
  });
});

describe("quién muestra descuento", () => {
  test("el informe rige desde setiembre 2026 y el mínimo es un día completo", () => {
    assert.equal(INICIO_INFORME, "2026-09-01");
    assert.equal(DIAS_MINIMOS, 1);
  });
  test("solo cumple quien completó al menos un día (24:00 h acumuladas)", () => {
    assert.equal(cumpleMinimo(descuentoDeNotas([caso("S2", 23.5)], AHORA)), false);
    assert.equal(cumpleMinimo(descuentoDeNotas([caso("S2", 23.99)], AHORA)), false);
    assert.equal(cumpleMinimo(descuentoDeNotas([caso("S2", 24)], AHORA)), true);
    // 23:30 + 23:30 acumulan 47:00 h: ya completa un día
    assert.equal(cumpleMinimo(descuentoDeNotas([caso("S2", 23.5), caso("S2", 23.5, "2026-09-10")], AHORA)), true);
  });
  test("datos ausentes no cumplen", () => {
    assert.equal(cumpleMinimo(undefined), false);
    assert.equal(cumpleMinimo(descuentoDeNotas([], AHORA)), false);
  });
});

describe("grado sin monto cargado", () => {
  test("un día completado con grado sin monto no se suma: queda INDETERMINADO", () => {
    const r = descuentoDeNotas([caso("ST2", 24)], AHORA);
    assert.equal(r.dias, 1);
    assert.equal(r.diasSinMonto, 1);
    assert.equal(r.monto, 0);
    assert.deepEqual(r.gradosSinMonto, ["ST2"]);
  });
  test("si no completa ningún día no hay nada indeterminado", () => {
    const r = descuentoDeNotas([caso("ST2", 8), caso("", 5, "2026-09-10")], AHORA);
    assert.equal(r.dias, 0);
    assert.equal(r.diasSinMonto, 0);
    assert.deepEqual(r.gradosSinMonto, []);
  });
  test("mezcla: los días con monto se suman y los otros se avisan", () => {
    const r = descuentoDeNotas([caso("S2", 24), caso("ST2", 24, "2026-09-05")], AHORA);
    assert.equal(r.dias, 2);
    assert.equal(r.monto, 98.93);
    assert.equal(r.diasSinMonto, 1);
    assert.deepEqual(r.gradosSinMonto, ["ST2"]);
  });
});

describe("textoDescuento y textoDias", () => {
  test("con todos los montos: solo el importe", () => {
    assert.equal(textoDescuento({ monto: 98.93, dias: 1, diasSinMonto: 0 }), "S/ 98.93");
    assert.equal(textoDescuento({ monto: 0, dias: 0, diasSinMonto: 0 }), "S/ 0.00");
  });
  test("ningún día con monto de grado: INDETERMINADO", () => {
    assert.equal(textoDescuento({ monto: 0, dias: 2, diasSinMonto: 2 }), "INDETERMINADO");
  });
  test("solo algunos días sin monto: lo calculado + INDETERMINADO", () => {
    assert.equal(textoDescuento({ monto: 98.93, dias: 2, diasSinMonto: 1 }), "S/ 98.93 + INDETERMINADO");
  });
  test("días en singular y plural", () => {
    assert.equal(textoDias(0), "0 días");
    assert.equal(textoDias(1), "1 día");
    assert.equal(textoDias(2), "2 días");
  });
});

describe("formatearSoles", () => {
  test("2 decimales y miles con coma", () => {
    assert.equal(formatearSoles(4382.05), "S/ 4,382.05");
    assert.equal(formatearSoles(0), "S/ 0.00");
    assert.equal(formatearSoles(138.9), "S/ 138.90");
    assert.equal(formatearSoles(1234567.5), "S/ 1,234,567.50");
  });
  test("valor inválido se muestra como cero", () => {
    assert.equal(formatearSoles(NaN), "S/ 0.00");
    assert.equal(formatearSoles(undefined), "S/ 0.00");
  });
});
