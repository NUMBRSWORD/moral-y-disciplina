import { decidirRespaldo, esperaPara, FUNCIONES_IA } from "./pasarela.ts";
import { autorizar, recordarAutorizacion } from "../_shared/acceso.ts";
import { emitirReserva } from "../_shared/reserva.mjs";
import { atender as analizarDescargo } from "../analizar-descargo-sancion/handler.ts";
import { atender as asistenteMd } from "../asistente-md/handler.ts";
import { atender as asistenteNormativa } from "../asistente-normativa/handler.ts";
import { atender as extraerNota } from "../extraer-nota-informativa/handler.ts";
import { atender as extraerTexto } from "../extraer-texto-vision/handler.ts";
import { atender as resumenCasos } from "../generar-resumen-casos/handler.ts";
import { atender as redactarAnalisis } from "../redactar-analisis/handler.ts";
import { atender as redactarHecho } from "../redactar-hecho-imputacion/handler.ts";
import { atender as revisarDocumento } from "../revisar-documento-ia/handler.ts";
import { atender as sugerirCodigo } from "../sugerir-codigo-infraccion/handler.ts";

// La web manda aquí todas las consultas de IA. La consulta se cuenta una sola vez
// (aquí) y primero se intenta la PC de la oficina (Ollama) con un comprobante firmado
// de esa reserva; si no está configurada, no contesta a tiempo o responde algo que
// no sirve, la misma función se ejecuta aquí con Claude sin volver a contarla.
const MAX_BYTES = 25 * 1024 * 1024;
const funciones: Record<string, (r: Request) => Promise<Response>> = {
  "analizar-descargo-sancion": analizarDescargo, "asistente-md": asistenteMd, "asistente-normativa": asistenteNormativa,
  "extraer-nota-informativa": extraerNota, "extraer-texto-vision": extraerTexto, "generar-resumen-casos": resumenCasos,
  "redactar-analisis": redactarAnalisis, "redactar-hecho-imputacion": redactarHecho, "revisar-documento-ia": revisarDocumento,
  "sugerir-codigo-infraccion": sugerirCodigo,
};

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "https://numbrsword.github.io",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Expose-Headers": "x-motor-ia",
  };
  const error = (status: number, mensaje: string) => Response.json({ error: mensaje }, { status, headers: cors });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const nombre = new URL(req.url).pathname.split("/").pop() || "";
  const handler = funciones[nombre];
  if (req.method !== "POST" || !FUNCIONES_IA.has(nombre) || !handler) return error(404, "Operación desconocida.");
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return error(401, "Inicie sesión.");
  const cuerpo = new Uint8Array(await req.arrayBuffer());
  if (cuerpo.byteLength > MAX_BYTES) return error(413, "El archivo es demasiado grande.");

  const interna = () => new Request(req.url, { method: "POST", body: cuerpo,
    headers: { "Authorization": auth, "Content-Type": "application/json", "Origin": "https://numbrsword.github.io" } });
  const rechazo = await autorizar(interna(), cors);
  if (rechazo) return rechazo;

  const responder = (r: Response, cuerpoRespuesta: BodyInit | null, motor: string) =>
    new Response(cuerpoRespuesta, { status: r.status, headers: { ...cors, "Content-Type": "application/json", "x-motor-ia": motor } });

  const base = Deno.env.get("IA_OFICINA_HTTPS");
  const llave = Deno.env.get("IA_OFICINA_SECRETO");
  if (base && llave && llave.length >= 32) {
    try {
      const url = new URL("/ia/" + nombre, base);
      if (url.protocol !== "https:") throw new Error("La pasarela debe usar HTTPS.");
      const r = await fetch(url, {
        method: "POST", redirect: "error",
        headers: { "Authorization": auth, "Content-Type": "application/json", "X-Oficina": llave,
          "X-Reserva-IA": await emitirReserva(llave, url.pathname, auth, cuerpo) },
        body: cuerpo,
        signal: AbortSignal.any([req.signal, AbortSignal.timeout(esperaPara(nombre))]),
      });
      const texto = await r.text();
      if (!decidirRespaldo(r.status, r.headers.get("content-type"), texto)) return responder(r, texto, "ollama");
      console.warn(JSON.stringify({ pasarela: "respaldo", funcion: nombre, status: r.status }));
    } catch (e) {
      console.warn(JSON.stringify({ pasarela: "respaldo", funcion: nombre, motivo: String((e as Error)?.name || e) }));
    }
  }
  if (req.signal.aborted) return error(408, "Se canceló la consulta.");

  // Respaldo con Claude en esta misma función: la consulta ya se contó arriba.
  try {
    const copia = interna();
    recordarAutorizacion(copia);
    const r = await handler(copia);
    return responder(r, r.body, "claude");
  } catch {
    return error(503, "La IA no está disponible en este momento. Intente de nuevo.");
  }
});
