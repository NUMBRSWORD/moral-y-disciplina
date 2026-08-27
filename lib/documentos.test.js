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
  { cip: "400474", apellidos_nombres: "ZEGOBIA QUISPE, ANTONY MARTIN", grado: "TENIENTE PNP", dni: "11111111" },
  { cip: "32138999", apellidos_nombres: "SALGADO CHOQUE, FREDDY", grado: "ST3", dni: "22222222" },
];

// L21, con descargo presentado.
const NOTA = {
  grado: "ST3",
  apellidos: "SALGADO CHOQUE",
  nombres: "FREDDY",
  codigo_infraccion: "L21",
  fecha_falta: "2026-08-10",
  hora_falta: "08:00",
  numero_nota_falta: "123",
  fecha_reincorporacion: "2026-08-10",
  hora_reincorporacion: "20:00",
  numero_nota_reincorporacion: "124",
  imputacion_generada_at: "2026-08-12T12:00:00.000Z",
  fecha_descargo: "2026-08-14",
  oficial_constato: "TNTE ZEGOBIA QUISPE Antony",
};

describe("construirDatosImputacion", () => {
  test("investigado en formato 'Grado PNP Nombres APELLIDOS'", () => {
    const d = construirDatosImputacion(NOTA, EFECTIVOS);
    assert.equal(d.investigado_completo, "ST3 PNP Freddy SALGADO CHOQUE");
  });
  test("el sello del superior usa nombres en título y apellidos en mayúsculas", () => {
    const d = construirDatosImputacion(NOTA, EFECTIVOS);
    assert.match(d.superior_completo, /^TENIENTE PNP Antony Martin ZEGOBIA QUISPE\.?$/);
    assert.equal(d.oficial_nombre_completo, "Antony Martin ZEGOBIA QUISPE");
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
    analisisTexto: "Se evalúa el descargo del ST1 PNP SALGADO CHOQUE Freddy y se concluye...",
    descargoTexto: "SALGADO CHOQUE Freddy sostiene que presentó certificado.",
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
    assert.match(d.analisis_texto, /Freddy SALGADO CHOQUE/);
    assert.doesNotMatch(d.analisis_texto, /SALGADO CHOQUE Freddy/);
    assert.match(d.descargo_texto, /Freddy SALGADO CHOQUE/);
  });
  test("la firma del superior conserva el formato de sello", () => {
    const d = construirDatosOrdenSancion(NOTA, EFECTIVOS, seleccion);
    assert.equal(d.signer_nombre, "Antony Martin ZEGOBIA QUISPE");
  });
  test("la decisión sanciona al investigado con su CIP y el tercio elegido", () => {
    const d = construirDatosOrdenSancion(NOTA, EFECTIVOS, seleccion);
    assert.match(d.decision_texto, /SANCIONAR al ST3 PNP Freddy SALGADO CHOQUE/);
    assert.match(d.decision_texto, /CIP N° 32138999/);
  });
  test("lanza error si falta el análisis y evaluación", () => {
    assert.throws(
      () => construirDatosOrdenSancion(NOTA, EFECTIVOS, { ...seleccion, analisisTexto: "   " }),
      /Análisis y Evaluación/i,
    );
  });
});

describe("construirDatosActaNoDescargo", () => {
  const NOTA_SIN_DESCARGO = { ...NOTA, fecha_descargo: null };

  test("separa apellidos (mayúsculas) y nombres (título) de investigado y superior", () => {
    const d = construirDatosActaNoDescargo(NOTA_SIN_DESCARGO, EFECTIVOS);
    assert.equal(d.investigado_apellidos, "SALGADO CHOQUE");
    assert.equal(d.investigado_nombres, "Freddy");
    assert.equal(d.superior_apellidos, "ZEGOBIA QUISPE");
    assert.equal(d.superior_nombres, "Antony Martin");
  });
  test("completa CIP y DNI del investigado desde Efectivos", () => {
    const d = construirDatosActaNoDescargo(NOTA_SIN_DESCARGO, EFECTIVOS);
    assert.equal(d.investigado_cip, "32138999");
    assert.equal(d.investigado_dni, "22222222");
  });
  test("lanza error si no ubica al investigado en Efectivos", () => {
    assert.throws(
      () => construirDatosActaNoDescargo({ ...NOTA_SIN_DESCARGO, apellidos: "PEREZ", nombres: "JUAN" }, EFECTIVOS),
      /no se pudo ubicar|Efectivos/i,
    );
  });
});
