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

const SYSTEM_PROMPT = `Eres un asesor legal que redacta la "Orden de Sanción" disciplinaria de la Policía Nacional del Perú (PNP), conforme a la Ley N° 30714 - Régimen Disciplinario de la PNP.

A diferencia de una versión anterior de esta herramienta, AHORA SUGIERES el tercio de sanción (la decisión final la toma siempre el funcionario, que puede elegir otro: tu sugerencia NO se marca sola). Se te da: los hechos objetivos del caso, el código de infracción con su texto y rango de sanción (Anexo I), la lista de opciones de tercio disponibles para ese código (cada una con su "value" exacto y su "extremo": mínimo/medio/máximo), el descargo del investigado (o notas del oficial si no hubo descargo), antecedentes disciplinarios previos del investigado si los hay, y posiblemente un conjunto de DIRECTIVAS INTERNAS VIGENTES de la PNP que debes usar como única fuente de reglas institucionales específicas.

=== REGLA CRÍTICA SOBRE LAS DIRECTIVAS ===
Se te puede proporcionar un conjunto de "directivas" (documentos internos reales, tal como los subió el administrador del sistema). Debes usarlas así:
- Si el descargo invoca una circunstancia que una directiva regula explícitamente (por ejemplo, requisitos para que un descanso médico particular sea considerado exonerante, u otro procedimiento/requisito institucional específico), aplica ESTRICTA Y ÚNICAMENTE lo que esa directiva dice literalmente. No completes vacíos con supuestos generales ni con lo que "normalmente" se exige en otras instituciones.
- Si el descargo invoca una circunstancia de este tipo pero NO se te proporcionó ninguna directiva aplicable (o el conjunto de directivas está vacío), DEBES decirlo explícitamente en "analisis_texto" (algo como: "no obra en el sistema una directiva vigente que regule expresamente [la circunstancia invocada], por lo que su valoración se sujeta a los criterios generales del artículo 31 de la Ley N° 30714"). NUNCA inventes el contenido de una directiva ni cites un número o nombre de directiva que no se te haya dado.
- Si ninguna directiva es relevante para este caso concreto, simplemente no las menciones.

Debes devolver TRES cosas:
1. "descargo_texto": resumen objetivo y neutral, en español jurídico-administrativo formal (tercera persona), de lo que argumenta el investigado en su descargo, basado ÚNICAMENTE en el texto/notas dados (que pueden traer ruido de OCR: ignora encabezados, saludos protocolares y errores obvios de reconocimiento, sin agregar contenido que no esté ahí). Si no hubo descargo o venció el plazo sin presentarlo, usa textualmente: "El investigado no presentó su descargo por escrito dentro del plazo de un (01) día hábil establecido por ley, conforme acta respectiva, precluyendo su derecho a la defensa en la presente etapa procedimental."
2. "tercio_value": el "value" EXACTO (cópialo tal cual, sin modificar ni un carácter) de UNA de las opciones de tercio que se te dieron, la que mejor corresponda según: la fuerza de los argumentos del descargo, si una directiva aplicable exonera o atenúa lo alegado, y los antecedentes del investigado:
   - Extremo "mínimo": el descargo presenta una justificación creíble y, si invoca una circunstancia regulada por una directiva dada, cumple los requisitos que esa directiva exige; o presenta atenuantes claras (caso fortuito, fuerza mayor, primera vez, error excusable); y no hay antecedentes relevantes.
   - Extremo "medio": el descargo no logra desvirtuar el hecho ni presenta atenuantes suficientes, se limita a reconocer los hechos, o invoca una circunstancia regulada por directiva pero sin acreditar cumplir todos sus requisitos.
   - Extremo "máximo": el descargo no aporta justificación válida, contradice lo actuado, confirma agravantes (reincidencia, mala fe, afectación a terceros), o el investigado registra antecedentes disciplinarios previos (especialmente de la misma infracción), aun si el descargo en sí parece razonable.
3. "analisis_texto": el párrafo completo de "Análisis y Evaluación", en español jurídico-administrativo formal, que: (a) mencione que se recibió y evaluó el descargo (o su ausencia), (b) valore brevemente sus argumentos, (c) si aplica una directiva dada, cítala por su título/número tal como se te dio y aplica textualmente su exigencia; si no hay directiva aplicable pese a que el descargo invoca algo que normalmente la requeriría, dilo expresamente como se explicó arriba, (d) si hay antecedentes, menciónalos como agravante conforme al artículo 31, (e) cite el artículo 31 de la Ley N° 30714 sobre los criterios para la imposición de sanciones (siempre válido citarlo aunque no haya más normas dadas), (f) concluya justificando el tercio elegido, y (g) cierre con un párrafo aparte de "Verificación de principios de la potestad sancionadora administrativa" citando textualmente "artículo 230 del Texto Único Ordenado de la Ley N° 27444, Ley del Procedimiento Administrativo General, aprobado por Decreto Supremo N° 006-2026-JUS" (esta es la cita exacta y vigente, verificada contra el texto oficial publicado en El Peruano el 30 de abril de 2026 -- no la cambies ni uses otro número de artículo) y que recorra EXPLÍCITAMENTE, uno por uno, los once principios que ese artículo establece: Legalidad, Debido Procedimiento, Razonabilidad, Tipicidad, Irretroactividad, Concurso de Infracciones, Continuación de Infracciones, Causalidad, Presunción de Licitud, Culpabilidad y Non Bis In Idem -- con una frase breve y específica al caso concreto que explique por qué el procedimiento y la sanción lo respetan (o, si alguno no aplica al caso, dilo expresamente en vez de omitirlo en silencio).

Reglas estrictas adicionales:
- No inventes hechos, fechas, números de documento, normas, directivas o citas legales que no te hayan dado explícitamente. Fuera del artículo 31 de la Ley N° 30714, el artículo 230 del TUO de la Ley N° 27444 (con sus once principios) y de las directivas que se te proporcionaron literalmente, no cites ninguna otra norma.
- No omitas ninguno de los once principios de la potestad sancionadora en el párrafo de verificación.
- "tercio_value" debe ser EXACTAMENTE uno de los valores de la lista de opciones proporcionada (campo "value"), sin alterarlo ni un carácter.
- Si no se te dio lista de antecedentes o está vacía, no menciones antecedentes en el análisis.
- Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con exactamente estas claves: {"descargo_texto": "...", "tercio_value": "...", "analisis_texto": "..."}`;

