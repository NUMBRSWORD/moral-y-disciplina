import { inferir } from "../_shared/ollama.ts";
import { autorizar, corsHeaders } from "../_shared/acceso.ts";

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

const SYSTEM_PROMPT_EXPEDIENTE = `Eres un asistente que lee un EXPEDIENTE DISCIPLINARIO YA TERMINADO de la Policía Nacional del Perú (PNP) por infracción leve, a partir de texto sacado por reconocimiento óptico de un escaneo (trae ruido: membretes, sellos, "CONFIDENCIAL", firmas, huellas, "0" por "O").

El expediente reúne varios documentos seguidos: el inicio de imputación, sus notificaciones firmadas, el acta de descargo o de no recepción, y la orden de sanción.

Devuelve SOLO este objeto JSON:
- "numero_nota_falta": el número de la Nota Informativa de la falta (12 dígitos, junto a "NOTA INFORMATIVA N°", antes del guion que lo pega a la unidad). Si hay varias, la PRIMERA que cite la descripción del hecho. String o null.
- "cip_investigado": el CIP del INVESTIGADO (6 a 9 dígitos). Va impreso en la decisión de la orden ("SANCIONAR al ... CIP N° ...") y en el acta ("PRESUNTO INFRACTOR ... identificado con CIP N°..."). CUIDADO: en la misma página aparecen los CIP del superior que sanciona y del testigo; NO los devuelvas. String o null.
- "codigo_infraccion": el código del Anexo I, sin guion ni espacios ("L21", "L24"). String o null.
- "dias_sancion": los días REALMENTE IMPUESTOS. Entero, 0 si es amonestación, null si no se resolvió.
- "tipo_sancion": "simple", "rigor" o "amonestacion". null si no consta.
- "resultado": "sancion" si hay orden de sanción, "archivo" si se resolvió archivar, "incompleto" si no consta ninguna de las dos.

AVISO SOBRE LOS DÍAS, que es el error más fácil de cometer: en un mismo expediente conviven hasta TRES cifras de días y solo una vale.
1. El RANGO del Anexo I ("Sanción: De 8 a 10 días de Sanción Simple", "De AMONESTACION a CUATRO (04) días"). Sale DOS veces: en la imputación y otra vez dentro de la propia orden, en "Descripción de la infracción". NO es lo impuesto.
2. El PLAZO PARA IMPUGNAR ("tres (3) días hábiles"). NO es una sanción.
3. La DECISIÓN, que es la única válida: "V. DECISIÓN: ... SANCIONAR al ... con ocho (08) días de Sanción Simple", o el campo "SANCIÓN IMPUESTA" del formato antiguo.
Si no encuentras ni decisión ni campo "SANCIÓN IMPUESTA", devuelve dias_sancion null. NUNCA uses el rango ni el plazo como respuesta.

No inventes. Lo que no puedas leer con certeza va como null.

Responde ÚNICAMENTE con ese objeto JSON, sin texto antes ni después.`;

function buildUserMessageExpediente(input: Record<string, unknown>): string {
  return `Texto del expediente firmado, sacado por reconocimiento óptico (puede tener ruido):\n${input.texto || "(vacío)"}`;
}

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

export const atender = async (req: Request) => {
  const cors = corsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  const rechazo = await autorizar(req, cors);
  if (rechazo) return rechazo;

  try {
    const input = await req.json();
    const esRol = input.tipo === "rol_servicio";
    const esExpediente = input.tipo === "expediente_firmado";
    const system = esExpediente ? SYSTEM_PROMPT_EXPEDIENTE : esRol ? SYSTEM_PROMPT_ROL : SYSTEM_PROMPT;
    const userMessage = esExpediente
      ? buildUserMessageExpediente(input)
      : esRol ? buildUserMessageRol(input) : buildUserMessage(input);

    const resp = await inferir({
        max_tokens: 6000,
        system,
        messages: [{ role: "user", content: userMessage }],
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
};
