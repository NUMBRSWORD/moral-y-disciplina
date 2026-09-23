import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:soporte@cpnp-ventanilla.local";
const CRON_SECRET = Deno.env.get("ALERTAS_CRON_SECRET") || "";
const APP_URL = "https://numbrsword.github.io/moral-y-disciplina/";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-alertas-cron-secret",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const hoyLima = () => {
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const v = (t: string) => partes.find((p) => p.type === t)?.value || "";
  return `${v("year")}-${v("month")}-${v("day")}`;
};

const siguienteDiaHabil = (fecha: string) => {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  while ([0, 6].includes(d.getUTCDay())) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

type Nota = Record<string, string | null>;
const alertaDeNota = (nota: Nota, hoy: string) => {
  const cip = nota.oficial_constato_cip;
  if (!cip) return null;
  if (nota.orden_sancion_generada_at && !nota.orden_notificada_at) {
    return { tipo: "cargo_orden_pendiente", clave: hoy, cip, texto: "Tiene una Orden generada pendiente de notificar y registrar el cargo firmado." };
  }
  if (nota.fecha_descargo && !nota.orden_sancion_generada_at) {
    return { tipo: "analisis_orden_pendiente", clave: hoy, cip, texto: "Tiene un descargo registrado pendiente de análisis y generación de la Orden." };
  }
  if (nota.imputacion_generada_at && !nota.fecha_descargo && !nota.orden_sancion_generada_at) {
    const limite = siguienteDiaHabil(nota.imputacion_generada_at.slice(0, 10));
    if (hoy > limite) return { tipo: "plazo_descargo_vencido", clave: hoy, cip, texto: "Venció el plazo de descargo. Defina el trámite que corresponde (acta u orden)." };
    if (siguienteDiaHabil(hoy) === limite) return { tipo: "plazo_descargo_vence", clave: limite, cip, texto: "El plazo de descargo vence el siguiente día hábil." };
  }
  if (nota.fecha_reincorporacion && !nota.imputacion_generada_at) {
    return { tipo: "imputacion_pendiente", clave: hoy, cip, texto: "Tiene un expediente pendiente de generar o notificar la Imputación." };
  }
  return null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!URL || !SERVICE || !VAPID_PUBLIC || !VAPID_PRIVATE || !CRON_SECRET) {
    return json({ error: "La programación de alertas aún no está configurada (faltan secretos en Supabase)." }, 503);
  }
  if (req.headers.get("x-alertas-cron-secret") !== CRON_SECRET) return json({ error: "No autorizado." }, 403);

  try {
    const admin = createClient(URL, SERVICE);
    const hoy = hoyLima();
    const { data: notas, error: notasError } = await admin
      .from("notas_informativas")
      .select("id, oficial_constato_cip, fecha_reincorporacion, imputacion_generada_at, fecha_descargo, orden_sancion_generada_at, orden_notificada_at");
    if (notasError) throw notasError;

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
    let enviados = 0, omitidos = 0;

    for (const nota of notas || []) {
      const alerta = alertaDeNota(nota as Nota, hoy);
      if (!alerta) { omitidos++; continue; }

      const { data: anterior } = await admin
        .from("alertas_movil_enviadas").select("id")
        .eq("nota_id", nota.id).eq("tipo", alerta.tipo).eq("clave_estado", alerta.clave).maybeSingle();
      if (anterior) { omitidos++; continue; }

      const { data: subs } = await admin
        .from("suscripciones_movil").select("id, endpoint, p256dh, auth").eq("cip", alerta.cip);
      let entregas = 0;
      for (const s of subs || []) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify({ title: "Faltos — Expedientes", body: alerta.texto, tag: `alerta-${nota.id}-${alerta.tipo}-${alerta.clave}`, url: APP_URL }),
          );
          entregas++;
        } catch (error) {
          const status = Number((error as { statusCode?: number }).statusCode);
          if (status === 404 || status === 410) await admin.from("suscripciones_movil").delete().eq("id", s.id);
          else console.error("No se pudo enviar alerta automática:", error);
        }
      }
      if (entregas > 0) {
        await admin.from("alertas_movil_enviadas").insert({ nota_id: nota.id, tipo: alerta.tipo, clave_estado: alerta.clave });
        enviados += entregas;
      } else omitidos++;
    }
    return json({ fecha: hoy, enviados, omitidos });
  } catch (error) {
    console.error(error);
    return json({ error: "No se pudieron procesar las alertas automáticas." }, 500);
  }
});
