// Ficha por persona: agrupa todos los expedientes de cada efectivo, lo busca por
// prefijo del nombre ("lop" -> todos los López) y resume cuántas veces faltó y
// cuánto tiempo acumulado. Funciones puras (sin DOM ni red) para poder probarlas
// con `node --test`.

import { tokens, horasAusente } from "./utils.js";
import { mismoEfectivo } from "./nombresNota.js";

// Agrupa las notas por persona (mismos apellidos y primer nombre, sin importar
// tildes, mayúsculas ni iniciales sueltas). Cada grupo se muestra con el grado y
// el nombre de su expediente MÁS RECIENTE, y sus notas quedan de la más nueva a
// la más antigua.
export function agruparPersonas(notas) {
  const grupos = [];
  for (const nota of notas || []) {
    let grupo = grupos.find((g) => mismoEfectivo(g.notas[0], nota));
    if (!grupo) { grupo = { notas: [] }; grupos.push(grupo); }
    grupo.notas.push(nota);
  }
  for (const g of grupos) {
    g.notas.sort((a, b) => String(b.fecha_falta ?? "").localeCompare(String(a.fecha_falta ?? "")));
    const reciente = g.notas[0];
    g.grado = reciente.grado || "";
    g.apellidos = reciente.apellidos || "";
    g.nombres = reciente.nombres || "";
  }
  return grupos;
}

// Cada palabra que escribió el usuario debe ser el INICIO de alguna palabra del
// nombre ("loz" -> LOZANO, "lopez gar" -> LOPEZ GARAY). Primero van quienes
// coinciden desde el primer apellido, luego los que más faltas tienen.
export function buscarPersonas(personas, texto, limite = 12) {
  const consulta = tokens(texto);
  if (!consulta.length || consulta.join("").length < 2) return [];
  const resultados = [];
  for (const p of personas || []) {
    const palabras = tokens(`${p.apellidos} ${p.nombres}`);
    if (!consulta.every((q) => palabras.some((w) => w.startsWith(q)))) continue;
    const primerApellido = tokens(p.apellidos)[0] || "";
    const desdeElApellido = primerApellido.startsWith(consulta[0]) ? 0 : 1;
    resultados.push({ persona: p, desdeElApellido });
  }
  resultados.sort((a, b) =>
    a.desdeElApellido - b.desdeElApellido
    || b.persona.notas.length - a.persona.notas.length
    || tokens(a.persona.apellidos).join(" ").localeCompare(tokens(b.persona.apellidos).join(" ")));
  return resultados.slice(0, limite).map((r) => r.persona);
}

const DIA_MS = 86400000;

// Horas que estuvo (o lleva) ausente en un expediente:
//  - reincorporado con hora: la diferencia exacta;
//  - reincorporado sin hora: por días completos (aproximado);
//  - sin reincorporar: desde que faltó hasta `ahora` (en curso).
export function horasDelCaso(nota, ahora = new Date()) {
  const exactas = horasAusente(nota);
  if (exactas != null) return { horas: exactas, enCurso: false, aproximado: false };
  const inicioTxt = nota.fecha_falta ? `${nota.fecha_falta}T${nota.hora_falta || "00:00:00"}` : null;
  if (!inicioTxt) return { horas: 0, enCurso: !nota.fecha_reincorporacion, aproximado: true };
  if (nota.fecha_reincorporacion) {
    const dias = (Date.parse(`${nota.fecha_reincorporacion}T00:00:00Z`) - Date.parse(`${nota.fecha_falta}T00:00:00Z`)) / DIA_MS;
    return { horas: Number.isFinite(dias) && dias > 0 ? dias * 24 : 0, enCurso: false, aproximado: true };
  }
  const ms = ahora.getTime() - new Date(inicioTxt).getTime();
  return { horas: Number.isFinite(ms) && ms > 0 ? ms / 3600000 : 0, enCurso: true, aproximado: false };
}

// "1d 23h 15m", "23h 30m", "3d 0h", "45m": días y horas (sin pasar de 24 h), y
// los minutos solo si los hay. Los minutos importan: 23:30 h es retraso (L21) y
// 24:00 h ya es L24, así que "23h" no puede esconder los 30 min.
export function formatearDuracion(horas) {
  if (!Number.isFinite(horas) || horas <= 0) return "0h";
  const totalMin = Math.round(horas * 60);
  const dias = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const min = totalMin % 60;
  if (!dias && !h) return `${min}m`;
  const base = dias ? `${dias}d ${h}h` : `${h}h`;
  return min ? `${base} ${min}m` : base;
}

// Valor especial del selector de período: suma TODAS las faltas, sin límite de mes.
export const PERIODO_TODO = "todo";

// Quiénes faltaron en un mes ("2026-09") o, con PERIODO_TODO, en todo el tiempo
// (así los retrasos de meses distintos se acumulan): una fila por efectivo, con cuántas
// faltas, en qué fechas y cuánto tiempo acumulado SOLO de ese mes, de quien más
// faltó a quien menos. Usa la misma agrupación que la ficha, así los números del
// Resumen mensual y de Seguimiento no se contradicen.
export function resumenDelMes(notas, ym, ahora = new Date()) {
  const delMes = (notas || []).filter((n) =>
    ym === PERIODO_TODO ? !!n.fecha_falta : String(n.fecha_falta ?? "").slice(0, 7) === ym);
  const efectivos = agruparPersonas(delMes).map((g) => {
    const r = resumenPersona(g.notas, ahora);
    const fechas = [...new Set(g.notas.map((n) => n.fecha_falta).filter(Boolean))].sort();
    return { grado: g.grado, apellidos: g.apellidos, nombres: g.nombres, notas: g.notas, fechas, ...r };
  });
  efectivos.sort((a, b) =>
    b.faltas - a.faltas
    || b.horasTotales - a.horasTotales
    || tokens(a.apellidos).join(" ").localeCompare(tokens(b.apellidos).join(" ")));
  return { total: delMes.length, efectivos };
}

// Números de la ficha: cuántas veces faltó, cuánto acumulado, cuántos casos siguen
// en trámite, cuántos llevaron sanción y el desglose por código de infracción.
export function resumenPersona(notas, ahora = new Date()) {
  const lista = notas || [];
  let horasTotales = 0;
  let enCurso = 0;
  let aproximado = false;
  const porCodigo = {};
  for (const n of lista) {
    const h = horasDelCaso(n, ahora);
    horasTotales += h.horas;
    if (h.enCurso) enCurso += 1;
    if (h.aproximado) aproximado = true;
    const codigo = String(n.codigo_infraccion || "").trim().toUpperCase().replace(/\s+/g, "") || "(sin código)";
    porCodigo[codigo] = (porCodigo[codigo] || 0) + 1;
  }
  const fechas = lista.map((n) => n.fecha_falta).filter(Boolean).sort();
  return {
    faltas: lista.length,
    horasTotales,
    duracion: formatearDuracion(horasTotales),
    aproximado,
    enCurso,
    sinReincorporar: lista.filter((n) => !n.fecha_reincorporacion).length,
    conSancion: lista.filter((n) => n.orden_sancion_generada_at).length,
    porCodigo,
    primeraFalta: fechas[0] || null,
    ultimaFalta: fechas[fechas.length - 1] || null,
  };
}
