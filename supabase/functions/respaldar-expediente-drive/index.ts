import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GOOGLE_CLIENT_ID = Deno.env.get("GOOGLE_CLIENT_ID") || "";
const GOOGLE_CLIENT_SECRET = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";
const RAIZ_NOMBRE = "Expedientes cerrados - CPNP Ventanilla (Moral y Disciplina)";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

type TipoArchivo = "expediente" | "ht" | "oficio";

async function requireAdmin(req: Request) {
  const authorization = req.headers.get("authorization");
  if (!authorization) throw new Error("Debe iniciar sesión.");
  const cliente = createClient(SUPABASE_URL, ANON, { global: { headers: { Authorization: authorization } } });
  const { data: auth, error: authError } = await cliente.auth.getUser();
  if (authError || !auth.user) throw new Error("Sesión no válida.");
  const { data: perfil } = await cliente.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (perfil?.role !== "admin") throw new Error("Solo el administrador puede respaldar en Drive.");
}

const escq = (v: string) => v.replaceAll("'", "\\'");

async function accessToken(admin: ReturnType<typeof createClient>): Promise<string> {
  const { data: conexion, error } = await admin.from("google_drive_conexion")
    .select("refresh_token, access_token, access_token_expira_at").eq("id", true).maybeSingle();
  if (error || !conexion?.refresh_token) throw new Error("Drive aún no está conectado. Conéctelo desde Recepción.");
  const vence = conexion.access_token_expira_at ? new Date(conexion.access_token_expira_at).getTime() : 0;
  if (conexion.access_token && vence > Date.now() + 60_000) return conexion.access_token as string;
  const resp = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET, refresh_token: conexion.refresh_token as string, grant_type: "refresh_token" }),
  });
  const token = await resp.json();
  if (!resp.ok || !token.access_token) throw new Error("Google rechazó la autorización guardada. Vuelva a conectar Drive.");
  await admin.from("google_drive_conexion").update({
    access_token: token.access_token,
    access_token_expira_at: new Date(Date.now() + Number(token.expires_in || 3600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", true);
  return token.access_token;
}

async function driveFetch(url: string, token: string, init: RequestInit = {}) {
  const resp = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  if (!resp.ok) throw new Error(`Google Drive respondió ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  return resp;
}

async function crearCarpeta(name: string, parentId: string | null, token: string): Promise<string> {
  if (parentId) {
    const q = `name = '${escq(name)}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const busca = await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`, token);
    const existe = await busca.json();
    if (existe.files?.[0]?.id) return existe.files[0].id;
  }
  const cuerpo: Record<string, unknown> = { name, mimeType: "application/vnd.google-apps.folder" };
  if (parentId) cuerpo.parents = [parentId];
  const crea = await driveFetch("https://www.googleapis.com/drive/v3/files?fields=id", token, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cuerpo),
  });
  const folder = await crea.json();
  if (!folder.id) throw new Error("No se pudo crear la carpeta de respaldo en Drive.");
  return folder.id;
}

async function carpetaRaiz(admin: ReturnType<typeof createClient>, token: string): Promise<string> {
  const { data: conexion } = await admin.from("google_drive_conexion").select("carpeta_raiz_id").eq("id", true).maybeSingle();
  if (conexion?.carpeta_raiz_id) return conexion.carpeta_raiz_id as string;
  const id = await crearCarpeta(RAIZ_NOMBRE, null, token);
  await admin.from("google_drive_conexion").update({ carpeta_raiz_id: id, updated_at: new Date().toISOString() }).eq("id", true);
  return id;
}

async function carpetaDelExpediente(admin: ReturnType<typeof createClient>, exp: Record<string, string | null>, token: string) {
  const fecha = exp.fecha_falta || new Date().toISOString().slice(0, 10);
  const [anio, mes = "sin-mes"] = fecha.split("-");
  const carpeta = exp.carpeta_archivo || "expediente-sin-identificar";
  const raizId = await carpetaRaiz(admin, token);
  const anioId = await crearCarpeta(anio || "sin-anio", raizId, token);
  const mesId = await crearCarpeta(mes, anioId, token);
  return crearCarpeta(carpeta, mesId, token);
}

async function subirArchivo(fileId: string | null, name: string, parent: string, blob: Blob, token: string) {
  if (fileId) {
    const upd = await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=id,name,webViewLink`, token, {
      method: "PATCH", headers: { "Content-Type": blob.type || "application/pdf" }, body: blob,
    });
    return upd.json();
  }
  const boundary = `pnp-${crypto.randomUUID()}`;
  const metadata = JSON.stringify({ name, parents: [parent] });
  const payload = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
    `--${boundary}\r\nContent-Type: ${blob.type || "application/pdf"}\r\n\r\n`, blob,
    `\r\n--${boundary}--`,
  ], { type: `multipart/related; boundary=${boundary}` });
  const crea = await driveFetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", token, {
    method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body: payload,
  });
  return crea.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Método no permitido." }, 405);
  if (!SUPABASE_URL || !ANON || !SERVICE || !GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    return json({ error: "El respaldo de Drive aún no está configurado (faltan secretos de Google en Supabase)." }, 503);
  }
  let admin: ReturnType<typeof createClient> | null = null;
  let expedienteId = "";
  try {
    await requireAdmin(req);
    const body = await req.json();
    admin = createClient(SUPABASE_URL, SERVICE);
    expedienteId = typeof body.expedienteId === "string" ? body.expedienteId : "";
    const tipo: TipoArchivo = ["expediente", "ht", "oficio"].includes(body.tipo) ? body.tipo : "expediente";
    if (!expedienteId) return json({ error: "Falta identificar el expediente." }, 400);

    const { data: exp, error: expError } = await admin.from("expedientes_remitidos")
      .select("id, fecha_falta, carpeta_archivo, archivo_path, archivo_nombre, archivo_ht_path, archivo_ht_nombre, archivo_oficio_path, archivo_oficio_nombre, drive_expediente_file_id, drive_ht_file_id, drive_oficio_file_id")
      .eq("id", expedienteId).maybeSingle();
    if (expError || !exp) return json({ error: "No se encontró el expediente." }, 404);

    const campos = tipo === "expediente"
      ? { path: exp.archivo_path, name: exp.archivo_nombre, fileId: exp.drive_expediente_file_id, idField: "drive_expediente_file_id", urlField: "drive_expediente_url" }
      : tipo === "ht"
        ? { path: exp.archivo_ht_path, name: exp.archivo_ht_nombre, fileId: exp.drive_ht_file_id, idField: "drive_ht_file_id", urlField: "drive_ht_url" }
        : { path: exp.archivo_oficio_path, name: exp.archivo_oficio_nombre, fileId: exp.drive_oficio_file_id, idField: "drive_oficio_file_id", urlField: "drive_oficio_url" };
    if (!campos.path || !campos.name) return json({ error: `Aún no hay ${tipo === "ht" ? "HT" : tipo === "oficio" ? "Oficio" : "PDF final"} para respaldar.` }, 409);

    const token = await accessToken(admin);
    const folder = await carpetaDelExpediente(admin, exp as Record<string, string | null>, token);
    const { data: blob, error: dlError } = await admin.storage.from("expedientes-terminados-pnp").download(campos.path as string);
    if (dlError || !blob) throw dlError || new Error("No se pudo descargar el archivo desde Supabase.");
    const subido = await subirArchivo(campos.fileId as string | null, campos.name as string, folder, blob, token);
    if (!subido.id) throw new Error("Drive no devolvió la identificación del archivo respaldado.");
    const urlDrive = subido.webViewLink || `https://drive.google.com/open?id=${subido.id}`;
    const { error: updError } = await admin.from("expedientes_remitidos").update({
      [campos.idField]: subido.id, [campos.urlField]: urlDrive, drive_sync_at: new Date().toISOString(), drive_error: null,
    }).eq("id", expedienteId);
    if (updError) throw updError;
    return json({ ok: true, tipo, fileId: subido.id, url: urlDrive });
  } catch (error) {
    console.error(error);
    if (admin && expedienteId) {
      await admin.from("expedientes_remitidos").update({ drive_error: error instanceof Error ? error.message.slice(0, 500) : "Error al respaldar en Drive." }).eq("id", expedienteId);
    }
    return json({ error: error instanceof Error ? error.message : "No se pudo respaldar en Drive." }, 500);
  }
});
