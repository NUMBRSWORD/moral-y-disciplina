import { decidirRespaldo, esperaPara, FUNCIONES_IA } from "./pasarela.ts";

// La web manda aquí todas las consultas de IA. Primero se intenta la PC de la
// oficina (Ollama); si no está configurada, no contesta a tiempo o responde
// algo que no es de la pasarela, se usa la misma función en Supabase (Claude).
// Así los teléfonos nunca se quedan sin IA cuando la PC está apagada.
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const MAX_BYTES = 25 * 1024 * 1024;

Deno.serve(async (req) => {
  const cors = {
    "Access-Control-Allow-Origin": "https://numbrsword.github.io",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Expose-Headers": "x-motor-ia",
  };
  const error = (status: number, mensaje: string) => Response.json({ error: mensaje }, { status, headers: cors });
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  const nombre = new URL(req.url).pathname.split("/").pop() || "";
  if (req.method !== "POST" || !FUNCIONES_IA.has(nombre)) return error(404, "Operación desconocida.");
  const auth = req.headers.get("Authorization");
  if (!auth?.startsWith("Bearer ")) return error(401, "Inicie sesión.");
  const cuerpo = await req.arrayBuffer();
  if (cuerpo.byteLength > MAX_BYTES) return error(413, "El archivo es demasiado grande.");

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
        headers: { "Authorization": auth, "Content-Type": "application/json", "X-Oficina": llave },
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

  // Respaldo: la función de Supabase con Claude. Ella misma valida la sesión y la cuota.
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/${nombre}`, {
      method: "POST",
      headers: {
        "Authorization": auth,
        "Content-Type": "application/json",
        "apikey": req.headers.get("apikey") || "",
        "Origin": "https://numbrsword.github.io",
      },
      body: cuerpo,
      signal: req.signal,
    });
    return responder(r, r.body, "claude");
  } catch {
    return error(503, "La IA no está disponible en este momento. Intente de nuevo.");
  }
});
