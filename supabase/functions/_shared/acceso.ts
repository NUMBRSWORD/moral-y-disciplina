import { createClient } from "jsr:@supabase/supabase-js@2";

// Acceso común de las funciones de IA: sesión iniciada, cuenta APROBADA y tope diario.
// `verify_jwt` solo comprueba que el token sea un JWT válido (la anon key pública lo es);
// autorizar_uso_ia() exige además un usuario aprobado y cuenta la llamada del día.
// Con una reserva verificada (la consulta ya se contó en ia-oficina) solo se comprueba
// la aprobación, para que una misma consulta no se cuente dos veces.
const autorizadas = new WeakSet<Request>();
export const limiteBytes = 25 * 1024 * 1024;
const LIMITE_DIARIO = 300;

// Restringir el origen es solo higiene: la protección real es la sesión.
export function corsHeaders(req: Request) {
  const origen = req.headers.get("origin") || "";
  const web = "https://numbrsword.github.io";
  return {"Access-Control-Allow-Origin": origen === web || /^http:\/\/(?:localhost|127\.0\.0\.1)(:\d+)?$/.test(origen) ? origen : web,
    "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type", "Vary":"Origin"};
}

export function clienteUsuario(req: Request) {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global:{headers:{Authorization:req.headers.get("authorization") || ""}}, auth:{persistSession:false}
  });
}

// La autorización vale solo para el objeto Request interno que ya pasó los controles.
export function recordarAutorizacion(req: Request) { autorizadas.add(req); }

// null = puede continuar; si no, la respuesta con la que se rechaza.
export async function autorizar(req: Request, cors: Record<string, string> = corsHeaders(req), reservaVerificada = false): Promise<Response | null> {
  const rechazo = (status: number, error: string) => Response.json({error},{status,headers:cors});
  if (Number(req.headers.get("content-length") || 0) > limiteBytes) return rechazo(413,"El archivo es demasiado grande.");
  if (autorizadas.has(req)) return null;
  const token = req.headers.get("authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token || !Deno.env.get("SUPABASE_URL") || !Deno.env.get("SUPABASE_ANON_KEY")) return rechazo(401,"Debe iniciar sesión.");
  try {
    const cliente = clienteUsuario(req);
    const sesion = await cliente.auth.getUser(token);
    if (sesion.error || !sesion.data.user) return rechazo(sesion.error?.status && sesion.error.status >= 500 ? 503 : 401,"Debe iniciar sesión.");
    const consulta = reservaVerificada ? await cliente.rpc("esta_aprobado") : await cliente.rpc("autorizar_uso_ia",{p_limite:LIMITE_DIARIO});
    if (consulta.error) {
      console.error("autorizar:", consulta.error.message);
      return rechazo(503,"No se pudo verificar su acceso. Intente de nuevo.");
    }
    if (consulta.data === "cuota") return rechazo(429,"Alcanzó el límite diario de uso de la IA. Intente mañana.");
    if (consulta.data !== (reservaVerificada ? true : "ok")) return rechazo(403,"Su cuenta no está autorizada para usar la IA.");
    recordarAutorizacion(req);
    return null;
  } catch { return rechazo(503,"No se pudo verificar su acceso. Intente de nuevo."); }
}
