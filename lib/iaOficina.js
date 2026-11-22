const funciones = new Set([
  "analizar-descargo-sancion",
  "asistente-md",
  "asistente-normativa",
  "extraer-nota-informativa",
  "extraer-texto-vision",
  "generar-resumen-casos",
  "redactar-analisis",
  "redactar-hecho-imputacion",
  "revisar-documento-ia",
  "sugerir-codigo-infraccion"
]);
export function transporteIA(urlProyecto) {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    const nombre = url.pathname.split('/').pop();
    if (url.origin !== urlProyecto || url.pathname !== '/functions/v1/' + nombre || !funciones.has(nombre)) {
      return fetch(input, init);
    }
    const local = ['localhost','127.0.0.1'].includes(location.hostname);
    const destino = local ? location.origin + '/ia/' + nombre : urlProyecto + '/functions/v1/ia-oficina/' + nombre;
    const solicitud = new Request(input, init);
    return fetch(destino, {method:solicitud.method, headers:solicitud.headers, body:await solicitud.arrayBuffer(),
      signal:solicitud.signal, redirect:"error", credentials:"omit", cache:"no-store"});
  };
}
