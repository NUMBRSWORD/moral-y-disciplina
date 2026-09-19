import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const URL = Deno.env.get("SUPABASE_URL") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY") || "";
const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:soporte@cpnp-ventanilla.local";
const APP_URL = "https://numbrsword.github.io/moral-y-disciplina/";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (!URL || !ANON || !SERVICE || !VAPID_PUBLIC || !VAPID_PRIVATE) {
    return json({ error: "El servicio de alertas aún no está configurado (faltan las claves VAPID en Supabase)." }, 503);
  }
  const authorization = req.headers.get("authorization");
  if (!authorization) return json({ error: "Debe iniciar sesión." }, 401);

  try {
    const { notaId } = await req.json();
    if (!notaId || typeof notaId !== "string") return json({ error: "Falta identificar el expediente." }, 400);

    // El usuario debe poder ver la nota (RLS) para poder disparar su alerta.
    const usuario = createClient(URL, ANON, { global: { headers: { Authorization: authorization } } });
    const { data: auth, error: authError } = await usuario.auth.getUser();
    if (authError || !auth.user) return json({ error: "Sesión no válida." }, 401);
    const { data: visible, error: visibleError } = await usuario
      .from("notas_informativas").select("id").eq("id", notaId).maybeSingle();
    if (visibleError || !visible) return json({ error: "No tiene permiso sobre este expediente." }, 403);

    const admin = createClient(URL, SERVICE);
    const { data: nota, error: notaError } = await admin
      .from("notas_informativas")
      .select("id, oficial_constato_cip, orden_sancion_generada_at, orden_notificada_at")
      .eq("id", notaId).maybeSingle();
    if (notaError || !nota) return json({ error: "No se encontró el expediente." }, 404);
    if (!nota.oficial_constato_cip || !nota.orden_sancion_generada_at || nota.orden_notificada_at) {
      return json({ enviados: 0 });
    }

    const { data: suscripciones, error: subError } = await admin
      .from("suscripciones_movil").select("id, endpoint, p256dh, auth").eq("cip", nota.oficial_constato_cip);
    if (subError) throw subError;

    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
    const payload = JSON.stringify({
      title: "Moral y Disciplina — CPNP Ventanilla",
      body: "Orden de Sanción generada: falta notificarla y subir el cargo firmado.",
      tag: `tarea-${nota.id}`,
      url: APP_URL,
    });

    let enviados = 0;
    for (const s of suscripciones || []) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
        );
        enviados++;
      } catch (error) {
        const status = Number((error as { statusCode?: number }).statusCode);
        if (status === 404 || status === 410) {
          await admin.from("suscripciones_movil").delete().eq("id", s.id);
        } else {
          console.error("No se pudo enviar la alerta móvil:", error);
        }
      }
    }
    return json({ enviados });
  } catch (error) {
    console.error(error);
    return json({ error: "No se pudo enviar la alerta móvil." }, 500);
  }
});
