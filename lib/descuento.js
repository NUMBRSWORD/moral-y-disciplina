// Descuento por inasistencia que se requiere a DIRREHUM. La app no descuenta
// nada: solo calcula el monto que va en el requerimiento. Funciones puras (sin
// DOM ni red) para poder probarlas con `node --test`.
//
// Fórmula (una por falta, con el grado que tenía el efectivo en esa falta):
//     total percibido del grado ÷ 30 ÷ 24 × horas de ausencia
// o sea, días de ausencia (con fracción) × el haber de un día. Las horas son las
// de horasDelCaso: exactas si hay hora de falta y de reincorporación; por días
// completos si falta alguna hora; y hasta ahora si aún no se reincorpora.

import { horasDelCaso } from "./personas.js";

// Total percibido mensual por grado = remuneración consolidada + bonificación
// por riesgo de vida (S/ 1 200). Son montos de la escala por grado, no datos de
// una persona, así que pueden vivir en el código; si cambian, se editan aquí.
// Un grado que no esté en la lista NO se calcula (no se inventa un monto).
// PENDIENTE DE CONFIRMAR (S1): el dato original decía "total 4323.96" pero
// 3023.96 + 1200 = 4223.96; se usa la suma de los componentes.
export const TOTAL_PERCIBIDO = {
  S1: 4223.96, // 3023.96 + 1200
  S2: 4167.87, // 2967.87 + 1200
  S3: 4124.82, // 2924.82 + 1200
};
export const DIAS_MES = 30;

// "S2", "s2 pnp", "S2 PNP" -> "S2"
export function claveGrado(grado) {
  return String(grado ?? "").toUpperCase().replace(/\bPNP\b/g, "").replace(/[^A-Z0-9]/g, "");
}

export function montoMensual(grado) {
  return TOTAL_PERCIBIDO[claveGrado(grado)] ?? null;
}

const aCentimos = (n) => Math.round(n * 100) / 100;

// Descuento de un solo expediente; null si su grado no tiene monto cargado.
export function descuentoDelCaso(nota, ahora = new Date()) {
  const total = montoMensual(nota?.grado);
  if (total == null) return null;
  const { horas } = horasDelCaso(nota, ahora);
  return aCentimos((total / DIAS_MES / 24) * horas);
}

// Suma los expedientes de una persona. Los que no tienen monto para su grado no
// se suman: se cuentan aparte para avisarlo en vez de ocultarlos.
export function descuentoDeNotas(notas, ahora = new Date()) {
  let monto = 0;
  let sinMonto = 0;
  const gradosSinMonto = new Set();
  for (const n of notas || []) {
    const d = descuentoDelCaso(n, ahora);
    if (d == null) { sinMonto += 1; gradosSinMonto.add(claveGrado(n?.grado) || "(sin grado)"); continue; }
    monto += d;
  }
  return { monto: aCentimos(monto), sinMonto, gradosSinMonto: [...gradosSinMonto] };
}

// "S/ 4,382.05" (siempre 2 decimales, miles con coma; no depende del idioma
// del navegador).
export function formatearSoles(monto) {
  const n = Number.isFinite(monto) ? monto : 0;
  const [entero, dec] = Math.abs(n).toFixed(2).split(".");
  return `${n < 0 ? "-" : ""}S/ ${entero.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${dec}`;
}
