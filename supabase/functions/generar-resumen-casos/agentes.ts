import { inferir } from "../_shared/ollama.ts";

const clavesPorAgente: Record<string, string[]> = {
  jornada: ["vencidas","hoy","confirmar","sin_fecha","proximas","mes_anterior"],
  parte: ["casos","efectivos","sin_cip","reportadas","recibidas"],
  expediente: ["nota","archivo","codigo","informe","reincorporacion","imputacion","descargo","evaluacion","notificar","legajo","fisico","remision","oficio","ht","remitido","dias","numero_oficio","numero_ht"]
};
type Hecho = { clave: string; titulo: string; cantidad: number };
type Entrada = { agente?: string; hechos?: Hecho[]; pregunta?: string };

export async function responderAgente(input: Entrada, headers: Record<string,string>, esAdmin: () => Promise<boolean>) {
  const responder = (body: object, status = 200) => Response.json(body, { status, headers });
  const agente = input.agente || "";
  const permitidas = Object.hasOwn(clavesPorAgente, agente) ? clavesPorAgente[agente] : [];
  const hechos = input.hechos;
  if (!permitidas.length || typeof input.pregunta !== "string" || !input.pregunta.trim() || input.pregunta.length > 350 ||
      !Array.isArray(hechos) || !hechos.length || hechos.length > permitidas.length ||
      hechos.some(h => !h || !permitidas.includes(h.clave) || typeof h.titulo !== "string" || h.titulo.length > 110 ||
        !Number.isSafeInteger(h.cantidad) || h.cantidad < 0)) return responder({error:"Consulta inválida."}, 400);
  if (agente === "parte" && !await esAdmin()) return responder({error:"Se requiere el perfil de administrador."}, 403);
  const claves = hechos.map(h => h.clave);
  const esquema = {type:"object", properties:{claves:{type:"array", items:{type:"string",enum:claves}}}, required:["claves"], additionalProperties:false};
  const evidencia = hechos.map(({clave,titulo,cantidad}) => ({clave,titulo,cantidad}));
  const resp = await inferir({
    max_tokens:220, contexto:2048, output_config:{format:{schema:esquema}},
    system:"Elige los indicadores de la lista que contestan directamente a la pregunta de la oficina. Para una pregunta específica devuelve solo la clave más precisa, salvo si se piden expresamente varias categorías. Por ejemplo, una pregunta sobre entregas reportadas pendientes de recepción solo corresponde al indicador de confirmación física. Devuelve las claves por relevancia. Un indicador con valor cero también responde. Si la pregunta no se puede responder con estos indicadores devuelve una lista vacía. Para un panorama general incluye los indicadores relevantes. Usa solo el JSON del esquema.",
    messages:[{role:"user",content:JSON.stringify({pregunta:input.pregunta,indicadores:evidencia})}]
  });
  const salida = await resp.json();
  const seleccion = JSON.parse(salida.content[0].text).claves;
  if (!Array.isArray(seleccion) || salida.stop_reason === "max_tokens" || seleccion.some(k => !claves.includes(k)))
    return responder({error:"La oficina no pudo verificar la respuesta del modelo."}, 502);
  return responder({claves:[...new Set(seleccion)]});
}
