// Transporte cerrado: las escrituras y funciones no previstas fallan, nunca salen a internet.
const session={access_token:'ficticio',user:{id:'qa',email:'123456@moralydisciplina.local'}};
const personas=Array.from({length:9},(_,i)=>({id:`persona-${i}`,cip:`90000${i}`,dni:`9900000${i}`,grado:'S1',apellidos_nombres:`DEMOSTRACIÓN DE APELLIDO EXTENSO, PERSONA ${i+1}`}));
const notas=personas.map((p,i)=>({id:`caso-${i}`,grado:'S1',apellidos:'DEMOSTRACIÓN DE APELLIDO EXTENSO',nombres:`PERSONA ${i+1}`,
  numero_nota_falta:`20260930000${i}`,fecha_falta:`2026-09-${String(10+i).padStart(2,'0')}`,hora_falta:'08:00',
  codigo_infraccion:i%2?'L21':'L24',oficial_constato_cip:'123456',cip:p.cip,
  fecha_reincorporacion:i>1?'2026-09-20':null,hora_reincorporacion:'08:00',
  imputacion_generada_at:i>3?'2026-09-21T12:00:00Z':null,
  fecha_descargo:i>5?'2026-09-23':null,orden_sancion_generada_at:i>6?'2026-09-24T12:00:00Z':null,
  orden_notificada_at:i>7?'2026-09-25T12:00:00Z':null,
  archivo_orden_notificacion_path:i>7?'qa/firmado.pdf':null,sancion_dias:3,expedientes:[]}));
export function createClient(){
  return {
    auth:{onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),getSession:async()=>({data:{session}}),
      mfa:{getAuthenticatorAssuranceLevel:async()=>({data:{currentLevel:'aal2',nextLevel:'aal2'}})}},
    rpc:async name=>{
      if(['necesita_cambiar_clave','exigir_cambio_si_clave_inicial'].includes(name))return {data:false};
      if(name==='cip_actual')return {data:'123456'};
      return {data:null,error:{message:'RPC deshabilitada en QA'}};
    },
    from:table=>{
      let rows=table==='profiles'?[{role:'admin',estado:'aprobado',email:session.user.email}]:table==='notas_informativas'?notas:table==='efectivos'?personas:[];
      let single=false;
      const query={select(){return query;},order(){return query;},eq(k,v){rows=rows.filter(r=>r[k]===v||(table==='profiles'&&k==='id'));return query;},
        in(k,v){rows=rows.filter(r=>v.includes(r[k]));return query;},limit(n){rows=rows.slice(0,n);return query;},
        range(a,b){rows=rows.slice(a,b+1);return query;},single(){single=true;return query;},maybeSingle(){single=true;return query;},
        then(ok,err){return Promise.resolve({data:single?(rows[0]||null):rows,error:null}).then(ok,err);}};
      return query;
    },
    functions:{invoke:async()=>({error:{message:'Funciones deshabilitadas en QA'}})},
    storage:{from:()=>({createSignedUrl:async()=>({error:{message:'Solo datos ficticios'}})})}
  };
}
