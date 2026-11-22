import { fechaLima, hoyLima } from "./fechas.js";

function grupo(clave, titulo, filas, cantidad = filas.length) {
  return {clave, titulo, filas, cantidad};
}
const porFecha = (a,b) => (a.fecha_limite || "9999").localeCompare(b.fecha_limite || "9999")
  || (a.fecha_falta || "").localeCompare(b.fecha_falta || "") || a.id.localeCompare(b.id);

export function jornada(filas, hoy = hoyLima()) {
  const abiertas = filas.filter(n => n.orden_sancion_generada_at && !n.archivo_leve_generada_at && !n.recibido_at).sort(porFecha);
  const pendientes = abiertas.filter(n => !n.reportada_at);
  const vencidas = pendientes.filter(n => n.fecha_limite && n.fecha_limite < hoy);
  const mesPrevio = new Date(hoy.slice(0,7) + "-01T12:00:00Z");
  mesPrevio.setUTCMonth(mesPrevio.getUTCMonth()-1);
  return [
    grupo("vencidas","Entregas vencidas",vencidas),
    grupo("hoy","Entregas previstas para hoy",pendientes.filter(n => n.fecha_limite === hoy)),
    grupo("confirmar","Entregas reportadas pendientes de recepción física",abiertas.filter(n => n.reportada_at)),
    grupo("sin_fecha","Entregas sin fecha límite registrada",pendientes.filter(n => !n.fecha_limite)),
    grupo("proximas","Entregas con fecha posterior",pendientes.filter(n => n.fecha_limite > hoy)),
    grupo("mes_anterior","Pendientes de faltas del mes pasado",abiertas.filter(n => n.fecha_falta?.startsWith(fechaLima(mesPrevio).slice(0,7))))
  ];
}

export function parteMensual(filas, mes) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new Error("Elija un mes válido.");
  const casos = filas.filter(n => n.fecha_falta?.startsWith(mes));
  const identificados = casos.filter(n => n.investigado_cip?.trim());
  const enMes = fecha => fecha && fechaLima(fecha).startsWith(mes);
  return [
    grupo("casos","Casos por fecha de falta",casos),
    grupo("efectivos","Efectivos distintos con CIP",identificados,new Set(identificados.map(n => n.investigado_cip.trim())).size),
    grupo("sin_cip","Casos del periodo sin CIP del investigado",casos.filter(n => !n.investigado_cip?.trim())),
    grupo("reportadas","Entregas reportadas en el mes",filas.filter(n => enMes(n.reportada_at))),
    grupo("recibidas","Recepciones físicas confirmadas en el mes",filas.filter(n => enMes(n.recibido_at)))
  ];
}

export function revisarExpediente(n, remision, admin) {
  const grupos = [];
  const agregar = (clave, titulo, detalle) => grupos.push(grupo(clave,titulo,[{...n,detalle}]));
  if (!n.archivo_nota_path) agregar("nota","Falta adjuntar la nota informativa","Verifique el archivo original de la falta.");
  if (n.archivo_leve_generada_at) {
    agregar("archivo","Archivo sin sanción registrado","Consulte la resolución y sus documentos en el expediente.");
    return grupos;
  }
  if (!n.codigo_infraccion) agregar("codigo","Código de infracción pendiente","Revise la clasificación registrada.");
  else if (!/^L/i.test(n.codigo_infraccion)) agregar("informe","Revisar el informe administrativo","Compruebe el informe correspondiente a la clasificación del caso.");
  else {
    if (!n.fecha_reincorporacion) agregar("reincorporacion","Reincorporación sin registrar","Compruebe si se ha recibido la nota de reincorporación.");
    if (!n.imputacion_generada_at) agregar("imputacion","Imputación pendiente de verificar","Revise si consta la generación de la imputación.");
    if (n.fecha_descargo && !n.archivo_descargo_path) agregar("descargo","Descargo registrado sin archivo adjunto","Contraste el registro de recepción con el escrito original.");
    if (n.imputacion_generada_at && !n.orden_sancion_generada_at) agregar("evaluacion","Evaluación pendiente","Revise las actuaciones y el descargo o acta que corresponda.");
    if (n.orden_sancion_generada_at && !n.orden_notificada_at) agregar("notificar","Notificación de la orden pendiente","Compruebe el cargo de notificación.");
    if (n.orden_sancion_generada_at && !n.archivo_orden_notificacion_path) agregar("legajo","Expediente firmado pendiente de carga","Verifique y adjunte el legajo firmado en la oficina.");
  }
  const ficha = Array.isArray(n.expedientes) ? n.expedientes[0] : n.expedientes;
  if (n.orden_sancion_generada_at) {
    agregar("dias", ficha?.dias_sancion == null ? "Días de sanción sin registrar" : "Días de sanción registrados",
      ficha?.dias_sancion == null ? "Contraste la duración con la orden firmada." : "La ficha del expediente consigna " + ficha.dias_sancion + " días.");
  }
  if (n.archivo_orden_notificacion_path) {
    for (const [clave, etiqueta] of [["numero_oficio","oficio"],["numero_ht","HT"]]) {
      const valor = String(ficha?.[clave] ?? "").trim();
      agregar(clave, "Número de " + etiqueta + (valor ? " registrado" : " pendiente de registro"),
        valor ? "Número que consta en la ficha: " + valor + "." : "Compruebe el número en el documento original.");
    }
    agregar("fisico", n.recibido_at ? "Recepción física confirmada" : "Recepción física pendiente de confirmación",
      n.recibido_at ? "Registrada el " + fechaLima(n.recibido_at) : n.reportada_at ? "El oficial ya reportó la entrega." : "Consulte la recepción en Mesa de Partes.");
    if (!admin) agregar("remision","Oficio y HT por consultar con administración","La remisión se comprueba con el registro administrativo.");
    else {
      if (!remision?.archivo_oficio_path) agregar("oficio","Oficio de remisión pendiente de adjuntar","Compruebe el documento en Recepción.");
      if (!remision?.archivo_ht_path) agregar("ht","Hoja de trámite pendiente de adjuntar","Compruebe si DIVOPUS ya devolvió la HT.");
      if (remision?.archivo_ht_path && remision.archivo_oficio_path) agregar("remitido","Oficio y HT registrados","Ambos archivos constan en la remisión.");
    }
  }
  return grupos;
}

