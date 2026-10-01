import {test} from 'node:test';
import assert from 'node:assert/strict';
import {fechaLima, avisoDeNota, avisoAdminPorRecibir, tokenNoRegistrado, leerPaginas} from '../supabase/functions/avisos-android/logica.mjs';
const nota = {id:'qa', oficial_constato_cip:'qa', created_at:'2026-09-01T12:00:00Z'};
test('Un descargo NO equivale a recepción física', () => {
  assert.equal(avisoDeNota({...nota, fecha_descargo:'2026-09-27'}, '2026-09-28'), null);
});
test('Solo conformidad explícita genera documento recibido', () => {
  const recibida = {recibido_at:'2026-09-28T15:00:00Z', conformidad_verificada:true};
  assert.equal(avisoDeNota(nota,'2026-09-28',recibida).tipo,'documento_recibido');
  assert.equal(avisoDeNota(nota,'2026-09-28',{...recibida,conformidad_verificada:false}),null);
});
test('Fecha de Lima, sin desplazar los campos date', () => {
  assert.equal(fechaLima('2026-09-26T02:00:00Z'),'2026-09-25');
  assert.equal(fechaLima('2026-09-26'),'2026-09-26');
  assert.equal(fechaLima('invalida'),null);
});
test('Aviso de plazo usa día local y salta fin de semana', () => {
  const aviso=avisoDeNota({...nota,imputacion_generada_at:'2026-09-26T02:00:00Z'},'2026-09-25');
  assert.deepEqual(aviso,{tipo:'plazo_descargo',clave:'2026-09-28'});
});
test('No anuncia un caso futuro ni uno cerrado', () => {
  assert.equal(avisoDeNota({...nota,created_at:'2027-01-01'},'2026-09-28'),null);
  assert.equal(avisoDeNota({...nota,archivo_leve_generada_at:'2026-09-28'},'2026-09-28'),null);
});
test('Un error de payload no borra dispositivos válidos', () => {
  assert.equal(tokenNoRegistrado({error:{status:'INVALID_ARGUMENT'}}),false);
  assert.equal(tokenNoRegistrado({error:{status:'NOT_FOUND'}}),false);
  assert.equal(tokenNoRegistrado({error:{details:[{'@type':'type.googleapis.com/google.firebase.fcm.v1.FcmError',errorCode:'UNREGISTERED'}]}}),true);
});
test('Lee más de 1000 filas y propaga errores de páginas intermedias',async()=>{
  const datos=Array.from({length:1205},(_,id)=>({id}));
  assert.equal((await leerPaginas(async(a,b)=>({data:datos.slice(a,b+1)}))).length,1205);
  await assert.rejects(leerPaginas(async(a,b)=>a===100?{error:new Error('sin red')}:{data:datos.slice(a,b+1)}),/sin red/);
});
test('Aviso al administrador: solo con expedientes subidos sin recepción física conforme', () => {
  const subida = {id:'a', orden_notificada_at:'2026-09-20', archivo_orden_notificacion_path:'x.pdf'};
  const vacio = new Map();
  assert.deepEqual(avisoAdminPorRecibir([subida], vacio, '2026-09-30'), {tipo:'documentos_por_recibir', clave:'2026-09-30'});
  // Sin PDF subido o sin orden notificada: todavía no hay nada que recibir.
  assert.equal(avisoAdminPorRecibir([{...subida, archivo_orden_notificacion_path:null}], vacio, '2026-09-30'), null);
  assert.equal(avisoAdminPorRecibir([{...subida, orden_notificada_at:null}], vacio, '2026-09-30'), null);
  // Con conformidad física explícita ya está recibido; sin conformidad sigue pendiente.
  assert.equal(avisoAdminPorRecibir([subida], new Map([['a',{conformidad_verificada:true}]]), '2026-09-30'), null);
  assert.equal(avisoAdminPorRecibir([subida], new Map([['a',{conformidad_verificada:false}]]), '2026-09-30').tipo, 'documentos_por_recibir');
  assert.equal(avisoAdminPorRecibir([], vacio, '2026-09-30'), null);
});
