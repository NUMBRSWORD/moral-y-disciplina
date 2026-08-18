// Funciones puras, sin ninguna dependencia externa (nada de Supabase, DOM, ni
// paquetes vía CDN) -- se separaron de imputacion.js/actaNoDescargo.js/app.js
// para que se puedan probar con `node --test` sin necesitar un navegador ni
// red. Si algo aquí deja de ser una función pura (por ejemplo, empieza a
// necesitar `document` o a llamar a la API), sácalo de este archivo.

const MESES_LARGO = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre",
];
const MESES_CORTO = [
  "ENE", "FEB", "MAR", "ABR", "MAY", "JUN",
  "JUL", "AGO", "SET", "OCT", "NOV", "DIC",
];

// Grados que se consideran parte del "grado" y no del nombre, al intentar
// ubicar en `efectivos` a la persona mencionada en un texto libre (p.ej.
// "TNTE. ZEGOBIA QUISPE Antony" o "S2 PNP RAMIREZ CANDIA").
const GRADOS = new Set([
  "GRAL", "TGRAL", "CGRAL", "CRNL", "CORONEL", "CMDTE", "CMDT", "COMANDANTE",
  "MY", "MAY", "MAYOR", "CAP", "CAPITAN", "TNTE", "TTE", "TENIENTE",
  "ALF", "ALFZ", "ALFEREZ", "SO", "SOB", "SOT", "SO1", "SO2", "SO3",
  "S1", "S2", "S3", "ST1", "ST2", "ST3", "SS", "SB", "PNP", "EST", "CADETE", "SUBOF",
]);

export function soloDigitos(s) {
  return (s || "").replace(/\D+/g, "");
}

// Añade "PNP" al grado para el sello/cuerpo del documento, sin duplicarlo:
// en `efectivos` los grados de oficiales ya vienen completos ("TENIENTE PNP"),
// mientras que los de suboficiales no lo incluyen ("S2", "ST1", etc.).
export function conPnp(grado) {
  const g = (grado || "").replace(/\.$/, "").trim();
  return /\bPNP\b$/i.test(g) ? g : `${g} PNP`.trim();
}

// Algunos registros de `efectivos` guardan apellidos_nombres con coma sin
// espacio detrás (p.ej. "ROJAS GUINEA,ALDO CANZIANI"); esto lo deja legible
// ("ROJAS GUINEA, Aldo Canziani"). Los apellidos se mantienen en mayúsculas
// (así vienen del padrón y así se usan en los documentos oficiales); los
// nombres se muestran en formato título (una mayúscula por palabra) en vez
// de heredar el TODO-MAYÚSCULAS con que están cargados en la base -- esto es
// solo para mostrar/imprimir, nunca toca el dato guardado.
export function limpiarNombreVisible(s) {
  const limpio = (s || "").replace(/,\s*/g, ", ").replace(/\s+/g, " ").trim();
  if (!limpio) return limpio;

  const tieneComa = limpio.includes(",");
  let apellidos, nombres;
  if (tieneComa) {
    const idx = limpio.indexOf(",");
    apellidos = limpio.slice(0, idx).trim();
    nombres = limpio.slice(idx + 1).trim();
  } else {
    const palabras = limpio.split(" ");
    if (palabras.length <= 2) return limpio.toUpperCase();
    apellidos = palabras.slice(0, 2).join(" ");
    nombres = palabras.slice(2).join(" ");
  }
  if (!nombres) return apellidos.toUpperCase();

  const nombresTitulo = nombres
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join(" ");

  return tieneComa ? `${apellidos.toUpperCase()}, ${nombresTitulo}` : `${apellidos.toUpperCase()} ${nombresTitulo}`;
}

export function addDays(fechaISO, dias) {
  const [y, m, d] = fechaISO.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + dias);
  return dt.toISOString().slice(0, 10);
}

export function fechaLarga(fechaISO) {
  if (!fechaISO) return "";
  const [y, m, d] = fechaISO.split("-").map(Number);
  return `${d} de ${MESES_LARGO[m - 1]} del ${y}`;
}

export function fechaCorta(fechaISO) {
  if (!fechaISO) return "";
  const [y, m, d] = fechaISO.split("-");
  return `${d}/${m}/${y}`;
}

// Formato "DDMMMAAAA" usado dentro de la narrativa del hecho, p.ej. "13JUN2026".
export function fechaCompacta(fechaISO) {
  if (!fechaISO) return "";
  const [y, m, d] = fechaISO.split("-").map(Number);
  return `${String(d).padStart(2, "0")}${MESES_CORTO[m - 1]}${y}`;
}

export function horaCorta(hora) {
  return (hora || "").slice(0, 5);
}

export function normalizarTexto(s) {
  return (s || "")
    .toUpperCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(s) {
  return normalizarTexto(s).split(" ").filter(Boolean);
}

// Ubica en `efectivos` a la persona mencionada en un texto libre, ignorando
// las palabras que sean grado y comparando el resto contra apellidos_nombres.
// Requiere al menos 2 palabras en común (p.ej. los dos apellidos).
export function buscarOficialConstato(oficialConstato, efectivos) {
  if (!oficialConstato || !efectivos?.length) return null;
  const nombreTokens = tokens(oficialConstato).filter((t) => !GRADOS.has(t));
  if (!nombreTokens.length) return null;

  let mejor = null;
  let mejorScore = 0;
  for (const ef of efectivos) {
    const efTokens = new Set(tokens(ef.apellidos_nombres));
    const score = nombreTokens.filter((t) => efTokens.has(t)).length;
    if (score > mejorScore) {
      mejorScore = score;
      mejor = ef;
    }
  }
  return mejorScore >= 2 ? mejor : null;
}

export function horasAusente(nota) {
  if (!nota.fecha_falta || !nota.hora_falta || !nota.fecha_reincorporacion || !nota.hora_reincorporacion) return null;
  const inicio = new Date(`${nota.fecha_falta}T${nota.hora_falta}`);
  const fin = new Date(`${nota.fecha_reincorporacion}T${nota.hora_reincorporacion}`);
  const ms = fin - inicio;
  if (Number.isNaN(ms) || ms < 0) return null;
  return ms / 3600000;
}

// L21: se resuelve el mismo día (hasta las 23:59 horas, menos de 24h ausente).
// L24: pasa de las 24:00 horas (cruza a otro día) pero antes de cumplir dos días (24-48h).
// G39: a partir de dos días, antes de cumplir el tercero (48-72h).
// MG32: a partir del tercer día (72h o más).
export function sugerirCodigoInfraccion(horas) {
  if (horas == null) return null;
  if (horas < 24) return "L21";
  if (horas < 48) return "L24";
  if (horas < 72) return "G39";
  return "MG32";
}

// Se construye con Date.UTC/getUTCDay (no `new Date(fechaISO + "T00:00:00")`
// con .getDay() en hora local) para que el cálculo del día de la semana no
// dependa de la zona horaria del navegador.
export function esFinDeSemana(fechaISO) {
  const [y, m, d] = fechaISO.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow === 0 || dow === 6;
}

// "Un (01) día hábil, a partir de las 08:00 horas del día siguiente hábil de notificado".
export function siguienteDiaHabil(fechaISO) {
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
