// Lectura de la lista de personal de una nota informativa por lo que dice el
// TEXTO, como red de seguridad de la IA. Funciones puras (sin DOM ni red) para
// poder probarlas con `node --test`.
//
// Por qué existe: en una reincorporación grupal la lista puede venir sin coma
// entre un efectivo y el siguiente ("... Marcos R.P S2 PNP MENDOZA RAMOS
// ..."). Ni la IA ni el lector por patrones separaron bien ese caso y se
// saltaron a una persona: quedó sin reincorporar y la nota "no la reconocía".
// Aquí cada "GRADO PNP" abre un efectivo nuevo, haya o no coma antes.

import { tokens } from "./utils.js";

const GRADOS_PNP = "S[1-3]|ST[1-3]|SO[1-3]?|SB|SS|TNTE|TTE|CAP|MAY|ALFZ|ALF|CMDTE|CMDT|CRNL|GRAL";
const MARCA_GRADO = new RegExp(`\\b(${GRADOS_PNP})\\.?\\s+PNP\\.?\\s+`, "gi");

// El párrafo que nombra a los reincorporados: desde "da cuenta que" hasta el
// verbo ("se reincorporaron", "quienes se encontraban..."). Sin ese párrafo
// devuelve "" y no se agrega a nadie (así no se cuela quien firma la nota).
export function bloqueReincorporados(texto) {
  const t = String(texto || "").replace(/\s+/g, " ");
  const m = t.match(/da\s+cuenta\s+que\s+([\s\S]*?)\s*,?\s+(?:se\s+reincorpor|quienes\b|se\s+present|regres)/i);
  return m ? m[1] : "";
}

// "LUNA ROJAS Marcos R.P" -> apellidos en MAYÚSCULAS (hasta 4 palabras),
// luego los nombres ("Marcos") y las iniciales sueltas ("R.P"). Una coma
// cierra al efectivo; una palabra en minúscula ("y", "se", "pertenecientes")
// cierra los nombres.
function separarNombre(tramo) {
  const primero = String(tramo).split(/[,;]/)[0];
  const palabras = primero.trim().split(" ").filter(Boolean);
  const apellidos = [];
  let i = 0;
  while (i < palabras.length && apellidos.length < 4 && /^[A-ZÁÉÍÓÚÜÑ]{2,}$/.test(palabras[i])) apellidos.push(palabras[i++]);
  if (!apellidos.length) return null;
  const nombres = [];
  while (i < palabras.length && /^(?:[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+|[A-Z]\.?(?:[A-Z]\.?)?)$/.test(palabras[i])) nombres.push(palabras[i++]);
  return { apellidos: apellidos.join(" "), nombres: nombres.join(" ") };
}

export function personalPNPEnTexto(bloque) {
  const t = String(bloque || "").replace(/\s+/g, " ");
  const marcas = [...t.matchAll(MARCA_GRADO)];
  const personas = [];
  marcas.forEach((m, i) => {
    const inicio = m.index + m[0].length;
    const fin = i + 1 < marcas.length ? marcas[i + 1].index : t.length;
    const persona = separarNombre(t.slice(inicio, fin));
    if (persona) personas.push({ grado: m[1].toUpperCase(), ...persona });
  });
  return personas;
}

// ¿Es el mismo efectivo? Mismos apellidos (o los de uno contenidos en los del
// otro, si son al menos dos) y, si ambos traen nombres, el mismo primer nombre.
// Tolera "Marcos" vs "Marcos R.P" y tildes/ñ.
export function mismoEfectivo(a, b) {
  const ta = tokens(a?.apellidos);
  const tb = tokens(b?.apellidos);
  if (!ta.length || !tb.length) return false;
  const [menor, mayor] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  const apellidosOk = menor.length === mayor.length
    ? menor.every((t) => mayor.includes(t))
    : menor.length >= 2 && menor.every((t) => mayor.includes(t));
  if (!apellidosOk) return false;
  const na = tokens(a?.nombres)[0];
  const nb = tokens(b?.nombres)[0];
  return !na || !nb || na === nb;
}

// Suma a la lista de la IA a quienes el texto nombra y ella se saltó.
export function completarCandidatos(candidatos, personasTexto) {
  const lista = [...(candidatos || [])];
  for (const p of personasTexto || []) {
    if (!lista.some((c) => mismoEfectivo(c, p))) lista.push({ grado: p.grado, apellidos: p.apellidos, nombres: p.nombres });
  }
  return lista;
}

// Para quien no tiene una falta pendiente: ¿ya está reincorporado? Devuelve
// { nota, mismaNota } -- mismaNota = ya se registró con ESTA misma nota de
// reincorporación (subir el mismo PDF dos veces) -- o null si no hay ninguna.
export function buscarReincorporada(notas, candidato, { numeroNota, fecha } = {}) {
  const cerradas = (notas || []).filter((n) => n.fecha_reincorporacion && mismoEfectivo(n, candidato));
  if (!cerradas.length) return null;
  const numero = String(numeroNota ?? "").trim();
  const misma = numero ? cerradas.find((n) => String(n.numero_nota_reincorporacion ?? "").trim() === numero) : null;
  if (misma) return { nota: misma, mismaNota: true };
  const porFecha = fecha ? cerradas.find((n) => n.fecha_reincorporacion === fecha) : null;
  const masReciente = cerradas.slice().sort((a, b) => String(b.fecha_falta).localeCompare(String(a.fecha_falta)))[0];
  return { nota: porFecha || masReciente, mismaNota: false };
}
