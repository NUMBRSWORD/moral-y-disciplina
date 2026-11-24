// Lectura de la lista de personal de una nota informativa por lo que dice el
// TEXTO, como red de seguridad de la IA. Funciones puras (sin DOM ni red) para
// poder probarlas con `node --test`.
//
// Por qué existe: en una reincorporación grupal la lista puede venir sin coma
// entre un efectivo y el siguiente ("... Marcos R.P S2 PNP MENDOZA RAMOS
// ..."). Ni la IA ni el lector por patrones separaron bien ese caso y se
// saltaron a una persona: quedó sin reincorporar y la nota "no la reconocía".
// Aquí cada "GRADO PNP" abre un efectivo nuevo, haya o no coma antes.

import { tokens, claveNombre } from "./utils.js";

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

// ---------- A qué falta pendiente pertenece una reincorporación ----------

// Letras cambiadas, de más o de menos entre a y b (corta apenas pasa el tope).
function distancia(a, b, tope) {
  if (Math.abs(a.length - b.length) > tope) return tope + 1;
  let previa = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const fila = [i];
    let menor = i;
    for (let j = 1; j <= b.length; j++) {
      fila[j] = Math.min(previa[j] + 1, fila[j - 1] + 1, previa[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (fila[j] < menor) menor = fila[j];
    }
    if (menor > tope) return tope + 1;
    previa = fila;
  }
  return previa[b.length];
}

// Mismos apellidos, o que solo difieren en UNA letra mal leída por la IA
// ("GUEVARRA" / "GUEVARA", "PHAJSE" / "PHAISE"). Con menos de 8 letras se
// exige igualdad, para no confundir apellidos cortos parecidos.
export function apellidosParecidos(a, b) {
  const ka = claveNombre(a);
  const kb = claveNombre(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  return Math.min(ka.length, kb.length) >= 8 && distancia(ka, kb, 1) <= 1;
}

const unica = (lista) => (lista.length === 1 ? lista[0] : null);

// Nombre completo exacto; si no, apellidos exactos; y si no, apellidos con
// una letra de diferencia. Siempre debe quedar UNA sola nota: con dos
// posibles no se adivina. (La vista previa muestra "por nombre" y el usuario
// confirma antes de guardar.)
function porNombre(pool, candidato) {
  const completo = claveNombre(candidato.apellidos, candidato.nombres);
  const apellidos = claveNombre(candidato.apellidos);
  return unica(pool.filter((n) => claveNombre(n.apellidos, n.nombres) === completo))
    || unica(pool.filter((n) => claveNombre(n.apellidos) === apellidos))
    || unica(pool.filter((n) => apellidosParecidos(n.apellidos, candidato.apellidos)));
}

// Elige la falta pendiente (sin reincorporación) que cierra esta persona.
// El N.º de la falta (REF. del PDF) manda, pero una falta grupal tiene una
// fila por efectivo con el MISMO N.º: entonces se decide por el nombre.
// Antes, si en esa nota quedaba UNA sola persona pendiente, se le asignaba a
// cualquiera que trajera ese REF. -- al volver a subir el PDF grupal, los
// compañeros ya reincorporados caían sobre la nota del único pendiente.
export function elegirNotaPendiente(notas, numeroFaltaRef, candidato) {
  const todas = notas || [];
  const pendientes = todas.filter((n) => !n.fecha_reincorporacion);
  if (numeroFaltaRef) {
    const delGrupo = todas.filter((n) => n.numero_nota_falta === numeroFaltaRef);
    const porNumero = pendientes.filter((n) => n.numero_nota_falta === numeroFaltaRef);
    if (porNumero.length) {
      if (!candidato) return unica(porNumero);
      const nota = porNombre(porNumero, candidato);
      if (nota) return nota;
      // Nota de falta de una sola persona: el N.º basta aunque el nombre se leyera mal.
      return porNumero.length === 1 && delGrupo.length === 1 ? porNumero[0] : null;
    }
    if (!candidato) return null;
    // Está en esa nota pero ya se reincorporó: no se le busca otra falta suya.
    if (delGrupo.some((n) => apellidosParecidos(n.apellidos, candidato.apellidos))) return null;
  } else if (!candidato) {
    return unica(pendientes);
  }
  // Sin REF. (hay notas que lo traen vacío) o con un REF. que no está en Faltos.
  return porNombre(pendientes, candidato);
}

// ---------- Quién constató la falta ----------

// En la nota de falta, el Comisario "da cuenta" y quien pasó lista es otro
// oficial: "el Comisario (e) ..., MAY. PNP ROJAS GUINEA ..., da cuenta que, el
// ALFZ. PNP PULIDO JORGE Renzo Tedy, al pasar lista al personal ..., constató
// la ausencia". El que constató es el ALFZ, no el Mayor. La IA local a veces
// toma al primero que aparece, así que se lee esa frase directo del texto.
// Devuelve null si la nota no la trae (entonces se usa lo que dijo la IA).
const PASO_LISTA = new RegExp(
  String.raw`da\s+cuenta\s+(?:de\s+)?que\s*,?\s*(?:el|la)\s+` +
  String.raw`((?:${GRADOS_PNP})\.?\s*PNP\.?\s+.{3,80}?)` +
  String.raw`\s*,?\s+(?:quien(?:es)?\s+)?al\s+pasar\s+(?:lista|revista)`,
  "i",
);

export function oficialQuePasoLista(texto) {
  const m = String(texto || "").replace(/\s+/g, " ").match(PASO_LISTA);
  return m ? m[1].replace(/[,;]+$/, "").replace(/\s+/g, " ").trim() : null;
}
