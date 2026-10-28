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

// Reemplaza a tesseract.js (OCR genérico en el navegador) para leer PDFs
// escaneados e imágenes: en vez de un motor de OCR ciego, le mandamos las
// páginas como imágenes a un modelo con visión para que las transcriba. Es
// más lento por página que tesseract, pero muchísimo más preciso en
// documentos reales (sellos, membretes, tablas, escaneos de mala calidad) --
// y como corre en el servidor, además libera al navegador del oficial.
const SYSTEM_PROMPT = `Eres un transcriptor de documentos oficiales peruanos (normas, reglamentos, directivas, oficios). Se te dan una o más imágenes, cada una una página de un mismo documento, en orden.

Tu única tarea es transcribir EXACTAMENTE el texto visible en cada imagen, en el orden en que aparecen las páginas. Reglas estrictas:
- No resumas, no comentes, no traduzcas, no corrijas redacción ni ortografía del original.
- Preserva la estructura: numeración de artículos, incisos, párrafos, mayúsculas de títulos.
- Si una página tiene tablas, transcribe el contenido de cada celda en un orden legible (fila por fila), no inventes columnas que no existan.
- Ignora elementos puramente decorativos (logos, líneas divisorias) pero SÍ transcribe sellos, membretes y pies de página si tienen texto legible.
- Si una palabra o fragmento es completamente ilegible, márcalo como [ilegible] en vez de adivinar o inventar texto.
- No agregues encabezados, numeración de página propia, ni ningún texto que no esté literalmente en la imagen.

Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con exactamente esta clave: {"texto": "..."} -- el texto de TODAS las páginas dadas, concatenado en orden, separado por un salto de línea doble entre páginas.`;

// Marca de corte entre páginas. Quien lee un fajo de expedientes necesita saber
// en qué página empieza cada uno para poder recortar el PDF, y eso se pierde si
// las páginas vuelven pegadas. Pedir la marca permite seguir mandándolas de a
// varias por llamada sin perder el límite; el servidor comprueba que vuelvan
// todas y, si la cuenta no cuadra, lo dice para que el cliente repita ese lote
// de a una en vez de quedarse con un corte inventado.
const MARCA_DE_PAGINA = "<<<FIN DE PAGINA>>>";

const SYSTEM_PROMPT_SEPARADO = `${SYSTEM_PROMPT}

ADEMÁS, y esto es obligatorio: escribe la marca ${MARCA_DE_PAGINA} entre una página y la siguiente, en una línea aparte. Va SOLO entre páginas: si te dan N páginas, la marca aparece exactamente N-1 veces, nunca al principio ni al final. Si una página está en blanco o es ilegible entera, deja su hueco vacío pero pon igual su marca: el orden y la cantidad tienen que coincidir con las imágenes dadas.`;

// La respuesta debería ser {"texto": "..."}, pero no se pierde la lectura si
// llega distinta: JSON válido → su "texto"; JSON cortado (se acabó el margen) →
// lo que alcanzó a escribir; texto suelto → ese texto. Antes cualquiera de esos
// casos devolvía 502 y la nota quedaba "sin detectar".
function textoDeLaRespuesta(bruto: string): string {
  const limpio = bruto.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const match = limpio.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const obj = JSON.parse(match[0]);
      if (typeof obj?.texto === "string") return obj.texto;
    } catch (_) { /* sigue abajo */ }
  }
  const inicio = limpio.match(/^\{\s*"texto"\s*:\s*"/);
  if (inicio) {
    let resto = limpio.slice(inicio[0].length).replace(/"\s*\}\s*$/, "");
    try { resto = JSON.parse(`"${resto.replace(/\\?$/, "")}"`); } catch (_) {
      resto = resto.replace(/\\n/g, "\n").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
    return resto;
  }
  return limpio;
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
    const paginas = Array.isArray(input.paginas) ? input.paginas : [];
    if (!paginas.length) {
      return new Response(JSON.stringify({ error: "No se recibió ninguna página para transcribir." }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    if (paginas.length > 8) {
      return new Response(JSON.stringify({ error: "Máximo 8 páginas por solicitud." }), {
        status: 400,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }

    // Quien necesita saber dónde acaba cada página lo pide con `separar`. El
    // resto de la web sigue recibiendo exactamente lo de siempre.
    const separar = input.separar === true && paginas.length > 1;

    const content = [
      ...paginas.map((p: { data?: string; mediaType?: string }) => ({
        type: "image",
        source: { type: "base64", media_type: p.mediaType || "image/jpeg", data: p.data || "" },
      })),
      {
        type: "text",
        text: separar
          ? `Transcribe estas ${paginas.length} páginas, en el orden dado, separando una de otra con ${MARCA_DE_PAGINA}.`
          : `Transcribe estas ${paginas.length} página(s), en el orden dado.`,
      },
    ];

    // ~2000 tokens de salida por página más un margen. Con 900 por página, una
    // nota con tabla, distribución y sellos se cortaba antes de cerrar el JSON y
    // la lectura fallaba con 502 ("formato no reconocible").
    const maxTokens = Math.min(16000, 2000 * paginas.length + 500);

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system: separar ? SYSTEM_PROMPT_SEPARADO : SYSTEM_PROMPT,
        messages: [{ role: "user", content }],
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
    const text = (data.content || []).map((b: { text?: string }) => b.text || "").join("");
    // Solo datos de diagnóstico, nunca el contenido (trae datos personales).
    console.log(JSON.stringify({ lectura: true, paginas: paginas.length, stop_reason: data.stop_reason, caracteres: text.length }));
    if (data.stop_reason === "refusal" || !text.trim()) {
      return new Response(JSON.stringify({ error: "La IA no pudo leer este documento. Pruebe con un escaneo más nítido o complete los datos a mano." }), {
        status: 422,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const parsed: { texto: string; paginas?: string[] | null } = { texto: textoDeLaRespuesta(text) };

    if (separar) {
      // Se devuelve el corte SOLO si la cuenta cuadra con las imágenes que se
      // mandaron. Un corte a medias sería peor que ninguno: mandaría páginas de
      // un expediente al expediente de otra persona. Con `paginas: null` el
      // cliente sabe que tiene que repetir este lote de a una.
      const partes = String(parsed.texto || "").split(MARCA_DE_PAGINA);
      parsed.paginas = partes.length === paginas.length ? partes.map((t: string) => t.trim()) : null;
    }

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
