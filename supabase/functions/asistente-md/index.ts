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

const SYSTEM_PROMPT = `Eres un asistente de consulta rápida dentro de "Moral y Disciplina", una aplicación interna de la Policía Nacional del Perú (PNP) usada para llevar el control de ausencias/faltas al servicio (Notas Informativas), su reincorporación, el descargo del investigado y la Orden de Sanción para las infracciones leves L21 (llegar con retraso) y L24 (faltar un día), conforme a la Ley N° 30714 - Régimen Disciplinario de la PNP y su reglamento.

Se te da el texto de las infracciones L21 y L24 del Anexo I (las únicas que este sistema tramita con Orden de Sanción automática), un conjunto de DIRECTIVAS INTERNAS VIGENTES que el administrador cargó al sistema (puede estar vacío), y el historial reciente de la conversación.

Responde preguntas del oficial sobre:
- El procedimiento: Nota Informativa de falta → reincorporación → plazo de descargo (1 día hábil) → Orden de Sanción con el tercio correspondiente.
- Cómo se clasifica L21 vs L24 según las horas de ausencia (menos de 24h = L21, de 24h a 48h = L24).
- Qué dicen las directivas internas cargadas en el sistema, cuando la pregunta se relacione con ellas.
- Dónde encontrar algo dentro de esta misma aplicación (qué botón usar, en qué pestaña).

Reglas estrictas:
- Basa tus respuestas ÚNICAMENTE en la información que se te da (infracciones L21/L24, directivas cargadas) y en tu conocimiento general y confiable sobre la Ley N° 30714 y su reglamento. Si algo no lo sabes con certeza, dilo claramente en vez de inventarlo.
- Si preguntan por un requisito institucional específico (p. ej. cuándo un descanso médico particular es exonerante) y esa regla no aparece en las directivas que se te dieron, dilo explícitamente: no existe en el sistema una directiva cargada que lo regule, en vez de inventar una respuesta. No inventes el contenido, número o nombre de ninguna directiva.
- Este sistema solo cubre L21 y L24. Si preguntan por otras infracciones (leves, graves o muy graves), acláralo: esta aplicación no las cubre por ahora.
- No eres un reemplazo de asesoría legal formal para casos complejos o litigiosos; para esos casos sugiere consultar con la oficina legal o asesoría jurídica correspondiente.
- Responde en español, en un tono claro, directo y profesional. Prefiere prosa breve (1-3 párrafos cortos), salvo que se pida más detalle.

Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con exactamente esta clave: {"respuesta": "..."}`;

function buildUserMessage(input: Record<string, unknown>): string {
  const historial = Array.isArray(input.historial) ? input.historial as Array<{ role: string; texto: string }> : [];
  const historialTexto = historial.length
    ? historial.map((h) => `${h.role === "asistente" ? "Asistente" : "Oficial"}: ${h.texto}`).join("\n")
    : "(sin mensajes previos)";
  const directivas = Array.isArray(input.directivas) ? input.directivas : [];
  const directivasTexto = directivas.length
    ? directivas.map((d: { titulo?: string; numero_documento?: string; contenido?: string }, i: number) =>
        `--- Directiva ${i + 1}: ${d.titulo || "(sin título)"}${d.numero_documento ? ` (${d.numero_documento})` : ""} ---\n${d.contenido || ""}`
      ).join("\n\n")
    : "(no hay directivas cargadas en el sistema todavía)";
  return [
    `Infracciones que tramita este sistema (Anexo I):\n${JSON.stringify(input.catalogo || [])}`,
    `Directivas internas vigentes cargadas en el sistema:\n${directivasTexto}`,
    `Historial reciente de la conversación:\n${historialTexto}`,
    `Nueva pregunta del oficial: ${input.pregunta || ""}`,
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
        max_tokens: 1200,
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
