import {test} from 'node:test';
import assert from 'node:assert/strict';
import {leerFirmantesOficio} from './firmantesOficio.js';
test('recupera datos de combinado sin confirmar automáticamente su vigencia',()=>{
  const previo={jefe_nombre:'JEFE DEMO',firma_nombre:'FIRMANTE DEMO',firma_oa:'OA-000000'};
  const almacen={getItem:k=>k==='oficio_remision_firmantes'?JSON.stringify(previo):null};
  const datos=leerFirmantesOficio(almacen);
  assert.equal(datos.jefeNombre,previo.jefe_nombre);
  assert.equal(datos.comisarioNombre,previo.firma_nombre);
  assert.equal(datos.comisarioOa,previo.firma_oa);
  assert.equal(datos.confirmado,undefined);
});
test('prefiere datos actuales y tolera almacenamiento ausente o inválido',()=>{
  assert.equal(leerFirmantesOficio({getItem:()=>'{"jefeNombre":"ACTUAL"}'}).jefeNombre,'ACTUAL');
  assert.deepEqual(leerFirmantesOficio({getItem:()=>'{'}),{});
  assert.deepEqual(leerFirmantesOficio(null),{});
});
