// Cuentas y paso de "entrar con CIP" a "entrar con Google". Funciones puras.
//
// Cada forma de entrar es una cuenta distinta en Supabase, con su propio token.
// Desde octubre de 2026 se entra con Google: la persona pide acceso con su CIP,
// el administrador la aprueba y su cuenta antigua de CIP se retira (no se borra:
// figura como autora de notas y documentos). Los administradores conservan su
// cuenta de CIP como acceso de emergencia.

export const DOMINIO_CIP = "@moralydisciplina.local";

export function esCuentaCip(email) {
  return String(email || "").toLowerCase().endsWith(DOMINIO_CIP);
}

export function cipDeCuenta(perfil) {
  if (!perfil) return null;
  if (perfil.cip) return String(perfil.cip);
  return esCuentaCip(perfil.email) ? String(perfil.email).split("@")[0] : null;
}

/**
 * Qué ve una persona que entró pero aún no puede operar.
 * "aprobada" | "formulario" (falta su solicitud) | "en_revision" | "rechazada" | "retirada"
 * (cuenta de CIP dada de baja tras pasar a Google).
 */
export function vistaDeAcceso(perfil, tieneSolicitud) {
  const estado = perfil?.estado;
  if (estado === "aprobado") return "aprobada";
  if (estado === "rechazado") return esCuentaCip(perfil?.email) ? "retirada" : "rechazada";
  return tieneSolicitud ? "en_revision" : "formulario";
}

const limpio = (v) => String(v ?? "").trim();

/** Normaliza y valida la solicitud. Devuelve { datos } o { error }. Mismas reglas que la base. */
export function validarSolicitud(entrada) {
  const datos = {
    grado: limpio(entrada.grado),
    apellidos: limpio(entrada.apellidos).toUpperCase(),
    nombres: limpio(entrada.nombres).toUpperCase(),
    cip: limpio(entrada.cip),
    dni: limpio(entrada.dni),
    telefono: limpio(entrada.telefono).replace(/[\s-]/g, ""),
  };
  if (!datos.grado) return { error: "Escriba su grado." };
  if (!datos.apellidos || !datos.nombres) return { error: "Escriba sus apellidos y nombres." };
  if (!/^\d{4,12}$/.test(datos.cip)) return { error: "El CIP son solo números." };
  if (!/^\d{8}$/.test(datos.dni)) return { error: "El DNI son 8 dígitos." };
  if (!/^\d{9}$/.test(datos.telefono)) return { error: "El teléfono son 9 dígitos." };
  if (!entrada.acepta) return { error: "Para continuar debe aceptar los términos y la política de datos." };
  return { datos };
}

/**
 * Ordena las cuentas para la pestaña Cuentas del administrador.
 * - porAprobar: solicitudes de cuentas pendientes; `cuentaCip` es la cuenta antigua de
 *   ese mismo CIP que se retirará al aprobar (si sigue activa y no es de administrador).
 * - porRetirar: cuentas de CIP activas cuyo dueño ya tiene una cuenta de Google aprobada
 *   con el mismo CIP (quedaron así si se aprobaron antes de existir esta pestaña).
 * - porMigrar: cuentas de CIP activas de usuarios que aún no entran con Google.
 */
export function organizarCuentas(perfiles = [], solicitudes = []) {
  const solicitudDe = new Map(solicitudes.map((s) => [s.user_id, s]));
  const cuentasCipActivas = perfiles.filter((p) => esCuentaCip(p.email) && p.estado === "aprobado" && p.role !== "admin");
  const cipAntigua = new Map(cuentasCipActivas.map((p) => [cipDeCuenta(p), p]));
  const googleAprobadas = new Map(perfiles
    .filter((p) => !esCuentaCip(p.email) && p.estado === "aprobado" && cipDeCuenta(p))
    .map((p) => [cipDeCuenta(p), p]));

  const porAprobar = perfiles
    .filter((p) => p.estado === "pendiente" && solicitudDe.has(p.id))
    .map((p) => {
      const solicitud = solicitudDe.get(p.id);
      return { perfil: p, solicitud, cuentaCip: cipAntigua.get(String(solicitud.cip)) || null };
    })
    .sort((a, b) => String(a.solicitud.creado_at || "").localeCompare(String(b.solicitud.creado_at || "")));

  const porRetirar = cuentasCipActivas
    .filter((p) => googleAprobadas.has(cipDeCuenta(p)))
    .map((p) => ({ cuentaCip: p, cuentaGoogle: googleAprobadas.get(cipDeCuenta(p)) }));

  const enCamino = new Set(porAprobar.map((x) => x.cuentaCip?.id).filter(Boolean));
  const porMigrar = cuentasCipActivas
    .filter((p) => !googleAprobadas.has(cipDeCuenta(p)) && !enCamino.has(p.id))
    .sort((a, b) => cipDeCuenta(a).localeCompare(cipDeCuenta(b)));

  const sinSolicitud = perfiles.filter((p) => p.estado === "pendiente" && !solicitudDe.has(p.id));
  return { porAprobar, porRetirar, porMigrar, sinSolicitud };
}