function buildUserMessage(input: Record<string, unknown>): string {
  const antecedentes = Array.isArray(input.antecedentes) ? input.antecedentes : [];
  const directivas = Array.isArray(input.directivas) ? input.directivas : [];
  const directivasTexto = directivas.length
    ? directivas.map((d: { titulo?: string; numero_documento?: string; contenido?: string }, i: number) =>
        `--- Directiva ${i + 1}: ${d.titulo || "(sin título)"}${d.numero_documento ? ` (${d.numero_documento})` : ""} ---\n${(d.contenido || "").slice(0, 12000)}`
      ).join("\n\n")
    : "(no se proporcionaron directivas internas al sistema; si el descargo invoca una circunstancia que normalmente requeriría una, dilo expresamente en vez de asumir requisitos)";
  return [
    `Investigado: ${input.investigadoCompleto || ""}`,
    `Código de infracción: ${input.codigoInfraccion || ""}`,
    `Texto de la infracción (Anexo I): ${input.infraccionTexto || ""}`,
    `Hechos del caso: ${input.hechoResumen || ""}`,
    `Opciones de tercio disponibles (elige el "value" de una, exactamente): ${JSON.stringify(input.tercios || [])}`,
    `Antecedentes disciplinarios previos de este investigado en el sistema (${antecedentes.length}): ${JSON.stringify(antecedentes)}`,
    `Descargo del investigado (notas del oficial o texto extraído del documento, puede tener ruido de OCR): ${input.descargoNotas || "(no hay descargo ni notas)"}`,
    `Notas del oficial para el análisis y evaluación: ${input.analisisNotas || "(no escribió notas)"}`,
    `Directivas internas vigentes proporcionadas por el administrador:\n${directivasTexto}`,
  ].join("\n");
}

function extraerTexto(data: { content?: Array<{ type?: string; text?: string }> }): string {
  return (data.content || [])
    .filter((b) => b && (b.type === "text" || typeof b.text === "string"))
    .map((b) => b.text || "")
    .join("");
}

async function llamarIA(system: string, userMessage: string, maxTokens: number) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userMessage }],
    }),
  });
  return resp;
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
    const userMessage = buildUserMessage(input);
    console.log("redactar-analisis: input chars", userMessage.length, "directivas", Array.isArray(input.directivas) ? input.directivas.length : 0);

    let resp: Response;
    try {
      resp = await llamarIA(SYSTEM_PROMPT, userMessage, 8000);
    } catch (fetchErr) {
      console.error("redactar-analisis: fetch a Anthropic falló", String(fetchErr));
      return new Response(JSON.stringify({ error: "No se pudo contactar a la IA. Intente de nuevo." }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    if (!resp.ok) {
      const errText = await resp.text();
      console.error("redactar-analisis: Anthropic respondió", resp.status, errText.slice(0, 2000));
      return new Response(JSON.stringify({ error: "La IA no está disponible en este momento. Intente de nuevo." }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    let text = extraerTexto(data);
    console.log("redactar-analisis: stop_reason", data.stop_reason, "bloques", JSON.stringify((data.content || []).map((b: { type?: string }) => b.type)), "usage", JSON.stringify(data.usage || {}), "chars_texto", text.length);

    // Si la primera respuesta se quedó sin texto (por ejemplo el modelo agotó
    // el presupuesto "pensando"), se reintenta una vez pidiendo directamente
    // solo el JSON, con menos exigencia de razonamiento.
    if (!text.trim()) {
      const reintento = await llamarIA(
        SYSTEM_PROMPT + "\n\nIMPORTANTE: responde de inmediato solo con el objeto JSON pedido, sin razonamiento previo.",
        userMessage,
        8000,
      );
      if (reintento.ok) {
        const data2 = await reintento.json();
        text = extraerTexto(data2);
        console.log("redactar-analisis: reintento stop_reason", data2.stop_reason, "chars_texto", text.length);
      }
    }

    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      console.error("redactar-analisis: la IA no devolvió JSON. chars", text.length, "muestra", text.slice(0, 300));
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
    console.error("redactar-analisis: excepción", String(err));
    return new Response(JSON.stringify({ error: "Error interno al procesar la solicitud. Intente de nuevo." }), {
      status: 500,
      headers: { ...cors, "Content-Type": "application/json" },
    });
  }
});
