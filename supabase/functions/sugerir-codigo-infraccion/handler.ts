import { inferir } from "../_shared/ollama.ts";
import { autorizar, corsHeaders } from "../_shared/acceso.ts";

const SYSTEM_PROMPT = `Eres un asesor legal que ayuda a un oficial de la Policía Nacional del Perú (PNP) a clasificar una infracción disciplinaria Leve, conforme al Anexo I de la Ley N° 30714 - Ley que regula el Régimen Disciplinario de la PNP.

Se te da la descripción libre de un hecho constatado (escrita por el oficial, puede estar incompleta o ser un borrador) y el catálogo completo de infracciones Leves del Anexo I (117 códigos, cada uno con su "codigo", "bienJuridico", "infraccion" y "sancion").

Debes identificar cuál de esos códigos describe MEJOR el hecho narrado.

Reglas estrictas:
- El "codigo_sugerido" debe ser EXACTAMENTE uno de los códigos del catálogo dado (por ejemplo "L21"), copiado tal cual, sin inventar códigos que no estén en la lista.
- Si el hecho descrito podría encajar razonablemente en más de un código, incluye hasta 2 alternativas adicionales en "alternativas" (también códigos exactos del catálogo), ordenadas de más a menos probable.
- Si el hecho descrito es demasiado vago o no corresponde claramente a ninguna infracción Leve del catálogo, responde con "codigo_sugerido": null y explica por qué en "justificacion".
- "justificacion" debe ser un texto breve (2-4 líneas) en español formal, explicando por qué ese código encaja con el hecho narrado, citando qué elementos del relato coinciden con el texto de la infracción.
- No inventes hechos que no estén en la descripción dada.
- Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con exactamente estas claves: {"codigo_sugerido": "L21" | null, "alternativas": ["L22"], "justificacion": "..."}`;

function buildUserMessage(input: Record<string, unknown>): string {
  return [
    `Descripción libre del hecho constatado (escrita por el oficial):\n${input.descripcionHecho || "(vacío)"}`,
    `Catálogo de infracciones Leves del Anexo I (elige el "codigo" de una de estas, exactamente):\n${JSON.stringify(input.catalogo || [])}`,
  ].filter(Boolean).join("\n\n");
}

export const atender = async (req: Request) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const rechazo = await autorizar(req, cors);
  if (rechazo) return rechazo;

  try {
    const input = await req.json();

    const resp = await inferir({
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserMessage(input) }],
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
};
