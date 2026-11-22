import { inferir } from "../_shared/ollama.ts";
import { autorizar, corsHeaders } from "../_shared/acceso.ts";

const SYSTEM_PROMPT_IMPUTACION = `Eres un asesor legal que revisa, ANTES de generarse, el documento "Inicio de Imputación de Infracción Leve" de la Policía Nacional del Perú (PNP), conforme a la Ley N° 30714.

Se te da el código de infracción elegido (con su texto del Anexo I), la fecha del hecho, y la "Descripción del hecho" que el oficial redactó libremente y que se usará tal cual en el documento oficial. Opcionalmente también se te da el texto extraído del archivo de sustento adjunto (oficio/orden telefónica), si lo hay.

Revisa si hay problemas evidentes ANTES de generar el documento oficial, por ejemplo:
- La descripción no menciona con claridad qué ocurrió, cuándo o cómo se comprobó.
- La descripción no parece corresponder al código de infracción elegido (el relato no encaja con el texto de esa infracción).
- La descripción contradice la fecha del hecho indicada.
- Si hay texto del archivo de sustento, y la descripción contradice o no guarda relación con lo que dice ese documento.
- La descripción es demasiado breve o genérica para sustentar una sanción disciplinaria.

No seas excesivamente estricto: si la descripción es razonable y coherente con el código elegido, no inventes observaciones. Esto es una revisión de apoyo, no un rechazo formal.

Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con exactamente estas claves: {"consistente": true|false, "observaciones": ["..."], "fecha_detectada": null}`;

const SYSTEM_PROMPT_NOTIFICACION = `Eres un asesor legal que revisa el cargo de notificación firmado de una "Orden de Sanción" disciplinaria de la Policía Nacional del Perú (PNP), conforme a la Ley N° 30714.

Se te da el nombre del investigado sancionado, el código de infracción y la sanción impuesta, y el texto extraído (por OCR o lectura directa, puede tener ruido) del cargo de notificación firmado que se subió como comprobante de entrega.

Debes:
1. Verificar que el documento efectivamente corresponda a una notificación dirigida a ese investigado (nombre coincide, aunque sea parcialmente, considerando posible ruido de OCR).
2. Buscar en el texto una fecha de recepción/notificación (fecha en que el investigado firmó o recibió el documento) y devolverla en formato YYYY-MM-DD en "fecha_detectada" si la encuentras con razonable certeza; si no la encuentras, deja "fecha_detectada": null.
3. Señalar en "observaciones" cualquier discrepancia relevante (por ejemplo, el nombre no coincide, no hay firma o fecha visible, el documento no parece ser un cargo de notificación).

"consistente" debe ser true solo si el documento razonablemente corresponde a la notificación de esa Orden de Sanción a ese investigado, sin discrepancias graves.

No inventes fechas ni datos que no estén en el texto dado.

Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con exactamente estas claves: {"consistente": true|false, "observaciones": ["..."], "fecha_detectada": "YYYY-MM-DD" | null}`;

