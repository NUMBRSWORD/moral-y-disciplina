// Corre con: node --test lib/
// Sin dependencias -- node:test y node:assert vienen incluidos en Node.js,
// no hace falta instalar nada.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  conPnp, limpiarNombreVisible, tokens, buscarOficialConstato,
  fechaLarga, fechaCorta, fechaCompacta,
  horasAusente, sugerirCodigoInfraccion,
  esFinDeSemana, siguienteDiaHabil, plazoDescargoVencido, fechaLimiteDescargo,
} from "./utils.js";

describe("conPnp", () => {
  test("agrega PNP cuando falta", () => {
    assert.equal(conPnp("S2"), "S2 PNP");
  });
  test("no lo duplica si ya lo tiene", () => {
    assert.equal(conPnp("TENIENTE PNP"), "TENIENTE PNP");
  });
  test("quita el punto final antes de decidir", () => {
    assert.equal(conPnp("CAPITAN PNP."), "CAPITAN PNP");
  });
});

describe("limpiarNombreVisible", () => {
  test("apellidos en mayúsculas, nombres en formato título (con coma)", () => {
    assert.equal(limpiarNombreVisible("ROJAS GUINEA,ALDO CANZIANI"), "ROJAS GUINEA, Aldo Canziani");
  });
  test("apellidos en mayúsculas, nombres en formato título (sin coma)", () => {
    assert.equal(limpiarNombreVisible("ZEGOBIA QUISPE ANTONY"), "ZEGOBIA QUISPE Antony");
  });
  test("sin nombres identificables, se deja todo en mayúsculas", () => {
    assert.equal(limpiarNombreVisible("ZEGOBIA QUISPE"), "ZEGOBIA QUISPE");
  });
});

describe("tokens", () => {
  test("quita tildes, puntuación y mayúsculas todo", () => {
    assert.deepEqual(tokens("TNTE. Zegóbia Quíspe Antony"), ["TNTE", "ZEGOBIA", "QUISPE", "ANTONY"]);
  });
  test("no une apellidos separados solo por coma sin espacio", () => {
    assert.deepEqual(tokens("ROJAS GUINEA,ALDO CANZIANI"), ["ROJAS", "GUINEA", "ALDO", "CANZIANI"]);
  });
});

describe("buscarOficialConstato", () => {
  const efectivos = [
    { cip: "400474", apellidos_nombres: "ZEGOBIA QUISPE ANTONY", grado: "TENIENTE PNP" },
    { cip: "363060", apellidos_nombres: "RAMOS VALDEZ, IRVING", grado: "CAPITAN PNP" },
  ];

  test("empareja ignorando el grado y sin importar el orden de palabras", () => {
    assert.equal(buscarOficialConstato("TNTE. ZEGOBIA QUISPE Antony", efectivos)?.cip, "400474");
    assert.equal(buscarOficialConstato("CAP. RAMOS VALDEZ Irving", efectivos)?.cip, "363060");
  });
  test("no empareja con una sola palabra en común", () => {
    assert.equal(buscarOficialConstato("TNTE. ZEGOBIA Desconocido", efectivos)?.cip, undefined);
  });
  test("devuelve null si no hay texto o no hay efectivos", () => {
    assert.equal(buscarOficialConstato("", efectivos), null);
    assert.equal(buscarOficialConstato("ZEGOBIA QUISPE", []), null);
  });
});

describe("formato de fechas", () => {
  test("fechaLarga", () => {
    assert.equal(fechaLarga("2026-08-15"), "15 de agosto del 2026");
  });
  test("fechaCorta", () => {
    assert.equal(fechaCorta("2026-08-15"), "15/08/2026");
  });
  test("fechaCompacta", () => {
    assert.equal(fechaCompacta("2026-08-15"), "15AGO2026");
  });
});

describe("horasAusente", () => {
  test("calcula las horas entre falta y reincorporación", () => {
    assert.equal(horasAusente({
      fecha_falta: "2026-08-14", hora_falta: "08:00",
      fecha_reincorporacion: "2026-08-14", hora_reincorporacion: "20:00",
    }), 12);
  });
  test("null si falta algún dato", () => {
    assert.equal(horasAusente({ fecha_falta: "2026-08-14", hora_falta: "08:00" }), null);
  });
  test("null si la reincorporación queda antes que la falta", () => {
    assert.equal(horasAusente({
      fecha_falta: "2026-08-14", hora_falta: "20:00",
      fecha_reincorporacion: "2026-08-14", hora_reincorporacion: "08:00",
    }), null);
  });
});

describe("sugerirCodigoInfraccion", () => {
  test("null sin horas", () => {
    assert.equal(sugerirCodigoInfraccion(null), null);
  });
  test("límites L21/L24/G39/MG32", () => {
    assert.equal(sugerirCodigoInfraccion(23), "L21");
    assert.equal(sugerirCodigoInfraccion(24), "L24");
    assert.equal(sugerirCodigoInfraccion(47.99), "L24");
    assert.equal(sugerirCodigoInfraccion(48), "G39");
    assert.equal(sugerirCodigoInfraccion(71.99), "G39");
    assert.equal(sugerirCodigoInfraccion(72), "MG32");
  });
});

describe("días hábiles y plazo de descargo", () => {
  test("esFinDeSemana reconoce sábado y domingo", () => {
    assert.equal(esFinDeSemana("2026-08-15"), true); // sábado
    assert.equal(esFinDeSemana("2026-08-16"), true); // domingo
    assert.equal(esFinDeSemana("2026-08-14"), false); // viernes
  });
  test("siguienteDiaHabil salta el fin de semana", () => {
    // viernes 14 -> el "siguiente día hábil" no es sábado 15 ni domingo 16, es lunes 17
    assert.equal(siguienteDiaHabil("2026-08-14"), "2026-08-17");
    // jueves 13 -> el siguiente es viernes 14, sin saltar nada
    assert.equal(siguienteDiaHabil("2026-08-13"), "2026-08-14");
  });
  test("fechaLimiteDescargo usa el mismo cálculo", () => {
    assert.equal(fechaLimiteDescargo({ imputacion_generada_at: "2026-08-13T12:00:00.000Z" }), "2026-08-14");
    assert.equal(fechaLimiteDescargo({ imputacion_generada_at: null }), null);
  });
  test("plazoDescargoVencido: el mismo día límite todavía no está vencido", () => {
    assert.equal(plazoDescargoVencido({ imputacion_generada_at: "2026-08-13T12:00:00.000Z" }, "2026-08-14"), false);
  });
  test("plazoDescargoVencido: al día siguiente del límite ya venció", () => {
    assert.equal(plazoDescargoVencido({ imputacion_generada_at: "2026-08-13T12:00:00.000Z" }, "2026-08-15"), true);
  });
  test("sin notificación, nunca está vencido", () => {
    assert.equal(plazoDescargoVencido({ imputacion_generada_at: null }, "2026-08-15"), false);
  });
});
