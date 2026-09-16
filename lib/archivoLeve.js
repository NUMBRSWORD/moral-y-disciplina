// Generación del "Archivo del Procedimiento Administrativo Disciplinario por
// Infracción Leve" (Anexo IV de la Resolución de la Inspectoría General
// N° 29-2026-IGPNP/SEC-UNIPLA — formatos aprobados por la IGPNP conforme al
// artículo 96 del Reglamento de la Ley N° 30714). Es la contraparte de la
// Orden de Sanción: se emite cuando, tras evaluar el descargo, se concluye
// que la conducta NO se adecúa a ningún código del Anexo I, así que el caso
// se cierra sin sanción en vez de con ella. Por eso requiere que exista un
// descargo que evaluar, y es mutuamente excluyente con la Orden de Sanción.
//
// Usa docxtemplater sobre la plantilla plantillas/plantilla_archivo_leve.docx
// (armada desde cero a partir del formato oficial, que no tenía un ejemplo
// previo en Word a diferencia de la Orden de Sanción/Informe Administrativo).

import { cargarDocxDeps } from "./docxDeps.js";
import { getInfraccion, normalizarCodigoInfraccion } from "./anexoI.js";
import { buscarOficialConstato, conPnp, fechaLarga } from "./imputacion.js";
import { buildCasoConcreto } from "./ordenSancion.js";
import { nombreCompletoVisible, nombreParaSello, normalizarMencionInvestigado } from "./utils.js";

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

// Determina si la nota tiene todo lo necesario para archivar el
// procedimiento: código leve con texto normativo cargado, Imputación ya
// notificada, descargo presentado (condición explícita del usuario -- sin
// descargo que evaluar no corresponde archivar), sin una Orden de Sanción ya
// generada (mutuamente excluyente), y el oficial que constató ubicable en
// Efectivos para poder firmar.
export function puedeGenerarArchivoLeve(nota, efectivos) {
  const codigo = normalizarCodigoInfraccion(nota.codigo_infraccion);
  if (!codigo || !getInfraccion(codigo)) return false;
  if (!nota.imputacion_generada_at) return false;
  if (!nota.fecha_descargo) return false;
  if (nota.orden_sancion_generada_at) return false;
  if (!buscarOficialConstato(nota.oficial_constato, efectivos)) return false;
  return true;
}

// Arma el objeto {tag: valor} para docxtemplater.
//   seleccion: { motivoTexto, resolucionNumero }
export function construirDatosArchivoLeve(nota, efectivos, seleccion) {
  const codigo = normalizarCodigoInfraccion(nota.codigo_infraccion);
  const infraccion = getInfraccion(codigo);
  if (!infraccion) {
    throw new Error("El Archivo del procedimiento solo está disponible para códigos leves con texto normativo cargado.");
  }
  if (nota.orden_sancion_generada_at) {
    throw new Error("Esta nota ya tiene una Orden de Sanción generada; no corresponde archivarla.");
  }
  if (!nota.fecha_descargo) {
    throw new Error("El Archivo del procedimiento requiere que el investigado haya presentado su descargo.");
  }
  if (!seleccion?.motivoTexto?.trim()) {
    throw new Error("Escriba el motivo por el que la conducta no se adecúa a ningún código antes de generar el documento.");
  }
  if (!seleccion?.resolucionNumero?.trim()) {
    throw new Error("Escriba el número de la Resolución antes de generar el documento.");
  }

  const superior = buscarOficialConstato(nota.oficial_constato, efectivos);
  if (!superior) {
    throw new Error(`No se pudo ubicar en Efectivos al oficial "${nota.oficial_constato || "(no registrado)"}" que constató la falta.`);
  }

  const superiorSplit = splitApellidosNombres(superior.apellidos_nombres);
  const codigoConGuion = codigo.replace(/^L(\d+)$/, "L-$1");
  const investigadoCompleto = `${conPnp(nota.grado)} ${nombreCompletoVisible(nota.apellidos, nota.nombres)}`.replace(/\s+/g, " ").trim();
  const motivoTexto = normalizarMencionInvestigado(seleccion.motivoTexto.trim(), nota.apellidos, nota.nombres);
  const hoyISO = new Date().toISOString().slice(0, 10);

  return {
    resolucion_numero: seleccion.resolucionNumero.trim(),
    lugar_fecha: `Ventanilla, ${fechaLarga(hoyISO)}`,
    investigado_completo: investigadoCompleto,
    codigo_imputado: codigoConGuion,
    // Mismo hecho narrado que ya usa la Orden de Sanción -- no se inventa
    // una segunda versión del mismo relato.
    hecho_completo: buildCasoConcreto(nota),
    fecha_notificacion: nota.imputacion_generada_at ? fechaLarga(nota.imputacion_generada_at.slice(0, 10)) : "",
    motivo_archivo: motivoTexto,
    signer_oa: `OA-${(superior.cip || "").replace(/\D+/g, "")}`,
    signer_nombre: nombreParaSello(superiorSplit.apellidos, superiorSplit.nombres),
    signer_grado: conPnp(superior.grado).toUpperCase(),
  };
}

export async function renderizarArchivoLeveDocx(nota, efectivos, seleccion) {
  const data = construirDatosArchivoLeve(nota, efectivos, seleccion);
  const { PizZip, Docxtemplater } = await cargarDocxDeps();

  const response = await fetch(new URL("../plantillas/plantilla_archivo_leve.docx", import.meta.url));
  if (!response.ok) throw new Error("No se pudo cargar la plantilla del Archivo del procedimiento.");
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

export async function generarArchivoLeveDocx(nota, efectivos, seleccion) {
  const out = await renderizarArchivoLeveDocx(nota, efectivos, seleccion);
  const { saveAs } = await cargarDocxDeps();
  const nombreArchivo = `ARCHIVO DEL PROCEDIMIENTO - ${(nota.grado || "").trim()} ${nombreCompletoVisible(nota.apellidos, nota.nombres)}.docx`.replace(/\s+/g, " ").trim();
  saveAs(out, nombreArchivo);
}
