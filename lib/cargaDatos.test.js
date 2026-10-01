import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leerTodasLasPaginas, cargaCompartida, puedeActualizar } from './cargaDatos.js';

test('lee más de mil registros y respeta un límite menor del servidor', async () => {
  const datos=Array.from({length:1201},(_,id)=>({id}));const rangos=[];
  const recibidos=await leerTodasLasPaginas(()=>({range:async(a,b)=>{
    rangos.push([a,b]);return {data:datos.slice(a,Math.min(a+200,b+1)),error:null};
  }}));
  assert.deepEqual(recibidos,datos);assert.equal(rangos.at(-1)[0],1201);
});
test('una segunda página fallida no presenta un éxito parcial', async () => {
  await assert.rejects(leerTodasLasPaginas(()=>({range:async a=>a?{error:new Error('sin red')}:{data:[{id:1}]}})),/sin red/);
});
test('respuesta nula no se confunde con lista vacía', async () => {
  await assert.rejects(leerTodasLasPaginas(()=>({range:async()=>({data:null})})),/incompleta/);
});
test('deduplica cargas simultáneas pero no bloquea actualizaciones posteriores', async () => {
  let veces=0;const cargar=cargaCompartida(async()=>++veces);
  assert.deepEqual(await Promise.all([cargar(),cargar(),cargar()]),[1,1,1]);
  assert.equal(await cargar(),2);
});
test('permite reintentar después de un error', async () => {
  let fallo=true;const cargar=cargaCompartida(async()=>{if(fallo)throw new Error('red');return 3;});
  await assert.rejects(cargar(),/red/);fallo=false;assert.equal(await cargar(),3);
});
test('sincroniza listas sin alterar formularios, sesión cerrada ni pantallas ocultas', () => {
  const base={visible:true,sesion:true,modal:false,editando:false,vista:'view-panel'};
  assert.equal(puedeActualizar(base),true);
  for(const cambio of [{visible:false},{sesion:false},{modal:true},{editando:true},{vista:'view-nota-detail'},{vista:'view-native-cases'}])
    assert.equal(puedeActualizar({...base,...cambio}),false);
});
