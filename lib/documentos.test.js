// Pruebas de las funciones que arman los datos de cada documento legal
// (construirDatos*). Son el código de mayor riesgo del proyecto: un error
// aquí sale impreso en una Orden de Sanción firmada.
//
// Corre con: node --test lib/
// Estas funciones NO tocan red ni DOM: las dependencias pesadas de .docx
// (PizZip, docxtemplater, file-saver) se cargan de forma perezosa solo
// dentro de renderizar*/generar* -- ver lib/docxDeps.js.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { construirDatosImputacion } from "./imputacion.js";
import { construirDatosActaNoDescargo } from "./actaNoDescargo.js";
import { construirDatosOrdenSancion, buildCasoConcreto } from "./ordenSancion.js";

const EFECTIVOS = [
  { cip: "400001", apellidos_nombres: "RIOS PAREDES, DIEGO MARTIN", grado: "TENIENTE PNP", dni: "11111111" },
  { cip: "30000001", apellidos_nombres: "MENDOZA RAMOS, CARLOS", grado: "ST3", dni: "22222222" },
];

// L21, con descargo presentado.
const NOTA = {
  grado: "ST3",
  apellidos: "MENDOZA RAMOS",
  nombres: "CARLOS",
  codigo_infraccion: "L21",
  fecha_falta: "2026-08-10",
  hora_falta: "08:00",
  numero_nota_falta: "123",
  fecha_reincorporacion: "2026-08-10",
  hora_reincorporacion: "20:00",
  numero_nota_reincorporacion: "124",
  imputacion_generada_at: "2026-08-12T12:00:00.000Z",
  fecha_descargo: "2026-08-14",
  oficial_constato: "TNTE RIOS PAREDES Diego",
};

describe("construirDatosImputacion", () => {
  test("investigado en formato 'Grado PNP Nombres APELLIDOS'", () => {
    const d = construirDatosImputacion(NOTA, EFECTIVOS);
    assert.equal(d.investigado_completo, "ST3 PNP Carlos MENDOZA RAMOS");
  });
  test("el sello del superior usa nombres en título y apellidos en mayúsculas", () => {
    const d = construirDatosImputacion(NOTA, EFECTIVOS);
    assert.match(d.superior_completo, /^TENIENTE PNP Diego Martin RIOS PAREDES\.?$/);
    assert.equal(d.oficial_nombre_completo, "Diego Martin RIOS PAREDES");
  });
  test("cita el código con guion y su texto normativo", () => {
    const d = construirDatosImputacion(NOTA, EFECTIVOS);
    assert.match(d.codigo_infraccion_texto, /^L-21 \(.+\)\.$/);
  });
  test("lanza error si el oficial que constató no está en Efectivos", () => {
    assert.throws(() => construirDatosImputacion(NOTA, []), /no se pudo ubicar|Efectivos/i);
  });
});

describe("construirDatosOrdenSancion", () => {
  const seleccion = {
    tercioValue: "2",
    analisisTexto: "Se evalúa el descargo del ST1 PNP MENDOZA RAMOS Carlos y se concluye...",
    descargoTexto: "MENDOZA RAMOS Carlos sostiene que presentó certificado.",
  };

  test("el hecho es solo el caso concreto, sin anteponer ni duplicar la infracción", () => {
    const d = construirDatosOrdenSancion(NOTA, EFECTIVOS, seleccion);
    assert.equal(d.hecho_completo, buildCasoConcreto(NOTA));
    assert.doesNotMatch(d.hecho_completo, /CASO CONCRETO:/);
    assert.ok(!d.hecho_completo.trimStart().startsWith('"'));
  });
  test("el código y su texto normativo van aparte, en codigo_texto", () => {
    const d = construirDatosOrdenSancion(NOTA, EFECTIVOS, seleccion);
    assert.match(d.codigo_texto, /^L-21 \(.+\)\.$/);
  });
  test("normaliza las menciones al investigado dentro del análisis y del descargo", () => {
    const d = construirDatosOrdenSancion(NOTA, EFECTIVOS, seleccion);
    assert.match(d.analisis_texto, /Carlos MENDOZA RAMOS/);
    assert.doesNotMatch(d.analisis_texto, /MENDOZA RAMOS Carlos/);
    assert.match(d.descargo_texto, /Carlos MENDOZA RAMOS/);
  });
  test("la firma del superior conserva el formato de sello", () => {
    const d = construirDatosOrdenSancion(NOTA, EFECTIVOS, seleccion);
    assert.equal(d.signer_nombre, "Diego Martin RIOS PAREDES");
  });
  test("la decisión sanciona al investigado con su CIP y el tercio elegido", () => {
    const d = construirDatosOrdenSancion(NOTA, EFECTIVOS, seleccion);
    assert.match(d.decision_texto, /SANCIONAR al ST3 PNP Carlos MENDOZA RAMOS/);
    assert.match(d.decision_texto, /CIP N° 30000001/);
  });
  test("lanza error si falta el análisis y evaluación", () => {
    assert.throws(
      () => construirDatosOrdenSancion(NOTA, EFECTIVOS, { ...seleccion, analisisTexto: "   " }),
      /Análisis y Evaluación/i,
    );
  });
  test("usa investigado_cip de la nota sin necesitar al investigado en el padrón", () => {
    // Un oficial no-admin ya no recibe el padrón completo; el CIP del
    // investigado viaja en la propia nota.
    const notaConCip = { ...NOTA, investigado_cip: "77777777" };
    const soloOficial = EFECTIVOS.filter((e) => e.cip !== "30000001");
    const d = construirDatosOrdenSancion(notaConCip, soloOficial, seleccion);
    assert.match(d.decision_texto, /CIP N° 77777777/);
  });
  test("sin investigado_cip y sin el investigado en el padrón, lanza error claro", () => {
    const soloOficial = EFECTIVOS.filter((e) => e.cip !== "30000001");
    assert.throws(
      () => construirDatosOrdenSancion(NOTA, soloOficial, seleccion),
      /No se pudo determinar el CIP/i,
    );
  });
});

describe("construirDatosActaNoDescargo", () => {
  const NOTA_SIN_DESCARGO = { ...NOTA, fecha_descargo: null };

  test("separa apellidos (mayúsculas) y nombres (título) de investigado y superior", () => {
    const d = construirDatosActaNoDescargo(NOTA_SIN_DESCARGO, EFECTIVOS);
    assert.equal(d.investigado_apellidos, "MENDOZA RAMOS");
    assert.equal(d.investigado_nombres, "Carlos");
    assert.equal(d.superior_apellidos, "RIOS PAREDES");
    assert.equal(d.superior_nombres, "Diego Martin");
  });
  test("completa CIP y DNI del investigado desde Efectivos", () => {
    const d = construirDatosActaNoDescargo(NOTA_SIN_DESCARGO, EFECTIVOS);
    assert.equal(d.investigado_cip, "30000001");
    assert.equal(d.investigado_dni, "22222222");
  });
  test("lanza error si no ubica al investigado en Efectivos", () => {
    assert.throws(
      () => construirDatosActaNoDescargo({ ...NOTA_SIN_DESCARGO, apellidos: "PEREZ", nombres: "JUAN" }, EFECTIVOS),
      /no se pudo ubicar|Efectivos/i,
    );
  });
});
