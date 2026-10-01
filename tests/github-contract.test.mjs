// Comprueba la web que se entrega con esta misma revisión, sin checkout externo.
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const html=await readFile(new URL('index.html',root),'utf8');
const js=await readFile(new URL('app.js',root),'utf8');
for(const name of ['onAuthed','loadProfile','loadNotas','showView','openNotaDetail','renderPanel','abrirCambioClave'])
  assert.match(js,new RegExp('function '+name+'\\s*\\('),`Contrato de función: ${name}`);
for(const name of ['cumplimiento','seguimiento','efectivos','panel','roles','directivas','agenda','documentos','historial']){
  assert.ok(html.includes(`data-view="${name}"`),`Pestaña: ${name}`);
  assert.ok(html.includes(`id="view-${name}"`),`Vista: ${name}`);
}
for(const id of ['view-token','modalCambiarClave','btnVolverDashboard','btnFaltasLote','flArchivo','modalFaltasLote',
  'btnReincorporacionLote','rlArchivo','modalReincorporacionLote','btnContinuanFaltosLote','cfArchivo','modalContinuanFaltosLote',
  'btnExpedientesLote','xlArchivo','modalExpedientesLote'])
  assert.ok(html.includes(`id="${id}"`),`Elemento: ${id}`);
for(const rpc of ['necesita_cambiar_clave','confirmar_cambio_clave'])assert.ok(js.includes(`"${rpc}"`),`RPC: ${rpc}`);
assert.match(js,/state\.notas\s*=\s*data\s*\|\|\s*\[\]/,'Detectar carga completa de notas');
const config=await readFile(new URL('config.js',root),'utf8');
const contract=JSON.parse(await readFile(new URL('web-contract.json',root),'utf8'));
const servidor=/https:\/\/[a-z0-9]+\.supabase\.co/;
assert.equal(config.match(servidor)?.[0],contract.supabaseUrl,'Backend web canónico');
const native=new URL('app/src/main/java/com/hidalgoferrai/myapplication/',root);
if(existsSync(new URL('ConfigSupabase.java',native))){
  const auth=await readFile(new URL('ConfigSupabase.java',native),'utf8');
  const web=await readFile(new URL('WebActivity.java',native),'utf8');
  assert.equal(auth.match(servidor)?.[0],contract.supabaseUrl,'Backend idéntico en Android');
  assert.ok(web.includes(`URL_APP = "${contract.webUrl}"`),'Android abre la web canónica');
}
for(const campo of ['registrar_notificacion_orden','archivo_orden_notificacion_path','orden_notificada_at'])
  assert.ok(js.includes(campo),`Registro canónico del expediente: ${campo}`);
console.log('Contrato de funciones, vistas, formularios y seguridad compatible con el checkout auditado.');
