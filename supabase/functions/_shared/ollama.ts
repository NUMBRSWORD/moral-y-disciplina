type Bloque = { type: string; source?: { data: string }; text?: string };
type Entrada = {
  system: string; messages: {role: string; content: string | Bloque[]}[];
  max_tokens: number; contexto?: number; tools?: {name:string; input_schema?:object}[];
  output_config?: {format:{schema:object}};
};
async function generar(model: string, messages: object[], maxTokens: number, formato?: object, contexto?: number) {
  const respuesta = await fetch("http://127.0.0.1:11434/api/chat", {
    method:"POST", redirect:"error", headers:{"Content-Type":"application/json"},
    signal:AbortSignal.timeout(240000),
    body:JSON.stringify({model, messages, stream:false, ...(model.startsWith("qwen") ? {think:false} : {}),
      ...(formato ? {format:formato} : {}), options:{temperature:0,num_predict:maxTokens,...(contexto ? {num_ctx:contexto} : {})}})
  });
  if (!respuesta.ok) throw new Error("Ollama no pudo procesar el documento.");
  return await respuesta.json();
}

export async function inferirLocal(entrada: Entrada, visionJson: boolean = false) {
  const herramienta = entrada.tools?.[0];
  const contenido = entrada.messages[0].content;
  let texto: string;
  let limitado = false;
  if (Array.isArray(contenido)) {
    const paginas: string[] = [];
    for (const bloque of contenido.filter(b => b.type === "image")) {
      if (!bloque.source?.data) throw new Error("Imagen sin contenido.");
      const pagina = await generar("glm-ocr", [{role:"user",content:"Text Recognition:",images:[bloque.source.data]}],4096);
      if (pagina.done_reason === "length") throw new Error("OCR incompleto. Divida la pÃ¡gina.");
      paginas.push(pagina.message.content.trim());
    }
    const separador = entrada.system.includes("<<<FIN DE PAGINA>>>") ? "\n<<<FIN DE PAGINA>>>\n" : "\n\n";
    texto = visionJson ? JSON.stringify({texto:paginas.join(separador)}) : paginas.join(separador);
  } else {
    const respuesta = await generar("qwen3:4b", [{role:"system",content:entrada.system}, ...entrada.messages],
      entrada.max_tokens, herramienta?.input_schema ?? entrada.output_config?.format.schema, entrada.contexto);
    texto = respuesta.message.content.trim();
    limitado = respuesta.done_reason === "length";
  }
  if (!texto) throw new Error("El modelo local devolviÃ³ una respuesta vacÃ­a.");
  if (herramienta && limitado) throw new Error("Respuesta estructurada incompleta.");
  const bloque = herramienta ? {type:"tool_use",name:herramienta.name,input:JSON.parse(texto)} : {type:"text",text:texto};
  return Response.json({content:[bloque],stop_reason:limitado ? "max_tokens" : "end_turn"});
}

// Claude (Anthropic) con la misma entrada y la misma forma de respuesta que
// inferirLocal: así las funciones no cambian según dónde corran. Se devuelven
// solo los bloques de texto/herramienta (sin "thinking"), unidos como Ollama.
const MODELO_CLAUDE = "claude-sonnet-5";
export async function inferirClaude(entrada: Entrada) {
  const clave = Deno.env.get("ANTHROPIC_API_KEY");
  if (!clave) throw new Error("Falta configurar ANTHROPIC_API_KEY en el servidor.");
  const messages = entrada.messages.map((m) => ({
    role: m.role,
    content: Array.isArray(m.content)
      ? m.content.map((b) => b.type === "image"
        ? { type: "image", source: { type: "base64", media_type: (b.source as { media_type?: string })?.media_type || "image/jpeg", data: b.source?.data || "" } }
        : b)
      : m.content,
  }));
  // Los topes de Ollama son solo de respuesta; Claude además razona dentro del
  // mismo tope, así que se le da un mínimo para que no corte la respuesta.
  const cuerpo: Record<string, unknown> = { model: MODELO_CLAUDE, max_tokens: Math.max(entrada.max_tokens, 4000), system: entrada.system, messages };
  if (entrada.tools?.length) {
    // Sin tool_choice forzado: con el razonamiento activo la API lo rechaza.
    cuerpo.tools = entrada.tools;
  } else if (entrada.output_config?.format?.schema) {
    cuerpo.output_config = { format: { type: "json_schema", schema: entrada.output_config.format.schema } };
  }
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": clave, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(cuerpo),
  });
  if (!resp.ok) return resp;
  const data = await resp.json();
  const bloques = (data.content || []) as { type: string; text?: string }[];
  const herramienta = bloques.find((b) => b.type === "tool_use");
  const texto = bloques.filter((b) => b.type === "text").map((b) => b.text || "").join("");
  return Response.json({
    content: [herramienta ?? { type: "text", text: texto }],
    stop_reason: data.stop_reason,
  });
}

// En la PC de la oficina (IA_LOCAL=1) se usa Ollama; en Supabase, Claude. La
// pasarela de la PC decide cuál responde y, si la PC no contesta, ia-oficina
// cae a la función de Supabase, que usa Claude.
export function inferir(entrada: Entrada, visionJson: boolean = false) {
  return Deno.env.get("IA_LOCAL") === "1" ? inferirLocal(entrada, visionJson) : inferirClaude(entrada);
}
