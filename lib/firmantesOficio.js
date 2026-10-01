// Conserva los firmantes recordados por cualquiera de las dos versiones previas.
// Leer no confirma su vigencia: la pantalla exige confirmación en cada oficio.
export function leerFirmantesOficio(almacen = globalThis.localStorage) {
  try {
    const actual=JSON.parse(almacen?.getItem('faltos.oficio.firmas') || 'null');
    if(actual && typeof actual==='object' && !Array.isArray(actual)) return actual;
    const previo=JSON.parse(almacen?.getItem('oficio_remision_firmantes') || 'null');
    if(!previo || typeof previo!=='object' || Array.isArray(previo)) return {};
    return {jefeGrado:previo.jefe_grado || '',jefeNombre:previo.jefe_nombre || '',jefeCargo:previo.jefe_cargo || '',
      comisarioGrado:previo.firma_grado || '',comisarioNombre:previo.firma_nombre || '',
      comisarioOa:previo.firma_oa || '',comisarioCargo:previo.firma_cargo || ''};
  } catch { return {}; }
}
