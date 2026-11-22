export const etiquetas = {
  eOficio: "Número de oficio", eHt: "Hoja de trámite",
  eDias: "Días de sanción", rFecha: "Fecha de reincorporación"
};

const prefijo = /(?:\s*(?:N[.º°o*]+|Nro\.?|Número))?[\s:#–-]*/i.source;
const patrones = {
  eOficio: new RegExp("^oficio\\b" + prefijo + "(\\d[\\w./–-]*)", "i"),
  eHt: new RegExp("^(?:hoja de tr[aá]mite|h\\.?\\s*t\\.?)\\b" + prefijo + "(\\d[\\w./–-]*)", "i")
};
const meses = ["ENE","FEB","MAR","ABR","MAY","JUN","JUL","AGO","SET","OCT","NOV","DIC"];

function fechaActo(linea) {
  const m = linea.match(/(?:fecha de reincorporaci[oó]n|se (?:re)?incorpor[óo]|reincorporad[oa])(?:\s+(?:a\s+las\s+\d{1,2}:\d{2}(?:\s+horas)?|del?|el|d[ií]a|con fecha))*\s*[:.-]?\s*(\d{1,2})[\s/.-]*(\d{1,2}|[A-Z]{3})[\s/.-]*(\d{4}|\d{2})\b/i);
  if (!m) return "";
  const mes = Number(m[2]) || meses.indexOf(m[2].toUpperCase().replace("SEP","SET")) + 1;
  const anio = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const fecha = new Date(Date.UTC(anio, mes-1, Number(m[1])));
  return fecha.getUTCMonth() === mes-1 && fecha.getUTCDate() === Number(m[1]) ? fecha.toISOString().slice(0,10) : "";
}

export function candidatos(texto, campos) {
  const salida = [];
  const revocacion = /\b(revoca|anula|absuelve|dejar sin efecto|deja sin efecto)\b/i.test(texto);
  for (const original of texto.split(/\r?\n/)) {
    const linea = original.replace(/[*#|_]/g, " ").trim();
    for (const campo of campos) {
      let valor = "";
      if (patrones[campo]) valor = linea.match(patrones[campo])?.[1]?.replace(/[./–-]+$/, "") || "";
      if (campo === "rFecha") valor = fechaActo(linea);
      if (campo === "eDias" && !revocacion && !/\b(no|sin|propone|solicita|recomienda|hasta|podría)\b/i.test(linea)) {
        const m = linea.match(/(?:d[ií]as de sanci[oó]n(?: consignados| impuestos)?\s*:\s*(\d{1,3})\b|(?:se (?:le )?impone|sanci[oó]n impuesta)(?:\s+(?:la|una|sanci[oó]n|simple|de|con))*\s*:?\s*(?:[a-záéíóúñ]+\s*\((\d{1,3})\)|(\d{1,3}))\s*d[ií]as\b)/i);
        if (m && !/\d+\s*(?:a|al|[-–])\s*\d+/i.test(linea)) valor = String(Number(m[1] || m[2] || m[3]));
      }
      if (valor) salida.push({campo, valor, linea:original});
    }
  }
  return salida;
}

function negaciones(texto) {
  const palabras = texto.toLowerCase().normalize("NFC").match(/[\p{L}\p{N}]+/gu) || [];
  return palabras.flatMap((p,i) => /^(no|nunca|jamás|tampoco|sin|niego|niega)$/.test(p)
    ? [palabras.slice(i,i+3).join(" ")] : []).sort().join("|");
}

export function revisarNegaciones(glm, tesseract) {
  return !glm.trim() || !tesseract.trim() || negaciones(glm) !== negaciones(tesseract);
}

function numerosDelTexto(texto) {
  // Conserva orden, separadores y ceros iniciales de fechas, horas e identificadores.
  const compacto = texto.replace(/(\d)[ \t]*([/.:–-])[ \t]*(?=\d)/gu, "$1$2").replace(/–/gu, "-");
  return (compacto.match(/\d+(?:[/.:\-]\d+)*/gu) || []).join("|");
}

export function motivoRevisionDescargo(glm, optico, lineas) {
  if (!glm.trim() || !optico.trim()) return "Falta una segunda lectura utilizable.";
  const motivos = [];
  if (revisarNegaciones(glm, optico)) motivos.push("Las lecturas difieren en una negación o su contexto.");
  if (numerosDelTexto(glm) !== numerosDelTexto(optico)) motivos.push("Las lecturas difieren en cifras, fechas u horas.");
  const dudosos = [...new Set(lineas.flatMap(l => l.numerosDudosos || []))];
  if (dudosos.length) motivos.push("Tesseract marcó para revisión: " + dudosos.join(", ") + ".");
  return motivos.join(" ");
}
