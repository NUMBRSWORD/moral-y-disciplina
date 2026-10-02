// La última etapa del caso: guardarlo. Un folder manila por caso, rotulado con
// el número de su oficio de remisión, y en el sistema un legajo PDF único con
// todo lo que el caso reunió. El físico y el digital llevan el mismo código,
// así que encontrar uno lleva al otro.
//
// Los casos archivados sin sanción no tienen oficio de remisión: se rotulan con
// su número de Resolución de archivo, que la aplicación ya numera.

import { estadoDeRemision, remisionDelCaso } from "./remision.js";

/**
 * "45-2026", "045-2026" o el código completo que trae el documento
 * ("045-2026-COMOPPOL-PNP/...") -> "045-2026". Vacío si no se reconoce: un
 * folder con un número a medias es peor que uno que pide corregirlo.
 */
export function normalizarNumeroOficio(texto = "") {
  const m = String(texto || "").match(/(?:^|[^0-9])0*([0-9]{1,4})\s*-\s*(20[0-9]{2})(?![0-9])/);
  if (!m) return "";
  const correlativo = Number(m[1]);
  if (!correlativo) return "";
  return `${String(correlativo).padStart(3, "0")}-${m[2]}`;
}

/**
 * Código con el que se rotula el folder y se busca el legajo.
 * Con oficio: "OF 045-2026". Archivado sin sanción: "RES 012-2026".
 */
export function codigoDeArchivo(nota, expediente) {
  const oficio = normalizarNumeroOficio(expediente?.numero_oficio);
  if (oficio) return `OF ${oficio}`;
  if (nota?.archivo_leve_generada_at) {
    const resolucion = normalizarNumeroOficio(nota.archivo_leve_resolucion_numero);
    if (resolucion) return `RES ${resolucion}`;
  }
  return "";
}

/** El caso terminó su trámite y ya puede guardarse. */
export function listoParaArchivar(nota, remitidos = []) {
  if (!nota?.id) return false;
  if (nota.archivo_leve_generada_at) return true;
  return estadoDeRemision(nota, remitidos) === "remitido";
}

/** Los que esperan su folder: terminados y todavía sin archivar. */
export function casosPorArchivar(notas = [], remitidos = [], archivados = []) {
  const yaArchivados = new Set(archivados.map((a) => a.nota_id));
  return notas.filter((n) => listoParaArchivar(n, remitidos) && !yaArchivados.has(n.id));
}

/** Para ordenar: año y correlativo. Lo que no tiene código va al final. */
function claveDeOrden(codigo = "") {
  const m = String(codigo).match(/^(OF|RES)\s+([0-9]+)-([0-9]{4})$/);
  if (!m) return [9999, 9, 99999];
  return [Number(m[3]), m[1] === "OF" ? 0 : 1, Number(m[2])];
}

export function compararCodigos(a = "", b = "") {
  const x = claveDeOrden(a), y = claveDeOrden(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/**
 * Las piezas que se unen en el legajo, en el orden del trámite. Solo PDF: un
 * Word se ve distinto en cada equipo y no sirve como copia fiel. Lo que el caso
 * no tenga simplemente no aparece; nunca se anuncia una pieza que no existe.
 */
export function piezasDelLegajo(nota = {}, remision = null) {
  const piezas = [
    ["Nota informativa", "notas", nota.archivo_nota_path],
    ["Reincorporación", "notas", nota.archivo_reincorporacion_path],
    ["Descargo del investigado", "notas", nota.archivo_descargo_path],
    ["Expediente firmado", "notas", nota.archivo_orden_notificacion_path],
    ["Oficio de remisión", "expedientes-terminados-pnp", remision?.archivo_oficio_path],
    ["Hoja de Trámite", "expedientes-terminados-pnp", remision?.archivo_ht_path],
  ];
  return piezas
    .filter(([, , ruta]) => ruta && /\.pdf$/i.test(ruta))
    .map(([titulo, bucket, ruta]) => ({ titulo, bucket, ruta }));
}

/** Lo que va impreso en la etiqueta del folder manila. */
export function datosDelRotulo(nota = {}, archivo = {}) {
  const persona = [nota.grado, "PNP", nota.apellidos, nota.nombres]
    .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  return {
    codigo: archivo.codigo || "",
    investigado: persona,
    cip: nota.investigado_cip || nota.cip || "",
    fecha_falta: nota.fecha_falta || "",
    infraccion: nota.codigo_infraccion || "",
    ubicacion: archivo.ubicacion || "",
    folios: archivo.folios ? String(archivo.folios) : "",
  };
}

/** Lo que impide archivar, en palabras; vacío si se puede. */
export function faltaParaArchivar({ codigo = "", folios = null, piezas = [] } = {}) {
  const falta = [];
  if (!/^(OF|RES)\s+[0-9]{3,4}-20[0-9]{2}$/.test(codigo)) falta.push("el número de oficio (por ejemplo 045-2026)");
  if (!(Number.isInteger(folios) && folios > 0)) falta.push("la cantidad de folios");
  if (!piezas.length) falta.push("al menos un documento en PDF del caso");
  return falta;
}

export { remisionDelCaso };
