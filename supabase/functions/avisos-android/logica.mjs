// Lógica compartida por la función desplegable y las pruebas sin credenciales.
export function fechaLima(valor) {
  if (!valor) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor;
  const d = new Date(valor);
  if (!Number.isFinite(d.getTime())) return null;
  const partes = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Lima',
    year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(d);
  const parte = t => partes.find(p => p.type === t).value;
  return `${parte('year')}-${parte('month')}-${parte('day')}`;
}

export function siguienteDiaHabil(fecha) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function avisoDeNota(nota, hoy, recepcion) {
  if (!nota.oficial_constato_cip || nota.archivo_leve_generada_at) return null;
  // Solo la conformidad física explícita autoriza este aviso.
  if (recepcion?.conformidad_verificada === true && fechaLima(recepcion.recibido_at) <= hoy
      && fechaLima(recepcion.recibido_at))
    return {tipo:'documento_recibido', clave:recepcion.recibido_at};
  const creada = fechaLima(nota.created_at);
  const antiguedad = creada ? (Date.parse(hoy) - Date.parse(creada)) / 86400000 : Infinity;
  if (antiguedad >= 0 && antiguedad <= 1 && !nota.imputacion_generada_at && !nota.fecha_descargo)
    return {tipo:'caso_nuevo', clave:nota.created_at};
  const imputada = fechaLima(nota.imputacion_generada_at);
  if (imputada && imputada <= hoy && !nota.fecha_descargo && !nota.orden_sancion_generada_at) {
    const limite = siguienteDiaHabil(imputada);
    // No declara vencimiento legal: no incluye feriados ni circunstancias particulares.
    if (hoy >= limite || siguienteDiaHabil(hoy) === limite)
      return {tipo:'plazo_descargo', clave:limite};
  }
  if ((nota.orden_sancion_generada_at && !nota.orden_notificada_at)
      || (nota.fecha_reincorporacion && !nota.imputacion_generada_at))
    return {tipo:'pasos_pendientes', clave:hoy};
  return null;
}

/**
 * Solo para administradores: hay expedientes subidos (orden notificada y PDF cargado)
 * que todavía no tienen recepción física con conformidad. Mismo criterio que la lista
 * «Recepción física» de la app. No lleva cifras ni nombres: basta saber que hay algo.
 */
export function avisoAdminPorRecibir(notas, recibidas, hoy) {
  const hay = notas.some(n => n.orden_notificada_at && n.archivo_orden_notificacion_path
    && recibidas.get(n.id)?.conformidad_verificada !== true);
  return hay ? {tipo:'documentos_por_recibir', clave:hoy} : null;
}

/** INVALID_ARGUMENT puede ser un error del mensaje, no prueba de token caducado. */
export function tokenNoRegistrado(cuerpo) {
  return cuerpo?.error?.details?.some(d => d['@type'] === 'type.googleapis.com/google.firebase.fcm.v1.FcmError'
    && d.errorCode === 'UNREGISTERED') === true;
}

/** Consulta paginada y ordenada por el llamante; nunca disimula errores como lista vacía. */
export async function leerPaginas(consulta) {
  const filas = [];
  for (let desde = 0; ; desde += 100) {
    const {data, error} = await consulta(desde, desde + 99);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error('Respuesta de consulta inválida');
    filas.push(...data);
    if (data.length < 100) return filas;
  }
}
