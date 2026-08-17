// Generación de la "Orden de Sanción": se emite luego de evaluar el descargo
// (o su ausencia, si venció el plazo sin que se presente) para los códigos
// leves L21 y L24, eligiendo el tercio de la sanción (Anexo I) a imponer.
//
// Usa docxtemplater sobre la plantilla plantillas/plantilla_orden_sancion.docx
// (copia exacta, con placeholders {tag}, del formato real ya aprobado por el
// usuario — ver plantillas/plantilla_orden_sancion_ejemplo.docx).

import PizZip from "https://esm.sh/pizzip@3.1.7";
import Docxtemplater from "https://esm.sh/docxtemplater@3.50.0";
import saveAs from "https://esm.sh/file-saver@2.0.5";
import { getInfraccion, normalizarCodigoInfraccion } from "./anexoI.js";
import { buscarOficialConstato, conPnp, fechaLarga, tokens } from "./imputacion.js";
import { plazoDescargoVencido } from "./actaNoDescargo.js";

const MESES_CORTO = [
  "ENE", "FEB", "MAR", "ABR", "MAY", "JUN",
  "JUL", "AGO", "SET", "OCT", "NOV", "DIC",
];

// Códigos para los que, por ahora, existe la opción de elegir tercio de
// sanción e imprimir la Orden de Sanción. Cada opción trae el fragmento
// exacto que va después de "con " en la frase de DECISIÓN.
const TERCIOS_POR_CODIGO = {
  L21: [
    { value: "amonestacion", label: "Amonestación (tercio inferior)", fragmento: "amonestación", extremo: "mínimo" },
    { value: "2", label: "Dos (02) días de Sanción Simple (tercio medio)", fragmento: "dos (02) días de Sanción Simple", extremo: "medio" },
    { value: "4", label: "Cuatro (04) días de Sanción Simple (tercio superior)", fragmento: "cuatro (04) días de Sanción Simple", extremo: "máximo" },
  ],
  L24: [
    { value: "8", label: "Ocho (08) días de Sanción Simple (tercio inferior)", fragmento: "ocho (08) días de Sanción Simple", extremo: "mínimo" },
    { value: "10", label: "Diez (10) días de Sanción Simple (tercio superior)", fragmento: "diez (10) días de Sanción Simple", extremo: "máximo" },
  ],
};

export function opcionesTercio(codigoInfraccion) {
  const codigo = normalizarCodigoInfraccion(codigoInfraccion);
  return TERCIOS_POR_CODIGO[codigo] || null;
}

// Párrafo estándar de "Análisis y Evaluación" para los casos SIN descargo
// (venció el plazo sin respuesta), con el cierre ajustado según el tercio que
// haya marcado el oficial. Sirve como punto de partida editable, no como
// texto final — el oficial puede completarlo con el motivo puntual (p. ej.
// reincidencia) antes de guardar.
export function analisisSinDescargoDefault(codigoInfraccion, tercioValue) {
  const opciones = opcionesTercio(codigoInfraccion) || [];
  const opcion = opciones.find((o) => o.value === tercioValue);
  const extremo = opcion?.extremo || "correspondiente";
  return (
    "Habiendo vencido el plazo reglamentario sin que el administrado haga ejercicio de su derecho a la defensa mediante la presentación de sus descargos, se procede a valorar los actuados. De las Notas Informativas mencionadas en la descripción de los hechos, ha quedado objetiva y fehacientemente acreditada la ausencia del efectivo policial a la formación y al servicio para el que fue designado, reincorporándose con retraso. Aunado a ello, para la graduación de la sanción se toma en estricta consideración lo establecido en el artículo 31 de la Ley N° 30714, el cual contempla los criterios para la imposición de sanciones. " +
    `En tal sentido, atendiendo a los criterios de razonabilidad y proporcionalidad, corresponde imponer la medida en su extremo ${extremo}.\n\n` +
    "Verificación de los principios de la potestad sancionadora administrativa (Texto Único Ordenado de la Ley N° 27444, Ley del Procedimiento Administrativo General): (i) Legalidad, en tanto la potestad disciplinaria se ejerce por autoridad competente conforme a la Ley N° 30714 y su reglamento; (ii) Debido Procedimiento, pues el investigado fue debidamente notificado de la imputación y tuvo la oportunidad real de presentar su descargo, no habiéndolo ejercido dentro del plazo legal; (iii) Razonabilidad, al graduarse la sanción dentro de los márgenes previstos en el Anexo I sin exceder lo estrictamente necesario; (iv) Tipicidad, dado que la conducta imputada (ausencia o retraso conforme a la Nota Informativa) se subsume exactamente en la infracción del Anexo I antes citada; (v) Irretroactividad, al aplicarse las normas vigentes al momento de los hechos; (vi) Concurso de Infracciones, no verificándose en el presente caso la concurrencia de otra infracción por el mismo hecho; (vii) Continuación de Infracciones, no correspondiendo su aplicación al tratarse de un hecho único; (viii) Causalidad, por recaer la sanción sobre quien realizó la conducta imputada; (ix) Presunción de Licitud, habiéndose desvirtuado dicha presunción con los medios probatorios que sustentan la imputación; (x) Culpabilidad, al no haberse acreditado causa eximente de responsabilidad; y (xi) Non Bis In Idem, no existiendo doble sanción por el mismo hecho y fundamento."
  );
}

