// Generación del documento "Inicio de Imputación de Infracción Leve" a partir
// de una fila de notas_informativas + la lista de efectivos (para ubicar al
// oficial que constató la falta y completar el sello).
//
// Usa docxtemplater sobre la plantilla plantillas/plantilla_imputacion_leve.docx
// (una copia exacta del formato oficial, con placeholders {tag}).

import PizZip from "https://esm.sh/pizzip@3.1.7";
import Docxtemplater from "https://esm.sh/docxtemplater@3.50.0";
import saveAs from "https://esm.sh/file-saver@2.0.5";
import { getInfraccion, normalizarCodigoInfraccion } from "./anexoI.js";
import {
  soloDigitos, conPnp, limpiarNombreVisible, nombreCompletoVisible, addDays,
  fechaLarga, fechaCorta, fechaCompacta, horaCorta,
  tokens, buscarOficialConstato,
} from "./utils.js";

// Re-exportadas tal cual: el resto de la app (app.js, ordenSancion.js,
// actaNoDescargo.js) las importa desde aquí, y así no hace falta tocar esos
// imports solo porque la implementación se movió a utils.js (donde además
// quedan cubiertas por pruebas automatizadas, ver lib/utils.test.js).
export { conPnp, fechaLarga, tokens, buscarOficialConstato };

// Construye el párrafo "Descripción del hecho" siguiendo exactamente el
// formato fijo definido por la unidad; solo se sustituyen fecha/hora/N.º de
// nota de cada caso.
export function buildDescripcionHecho(nota) {
  const horaFalta = horaCorta(nota.hora_falta);
  const horaReinc = horaCorta(nota.hora_reincorporacion);
  const fechaFaltaCorta = fechaCompacta(nota.fecha_falta);
  const fechaFinTurno = fechaCompacta(addDays(nota.fecha_falta, 1));
  const fechaReincCorta = fechaCompacta(nota.fecha_reincorporacion);
  const sufijo = (numero) =>
    `NOTA INFORMATIVA N° ${numero} - COMOPPOL-PNP/DIRNOS/REGPOL CALLAO/DIVOPUS VENTANILLA/COM VENTANILLA A`;

  return (
    `en circunstancias que el investigado se encontraba nombrado según el rol de servicio de la Comisaría PNP Ventanilla, ` +
    `desde las ${horaFalta} horas del ${fechaFaltaCorta} hasta las ${horaFalta} horas del ${fechaFinTurno}; ` +
    `constatando la ausencia física del investigado a la lista, hecho constatado por el suscrito, Oficial de Permanencia, ` +
    `durante la formación a las ${horaFalta} horas del ${fechaFaltaCorta}, dando cuenta a la superioridad mediante ${sufijo(nota.numero_nota_falta)}, ` +
    `asimismo, el investigado se reincorporó a la dependencia a las ${horaReinc} horas del ${fechaReincCorta}, ` +
    `hecho reportado conforme a la ${sufijo(nota.numero_nota_reincorporacion)}, ` +
    `evidenciando falta de responsabilidad y compromiso en el cumplimiento de sus obligaciones funcionales como miembro de la policía nacional de Perú.`
  );
}

// Título fijo usado en el sello para quien constató la falta. Por ahora es
// siempre "OFICIAL DE PERMANENCIA" (así se confirmó para el caso de prueba);
// si en el futuro varía según el oficial, este es el único lugar a ajustar.
const CARGO_SELLO_POR_DEFECTO = "OFICIAL DE PERMANENCIA";

// Determina si una nota tiene todos los datos necesarios para generar el
// documento (código Leve + reincorporación registrada + oficial identificable).
export function puedeGenerarImputacion(nota, efectivos) {
  const codigo = normalizarCodigoInfraccion(nota.codigo_infraccion);
  if (!codigo || !getInfraccion(codigo)) return false;
  if (!nota.fecha_reincorporacion || !nota.hora_reincorporacion) return false;
  if (!nota.numero_nota_reincorporacion) return false;
  if (!buscarOficialConstato(nota.oficial_constato, efectivos)) return false;
  return true;
}

// Arma el objeto de datos {tag: valor} que se le pasa a docxtemplater.
// Lanza un Error con un mensaje explicativo (mostrable directo al usuario)
// si falta algún dato indispensable.
export function construirDatosImputacion(nota, efectivos) {
  const infraccion = getInfraccion(nota.codigo_infraccion);
  if (!infraccion) {
    throw new Error("Este caso no tiene un código de infracción Leve válido (Anexo I). Solo se puede generar la imputación para infracciones leves (L1–L117).");
  }
  const oficial = buscarOficialConstato(nota.oficial_constato, efectivos);
  if (!oficial) {
    throw new Error(`No se pudo ubicar en Efectivos al oficial "${nota.oficial_constato || "(no registrado)"}" que constató la falta. Verifique que esté registrado en la tabla Efectivos con el mismo apellido.`);
  }
  if (!nota.fecha_reincorporacion || !nota.hora_reincorporacion || !nota.numero_nota_reincorporacion) {
    throw new Error("Falta registrar la reincorporación (fecha, hora y N.º de nota) antes de generar la imputación.");
  }

  const codigo = normalizarCodigoInfraccion(nota.codigo_infraccion);
  const codigoConGuion = codigo.replace(/^L(\d+)$/, "L-$1");
  const infraccionSinPunto = infraccion.infraccion.replace(/\.\s*$/, "");
  const investigadoCompleto = `${conPnp(nota.grado)} ${nombreCompletoVisible(nota.apellidos, nota.nombres, ", ")}`.replace(/\s+/g, " ").trim();

  return {
    investigado_completo: investigadoCompleto,
    unidad_investigado: "DIVOPUS 3-CPNP VENTANILLA.",
    descripcion_hecho: buildDescripcionHecho(nota),
    bien_juridico: infraccion.bienJuridico,
    codigo_infraccion_texto: `${codigoConGuion} (${infraccionSinPunto}).`,
    sancion_texto: infraccion.sancion,
    superior_completo: `${conPnp(oficial.grado)} ${limpiarNombreVisible(oficial.apellidos_nombres)}.`.replace(/\s+/g, " ").trim(),
    fecha_larga: fechaLarga(new Date().toISOString().slice(0, 10)),
    fecha_corta: fechaCorta(new Date().toISOString().slice(0, 10)),
    oficial_cip: soloDigitos(oficial.cip),
    oficial_nombre_completo: limpiarNombreVisible(oficial.apellidos_nombres),
    oficial_grado_seal: conPnp(oficial.grado),
    oficial_cargo: CARGO_SELLO_POR_DEFECTO,
  };
}

// Renderiza la plantilla con los datos del caso y devuelve el Blob del
// .docx resultante (sin descargarlo todavía).
export async function renderizarImputacionDocx(nota, efectivos) {
  const data = construirDatosImputacion(nota, efectivos);

  const response = await fetch(new URL("../plantillas/plantilla_imputacion_leve.docx", import.meta.url));
  if (!response.ok) throw new Error("No se pudo cargar la plantilla del documento.");
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

export async function generarImputacionDocx(nota, efectivos) {
  const out = await renderizarImputacionDocx(nota, efectivos);
  const nombreArchivo = `IMPUTACION LEVE - ${(nota.grado || "").trim()} ${(nota.apellidos || "").trim()} ${(nota.nombres || "").trim()}.docx`.replace(/\s+/g, " ").trim();
  saveAs(out, nombreArchivo);
}
