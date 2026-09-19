import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

// Acceso: solo personas con sesión iniciada. `verify_jwt` de Supabase solo
// comprueba que el token sea un JWT válido, y la anon key (pública: está en
// config.js) lo es -- sin esta verificación cualquiera que la copie podría usar
// esta función como proxy de la IA a costa de la cuenta. auth.getUser() sí la
// rechaza (403 "missing sub claim"): el token anónimo no es de ningún usuario.
// Este bloque se repite igual en cada función de IA porque cada una se
// despliega por separado.
const ORIGENES_PERMITIDOS = ["https://numbrsword.github.io"];

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

async function haySesion(req: Request): Promise<boolean> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return false;
  const { data, error } = await createClient(SUPABASE_URL, SUPABASE_ANON_KEY).auth.getUser(token);
  return !error && !!data.user;
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

Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con exactamente esta clave: {"resumen": "..."}`;

function buildUserMessage(input: Record<string, unknown>): string {
  return [
    `Fecha de hoy: ${input.fechaHoy || ""}`,
    `Lista de casos (JSON):\n${JSON.stringify(input.casos || [])}`,
  ].filter(Boolean).join("\n\n");
}

Deno.serve(async (req: Request) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  if (!(await haySesion(req))) {
    return new Response(JSON.stringify({ error: "Debe iniciar sesión." }), {
      status: 401,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }

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
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserMessage(input) }],
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return new Response(JSON.stringify({ error: `Error de la API de IA: ${errText}` }), {
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
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
