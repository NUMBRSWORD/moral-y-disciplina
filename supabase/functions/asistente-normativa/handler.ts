import { inferir } from "../_shared/ollama.ts";
import { autorizar, corsHeaders } from "../_shared/acceso.ts";

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

export const atender = async (req: Request) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const rechazo = await autorizar(req, cors);
  if (rechazo) return rechazo;

  try {
    const input = await req.json();

    const resp = await inferir({
        max_tokens: 1200,
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
