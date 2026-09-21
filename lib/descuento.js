// Descuento por inasistencia que se requiere a DIRREHUM. La app no descuenta
// nada: solo calcula lo que va en el requerimiento. Funciones puras (sin DOM ni
// red) para poder probarlas con `node --test`.
//
// DIRREHUM paga por DÍAS efectivamente laborados (D.S. 016-2025-IN, Tercera
// Disposición Complementaria Final), así que el descuento es POR DÍA FALTADO:
//     remuneración del grado ÷ 30 × días faltados
// Un día faltado se completa cada 24:00 h de ausencia ACUMULADA (las horas de
// varias faltas se suman: 23:30 + 23:30 = 47:00 h = 1 día, y sobran 23:00 h que
// no cuentan hasta completar otro día). Las horas son las de horasDelCaso:
// exactas si hay hora de falta y de reincorporación; por días completos si
// falta alguna hora; y hasta ahora si aún no se reincorpora.
//
// Esto es SOLO para el descuento: no cambia la infracción. Cada falta conserva
// su propio código (dos faltas de 23:30 h siguen siendo dos L21, no una G39).

import { horasDelCaso } from "./personas.js";

// Remuneración mensual por grado. El descuento se calcula SOLO sobre la
// remuneración (indicación del usuario, 21-sep-2026), sin la bonificación por
// riesgo de vida de S/ 1 200 (total percibido = remuneración + 1 200: S1 4223.96,
// S2 4167.87, S3 4124.82). Son montos de la escala por grado, no datos de una
// persona, así que pueden vivir en el código; si cambian, se editan aquí. Un
// grado que no esté en la lista NO se calcula (no se inventa un monto).
export const REMUNERACION = {
  S1: 3023.96,
  S2: 2967.87,
  S3: 2924.82,
};
export const DIAS_MES = 30;

// El informe a DIRREHUM rige desde setiembre 2026: el acumulado empieza ahí y los
// meses anteriores no llevan descuento.
export const INICIO_INFORME = "2026-09-01";
// Solo se muestra descuento a quien ya completó al menos este número de días
// (un día = 24:00 h acumuladas), para no dar un monto de alguien que no llega.
export const DIAS_MINIMOS = 1;

export function cumpleMinimo(descuento) {
  return (descuento?.dias ?? 0) >= DIAS_MINIMOS;
}
const MIN_DIA = 24 * 60;

// "S2", "s2 pnp", "S2 PNP" -> "S2"
export function claveGrado(grado) {
  return String(grado ?? "").toUpperCase().replace(/\bPNP\b/g, "").replace(/[^A-Z0-9]/g, "");
}

export function montoMensual(grado) {
  return REMUNERACION[claveGrado(grado)] ?? null;
}

const aCentimos = (n) => Math.round(n * 100) / 100;

// De la más antigua a la más reciente; los expedientes sin fecha, al final.
function porFecha(a, b) {
  const ka = a?.fecha_falta ? `${a.fecha_falta}T${a.hora_falta || "00:00:00"}` : "9999";
  const kb = b?.fecha_falta ? `${b.fecha_falta}T${b.hora_falta || "00:00:00"}` : "9999";
  return ka < kb ? -1 : ka > kb ? 1 : 0;
}

// Descuento de una persona a partir de sus expedientes (los del período que se
// esté mirando: las horas se acumulan dentro de él).
//  - dias: días faltados completos (cada 24:00 h acumuladas).
//  - minutosSobrantes: lo que falta para el siguiente día; todavía no descuenta.
//  - monto: suma de esos días, cada uno al haber del grado que tenía la persona
//    en la falta que lo completó (por si la ascendieron en el período).
//  - diasSinMonto / gradosSinMonto: días completados con un grado sin monto
//    cargado; no se suman ni se inventan: quedan como INDETERMINADO.
// Se acumula en minutos enteros (las horas se registran en hh:mm) para que 24:00
// exactas no se pierdan por decimales.
export function descuentoDeNotas(notas, ahora = new Date()) {
  let minutos = 0;
  let dias = 0;
  let diasSinMonto = 0;
  let monto = 0;
  const gradosSinMonto = new Set();
  for (const nota of [...(notas || [])].sort(porFecha)) {
    minutos += Math.round(horasDelCaso(nota, ahora).horas * 60);
    const nuevos = Math.floor(minutos / MIN_DIA) - dias;
    if (nuevos <= 0) continue;
    dias += nuevos;
    const total = montoMensual(nota?.grado);
    if (total == null) {
      diasSinMonto += nuevos;
      gradosSinMonto.add(claveGrado(nota?.grado) || "(sin grado)");
    } else {
      monto += (total / DIAS_MES) * nuevos; // `total` es la remuneración del grado
    }
  }
  return { monto: aCentimos(monto), dias, minutosSobrantes: minutos - dias * MIN_DIA, diasSinMonto, gradosSinMonto: [...gradosSinMonto] };
}

export const INDETERMINADO = "INDETERMINADO";

// Texto del descuento: "S/ 138.93", "INDETERMINADO" si NINGÚN día tiene monto de
// grado, o "S/ 138.93 + INDETERMINADO" si solo algunos. Es lo que se ve hasta
// que se cargue el monto del grado que falta.
export function textoDescuento({ monto, dias, diasSinMonto }) {
  if (!diasSinMonto) return formatearSoles(monto);
  if (diasSinMonto >= dias) return INDETERMINADO;
  return `${formatearSoles(monto)} + ${INDETERMINADO}`;
}

// "1 día", "2 días", "0 días"
export function textoDias(dias) {
  return `${dias} ${dias === 1 ? "día" : "días"}`;
}

// "S/ 4,382.05" (siempre 2 decimales, miles con coma; no depende del idioma
// del navegador).
export function formatearSoles(monto) {
  const n = Number.isFinite(monto) ? monto : 0;
  const [entero, dec] = Math.abs(n).toFixed(2).split(".");
  return `${n < 0 ? "-" : ""}S/ ${entero.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${dec}`;
}
