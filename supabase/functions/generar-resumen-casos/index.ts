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

const SYSTEM_PROMPT = `Eres un asistente que redacta un resumen ejecutivo breve para un oficial de la Policía Nacional del Perú (PNP) sobre el estado de sus casos disciplinarios (infracciones Leves, Ley N° 30714).

Se te da la fecha de hoy y una lista de casos con su estado actual (investigado, código de infracción, fecha del hecho, si ya fue notificada la Imputación, si el plazo de descargo (1 día hábil) ya venció o sigue en curso, si se recibió descargo, si se generó Acta de No Descargo, si se generó Orden de Sanción, y si esa orden ya fue notificada).

Redacta un resumen ejecutivo en español, en prosa clara (puedes usar un par de párrafos cortos y, si ayuda a la claridad, una lista breve al final con los casos que requieren acción urgente), que incluya:
1. Un panorama general: cuántos casos hay en total y en qué etapa se encuentra cada uno (agrupa por etapa: pendiente de notificar, plazo de descargo en curso, plazo vencido sin Acta, listo para Orden de Sanción, Orden generada pero no notificada, trámite completo).
2. Alertas priorizadas: casos cuyo plazo de descargo está vencido y todavía no tienen Acta de No Descargo ni Orden de Sanción (son los que requieren acción más urgente), y casos con Orden de Sanción generada pero aún no notificada.
3. Un cierre breve si todo está al día.

No inventes datos que no estén en la lista dada. Sé conciso y útil, como si fuera el resumen que un asistente personal le entrega cada mañana.

Los investigados vienen identificados por un alias (por ejemplo E01, E02): refiérete a ellos SIEMPRE con ese alias, tal cual, y no inventes nombres.

Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con exactamente esta clave: {"resumen": "..."}`;

// Saca el texto del resumen aunque la respuesta venga cortada: con muchos casos
// la IA se queda sin tokens a mitad de la respuesta y el JSON queda sin cerrar
// (antes: "La IA no devolvió un formato reconocible"). Si no se puede leer como
// JSON se rescata lo que alcanzó a escribir, y si no hay JSON se usa el texto.
function extraerResumen(text: string): string | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const p = JSON.parse(m[0]);
      if (typeof p.resumen === "string" && p.resumen.trim()) return p.resumen;
    } catch { /* puede venir cortado: se rescata abajo */ }
  }
  const parcial = text
    .replace(/^[\s\S]*?"resumen"\s*:\s*"/, "")
    .replace(/"\s*\}?\s*$/, "")
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"');
  return parcial.trim() || null;
}

function buildUserMessage(input: Record<string, unknown>): string {
  return [
    `Fecha de hoy: ${input.fechaHoy || ""}`,
    `Lista de casos (JSON):\n${JSON.stringify(input.casos || [])}`,
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
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserMessage(input) }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("Error de la API de IA:", errText);
      return new Response(JSON.stringify({ error: "La IA no está disponible en este momento. Intente de nuevo." }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const text = (data.content || []).filter((b: { type?: string }) => b.type === "text").map((b: { text?: string }) => b.text || "").join("");
    let resumen = extraerResumen(text);
    if (!resumen) {
      return new Response(JSON.stringify({ error: "La IA no devolvió un resumen. Intente de nuevo." }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (data.stop_reason === "max_tokens") resumen += "\n\n(El resumen se cortó por su extensión.)";

    return new Response(JSON.stringify({ resumen }), {
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
