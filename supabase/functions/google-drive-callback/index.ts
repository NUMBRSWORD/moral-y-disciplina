import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") || "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
const CALLBACK_URL = `${SUPABASE_URL}/functions/v1/google-drive-callback`;
const HOME = "https://numbrsword.github.io/moral-y-disciplina/";

function page(title: string, detail: string, ok = false) {
  const color = ok ? "#1f9d55" : "#e5484d";
  return new Response(
    `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><body style="margin:0;background:#0f1720;color:#e7edf3;font-family:system-ui;display:grid;min-height:100vh;place-items:center"><main style="max-width:520px;padding:32px;border:1px solid #2a3947;border-radius:14px;background:#16212c"><p style="color:${color};font-weight:700">${ok ? "✓" : "!"} Faltos — Herramienta independiente</p><h1 style="font-size:24px">${title}</h1><p style="line-height:1.5">${detail}</p><a href="${HOME}" style="display:inline-block;padding:10px 15px;color:#fff;background:#1f9d55;border-radius:8px;text-decoration:none">Volver a la aplicación</a></main></body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const errorGoogle = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const estado = url.searchParams.get("state");
  if (errorGoogle) return page("Autorización cancelada", "No se otorgó acceso a Drive. Puede intentarlo de nuevo desde Recepción.");
  if (!code || !estado || !SUPABASE_URL || !SERVICE || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return page("No se pudo conectar Drive", "La solicitud no es válida o falta configurar las credenciales de Google en Supabase.");
  }
  try {
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: solicitud, error: solicitudError } = await admin
      .from("google_drive_oauth_estados").select("estado, user_id, expira_at").eq("estado", estado).maybeSingle();
    if (solicitudError || !solicitud || new Date(solicitud.expira_at).getTime() < Date.now()) {
      return page("Enlace vencido", "Por seguridad, inicie nuevamente la conexión desde Recepción.");
    }
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, redirect_uri: CALLBACK_URL, grant_type: "authorization_code" }),
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.refresh_token) throw new Error("Google no entregó una autorización permanente. Vuelva a intentarlo y acepte todos los permisos.");
    const cuentaResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` } });
    const cuenta = cuentaResponse.ok ? await cuentaResponse.json() : {};
    const { error: guardarError } = await admin.from("google_drive_conexion").upsert({
      id: true,
      cuenta_google: typeof cuenta.email === "string" ? cuenta.email : null,
      refresh_token: tokens.refresh_token,
      access_token: tokens.access_token,
      access_token_expira_at: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString(),
      conectado_por: solicitud.user_id,
      conectado_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    if (guardarError) throw guardarError;
    await admin.from("google_drive_oauth_estados").delete().eq("estado", estado);
    return page("Drive conectado", "La aplicación ya puede guardar copias de seguridad de los expedientes finales, HT y oficios en su Google Drive.", true);
  } catch (error) {
    console.error(error);
    return page("No se pudo conectar Drive", error instanceof Error ? error.message : "Ocurrió un problema al guardar la autorización.");
  }
});
