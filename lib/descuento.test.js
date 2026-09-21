// Pruebas del descuento por inasistencia -- ver lib/descuento.js. Datos ficticios.
//
// Corre con: node --test lib/

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { TOTAL_PERCIBIDO, claveGrado, montoMensual, descuentoDelCaso, descuentoDeNotas, formatearSoles, textoDescuento } from "./descuento.js";

const AHORA = new Date("2026-09-17T07:00:00");
// Falta de `h` horas exactas el mismo día (o siguientes) con hora de reincorporación.
const caso = (grado, horas, extra = {}) => {
  const fin = new Date(new Date("2026-09-01T00:00:00").getTime() + horas * 3600000);
  const p = (x) => String(x).padStart(2, "0");
  return {
    grado, fecha_falta: "2026-09-01", hora_falta: "00:00:00",
    fecha_reincorporacion: `${fin.getFullYear()}-${p(fin.getMonth() + 1)}-${p(fin.getDate())}`,
    hora_reincorporacion: `${p(fin.getHours())}:${p(fin.getMinutes())}:00`,
    ...extra,
  };
};

describe("montos por grado", () => {
  test("total percibido = remuneración + S/ 1 200 de riesgo de vida", () => {
    assert.equal(TOTAL_PERCIBIDO.S1, 3023.96 + 1200);
    assert.equal(TOTAL_PERCIBIDO.S2, 2967.87 + 1200);
    assert.equal(TOTAL_PERCIBIDO.S3, 2924.82 + 1200);
  });
  test("reconoce el grado aunque venga con PNP, minúsculas o espacios", () => {
    assert.equal(claveGrado("S2 PNP"), "S2");
    assert.equal(claveGrado(" s3 "), "S3");
    assert.equal(montoMensual("s1"), 4223.96);
  });
  test("un grado sin monto da null (no se inventa)", () => {
    assert.equal(montoMensual("ST2"), null);
    assert.equal(montoMensual(""), null);
    assert.equal(montoMensual(undefined), null);
  });
});

describe("descuentoDelCaso", () => {
  test("un día completo (24 h) = un treintavo del total percibido", () => {
    assert.equal(descuentoDelCaso(caso("S2", 24), AHORA), 138.93);
    assert.equal(descuentoDelCaso(caso("S1", 24), AHORA), 140.8);
    assert.equal(descuentoDelCaso(caso("S3", 24), AHORA), 137.49);
  });
  test("es proporcional a las horas", () => {
    assert.equal(descuentoDelCaso(caso("S2", 30), AHORA), 173.66); // 1 día y 6 h
    assert.equal(descuentoDelCaso(caso("S2", 14), AHORA), 81.04);
    assert.equal(descuentoDelCaso(caso("S2", 0), AHORA), 0);
  });
  test("sin reincorporar cuenta hasta ahora", () => {
    const enCurso = { grado: "S2", fecha_falta: "2026-09-15", hora_falta: "07:00:00" }; // 48 h hasta AHORA
    assert.equal(descuentoDelCaso(enCurso, AHORA), 277.86);
  });
  test("grado sin monto -> null", () => {
    assert.equal(descuentoDelCaso(caso("ST2", 24), AHORA), null);
  });
});

describe("descuentoDeNotas", () => {
  test("suma los casos y usa el grado de CADA falta (por si lo ascendieron)", () => {
    const r = descuentoDeNotas([caso("S3", 24), caso("S2", 24)], AHORA);
    assert.equal(r.monto, 137.49 + 138.93);
    assert.equal(r.sinMonto, 0);
  });
  test("los casos sin monto no se suman y se avisan", () => {
    const r = descuentoDeNotas([caso("S2", 24), caso("ST2", 48), caso("", 5)], AHORA);
    assert.equal(r.monto, 138.93);
    assert.equal(r.sinMonto, 2);
    assert.deepEqual(r.gradosSinMonto.sort(), ["(sin grado)", "ST2"]);
  });
  test("lista vacía o ausente no rompe", () => {
    assert.deepEqual(descuentoDeNotas([], AHORA), { monto: 0, sinMonto: 0, gradosSinMonto: [] });
    assert.deepEqual(descuentoDeNotas(undefined, AHORA), { monto: 0, sinMonto: 0, gradosSinMonto: [] });
  });
});

describe("textoDescuento", () => {
  test("con todos los montos: solo el importe", () => {
    assert.equal(textoDescuento({ monto: 138.93, sinMonto: 0 }, 1), "S/ 138.93");
  });
  test("ningún caso con monto de grado: INDETERMINADO", () => {
    assert.equal(textoDescuento({ monto: 0, sinMonto: 2 }, 2), "INDETERMINADO");
  });
  test("solo algunos sin monto: lo calculado + INDETERMINADO", () => {
    assert.equal(textoDescuento({ monto: 45.83, sinMonto: 1 }, 2), "S/ 45.83 + INDETERMINADO");
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
