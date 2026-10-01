import "jsr:@supabase/functions-js@2.117.2/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2.117.2";
import { avisoAdminPorRecibir, avisoDeNota, fechaLima, leerPaginas, tokenNoRegistrado } from "./logica.mjs";

// Datos mínimos: usuario, tipo y un identificador opaco para evitar duplicados.
// No envía nombres, CIP, documentos ni el texto de la sanción.
const URL_SUPABASE = Deno.env.get("SUPABASE_URL") || "";
const SERVICIO = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CUENTA_FCM = Deno.env.get("FCM_CUENTA_SERVICIO") || "";
const SECRETO_CRON = Deno.env.get("AVISOS_CRON_SECRET") || "";
const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), {
  status, headers: {"Content-Type":"application/json"},
});
type Fila = Record<string, string | null>;
type Cuenta = {client_email:string; private_key:string; project_id:string};
const base64url = (datos: ArrayBuffer | string) => {
  const bytes = typeof datos === "string" ? new TextEncoder().encode(datos) : new Uint8Array(datos);
  let binario = "";
  for (const b of bytes) binario += String.fromCharCode(b);
  return btoa(binario).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");
};
async function tokenDeAcceso(cuenta: Cuenta) {
  const pem = cuenta.private_key.replace(/-----[^-]+-----/g,"").replace(/\s+/g,"");
  const bytes = Uint8Array.from(atob(pem),c=>c.charCodeAt(0));
  const clave = await crypto.subtle.importKey("pkcs8", bytes.buffer,
    {name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["sign"]);
  const ahora = Math.floor(Date.now()/1000);
  const cabecera = base64url(JSON.stringify({alg:"RS256",typ:"JWT"}));
  const cuerpo = base64url(JSON.stringify({iss:cuenta.client_email,
    scope:"https://www.googleapis.com/auth/firebase.messaging",aud:"https://oauth2.googleapis.com/token",
    iat:ahora,exp:ahora+3600}));
  const firma = await crypto.subtle.sign("RSASSA-PKCS1-v1_5",clave,new TextEncoder().encode(`${cabecera}.${cuerpo}`));
  const respuesta = await fetch("https://oauth2.googleapis.com/token",{
    method:"POST",signal:AbortSignal.timeout(20000),
    headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({grant_type:"urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion:`${cabecera}.${cuerpo}.${base64url(firma)}`}),
  });
  if (!respuesta.ok) throw new Error("Credencial de mensajería rechazada");
  const datos = await respuesta.json();
  if (!datos.access_token) throw new Error("Sin credencial de mensajería");
  return datos.access_token as string;
}
async function huella(valor:string) {
  const digest = await crypto.subtle.digest("SHA-256",new TextEncoder().encode(valor));
  return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}
function enviar(cuenta:Cuenta, acceso:string, token:string, usuario:string, tipo:string, id:string) {
  return fetch(`https://fcm.googleapis.com/v1/projects/${cuenta.project_id}/messages:send`,{
    method:"POST",signal:AbortSignal.timeout(20000),
    headers:{Authorization:`Bearer ${acceso}`,"Content-Type":"application/json"},
    body:JSON.stringify({message:{token,data:{user_id:usuario,tipo,aviso_id:id},
      android:{priority:"HIGH",ttl:"86400s"}}}),
  });
}

Deno.serve(async(req:Request)=>{
  if (req.method !== "POST") return json({error:"Use POST."},405);
  if (!SECRETO_CRON || req.headers.get("x-avisos-cron-secret") !== SECRETO_CRON)
    return json({error:"No autorizado."},403);
  if (!URL_SUPABASE || !SERVICIO || !CUENTA_FCM) return json({error:"Configuración incompleta."},503);
  try {
    const cuenta = JSON.parse(CUENTA_FCM) as Cuenta;
    const admin = createClient(URL_SUPABASE,SERVICIO,{
      auth:{persistSession:false,autoRefreshToken:false},
      global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(20000)})},
    });
    let cuerpo:Record<string,unknown> = {};
    const texto = await req.text();
    if (texto) {
      try { cuerpo = JSON.parse(texto); } catch { return json({error:"JSON inválido."},400); }
      if (!cuerpo || typeof cuerpo !== "object" || Array.isArray(cuerpo)) return json({error:"Objeto requerido."},400);
    }
    if (cuerpo.comprobar === true) {
      await tokenDeAcceso(cuenta);
      const {count,error} = await admin.from("dispositivos_android").select("token",{count:"exact",head:true});
      if (error) throw error;
      return json({credencial:"ok",proyectoFcm:cuenta.project_id,dispositivosRegistrados:count,enviado:false});
    }
    // Nunca elige automáticamente el último teléfono de producción.
    if (cuerpo.probarEnvio === true) {
      if (typeof cuerpo.usuarioPrueba !== "string" || !/^[0-9a-f-]{36}$/i.test(cuerpo.usuarioPrueba))
        return json({error:"Indique usuarioPrueba explícitamente."},400);
      const {data:perfil,error:ePerfil} = await admin.from("profiles").select("id")
        .eq("id",cuerpo.usuarioPrueba).eq("estado","aprobado").maybeSingle();
      if (ePerfil) throw ePerfil;
      if (!perfil) return json({error:"La cuenta de prueba no está aprobada."},409);
      const {data:dispositivo,error} = await admin.from("dispositivos_android").select("token,user_id")
        .eq("user_id",cuerpo.usuarioPrueba).order("actualizado_at",{ascending:false}).limit(1).maybeSingle();
      if (error) throw error;
      if (!dispositivo) return json({error:"La cuenta de prueba no tiene un teléfono registrado."},409);
      const respuesta = await enviar(cuenta,await tokenDeAcceso(cuenta),dispositivo.token,
        dispositivo.user_id,"prueba",await huella(crypto.randomUUID()));
      return json({prueba:respuesta.ok?"aceptada por FCM":"rechazada",estado:respuesta.status,
        entregaEnTelefonoVerificada:false},respuesta.ok?200:502);
    }
    const hoy = fechaLima(new Date().toISOString());
    const notas:Fila[] = await leerPaginas((a:number,b:number)=>admin.from("notas_informativas")
      .select("id,oficial_constato_cip,created_at,fecha_reincorporacion,imputacion_generada_at,fecha_descargo,orden_sancion_generada_at,orden_notificada_at,archivo_leve_generada_at,archivo_orden_notificacion_path")
      .order("id").range(a,b));
    const perfiles:Fila[] = await leerPaginas((a:number,b:number)=>admin.from("profiles")
      .select("id,cip").eq("estado","aprobado").not("cip","is",null).order("id").range(a,b));
    const dispositivos:Fila[] = await leerPaginas((a:number,b:number)=>admin.from("dispositivos_android")
      .select("token,user_id").order("token").range(a,b));
    const recepciones = await leerPaginas((a:number,b:number)=>admin.from("recepciones_fisicas")
      .select("nota_id,recibido_at,conformidad_verificada").order("nota_id").range(a,b));
    const recibidas = new Map(recepciones.map(r=>[r.nota_id,r]));
    const usuariosPorCip = new Map<string,string[]>();
    for (const p of perfiles) usuariosPorCip.set(String(p.cip),[...(usuariosPorCip.get(String(p.cip))||[]),String(p.id)]);
    const tokensPorUsuario = new Map<string,string[]>();
    for (const d of dispositivos) tokensPorUsuario.set(String(d.user_id),[...(tokensPorUsuario.get(String(d.user_id))||[]),String(d.token)]);
    let acceso:string|null = null;
    let enviados = 0, omitidos = 0, fallidos = 0, tokensRetirados = 0;
    // Un aviso por usuario y dispositivo; la reserva evita repetirlo el mismo día.
    const entregar = async (usuario:string, token:string, aviso:{tipo:string;clave:string}, evento:string) => {
      const clave = await huella(JSON.stringify([evento,aviso.tipo,aviso.clave,usuario,token]));
      const {data:reserva,error} = await admin.rpc("reservar_entrega_android",{p_clave:clave,p_usuario:usuario});
      if (error) throw error;
      if (!reserva?.reservada) { omitidos++; return; }
      try {
        if (!acceso) acceso = await tokenDeAcceso(cuenta);
        const respuesta = await enviar(cuenta,acceso,token,usuario,aviso.tipo,clave);
        if (respuesta.ok) {
          const {error:guardar} = await admin.from("entregas_android")
            .update({enviado_at:new Date().toISOString()}).eq("clave",clave).eq("intento_id",reserva.intento_id);
          if (guardar) throw guardar;
          enviados++;
        } else {
          const detalle = await respuesta.json().catch(()=>null);
          if (tokenNoRegistrado(detalle)) {
            const {error:retirar} = await admin.from("dispositivos_android").delete().eq("token",token).eq("user_id",usuario);
            if (retirar) throw retirar;
            tokensRetirados++;
          }
          fallidos++;
          // La reserva vence: un fallo temporal podrá reintentarse sin marcarlo enviado.
        }
      } catch { fallidos++; }
    };
    for (const nota of notas) {
      const aviso = avisoDeNota(nota,hoy,recibidas.get(nota.id));
      if (!aviso) { omitidos++; continue; }
      for (const usuario of usuariosPorCip.get(String(nota.oficial_constato_cip))||[]) {
        for (const token of tokensPorUsuario.get(usuario)||[]) {
          // Pendientes: un aviso por usuario/dispositivo/día, aunque tenga varios casos.
          const evento = aviso.tipo === "pasos_pendientes" ? "pendientes" : nota.id;
          await entregar(usuario,token,aviso,String(evento));
        }
      }
    }
    // Solo administradores: expedientes subidos que esperan la recepción física.
    const porRecibir = avisoAdminPorRecibir(notas,recibidas,hoy);
    if (porRecibir) {
      const administradores:Fila[] = await leerPaginas((a:number,b:number)=>admin.from("profiles")
        .select("id").eq("estado","aprobado").eq("role","admin").order("id").range(a,b));
      for (const adm of administradores) {
        for (const token of tokensPorUsuario.get(String(adm.id))||[]) {
          await entregar(String(adm.id),token,porRecibir,"por-recibir");
        }
      }
    }
    return json({fecha:hoy,aceptadosPorFcm:enviados,omitidos,fallidos,tokensRetirados},fallidos?207:200);
  } catch {
    // Ni las credenciales ni los cuerpos de error con datos de expedientes se registran.
    console.error("Fallo al procesar los avisos Android; revise configuración y migraciones.");
    return json({error:"No se pudieron procesar los avisos de Android."},500);
  }
});
