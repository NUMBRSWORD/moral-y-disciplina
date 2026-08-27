// Corre con: node --test lib/
// Sin dependencias -- node:test y node:assert vienen incluidos en Node.js,
// no hace falta instalar nada.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  conPnp, limpiarNombreVisible, nombreCompletoVisible, nombreParaSello,
  normalizarMencionInvestigado, tokens, buscarOficialConstato,
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
  test("muestra primero nombres y luego apellidos (con coma)", () => {
    assert.equal(limpiarNombreVisible("VARGAS SOTO,MARIO ENRIQUE"), "Mario Enrique VARGAS SOTO");
  });
  test("muestra primero nombres y luego apellidos (sin coma)", () => {
    assert.equal(limpiarNombreVisible("RIOS PAREDES DIEGO"), "Diego RIOS PAREDES");
  });
  test("sin nombres identificables, se deja todo en mayúsculas", () => {
    assert.equal(limpiarNombreVisible("RIOS PAREDES"), "RIOS PAREDES");
  });
});

describe("nombreParaSello", () => {
  test("nombres en formato título y apellidos en mayúsculas", () => {
    assert.equal(nombreParaSello("REYES MEDINA", "MANUEL ANGELO"), "Manuel Angelo REYES MEDINA");
  });
});

describe("nombreCompletoVisible", () => {
  test("usa nombres en formato título y apellidos en mayúsculas", () => {
    assert.equal(nombreCompletoVisible("MENDOZA RAMOS", "CARLOS"), "Carlos MENDOZA RAMOS");
  });
});

describe("normalizarMencionInvestigado", () => {
  test("corrige las dos formas anteriores dentro de un texto libre", () => {
    const fuente = "El ST1 PNP MENDOZA RAMOS Carlos fue notificado. Carlos Mendoza Ramos presentó su descargo.";
    assert.equal(
      normalizarMencionInvestigado(fuente, "MENDOZA RAMOS", "CARLOS"),
      "El ST1 PNP Carlos MENDOZA RAMOS fue notificado. Carlos MENDOZA RAMOS presentó su descargo.",
    );
  });
});

describe("tokens", () => {
  test("quita tildes, puntuación y mayúsculas todo", () => {
    assert.deepEqual(tokens("TNTE. Rios Paredes Diego"), ["TNTE", "RIOS", "PAREDES", "DIEGO"]);
  });
  test("no une apellidos separados solo por coma sin espacio", () => {
    assert.deepEqual(tokens("VARGAS SOTO,MARIO ENRIQUE"), ["VARGAS", "SOTO", "MARIO", "ENRIQUE"]);
  });
});

describe("buscarOficialConstato", () => {
  const efectivos = [
    { cip: "400001", apellidos_nombres: "RIOS PAREDES DIEGO", grado: "TENIENTE PNP" },
    { cip: "400002", apellidos_nombres: "PAREDES LUNA, HUGO", grado: "CAPITAN PNP" },
  ];

  test("empareja ignorando el grado y sin importar el orden de palabras", () => {
    assert.equal(buscarOficialConstato("TNTE. RIOS PAREDES Diego", efectivos)?.cip, "400001");
    assert.equal(buscarOficialConstato("CAP. PAREDES LUNA Hugo", efectivos)?.cip, "400002");
  });
  test("no empareja con una sola palabra en común", () => {
    assert.equal(buscarOficialConstato("TNTE. RIOS Desconocido", efectivos)?.cip, undefined);
  });
  test("devuelve null si no hay texto o no hay efectivos", () => {
    assert.equal(buscarOficialConstato("", efectivos), null);
    assert.equal(buscarOficialConstato("RIOS PAREDES", []), null);
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
