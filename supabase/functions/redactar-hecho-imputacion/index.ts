import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

// Acceso: solo personas APROBADAS con sesión iniciada y con un tope diario de uso.
// `verify_jwt` de Supabase solo comprueba que el token sea un JWT válido, y la anon
// key (pública: está en config.js) lo es; auth.getUser() rechaza ese token anónimo
// pero aceptaría a cualquier persona con una cuenta (p. ej. de Google). Por eso
// autorizar_uso_ia() (base de datos) exige además un usuario aprobado y cuenta las
// llamadas del día. Este bloque se repite igual en cada función de IA porque cada
// una se despliega por separado.
const ORIGENES_PERMITIDOS = ["https://numbrsword.github.io"];
const LIMITE_DIARIO = 300;
const MAX_BYTES_ENTRADA = 25 * 1024 * 1024;

// Restringir el origen es solo higiene: la protección real es la sesión.
function corsHeaders(req: Request) {
  const origen = req.headers.get("origin") || "";
  const permitido = ORIGENES_PERMITIDOS.includes(origen) || /^http:\/\/localhost(:\d+)?$/.test(origen);
  return {
    "Access-Control-Allow-Origin": permitido ? origen : ORIGENES_PERMITIDOS[0],
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Vary": "Origin",
  };
}

// null = puede continuar; si no, la respuesta con la que se rechaza.
async function autorizar(req: Request, cors: Record<string, string>): Promise<Response | null> {
  const rechazo = (status: number, error: string) =>
    new Response(JSON.stringify({ error }), { status, headers: { ...cors, "Content-Type": "application/json" } });
  if (Number(req.headers.get("content-length") || 0) > MAX_BYTES_ENTRADA) return rechazo(413, "El archivo es demasiado grande.");
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return rechazo(401, "Debe iniciar sesión.");
  const cliente = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });
  const { data, error } = await cliente.auth.getUser(token);
  if (error || !data.user) return rechazo(401, "Debe iniciar sesión.");
  const { data: estado, error: errRpc } = await cliente.rpc("autorizar_uso_ia", { p_limite: LIMITE_DIARIO });
  if (errRpc) {
    console.error("autorizar_uso_ia:", errRpc.message);
    return rechazo(503, "No se pudo verificar su acceso. Intente de nuevo.");
  }
  if (estado === "no_aprobado") return rechazo(403, "Su cuenta no está autorizada para usar la IA.");
  if (estado === "cuota") return rechazo(429, "Alcanzó el límite diario de uso de la IA. Intente mañana.");
  return null;
}

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-sonnet-5";

const SYSTEM_PROMPT = `Eres un asesor legal que redacta la "Descripción del hecho" para el documento "Inicio de Imputación de Infracción Leve" de la Policía Nacional del Perú (PNP), conforme a la Ley N° 30714 - Ley que regula el Régimen Disciplinario de la PNP.

Se te da el texto de un documento (oficio, orden telefónica, directiva u otro documento similar) que el investigado presuntamente no cumplió, extraído automáticamente (a veces por OCR, puede traer ruido: encabezados, membretes, sellos, errores de reconocimiento). También se te dan datos del caso: el investigado, su grado, la fecha en que se constató el incumplimiento, y el código/texto de la infracción Leve que se le imputa.

Redacta UN PARRAFO formal en español jurídico-administrativo peruano, en tercera persona, tono formal (sin exclamaciones ni lenguaje coloquial), que:
1. Identifique el documento incumplido (tipo -oficio, orden telefónica, directiva, memorándum, etc.-, y su número y fecha SOLO si aparecen explícitamente en el texto dado).
2. Resuma brevemente qué disposición u orden contenía ese documento.
3. Indique que el investigado no le dio cumplimiento (o cumplió tardíamente / parcialmente, según corresponda al texto), generando la infracción imputada.

Reglas estrictas:
- No inventes números de documento, fechas, nombres, cargos o citas legales que no estén explícitamente en el texto proporcionado. Si no puedes identificar con certeza el número o la fecha del documento en el texto, omite ese dato sin inventarlo (por ejemplo, refiérete a "el oficio remitido" sin número).
- Ignora ruido de OCR (encabezados institucionales, sellos, firmas, datos de envío) y corrige errores obvios de OCR solo cuando el sentido es evidente por el contexto.
- No agregues hechos, motivos o circunstancias que no estén en el texto dado ni en los datos del caso.
- El párrafo debe quedar listo para usarse tal cual como el campo "DESCRIPCIÓN DEL HECHO" del documento de imputación, sin títulos ni viñetas.
- Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con exactamente esta clave: {"descripcion_hecho": "..."}`;

function buildUserMessage(input: Record<string, unknown>): string {
  return [
    `Investigado: ${input.investigadoCompleto || ""}`,
    `Fecha en que se constató el incumplimiento: ${input.fechaHecho || ""}`,
    `Código de infracción imputada: ${input.codigoInfraccion || ""}`,
    `Texto de la infracción (Anexo I): ${input.infraccionTexto || ""}`,
    `Texto extraído del documento (oficio/orden telefónica/directiva), puede tener ruido de OCR:\n${input.textoDocumento || "(no se pudo extraer texto)"}`,
    input.notasOficial ? `Notas adicionales del oficial: ${input.notasOficial}` : "",
  ].filter(Boolean).join("\n");
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const rechazo = await autorizar(req, cors);
  if (rechazo) return rechazo;

  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "Falta configurar ANTHROPIC_API_KEY en el servidor." }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

  try {
    const input = await req.json();

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserMessage(input) }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Error de la API de IA:", errText.slice(0, 2000));
      return new Response(JSON.stringify({ error: "La IA no está disponible en este momento. Intente de nuevo." }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const text = (data.content || []).map((b: { text?: string }) => b.text || "").join("");
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return new Response(JSON.stringify({ error: "La IA no devolvió un formato reconocible. Intente de nuevo." }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const parsed = JSON.parse(match[0]);

    return new Response(JSON.stringify(parsed), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Error en la función:", err);
    return new Response(JSON.stringify({ error: "Error interno al procesar la solicitud. Intente de nuevo." }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
