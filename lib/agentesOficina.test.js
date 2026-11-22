import test from "node:test";
import assert from "node:assert/strict";
import { consultarAgente, jornada, parteMensual, revisarExpediente, redactarDesdeFuentes } from "./agentesOficina.js";

const nota = (id, extra={}) => ({id, fecha_falta:"2026-11-01", oficial_constato_cip:"101", investigado_cip:"999",
  orden_sancion_generada_at:"2026-11-02", ...extra});
const cantidad = (grupos, clave) => grupos.find(g => g.clave === clave).cantidad;

test("jornada prioriza fechas y conserva las entregas del mes anterior", () => {
  const grupos = jornada([nota("a",{fecha_limite:"2026-11-21",fecha_falta:"2026-10-02"}),
    nota("b",{fecha_limite:"2026-11-22"}), nota("c",{reportada_at:"2026-11-22"}),
    nota("d",{recibido_at:"2026-11-21"}),nota("e",{archivo_leve_generada_at:"2026-11-22"}),
    nota("f",{fecha_limite:"2026-11-23"}),nota("g")],"2026-11-22");
  for (const grupo of grupos) assert.equal(grupo.cantidad,1,grupo.clave);
  assert.deepEqual(grupos[0].filas.map(n=>n.id),["a"]);
});

test("parte mensual distingue casos, CIP y entregas por fecha de Lima", () => {
  const grupos = parteMensual([nota("a"),nota("b"),nota("c",{investigado_cip:null}),
    nota("d",{fecha_falta:"2026-10-01", reportada_at:"2026-11-01T03:00:00Z",recibido_at:"2026-12-01T04:59:59Z"})],"2026-11");
  assert.deepEqual(grupos.map(g=>g.cantidad),[3,1,1,0,1]);
  assert.equal(grupos.at(-1).filas[0].id,"d");
  assert.match(redactarDesdeFuentes("parte",grupos,["efectivos"],"2026-11"),/Recepciones físicas confirmadas en el mes: 1/);
});

test("revisión distingue el reporte de la recepción y respeta la remisión administrativa", () => {
  const n=nota("a",{codigo_infraccion:"L-8",archivo_orden_notificacion_path:"firmado.pdf",reportada_at:"2026-11-03"});
  const admin=revisarExpediente(n,{archivo_oficio_path:"oficio.pdf"},true);
  assert.ok(admin.some(g=>g.clave==="ht") && !admin.some(g=>g.clave==="oficio"));
  assert.match(admin.find(g=>g.clave==="fisico").titulo,/pendiente/);
  const conFicha=revisarExpediente({...n,expedientes:[{numero_oficio:"DEMO-9",dias_sancion:2}]},null,true);
  assert.match(conFicha.find(g=>g.clave==="numero_oficio").filas[0].detalle,/DEMO-9/);
  assert.match(conFicha.find(g=>g.clave==="numero_ht").titulo,/pendiente/);
  assert.match(conFicha.find(g=>g.clave==="dias").filas[0].detalle,/2 días/);
  const oficial=revisarExpediente(n,null,false);
  assert.ok(oficial.some(g=>g.clave==="remision") && !oficial.some(g=>g.clave==="ht"));
  assert.match(redactarDesdeFuentes("expediente",oficial,["inventado","fisico"],""),/oficial ya reportó/);
});

function simular({admin = false, verificada = true, errorEntrega = false} = {}) {
  const tablas = {
    notas_informativas:[nota("a"),nota("b",{oficial_constato_cip:"202"}),nota("c")],
    control_entregas:[{nota_id:"a",fecha_limite:"2026-11-22"}], recepciones_fisicas:[]
  };
  return {
    rpc:async nombre=>({data:{es_admin:admin,esta_aprobado:true,tiene_mfa_verificada:verificada,cip_actual:"101"}[nombre]}),
    from(tabla){
      let filas = tablas[tabla];
      return {
        select(){return this;}, order(){return this;}, limit(){return this;}, not(){return this;},
        is(){return this;}, eq(k,v){filas=filas.filter(n=>n[k]===v);return this;},
        gt(k,v){filas=filas.filter(n=>n[k]>v);return this;}, in(k,vs){filas=filas.filter(n=>vs.includes(n[k]));return this;},
        then(resolve){resolve({data:tabla==="notas_informativas"?filas.slice(0,1):filas,error:errorEntrega&&tabla==="control_entregas"});}
      };
    }
  };
}

test("consulta pagina con límite menor al solicitado y filtra por oficial",async()=>{
  const resultado=await consultarAgente(simular(),"jornada",{hoy:"2026-11-22"});
  assert.equal(cantidad(resultado,"hoy"),1);
  assert.deepEqual(resultado.find(g=>g.clave==="sin_fecha").filas.map(n=>n.id),["c"]);
  await assert.rejects(consultarAgente(simular(),"expediente",{id:"b"}),/no disponible/);
  await assert.rejects(consultarAgente(simular(),"parte",{mes:"2026-11"}),/administrador/);
  assert.equal(cantidad(await consultarAgente(simular({admin:true}),"parte",{mes:"2026-11"}),"casos"),3);
});

test("una sesión sin acceso o una fuente indisponible no produce un informe vacío",async()=>{
  await assert.rejects(consultarAgente(simular({verificada:false}),"jornada"),/acceso verificado/);
  await assert.rejects(consultarAgente(simular({errorEntrega:true}),"jornada"),/verificar los registros/);
});
