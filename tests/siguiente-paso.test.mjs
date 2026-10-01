import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {esperaOficio,esperaHojaDeTramite} from '../lib/remision.js';
const app=await readFile(new URL('../app.js',import.meta.url),'utf8');
const block=app.slice(app.indexOf('function siguienteAccionNotaHtml('),app.indexOf('// Guía del trámite:'));
function siguiente(nota,admin=false,remisiones=[]){
  const context=vm.createContext({nota,admin,state:{remisiones},esperaOficio,esperaHojaDeTramite,
    plazoDescargoVencido:()=>true,svgIco:()=>'',escapeHtml:String,INFRACCIONES_GRAVES:{}});
  return vm.runInContext(block+';siguienteAccionNotaHtml(nota,admin,false)',context);
}
const cerrada={id:'qa',codigo_infraccion:'L21',orden_sancion_generada_at:'2026-09-24',
  orden_notificada_at:'2026-09-25',archivo_orden_notificacion_path:'qa.pdf'};
test('un expediente subido no vuelve a evaluación ni afirma recepción física',()=>{
  assert.match(siguiente(cerrada),/Expediente subido/);
  assert.match(siguiente(cerrada),/no confirma/);
  assert.doesNotMatch(siguiente(cerrada),/Complete la evaluación|Registre la reincorporación/);
});
test('administrador recibe el paso de remisión que corresponde',()=>{
  assert.match(siguiente(cerrada,true),/Genere el oficio de remisión/);
  assert.match(siguiente(cerrada,true,[{nota_id:'qa',archivo_oficio_path:'of.pdf'}]),/Adjunte la Hoja de Trámite/);
});
test('orden generada pide el PDF, archivo sin sanción permanece concluido',()=>{
  assert.match(siguiente({...cerrada,orden_notificada_at:null}),/Cargue el expediente firmado/);
  assert.match(siguiente({archivo_leve_generada_at:'2026-09-25'}),/Trámite concluido \(archivado\)/);
});
