// Cada fábrica crea una consulta nueva, con orden estable y desempate por id.
// No devuelve resultados parciales cuando una página falla.
export async function leerTodasLasPaginas(consulta, pagina = 500) {
  if (!Number.isInteger(pagina) || pagina < 1) throw new Error("Tamaño de página inválido");
  const filas = [];
  for (let desde = 0; ; ) {
    const { data, error } = await consulta().range(desde, desde + pagina - 1);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error("Respuesta de datos incompleta");
    if (!data.length) return filas;
    filas.push(...data);
    // También funciona si el servidor limita la respuesta por debajo de 500.
    desde += data.length;
  }
}

/** Una única lectura en curso; al terminar permite reintentar incluso tras errores. */
export function cargaCompartida(cargar) {
  let pendiente;
  return (...args) => {
    if (!pendiente) pendiente = Promise.resolve().then(() => cargar(...args)).finally(() => { pendiente = null; });
    return pendiente;
  };
}

// Solo listas de consulta: jamás interrumpir un formulario, modal o carga de PDF.
export function puedeActualizar({ visible, sesion, modal, editando, vista }) {
  return !!(visible && sesion && !modal && !editando &&
    ['view-dashboard', 'view-seguimiento', 'view-panel', 'view-agenda', 'view-efectivos'].includes(vista));
}
