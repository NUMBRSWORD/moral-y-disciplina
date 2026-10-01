// Manejadores reales; transporte de pruebas sin red ni documentos personales.
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const source=await readFile(new URL('../app.js',import.meta.url),'utf8');
const bloque=source.slice(source.indexOf('let expedientesLoteFilas = []'),source.indexOf('// OFICIO DE REMISIÓN'));
function escenario(){
  const nodos=new Map(),subidas=[],registros=[];let falla=true;
  const $=id=>{
    if(!nodos.has(id))nodos.set(id,{disabled:false,classList:{add(){},remove(){}},handlers:{},
      addEventListener(e,fn){this.handlers[e]=fn;},querySelectorAll(){return [];}});
    return nodos.get(id);
  };
  const context=vm.createContext({$,console:{error(){}},state:{notas:[]},
    resumenDelLote:filas=>({total:filas.length,listos:filas.length,revisar:0,detenidos:0}),
    filasGuardables:filas=>filas,escapeHtml:String,nombreCompletoVisible:()=> 'DEMOSTRACIÓN',
    ocuparBoton:(btn,busy)=>{btn.disabled=busy;},toast(){},loadNotas:async()=>true,
    recortarPdf:async()=>new Uint8Array(),filaARegistroDeExpediente:f=>({p_nota_id:f.nota.id}),
    supabase:{storage:{from:()=>({upload:async path=>{subidas.push(path);return {};},remove:async()=>({})})},
      rpc:async(_,p)=>{registros.push(p.p_nota_id);return p.p_nota_id==='b'&&falla?{error:new Error('Fallo ficticio')}:{};}}});
  vm.runInContext(bloque,context);
  vm.runInContext(`expedientesLoteFilas=['a','b'].map(id=>({nota:{id},file:{},desde:1,hasta:2,
    nombreSugerido:id+'.pdf',archivo:id+'.pdf',confirmada:true,estado:'listo',avisos:[],datos:{dias_sancion:3}}));`,context);
  const guardar=()=>$('btnGuardarExpLote').handlers.click({currentTarget:$('btnGuardarExpLote')});
  return {context,$,subidas,registros,guardar,reparar:()=>{falla=false;}};
}
test('reintentar un lote parcialmente fallido solo sube los casos pendientes',async()=>{
  const s=escenario();await s.guardar();assert.deepEqual(s.registros,['a','b']);
  assert.equal(vm.runInContext('expedientesLoteFilas.length',s.context),1);
  s.reparar();await s.guardar();assert.deepEqual(s.registros,['a','b','b']);
  assert.equal(s.subidas.filter(p=>p.startsWith('a/')).length,1);
  assert.equal(vm.runInContext('expedientesLoteFilas.length',s.context),0);
});
test('doble clic no inicia dos cargas y libera los controles al terminar',async()=>{
  const s=escenario();await Promise.all([s.guardar(),s.guardar()]);assert.deepEqual(s.registros,['a','b']);
  for(const id of ['xlArchivo','btnGuardarExpLote','btnCerrarModalExpLote'])assert.equal(s.$(id).disabled,false);
});
