// Decide si una nota de falta que llega en un PDF es de verdad un hecho NUEVO o
// solo el seguimiento de un expediente que ya existe (continúa faltando,
// reincorporación, corrección). Funciones puras, sin DOM ni red, para poder
// probarlas con `node --test`.
//
// Por qué existe: "Faltas (PDF grupal)" trataba TODO PDF como una falta nueva
// y su único freno era comparar el nombre contra lo ya guardado en la base.
// Eso dejaba pasar dos casos reales (2026-09-19):
//  - Un "Continúan faltos" subido en el MISMO lote que la nota que continúa:
//    la nota madre todavía no estaba en la base, así que nada la detectaba, y
//    se creó una nota independiente para el día siguiente.
//  - La nota de REINCORPORACIÓN de alguien, subida otra vez por "Faltas": su
//    N.º ya estaba guardado como reincorporación de un expediente de esa misma
//    persona, pero el chequeo de nombre lo dejó pasar porque ese expediente ya
//    estaba cerrado, y se creó una falta fantasma.

import { normalizarTexto } from "./utils.js";

// Mismos apellidos y, si ambos lados traen nombres, los mismos nombres. Los
// PDF a veces vienen sin nombres (solo apellidos), por eso un lado vacío no
// impide que coincidan.
export function mismaPersona(a, b) {
  const apellidosA = normalizarTexto(a?.apellidos);
  if (!apellidosA || apellidosA !== normalizarTexto(b?.apellidos)) return false;
  const nombresA = normalizarTexto(a?.nombres);
  const nombresB = normalizarTexto(b?.nombres);
  return !nombresA || !nombresB || nombresA === nombresB;
}

// Las entradas de "Continúan faltos" de un expediente, en orden cronológico y
// sin filas rotas. `seguimiento_faltas` es un jsonb: puede venir null.
export function entradasSeguimiento(nota) {
  const lista = Array.isArray(nota?.seguimiento_faltas) ? nota.seguimiento_faltas : [];
  return lista
    .filter((s) => s && s.fecha)
    .sort((a, b) => String(a.fecha).localeCompare(String(b.fecha)));
}

// A qué expediente ABIERTO de esta persona pertenece un "continúa faltando" que
// no trae REF. utilizable: el más reciente que no sea posterior a él, ya sea en
// la base o entre las demás filas del mismo lote (que aún no están guardadas).
// Si empatan en fecha, gana el de la base. Los "continúa" del lote nunca cuentan
// como madre de otro.
function madreProbable(entrante, propias, lote) {
  const fecha = String(entrante.fecha_falta ?? "").trim();
  const noPosterior = (x) => {
    const f = String(x.fecha_falta ?? "").trim();
    return !fecha || !f || f <= fecha;
  };
  const candidatos = [];
  for (const nota of propias) {
    if (!nota.fecha_reincorporacion && noPosterior(nota)) candidatos.push({ nota, fecha: String(nota.fecha_falta ?? "") });
  }
  for (const fila of lote) {
    if (fila === entrante || fila.esContinua || !mismaPersona(fila, entrante)) continue;
    if (noPosterior(fila)) candidatos.push({ fila, fecha: String(fila.fecha_falta ?? "") });
  }
  candidatos.sort((a, b) => b.fecha.localeCompare(a.fecha));
  return candidatos[0] || null;
}

// `entrante` es la fila leída de un PDF: { apellidos, nombres, fecha_falta,
// numero_nota_falta, referencia, esContinua }.
//  - `referencia` es el N.º de la nota a la que el PDF dice responder ("REF."),
//    si lo trae.
//  - `esContinua` indica que el texto del PDF dice que la persona "continúa
//    faltando" (es la misma señal que ya usa el lector de notas).
// `notas` son los expedientes ya guardados y `lote` las demás filas que se están
// subiendo junto con esta (puede incluir a `entrante` misma; se ignora).
//
// Devuelve null si parece una falta nueva, o { motivo, nota | fila } con la
// razón por la que NO debería crear un expediente:
//  - "reincorporacion": su N.º ya es la reincorporación de un expediente de
//    esta misma persona.
//  - "seguimiento": su N.º ya es un "Continúan faltos" de esa persona.
//  - "continuacion": es el seguimiento de una falta de esta misma persona, sea
//    porque su REF. la señala o, si no hay REF., porque el PDF dice que continúa
//    faltando y hay un expediente abierto de esa persona (en la base o en el
//    mismo lote, aunque el PDF madre venga después en la lista).
//  - "continua_sin_madre": dice que continúa faltando pero no hay ningún
//    expediente abierto de esa persona al que agregarlo.
//  - "repetida_en_lote": el mismo N.º y persona ya vienen antes en este lote.
//
// Siempre se compara contra la MISMA persona: una nota grupal reporta a varias
// bajo un solo N.º, y eso no las vuelve duplicadas entre sí.
export function clasificarNotaEntrante(entrante, notas, lote = []) {
  const numero = String(entrante?.numero_nota_falta ?? "").trim();
  const referencia = String(entrante?.referencia ?? "").trim();
  if (!numero && !referencia && !entrante?.esContinua) return null;

  const propias = (notas || []).filter((n) => mismaPersona(n, entrante));

  if (numero) {
    const comoReincorporacion = propias.find((n) => String(n.numero_nota_reincorporacion ?? "").trim() === numero);
    if (comoReincorporacion) return { motivo: "reincorporacion", nota: comoReincorporacion };
    const comoSeguimiento = propias.find((n) => entradasSeguimiento(n).some((s) => String(s.numero_nota ?? "").trim() === numero));
    if (comoSeguimiento) return { motivo: "seguimiento", nota: comoSeguimiento };
  }

  if (referencia && referencia !== numero) {
    const madre = propias.find((n) => String(n.numero_nota_falta ?? "").trim() === referencia);
    if (madre) return { motivo: "continuacion", nota: madre };
    const madreEnLote = lote.find((f) => f !== entrante
      && String(f.numero_nota_falta ?? "").trim() === referencia
      && mismaPersona(f, entrante));
    if (madreEnLote) return { motivo: "continuacion", fila: madreEnLote };
  }

  if (entrante?.esContinua) {
    const madre = madreProbable(entrante, propias, lote);
    return madre ? { motivo: "continuacion", ...(madre.nota ? { nota: madre.nota } : { fila: madre.fila }) } : { motivo: "continua_sin_madre" };
  }

  if (numero) {
    // Solo contra las filas ANTERIORES: si dos filas son la misma nota, la
    // primera se crea y la segunda es la repetida (no que se anulen entre sí).
    const posicion = lote.indexOf(entrante);
    const anterior = posicion > 0
      ? lote.slice(0, posicion).find((f) => String(f.numero_nota_falta ?? "").trim() === numero && mismaPersona(f, entrante))
      : null;
    if (anterior) return { motivo: "repetida_en_lote", fila: anterior };
  }

  return null;
}
