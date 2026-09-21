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

const SYSTEM_PROMPT = `Eres un asistente que extrae datos estructurados de una Nota Informativa de la Policía Nacional del Perú (PNP), a partir de texto extraído automáticamente de un PDF (a veces por OCR, puede traer ruido: encabezados, membretes, sellos, saltos de línea raros, errores de reconocimiento como "0" en vez de "O", o "N°" mal reconocido).

Se te da el "tipo" de nota:
- "falta": la Nota Informativa que da cuenta de que uno o más efectivos faltaron/se ausentaron de la formación o servicio.
- "reincorporacion": la Nota Informativa que da cuenta de que el efectivo se reincorporó (regresó) tras la falta.

Debes devolver un objeto JSON con exactamente estas claves:
- "numero_nota": el número de ESTA nota informativa (el que aparece junto a "NOTA INFORMATIVA N°" — si el tipo es "reincorporacion" y hay dos menciones de "NOTA INFORMATIVA N°", usa la PRIMERA, que es el número de esta nota, no el de la nota de falta original referenciada). String o null si no aparece con certeza.
- "numero_nota_referencia": SOLO para tipo "reincorporacion": el número de la nota informativa de la FALTA ORIGINAL, mencionada como referencia ("REF." o similar, normalmente la segunda mención de "NOTA INFORMATIVA N°" en el texto). Para tipo "falta", siempre null.
- "fecha": la fecha del hecho (de la falta si tipo="falta", de la reincorporación si tipo="reincorporacion") en formato "YYYY-MM-DD". null si no se puede determinar con certeza. Cuidado: en notas de reincorporación NO uses la fecha de la falta original (que también puede aparecer mencionada), sino la fecha en que se reincorporó.
- "hora": la hora del hecho correspondiente (de la falta si tipo="falta", de la reincorporación si tipo="reincorporacion") en formato "HH:MM" (24 horas). null si no se puede determinar.
- "oficial_constato": SOLO para tipo "falta": el nombre completo (con grado) del oficial que constató la falta, tal como aparece en el texto, justo antes o cerca de la palabra "constató"/"constató". null si no aparece o es tipo "reincorporacion".
- "candidatos": lista de los efectivos policiales mencionados como quienes faltaron (tipo="falta") o se reincorporaron (tipo="reincorporacion") — puede haber uno o varios (notas grupales). Cada elemento: {"grado": "...", "apellidos": "...", "nombres": "..."}. El grado es la abreviatura tal como aparece (p.ej. "S2", "TNTE", "CAP"), sin la palabra "PNP". Separa apellidos (normalmente los 2 primeros apellidos) de nombres correctamente aunque el texto no traiga coma. Si no se detecta a nadie con certeza, devuelve una lista vacía.

Reglas estrictas:
- No inventes datos que no estén respaldados por el texto. Si algo no se puede determinar con razonable certeza, usa null (o lista vacía para candidatos).
- Corrige errores obvios de OCR (como "0" por "O" en meses, o símbolos raros en "N°") solo cuando el sentido es evidente por el contexto.
- Responde ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después, con exactamente estas claves: {"numero_nota": "...", "numero_nota_referencia": "...", "fecha": "YYYY-MM-DD", "hora": "HH:MM", "oficial_constato": "...", "candidatos": [{"grado": "...", "apellidos": "...", "nombres": "..."}]}`;

