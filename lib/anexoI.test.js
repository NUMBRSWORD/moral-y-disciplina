// Corre con: node --test lib/
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { getInfraccion, normalizarCodigoInfraccion, ANEXO_I } from "./anexoI.js";

describe("normalizarCodigoInfraccion", () => {
  test("acepta variantes de formato", () => {
    assert.equal(normalizarCodigoInfraccion("L21"), "L21");
    assert.equal(normalizarCodigoInfraccion("l21"), "L21");
    assert.equal(normalizarCodigoInfraccion("L-21"), "L21");
    assert.equal(normalizarCodigoInfraccion("l 21"), "L21");
  });
  test("null para vacío o sin match", () => {
    assert.equal(normalizarCodigoInfraccion(""), null);
    assert.equal(normalizarCodigoInfraccion(null), null);
    assert.equal(normalizarCodigoInfraccion("G39"), null); // G39 no es del Anexo I (Leves), no matchea el patrón "L"
  });
});

describe("getInfraccion", () => {
  test("devuelve los 3 campos esperados para un código válido", () => {
    const inf = getInfraccion("L21");
    assert.ok(inf);
    assert.equal(typeof inf.bienJuridico, "string");
    assert.equal(typeof inf.infraccion, "string");
    assert.equal(typeof inf.sancion, "string");
  });
  test("null para un código que no existe", () => {
    assert.equal(getInfraccion("L999"), null);
  });
  test("el catálogo completo tiene datos coherentes en las 117 infracciones", () => {
    const codigos = Object.keys(ANEXO_I);
    assert.equal(codigos.length, 117);
    for (const c of codigos) {
      const inf = ANEXO_I[c];
      assert.ok(inf.bienJuridico?.length > 0, `${c} sin bienJuridico`);
      assert.ok(inf.infraccion?.length > 0, `${c} sin infraccion`);
      assert.ok(inf.sancion?.length > 0, `${c} sin sancion`);
    }
  });
});
