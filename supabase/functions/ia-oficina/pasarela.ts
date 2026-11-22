// Reglas de la pasarela, sin dependencias, para poder probarlas con Node.
export const FUNCIONES_IA = new Set([
  "analizar-descargo-sancion", "asistente-md", "asistente-normativa", "extraer-nota-informativa",
  "extraer-texto-vision", "generar-resumen-casos", "redactar-analisis", "redactar-hecho-imputacion",
  "revisar-documento-ia", "sugerir-codigo-infraccion",
]);

// Cuánto se espera a la PC antes de pasar a Claude. Una Edge Function se corta a
// los ~150 s y Claude ha llegado a tardar ~85 s, así que la PC tiene a lo sumo ~55 s.
export function esperaPara(nombre: string): number {
  return nombre === "extraer-texto-vision" || nombre === "redactar-analisis" ? 55000 : 30000;
}

// true = la respuesta de la PC no sirve y hay que usar Claude. Se acepta lo que
// devuelve la pasarela: JSON con éxito, o un rechazo propio (sesión, cuota,
// datos inválidos). Un error del túnel, una página HTML, un 5xx o un tiempo
// agotado van al respaldo.
export function decidirRespaldo(status: number, contentType: string | null, texto: string): boolean {
  if (status >= 500 || status === 408 || status === 404) return true;
  if (!(contentType || "").toLowerCase().includes("application/json")) return true;
  try { JSON.parse(texto); } catch { return true; }
  return false;
}