const SYSTEM_PROMPT_ROL = `Eres un asistente que lee el ROL DE SERVICIO DIARIO de la Comisaría PNP Ventanilla (REGPOL Callao). Es una tabla larga con columnas: N° | GRADO | PNP | "APELLIDOS Nombres" | PUESTO O SERVICIO ASIGNADO | (a veces) SECTOR o DETALLE. Tiene encabezados de sección que agrupan al personal (servicio 24x24, patrullaje motorizado con placa y CONDUCTOR/OPERADOR, administrativo, secciones FAMILIA/INVESTIGACIÓN, apoyo DIROES) y al final una sección de NOVEDADES con subgrupos: "PERSONAL PNP FALTOS AL SERVICIO", "PERSONAL PNP CON DESCANSO MEDICO", "OTROS" (FRANCO, PERMISO A CUENTA DE VACACIONES, LICENCIAS, VACACIONES, SUSPENSIÓN TEMPORAL DEL SERVICIO, PERMISO POR ONOMÁSTICO, etc.). El texto viene de un PDF y puede tener ruido de OCR.

EN EL ENCABEZADO el rol indica el periodo que cubre, por ejemplo "DEL 10SET26 AL 11SET26 (07:00 A 07:00 HRS.)" (servicio de 24 horas que ARRANCA el 10). Extrae ese periodo.

Se te da el nombre de un efectivo (apellidos y nombres, puede venir sin coma) y la fecha de la falta. Busca a esa persona por sus APELLIDOS (tolera OCR y tildes). Devuelve SOLO este JSON:

- "fecha_rol_inicio": fecha de inicio del periodo del rol en "YYYY-MM-DD" (de "DEL 10SET26..." => "2026-09-10"). null si no aparece.
- "fecha_rol_fin": fecha de fin del periodo en "YYYY-MM-DD". null si no aparece o es el mismo día.
- "encontrado": true si ubicaste a la persona en este rol, false si no.
- "puesto": frase corta EN MAYÚSCULAS con el servicio/puesto asignado tal como figura en su fila, uniendo puesto + sector/detalle si lo hay (ej. "OFICIAL DE PATRULLAJE SECTOR: 3 Y 5", "PATRULLAJE MOTORIZADO PAT. TMP-3096 - CONDUCTOR", "SECCION DE FAMILIA", "PERSONAL DE APOYO DIROES PNP"). null si la persona está en NOVEDADES sin puesto de servicio, o no se encontró.
- "situacion": según la sección bajo la que aparece: "servicio" | "falto" | "descanso_medico" | "vacaciones" | "permiso" | "franco" | "suspension" | "otro". null si no se encontró.
- "detalle_novedad": si la situación NO es "servicio", copia el texto de la novedad tal como figura (ej. "CINCO (05) DIAS DEL 08SET2026 AL 13SET2026 VACACIONES PERSONAL DIROES"). null en otro caso.

IMPORTANTE: este rol vale SOLO para el periodo de su encabezado. NO deduzcas la situación de la persona para otra fecha distinta. Reportá lo que dice ESTE rol; el cliente comparará las fechas.

No inventes. Si la persona no aparece, {"encontrado": false, "puesto": null, "situacion": null, "detalle_novedad": null} (igual con fecha_rol_inicio/fin si se leen).

Responde ÚNICAMENTE con ese objeto JSON, sin texto antes ni después.`;

function buildUserMessage(input: Record<string, unknown>): string {
  return [
    `Tipo de nota: ${input.tipo === "reincorporacion" ? "reincorporacion" : "falta"}`,
    `Texto extraído del PDF (puede tener ruido de OCR):\n${input.texto || "(vacío)"}`,
  ].join("\n\n");
}

function buildUserMessageRol(input: Record<string, unknown>): string {
  return [
    `Efectivo a ubicar en el rol: ${input.persona || "(no indicado)"}`,
    input.fecha ? `Fecha de la falta: ${input.fecha}` : "",
    `Texto extraído del rol de servicio (puede tener ruido de OCR):\n${input.texto || "(vacío)"}`,
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
    const esRol = input.tipo === "rol_servicio";
    const system = esRol ? SYSTEM_PROMPT_ROL : SYSTEM_PROMPT;
    const userMessage = esRol ? buildUserMessageRol(input) : buildUserMessage(input);

    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 6000,
        system,
        messages: [{ role: "user", content: userMessage }],
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
    // Una nota grupal con muchos efectivos daba un JSON más largo que el tope y salía
    // cortado: JSON.parse fallaba y el usuario veía un error 500. Ahora hay más
    // margen y, si aun así se corta, se avisa con claridad en vez de fallar.
    if (data.stop_reason === "max_tokens") {
      return new Response(JSON.stringify({ error: "El documento tiene demasiados efectivos para leerlo de una sola vez. Divídalo en partes e intente de nuevo." }), {
        status: 422,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) {
      return new Response(JSON.stringify({ error: "La IA no devolvió un formato reconocible. Intente de nuevo." }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    let parsed;
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return new Response(JSON.stringify({ error: "La IA devolvió una respuesta incompleta. Intente de nuevo." }), {
        status: 502,
        headers: { ...cors, "Content-Type": "application/json" },
      });
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