const campos = "id,grado,apellidos,nombres,numero_nota_falta,fecha_falta,oficial_constato,oficial_constato_cip,investigado_cip,codigo_infraccion,fecha_reincorporacion,imputacion_generada_at,fecha_descargo,orden_sancion_generada_at,orden_notificada_at,archivo_leve_generada_at,archivo_nota_path,archivo_descargo_path,archivo_orden_notificacion_path";

async function leer(query) {
  const {data,error} = await query;
  if (error) throw new Error("No se pudieron verificar los registros. Revise el acceso y vuelva a consultar.");
  return data;
}

export async function consultarAgente(db, modo, {mes, id, hoy = hoyLima()} = {}) {
  if (!["jornada","expediente","parte"].includes(modo)) throw new Error("Asistente desconocido.");
  const [aprobado, accesoEntregas, admin] = await Promise.all(
    ["esta_aprobado", "tiene_mfa_verificada", "es_admin"].map(nombre => leer(db.rpc(nombre)))
  );
  if (aprobado !== true || accesoEntregas !== true)
    throw new Error("Su sesión no tiene acceso verificado a las entregas. Revise el acceso de su cuenta.");
  if (admin !== true && admin !== false) throw new Error("Perfil no verificado.");
  if (modo === "parte" && !admin) throw new Error("El parte mensual está disponible para el administrador.");
  if (modo === "expediente" && !id) throw new Error("Abra el expediente que desea revisar.");
  const cip = admin ? null : await leer(db.rpc("cip_actual"));
  if (!admin && (typeof cip !== "string" || !cip.trim())) throw new Error("La cuenta requiere un CIP aprobado.");
  if (modo === "parte" && !/^\d{4}-(0[1-9]|1[0-2])$/.test(mes)) throw new Error("Elija un mes válido.");
  const seleccion = modo === "expediente" ? campos + ",expedientes(numero_oficio,numero_ht,dias_sancion)" : campos;
  const filas = [];
  let cursor = "";
  for (;;) {
    let q = db.from("notas_informativas").select(seleccion).order("id").limit(100);
    if (!admin) q=q.eq("oficial_constato_cip",cip);
    if (modo==="expediente") q=q.eq("id",id);
    if (modo==="jornada") q=q.not("orden_sancion_generada_at","is",null).is("archivo_leve_generada_at",null);
    if (cursor) q=q.gt("id",cursor);
    const lote=await leer(q);
    if (!lote.length) break;
    const ids=lote.map(n=>n.id);
    const [control,recepcion]=await Promise.all([
      leer(db.from("control_entregas").select("nota_id,fecha_limite,reportada_at").in("nota_id",ids)),
      leer(db.from("recepciones_fisicas").select("nota_id,recibido_at").in("nota_id",ids))
    ]);
    const controles=new Map(control.map(c=>[c.nota_id,c]));
    const recibos=new Map(recepcion.map(c=>[c.nota_id,c]));
    filas.push(...lote.map(n=>({...n,...controles.get(n.id),...recibos.get(n.id)})));
    if (modo==="expediente") break;
    const siguiente=ids[ids.length-1];
    if (siguiente===cursor) throw new Error("La consulta de expedientes quedó incompleta.");
    cursor=siguiente;
  }
  if (modo==="jornada") return jornada(filas,hoy);
  if (modo==="parte") return parteMensual(filas,mes);
  if (filas.length!==1) throw new Error("Expediente no disponible para esta cuenta.");
  const r=admin && filas[0].archivo_orden_notificacion_path
    ? await leer(db.from("expedientes_remitidos").select("archivo_ht_path,archivo_oficio_path").eq("nota_id",id).maybeSingle()) : null;
  return revisarExpediente(filas[0],r,admin);
}

// La IA elige qué evidencia contesta la pregunta. Las frases y sus cifras proceden del registro.
export function redactarDesdeFuentes(modo, grupos, claves, mes) {
  const porClave=new Map(grupos.map(g=>[g.clave,g]));
  let orden=[...new Set(claves)].filter(k=>porClave.has(k));
  if (modo==="parte" || !orden.length) orden=[...new Set([...orden,...porClave.keys()])];
  const frases=orden.map(k=>{
    const g=porClave.get(k);
    if (modo==="expediente") return g.titulo+". "+g.filas[0].detalle;
    return g.titulo+": "+g.cantidad+".";
  });
  return (modo==="parte"?"Parte mensual de Moral y Disciplina · "+mes+"\n\n":"")+frases.join(" ");
}