const SYSTEM_PROMPT_EXPEDIENTE = `Eres un asesor legal que revisa el LEGAJO COMPLETO FIRMADO de un procedimiento disciplinario por infracción leve de la Policía Nacional del Perú (PNP), conforme a la Ley N° 30714, que el oficial sube como un único PDF (el "cargo del expediente").

Se te da:
- El nombre del investigado, el código de infracción y la sanción impuesta.
- La lista de documentos que el expediente DEBE contener para estar completo, y para cada uno si ya consta por separado en el sistema (por ejemplo, el descargo firmado suele estar cargado aparte).
- El texto extraído (por OCR o lectura directa, puede tener bastante ruido y saltos) del PDF subido.

Tu tarea:
1. Para cada documento esperado, decide si aparece en el texto del PDF. Reconoce los documentos por sus encabezados o frases típicas aunque el OCR esté sucio (p. ej. "INICIO DE IMPUTACIÓN", "NOTIFICACIÓN", "DESCARGO", "ACTA DE NO ... DESCARGO", "ORDEN DE SANCIÓN", "CARGO DE NOTIFICACIÓN"/constancia de recepción firmada). Un documento que el sistema marca como "ya consta por separado" cuéntalo como presente aunque no esté en el PDF, pero anótalo en "observaciones".
2. Devuelve "presentes" y "faltantes" con las etiquetas EXACTAS de la lista de documentos esperados que te doy.
3. Verifica que el nombre del investigado del legajo coincida (aunque sea parcialmente, con ruido de OCR) con el indicado.
4. Si encuentras una fecha de notificación/recepción firmada por el investigado, devuélvela en "fecha_detectada" en formato YYYY-MM-DD; si no, null.
5. En "observaciones" resume en frases cortas: qué falta, incoherencias de nombre, si el PDF parece incompleto o ilegible, o si el descargo va aparte.

"consistente" es true solo si NO falta ningún documento esencial y el nombre coincide.

No inventes documentos ni fechas que no estén en el texto.

Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con exactamente estas claves: {"consistente": true|false, "presentes": ["..."], "faltantes": ["..."], "observaciones": ["..."], "fecha_detectada": "YYYY-MM-DD" | null}`;

function buildUserMessageImputacion(input: Record<string, unknown>): string {
  return [
    `Código de infracción elegido: ${input.codigoInfraccion || ""}`,
    `Texto de la infracción (Anexo I): ${input.infraccionTexto || ""}`,
    `Fecha del hecho: ${input.fechaHecho || ""}`,
    `Descripción del hecho redactada por el oficial:\n${input.descripcionHecho || ""}`,
    input.textoDocumento ? `Texto extraído del archivo de sustento adjunto:\n${input.textoDocumento}` : "",
  ].filter(Boolean).join("\n\n");
}

function buildUserMessageNotificacion(input: Record<string, unknown>): string {
  return [
    `Investigado sancionado: ${input.investigadoCompleto || ""}`,
    `Código de infracción: ${input.codigoInfraccion || ""}`,
    `Sanción impuesta: ${input.sancionImpuesta || ""}`,
    `Texto extraído del cargo de notificación firmado (puede tener ruido de OCR):\n${input.textoDocumento || "(no se pudo extraer texto)"}`,
  ].filter(Boolean).join("\n\n");
}

function buildUserMessageExpediente(input: Record<string, unknown>): string {
  const esperados = Array.isArray(input.componentesEsperados) ? input.componentesEsperados as Array<Record<string, unknown>> : [];
  const lista = esperados.map((c) => `- ${c.etiqueta}${c.yaConsta ? " (YA CONSTA POR SEPARADO EN EL SISTEMA)" : ""}`).join("\n");
  return [
    `Investigado: ${input.investigadoCompleto || ""}`,
    `Código de infracción: ${input.codigoInfraccion || ""}`,
    `Sanción impuesta: ${input.sancionImpuesta || ""}`,
    `Documentos que el expediente debe contener:\n${lista || "(no especificados)"}`,
    `Texto extraído del PDF del legajo completo (puede tener bastante ruido de OCR):\n${input.textoDocumento || "(no se pudo extraer texto)"}`,
  ].filter(Boolean).join("\n\n");
}

export const atender = async (req: Request) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const rechazo = await autorizar(req, cors);
  if (rechazo) return rechazo;

  try {
    const input = await req.json();
    let system = SYSTEM_PROMPT_IMPUTACION;
    let userMessage = buildUserMessageImputacion(input);
    if (input.tipo === "notificacion_orden") {
      system = SYSTEM_PROMPT_NOTIFICACION;
      userMessage = buildUserMessageNotificacion(input);
    } else if (input.tipo === "expediente_completo") {
      system = SYSTEM_PROMPT_EXPEDIENTE;
      userMessage = buildUserMessageExpediente(input);
    }

    const resp = await inferir({
        max_tokens: 1500,
        system,
        messages: [{ role: "user", content: userMessage }],
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
    const text = (data.content || []).filter((b: { type?: string }) => b.type === "text").map((b: { text?: string }) => b.text || "").join("");
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
