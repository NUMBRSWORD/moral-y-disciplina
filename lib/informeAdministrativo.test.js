// Pruebas del Informe Administrativo (informe de ausencia continua que
// escala a infracción GRAVE, G39/MG32) — ver lib/informeAdministrativo.js.
// Caso base tomado del ejemplo real ya aprobado por el usuario
// (plantillas/plantilla_informe_administrativo_ejemplo.docx).

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  puedeGenerarInformeAdministrativo,
  construirDatosInformeAdministrativo,
  diasDeAusencia,
  formatearCodigoEspaciado,
} from "./informeAdministrativo.js";

const NOTA_G39 = {
  grado: "S3",
  apellidos: "TORRES VEGA",
  nombres: "Luis Alberto",
  codigo_infraccion: "G39",
  fecha_falta: "2026-08-30",
  hora_falta: "07:00",
  numero_nota_falta: "202601470823",
  fecha_reincorporacion: "2026-09-01",
  hora_reincorporacion: "07:30",
  numero_nota_reincorporacion: "202601484695",
  oficial_constato: "MAY. PNP VARGAS SOTO Mario Enrique",
  investigado_cip: "111222",
};

const NOTA_MG32 = {
  ...NOTA_G39,
  codigo_infraccion: "MG32",
  fecha_falta: "2026-08-02",
  fecha_reincorporacion: "2026-08-09",
  numero_nota_falta: "202601269367",
  numero_nota_reincorporacion: "202601312843",
};

const FIRMANTES = {
  conforme: { grado: "MAY. PNP", nombre: "VARGAS SOTO, Mario Enrique", cargo: "Comisario (e) CPNP Ventanilla" },
  instructor: { grado: "S2 PNP", nombre: "HIDALGO FERRARI, Hans Brandon" },
};

describe("formatearCodigoEspaciado", () => {
  test("separa la letra del número", () => {
    assert.equal(formatearCodigoEspaciado("G39"), "G 39");
    assert.equal(formatearCodigoEspaciado("MG32"), "MG 32");
  });
});

describe("diasDeAusencia", () => {
  test("2 días consecutivos (G39) da 3 fechas: falta, intermedio, reincorporación", () => {
    const dias = diasDeAusencia("2026-08-30", "2026-09-01");
    assert.deepEqual(dias, ["2026-08-30", "2026-08-31", "2026-09-01"]);
  });
  test("mismo día (nunca debería pasar aquí, pero no debe colgarse)", () => {
    assert.deepEqual(diasDeAusencia("2026-08-30", "2026-08-30"), ["2026-08-30"]);
  });
});

describe("puedeGenerarInformeAdministrativo", () => {
  test("true con G39 completo y reincorporado", () => {
    assert.equal(puedeGenerarInformeAdministrativo(NOTA_G39, []), true);
  });
  test("false si todavía no se reincorpora", () => {
    assert.equal(puedeGenerarInformeAdministrativo({ ...NOTA_G39, fecha_reincorporacion: null }, []), false);
  });
  test("false para un código leve (L21) -- ese va por la Orden de Sanción, no por aquí", () => {
    assert.equal(puedeGenerarInformeAdministrativo({ ...NOTA_G39, codigo_infraccion: "L21" }, []), false);
  });
  test("true con MG32 completo y reincorporado (texto legal ya verificado)", () => {
    assert.equal(puedeGenerarInformeAdministrativo(NOTA_MG32, []), true);
  });
  test("false para un código sin texto legal verificado (no inventa la cita)", () => {
    assert.equal(puedeGenerarInformeAdministrativo({ ...NOTA_G39, codigo_infraccion: "MG99" }, []), false);
  });
});

