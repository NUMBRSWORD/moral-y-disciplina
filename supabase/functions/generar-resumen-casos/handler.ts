import { responderAgente } from "./agentes.ts";
import { inferir } from "../_shared/ollama.ts";
import { autorizar, corsHeaders, clienteUsuario } from "../_shared/acceso.ts";

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

export const atender = async (req: Request) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const rechazo = await autorizar(req, cors);
  if (rechazo) return rechazo;

  try {
    const input = await req.json();
    if (input?.modo === "asistente_oficina") {
      return await responderAgente(input, cors, async () => {
        const cliente = clienteUsuario(req);
        const {data, error} = await cliente.rpc("es_admin");
        return !error && data === true;
      });
    }

    const resp = await inferir({
        max_tokens: 4000,
        // Sin la forma exacta, el modelo local devolvía la lista de casos en vez del resumen.
        output_config: { format: { schema: { type: "object", properties: { resumen: { type: "string" } }, required: ["resumen"], additionalProperties: false } } },
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserMessage(input) }],
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
};
