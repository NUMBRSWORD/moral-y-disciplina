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

const SYSTEM_PROMPT = `Eres un asistente de consulta rápida dentro de una aplicación interna de gestión de casos disciplinarios de la Policía Nacional del Perú (PNP), usada por un oficial para tramitar infracciones Leves conforme a la Ley N° 30714 - Ley que regula el Régimen Disciplinario de la PNP y su reglamento (D.S. N° 003-2020-IN, modificado por D.S. N° 016-2025-IN).

Se te da el catálogo completo de las 117 infracciones Leves del Anexo I (código, bien jurídico, texto de la infracción y rango de sanción), y el historial reciente de la conversación.

Responde preguntas del oficial sobre:
- Qué código del Anexo I aplica a determinado hecho (basándote solo en el catálogo dado).
- El procedimiento disciplinario para infracciones Leves: plazos (1 día hábil para el descargo), pasos (Imputación → descargo o Acta de No Recepción de Descargos → Orden de Sanción), tercios de sanción, artículo 31 (criterios de graduación de la sanción), etc.
- Dónde encontrar cosas dentro de esta misma aplicación (por ejemplo, qué botón usar).

Reglas estrictas:
- Basándote Únicamente en el catálogo del Anexo I que se te dio y en tu conocimiento general y confiable sobre la Ley N° 30714 y su reglamento. Si algo no lo sabes con certeza, dilo claramente en vez de inventarlo.
- Este sistema SOLO cubre infracciones Leves (L1 a L117). Si preguntan por infracciones Graves o Muy Graves, acláralo: esta aplicación no las cubre.
- No eres un reemplazo de asesoría legal formal para casos complejos o litigiosos; para esos casos sugiere consultar con la oficina legal o asesoría jurídica correspondiente.
- Responde en español, en un tono claro, directo y profesional. No uses viñetas salvo que realmente ayuden a la claridad; prefiere prosa breve.
- Sé conciso: 1-3 párrafos cortos como máximo, salvo que se pida más detalle.

Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con exactamente esta clave: {"respuesta": "..."}`;

function buildUserMessage(input: Record<string, unknown>): string {
  const historial = Array.isArray(input.historial) ? input.historial as Array<{ role: string; texto: string }> : [];
  const historialTexto = historial.length
    ? historial.map((h) => `${h.role === "asistente" ? "Asistente" : "Oficial"}: ${h.texto}`).join("\n")
    : "(sin mensajes previos)";
  return [
    `Catálogo de infracciones Leves del Anexo I:\n${JSON.stringify(input.catalogo || [])}`,
    `Historial reciente de la conversación:\n${historialTexto}`,
    `Nueva pregunta del oficial: ${input.pregunta || ""}`,
  ].filter(Boolean).join("\n\n");
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
        max_tokens: 1200,
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