describe("construirDatosInformeAdministrativo", () => {
  test("arma el ASUNTO con el código, el investigado y las fechas correctas", () => {
    const d = construirDatosInformeAdministrativo(NOTA_G39, [], [], FIRMANTES);
    assert.match(d.asunto_texto, /infracción GRAVE G 39/);
    assert.match(d.asunto_texto, /S3 PNP Luis Alberto TORRES VEGA/);
    assert.match(d.asunto_texto, /se reincorporó a las 07:30 horas del 01SET2026/);
  });

  test("la descripción de los días tiene un bloque A/B/C por cada día, con la letra correcta", () => {
    const d = construirDatosInformeAdministrativo(NOTA_G39, [], [], FIRMANTES);
    const bloques = d.descripcion_dias.split("\n\n");
    assert.equal(bloques.length, 3);
    assert.match(bloques[0], /^A\. Día 30AGO2026 \(primer día de inasistencia\)/);
    assert.match(bloques[1], /^B\. Día 31AGO2026 \(día 2 de inasistencia\)/);
    assert.match(bloques[2], /^C\. Día 01SET2026 \(reincorporación\)/);
  });

  test("el día intermedio avisa si no hay rol de servicio guardado para esa fecha", () => {
    const d = construirDatosInformeAdministrativo(NOTA_G39, [], [], FIRMANTES);
    assert.match(d.descripcion_dias, /verificar manualmente antes de remitir/);
  });

  test("el día intermedio cita el rol de servicio cuando sí está guardado", () => {
    const roles = [{ fecha: "2026-08-31" }];
    const d = construirDatosInformeAdministrativo(NOTA_G39, [], roles, FIRMANTES);
    assert.match(d.descripcion_dias, /conforme al rol de servicio del 31AGO2026/);
    assert.doesNotMatch(d.descripcion_dias, /verificar manualmente antes de remitir/);
  });

  test("el día intermedio cita la nota de \"Continúan faltos\" (seguimiento_faltas) en vez del rol, cuando existe", () => {
    const nota = { ...NOTA_G39, seguimiento_faltas: [{ fecha: "2026-08-31", numero_nota: "202601476981", oficial_constato: "CAP. PNP CASTRO ORTIZ Pedro Jose" }] };
    const roles = [{ fecha: "2026-08-31" }]; // aunque también haya rol, gana la nota real
    const d = construirDatosInformeAdministrativo(nota, [], roles, FIRMANTES);
    assert.match(d.descripcion_dias, /Nota Informativa N° 202601476981/);
    assert.match(d.descripcion_dias, /CAP\. PNP CASTRO ORTIZ Pedro Jose/);
    assert.doesNotMatch(d.descripcion_dias, /conforme al rol de servicio/);
    assert.match(d.indicios_lista, /Nota Informativa N° 202601476981, de fecha 31AGO2026, que acredita la continuidad/);
  });

  test("cita el texto legal exacto de G39 (descripción y sanción)", () => {
    const d = construirDatosInformeAdministrativo(NOTA_G39, [], [], FIRMANTES);
    assert.match(d.subsuncion_lista, /Faltar dos \(2\) días consecutivos a su unidad/);
    assert.match(d.subsuncion_lista, /De diez \(10\) a quince \(15\) días de Sanción de Rigor/);
  });

  test("ambas firmas quedan con su grado, nombre y cargo (instructor sin cargo, la plantilla ya dice \"Instructor\")", () => {
    const d = construirDatosInformeAdministrativo(NOTA_G39, [], [], FIRMANTES);
    assert.equal(d.conforme_grado, "MAY. PNP");
    assert.equal(d.conforme_nombre, "VARGAS SOTO, Mario Enrique");
    assert.equal(d.conforme_cargo, "Comisario (e) CPNP Ventanilla");
    assert.equal(d.instructor_grado, "S2 PNP");
    assert.equal(d.instructor_nombre, "HIDALGO FERRARI, Hans Brandon");
  });

  test("MG32 cita su propio texto legal (Anexo III, muy grave, pase a retiro) -- no reusa el de G39", () => {
    const d = construirDatosInformeAdministrativo(NOTA_MG32, [], [], FIRMANTES);
    assert.match(d.asunto_texto, /infracción MUY GRAVE MG 32/);
    assert.match(d.subsuncion_parrafo, /Anexo III/);
    assert.match(d.subsuncion_lista, /Faltar a su unidad tres \(3\) o más días en forma consecutiva/);
    assert.match(d.subsuncion_lista, /Pase a la Situación de Retiro/);
    assert.match(d.recomendaciones_lista, /infracción MUY GRAVE MG 32/);
  });

  test("lanza error claro para un código sin texto legal verificado, en vez de inventarlo", () => {
    assert.throws(
      () => construirDatosInformeAdministrativo({ ...NOTA_G39, codigo_infraccion: "MG99" }, [], [], FIRMANTES),
      /No hay texto legal verificado.*MG99/
    );
  });

  test("lanza error si falta el nombre de algún firmante", () => {
    assert.throws(
      () => construirDatosInformeAdministrativo(NOTA_G39, [], [], { conforme: { nombre: "" }, instructor: { nombre: "HIDALGO FERRARI" } }),
      /firmantes/
    );
  });

  test("lanza error si todavía no se reincorpora", () => {
    assert.throws(
      () => construirDatosInformeAdministrativo({ ...NOTA_G39, fecha_reincorporacion: null }, [], [], FIRMANTES),
      /reincorporación/
    );
  });
});
