// Generación del "Acta de No Recepción de Descargos": se emite cuando ya
// venció el plazo de un (01) día hábil desde que se generó la Imputación y
// el investigado no presentó su descargo.
//
// Usa docxtemplater sobre la plantilla plantillas/plantilla_acta_no_descargo.docx.

import PizZip from "https://esm.sh/pizzip@3.1.7";
import Docxtemplater from "https://esm.sh/docxtemplater@3.50.0";
import saveAs from "https://esm.sh/file-saver@2.0.5";
import { getInfraccion, normalizarCodigoInfraccion } from "./anexoI.js";
import { buscarOficialConstato, conPnp, fechaLarga, tokens } from "./imputacion.js";

// El testigo es siempre la misma persona (confirmado por el usuario), a
// diferencia del superior que varía según quién constató la falta.
const TESTIGO_FIJO = {
  grado: "S2",
  apellidos: "HIDALGO FERRARI",
  nombres: "Hans Brandon",
  cip: "32138113",
  dni: "72955816",
};

function sinPnp(grado) {
  return (grado || "").replace(/\.$/, "").replace(/\s*\bPNP\b\s*$/i, "").trim();
}

function splitApellidosNombres(full) {
  const txt = (full || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (txt.includes(",")) {
    const [ap, no] = txt.split(",");
    return { apellidos: ap.trim(), nombres: (no || "").trim() };
  }
  const words = txt.split(/\s+/).filter(Boolean);
  if (words.length <= 2) return { apellidos: txt, nombres: "" };
  return { apellidos: words.slice(0, 2).join(" "), nombres: words.slice(2).join(" ") };
}

// Ubica en `efectivos` al investigado de la nota (que ya viene con apellidos
// y nombres separados, a diferencia de oficial_constato) para completar su
// CIP y DNI. Requiere al menos 2 palabras en común para dar el match por bueno.
function buscarPorApellidosNombres(apellidos, nombres, efectivos) {
  if (!apellidos || !efectivos?.length) return null;
  const objetivo = tokens(`${apellidos} ${nombres}`);
  if (!objetivo.length) return null;
  let mejor = null;
  let mejorScore = 0;
  for (const ef of efectivos) {
    const efTokens = new Set(tokens(ef.apellidos_nombres));
    const score = objetivo.filter((t) => efTokens.has(t)).length;
    if (score > mejorScore) {
      mejorScore = score;
      mejor = ef;
    }
  }
  return mejorScore >= 2 ? mejor : null;
}

// Se construye con Date.UTC/getUTCDay (no `new Date(fechaISO + "T00:00:00")`
// con .getDay() en hora local) para que el cálculo del día de la semana no
// dependa de la zona horaria del navegador: con una fecha-hora local sin
// offset, un huso horario adelantado a UTC podría correr el día calculado.
function esFinDeSemana(fechaISO) {
  const [y, m, d] = fechaISO.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 || dow === 6;
}

// "Un (01) día hábil, a partir de las 08:00 horas del día siguiente hábil de
// notificado" (mismo texto que ya usa la Imputación para el plazo de descargo).
function siguienteDiaHabil(fechaISO) {
  const [y, m, d] = fechaISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  while (esFinDeSemana(dt.toISOString().slice(0, 10))) dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

export function fechaLimiteDescargo(nota) {
  if (!nota.imputacion_generada_at) return null;
  return siguienteDiaHabil(nota.imputacion_generada_at.slice(0, 10));
}

export function plazoDescargoVencido(nota, hoyISO) {
  if (!nota.imputacion_generada_at) return false;
  const hoy = hoyISO || new Date().toISOString().slice(0, 10);
  const fechaNotif = nota.imputacion_generada_at.slice(0, 10);
  const limite = siguienteDiaHabil(fechaNotif);
  return hoy > limite;
}

export function puedeGenerarActaNoDescargo(nota, efectivos) {
  const codigo = normalizarCodigoInfraccion(nota.codigo_infraccion);
  if (!codigo || !getInfraccion(codigo)) return false;
  if (!nota.imputacion_generada_at) return false;
  if (nota.fecha_descargo) return false;
  if (!plazoDescargoVencido(nota)) return false;
  if (!buscarOficialConstato(nota.oficial_constato, efectivos)) return false;
  if (!buscarPorApellidosNombres(nota.apellidos, nota.nombres, efectivos)) return false;
  return true;
}

export function construirDatosActaNoDescargo(nota, efectivos) {
  const superior = buscarOficialConstato(nota.oficial_constato, efectivos);
  if (!superior) {
    throw new Error(`No se pudo ubicar en Efectivos al oficial "${nota.oficial_constato || "(no registrado)"}" que constató la falta.`);
  }
  const investigadoEf = buscarPorApellidosNombres(nota.apellidos, nota.nombres, efectivos);
  if (!investigadoEf) {
    throw new Error(`No se pudo ubicar en Efectivos a ${nota.apellidos || ""} ${nota.nombres || ""} para completar su CIP/DNI. Verifique que esté registrado en la tabla Efectivos.`);
  }

  const superiorSplit = splitApellidosNombres(superior.apellidos_nombres);
  const ahora = new Date();
  const cierre = new Date(ahora.getTime() + 10 * 60000);
  const hhmm = (d) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

  return {
    fecha_larga: fechaLarga(ahora.toISOString().slice(0, 10)),
    hora_apertura: hhmm(ahora),
    hora_cierre: hhmm(cierre),
    superior_grado: sinPnp(superior.grado),
    superior_apellidos: superiorSplit.apellidos,
    superior_nombres: superiorSplit.nombres,
    superior_cip: superior.cip,
    superior_dni: superior.dni,
    testigo_grado: TESTIGO_FIJO.grado,
    testigo_apellidos: TESTIGO_FIJO.apellidos,
    testigo_nombres: TESTIGO_FIJO.nombres,
    testigo_cip: TESTIGO_FIJO.cip,
    testigo_dni: TESTIGO_FIJO.dni,
    investigado_grado: sinPnp(nota.grado),
    investigado_apellidos: nota.apellidos || "",
    investigado_nombres: nota.nombres || "",
    investigado_cip: investigadoEf.cip,
    investigado_dni: investigadoEf.dni,
  };
}

export async function renderizarActaNoDescargoDocx(nota, efectivos) {
  const data = construirDatosActaNoDescargo(nota, efectivos);

  const response = await fetch(new URL("../plantillas/plantilla_acta_no_descargo.docx", import.meta.url));
  if (!response.ok) throw new Error("No se pudo cargar la plantilla del acta.");
  const arrayBuffer = await response.arrayBuffer();

  const zip = new PizZip(arrayBuffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{", end: "}" },
  });
  doc.render(data);

  return doc.getZip().generate({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

export async function generarActaNoDescargoDocx(nota, efectivos) {
  const out = await renderizarActaNoDescargoDocx(nota, efectivos);
  const nombreArchivo = `ACTA NO DESCARGO - ${(nota.grado || "").trim()} ${(nota.apellidos || "").trim()} ${(nota.nombres || "").trim()}.docx`.replace(/\s+/g, " ").trim();
  saveAs(out, nombreArchivo);
}