function fechaCorta(fechaISO) {
  if (!fechaISO) return "";
  const [y, m, d] = fechaISO.split("-");
  return `${d}/${m}/${y}`;
}

function fechaCompacta(fechaISO) {
  if (!fechaISO) return "";
  const [y, m, d] = fechaISO.split("-").map(Number);
  return `${String(d).padStart(2, "0")}${MESES_CORTO[m - 1]}${y}`;
}

function horaCorta(hora) {
  return (hora || "").slice(0, 5);
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

// Ubica en `efectivos` al investigado de la nota, para completar su CIP en
// la frase de DECISIÓN. Requiere al menos 2 palabras en común (apellidos).
function buscarInvestigado(apellidos, nombres, efectivos) {
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

// Narrativa fija de "CASO CONCRETO": fecha/hora de la falta y de la
// reincorporación, con sus N.º de nota, igual al formato ya aprobado.
export function buildCasoConcreto(nota) {
  const horaFalta = horaCorta(nota.hora_falta);
  const horaReinc = horaCorta(nota.hora_reincorporacion);
  const fechaFaltaCorta = fechaCompacta(nota.fecha_falta);
  const fechaReincCorta = fechaCompacta(nota.fecha_reincorporacion);
  const sufijo = (numero) =>
    `${numero}-COMOPPOL-PNP/DIRNOS/REGPOL CALLAO/DIVOPUS VENTANILLA/COM VENTANILLA A`;

  return (
    `El investigado se encontraba nombrado según el rol de servicio de la Comisaría PNP Ventanilla para el turno de las ${horaFalta} horas del ${fechaFaltaCorta}; ` +
    `constatándose su ausencia física a la formación de las ${horaFalta} horas del ${fechaFaltaCorta}, hecho comunicado a la superioridad mediante la Nota Informativa N° ${sufijo(nota.numero_nota_falta)}. ` +
    `Posteriormente, el investigado se reincorporó al servicio a las ${horaReinc} horas del ${fechaReincCorta}, hecho reportado conforme a la Nota Informativa N° ${sufijo(nota.numero_nota_reincorporacion)}.`
  );
}

// Determina si la nota tiene todo lo necesario para poder elegir tercio y
// generar la Orden de Sanción: código L21/L24, reincorporación registrada, y
// el plazo de descargo ya resuelto (con descargo presentado, o vencido sin
// respuesta), además de poder ubicar al oficial y al investigado en Efectivos.
export function puedeGenerarOrdenSancion(nota, efectivos) {
  const codigo = normalizarCodigoInfraccion(nota.codigo_infraccion);
  if (!codigo || !TERCIOS_POR_CODIGO[codigo]) return false;
  if (!nota.fecha_reincorporacion || !nota.numero_nota_reincorporacion) return false;
  if (!nota.imputacion_generada_at) return false;
  if (!nota.fecha_descargo && !plazoDescargoVencido(nota)) return false;
  if (!buscarOficialConstato(nota.oficial_constato, efectivos)) return false;
  if (!buscarInvestigado(nota.apellidos, nota.nombres, efectivos)) return false;
  return true;
}

// Arma el objeto de datos {tag: valor} para docxtemplater a partir de la
// nota y de lo que el oficial eligió/escribió en el formulario:
//   { tercioValue, analisisTexto, descargoTexto }
export function construirDatosOrdenSancion(nota, efectivos, seleccion) {
  const codigo = normalizarCodigoInfraccion(nota.codigo_infraccion);
  const opciones = TERCIOS_POR_CODIGO[codigo];
  if (!opciones) {
    throw new Error("La Orden de Sanción solo está disponible para los códigos L21 y L24 por ahora.");
  }
  const opcion = opciones.find((o) => o.value === seleccion?.tercioValue);
  if (!opcion) {
    throw new Error("Seleccione el tercio de la sanción a imponer.");
  }
  if (!seleccion?.analisisTexto?.trim()) {
    throw new Error("Escriba el Análisis y Evaluación del caso antes de generar el documento.");
  }

  const infraccion = getInfraccion(codigo);
  const superior = buscarOficialConstato(nota.oficial_constato, efectivos);
  if (!superior) {
    throw new Error(`No se pudo ubicar en Efectivos al oficial "${nota.oficial_constato || "(no registrado)"}" que constató la falta.`);
  }
  const investigadoEf = buscarInvestigado(nota.apellidos, nota.nombres, efectivos);
  if (!investigadoEf) {
    throw new Error(`No se pudo ubicar en Efectivos a ${nota.apellidos || ""} ${nota.nombres || ""} para completar su CIP. Verifique que esté registrado en la tabla Efectivos.`);
  }

  const superiorSplit = splitApellidosNombres(superior.apellidos_nombres);
  const codigoConGuion = codigo.replace(/^L(\d+)$/, "L-$1");
  const infraccionSinPunto = infraccion.infraccion.replace(/\.\s*$/, "");
  const investigadoCompleto = `${conPnp(nota.grado)} ${nota.apellidos || ""} ${nota.nombres || ""}`.replace(/\s+/g, " ").trim();

  const descargoTexto = (seleccion.descargoTexto || "").trim() ||
    "El investigado no presentó su descargo por escrito dentro del plazo de un (01) día hábil establecido por ley, conforme acta respectiva, precluyendo su derecho a la defensa en la presente etapa procedimental.";

  const hechoCompleto = `"${infraccionSinPunto}"; CASO CONCRETO: ${buildCasoConcreto(nota)}`;

  const decisionTexto =
    `Se resuelve SANCIONAR al ${investigadoCompleto}, CIP N° ${investigadoEf.cip}, perteneciente a la comisaría PNP Ventanilla, ` +
    `con ${opcion.fragmento} por la comisión de la infracción leve código ${codigoConGuion} tipificada en el Anexo I de la tabla de infracción y sanciones de la ley 30714 y sus modificatorias.`;

  const hoyISO = new Date().toISOString().slice(0, 10);

  return {
    investigado_completo: investigadoCompleto,
    hecho_completo: hechoCompleto,
    descargo_texto: descargoTexto,
    bien_juridico: ` ${infraccion.bienJuridico}. `,
    codigo_texto: `${codigoConGuion} (${infraccionSinPunto}).`,
    sancion_rango: ` ${infraccion.sancion}`,
    analisis_texto: seleccion.analisisTexto.trim(),
    decision_texto: decisionTexto,
    signer_oa: `OA-${(superior.cip || "").replace(/\D+/g, "")}`,
    signer_nombre: `${superiorSplit.nombres} ${superiorSplit.apellidos}`.replace(/\s+/g, " ").trim(),
    signer_grado: conPnp(superior.grado).toUpperCase(),
    fecha_larga_punto: `Ventanilla, ${fechaLarga(hoyISO)}.`,
    fecha_corta: fechaCorta(hoyISO),
  };
}

export async function renderizarOrdenSancionDocx(nota, efectivos, seleccion) {
  const data = construirDatosOrdenSancion(nota, efectivos, seleccion);

  const response = await fetch(new URL("../plantillas/plantilla_orden_sancion.docx", import.meta.url));
  if (!response.ok) throw new Error("No se pudo cargar la plantilla de la Orden de Sanción.");
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

export async function generarOrdenSancionDocx(nota, efectivos, seleccion) {
  const out = await renderizarOrdenSancionDocx(nota, efectivos, seleccion);
  const nombreArchivo = `ORDEN DE SANCION - ${(nota.grado || "").trim()} ${(nota.apellidos || "").trim()} ${(nota.nombres || "").trim()}.docx`.replace(/\s+/g, " ").trim();
  saveAs(out, nombreArchivo);
}
