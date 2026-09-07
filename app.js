import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as pdfjsLib from "https://esm.sh/pdfjs-dist@4.6.82/build/pdf.mjs";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import saveAs from "https://esm.sh/file-saver@2.0.5";
import { renderizarImputacionDocx, construirDatosImputacion, puedeGenerarImputacion, buscarOficialConstato, tokens } from "./lib/imputacion.js";
import { renderizarActaNoDescargoDocx, construirDatosActaNoDescargo, puedeGenerarActaNoDescargo, plazoDescargoVencido, fechaLimiteDescargo } from "./lib/actaNoDescargo.js";
import { renderizarOrdenSancionDocx, construirDatosOrdenSancion, puedeGenerarOrdenSancion, opcionesTercio, buildCasoConcreto, analisisSinDescargoDefault } from "./lib/ordenSancion.js";
import { getInfraccion, normalizarCodigoInfraccion } from "./lib/anexoI.js";
import { listarDirectivas, directivasParaIA, guardarDirectiva, eliminarDirectiva, subirArchivoDirectiva } from "./lib/directivas.js";
import { horasAusente, sugerirCodigoInfraccion, nombreCompletoVisible, limpiarNombreVisible } from "./lib/utils.js";
import { Chart } from "https://esm.sh/chart.js@4.4.4/auto";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://esm.sh/pdfjs-dist@4.6.82/build/pdf.worker.mjs";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
  session: null,
  role: null,
  email: null,
  cip: null,
  notas: [],
  efectivos: [],
  currentNotaId: null,
  directivas: [],
  asistenteHistorial: [],
};

// Infracciones que este sistema tramita con Orden de Sanción (por ahora,
// solo L21 y L24): catálogo compacto que se le pasa al asistente flotante
// como contexto, junto con las directivas internas cargadas.
const CATALOGO_ASISTENTE = ["L21", "L24"]
  .map((codigo) => ({ codigo, ...(getInfraccion(codigo) || {}) }));

const $ = (id) => document.getElementById(id);

// ---------- Avisos flotantes ----------
// Reemplaza los `console.error(...)` mudos de las cargas: si algo falla (red,
// permisos, sesión vencida) el oficial ve un aviso en pantalla en vez de creer
// que simplemente "no hay casos".
function toast(mensaje, tipo = "error", ms = 6000) {
  const cont = $("toasts");
  if (!cont) { console[tipo === "error" ? "error" : "log"](mensaje); return; }
  const el = document.createElement("div");
  el.className = `toast is-${tipo === "ok" ? "ok" : tipo === "info" ? "info" : "error"}`;
  el.textContent = mensaje;
  cont.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 220);
  }, ms);
}

// Cuando una Edge Function responde con un status no-2xx, supabase-js entrega
// un FunctionsHttpError genérico ("non-2xx status code") y deja el detalle real
// en el cuerpo de la respuesta (error.context). Esto lo extrae para mostrarlo.
async function mensajeErrorFuncion(error) {
  const generico = error?.message || String(error || "error desconocido");
  try {
    const resp = error?.context;
    if (resp && typeof resp.clone === "function") {
      const cuerpo = await resp.clone().json();
      if (cuerpo?.error) return String(cuerpo.error);
    }
  } catch (_) { /* el cuerpo no era JSON legible */ }
  return generico;
}

// ---------- Borradores locales (autoguardado) ----------
// Los textos largos de la Orden de Sanción (análisis y resumen del descargo)
// se guardan en el navegador mientras se escriben, para no perderlos si se
// navega, se recarga o expira la sesión antes de "Guardar y descargar". Es
// solo del navegador de quien redacta: no toca la base ni a otros usuarios.
const BORRADOR_PREFIJO = "borrador:";
function borradorKey(notaId, campo) { return `${BORRADOR_PREFIJO}${notaId}:${campo}`; }

function guardarBorrador(notaId, campo, texto) {
  try {
    localStorage.setItem(borradorKey(notaId, campo), JSON.stringify({ texto, ts: Date.now() }));
  } catch (_) { /* almacenamiento lleno o bloqueado: se ignora */ }
}
function leerBorrador(notaId, campo) {
  try {
    const raw = localStorage.getItem(borradorKey(notaId, campo));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    return obj && typeof obj.texto === "string" ? obj : null;
  } catch (_) { return null; }
}
function borrarBorrador(notaId, campo) {
  try { localStorage.removeItem(borradorKey(notaId, campo)); } catch (_) {}
}
function limpiarBorradoresNota(notaId) {
  ["analisis", "descargo"].forEach((c) => borrarBorrador(notaId, c));
}

function tiempoRelativo(ts) {
  const seg = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (seg < 10) return "hace un momento";
  if (seg < 60) return `hace ${seg} s`;
  const min = Math.round(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} d`;
}

let debounceBorrador = {};
// Conecta el autoguardado a las dos áreas de texto de la Orden de Sanción y,
// si hay un borrador local distinto de lo que se acaba de cargar, ofrece
// restaurarlo (sin pisar nada automáticamente).
function activarAutoguardadoSancion(nota) {
  const campos = [
    { campo: "analisis", el: $("sSancionAnalisis"), etiqueta: "Análisis y evaluación" },
    { campo: "descargo", el: $("sSancionDescargo"), etiqueta: "Resumen del descargo" },
  ];
  const form = $("sancionForm");
  if (!form) return;

  for (const { campo, el, etiqueta } of campos) {
    if (!el) continue;
    const estado = document.createElement("p");
    estado.className = "campo-guardado";
    estado.id = `guardado-${campo}`;
    el.insertAdjacentElement("afterend", estado);

    el.addEventListener("input", () => {
      clearTimeout(debounceBorrador[campo]);
      debounceBorrador[campo] = setTimeout(() => {
        guardarBorrador(nota.id, campo, el.value);
        estado.textContent = `Borrador guardado ${tiempoRelativo(Date.now())}`;
      }, 700);
    });

    const b = leerBorrador(nota.id, campo);
    if (b && b.texto.trim() && b.texto.trim() !== (el.value || "").trim()) {
      const banner = document.createElement("div");
      banner.className = "borrador-banner";
      banner.innerHTML = `<span class="grow">Hay un borrador local de «${escapeHtml(etiqueta)}» sin guardar (${escapeHtml(tiempoRelativo(b.ts))}).</span>`;
      const restaurar = document.createElement("button");
      restaurar.type = "button";
      restaurar.className = "btn-secondary";
      restaurar.textContent = "Restaurar";
      restaurar.addEventListener("click", () => {
        el.value = b.texto;
        if (campo === "analisis") el.dataset.autofilled = "false";
        banner.remove();
        estado.textContent = "Borrador restaurado.";
      });
      const descartar = document.createElement("button");
      descartar.type = "button";
      descartar.className = "btn-ghost";
      descartar.textContent = "Descartar";
      descartar.addEventListener("click", () => { borrarBorrador(nota.id, campo); banner.remove(); });
      banner.append(restaurar, descartar);
      form.prepend(banner);
    }
  }
}

// ---------- Tema claro/oscuro ----------
// El oscuro sigue siendo el predeterminado (nadie ve un cambio de
// apariencia sin pedirlo); el script inline en <head> ya aplicó
// data-theme="light" antes de este punto si esa era la preferencia
// guardada, así que aquí solo hace falta sincronizar el ícono y el clic.
function actualizarIconoTema() {
  const claro = document.documentElement.getAttribute("data-theme") === "light";
  $("btnTemaToggle").textContent = claro ? "☀️" : "🌙";
  $("btnTemaToggle").title = claro ? "Cambiar a tema oscuro" : "Cambiar a tema claro";
}
actualizarIconoTema();
$("btnTemaToggle").addEventListener("click", () => {
  const claroAhora = document.documentElement.getAttribute("data-theme") === "light";
  if (claroAhora) {
    document.documentElement.removeAttribute("data-theme");
    localStorage.setItem("tema", "dark");
  } else {
    document.documentElement.setAttribute("data-theme", "light");
    localStorage.setItem("tema", "light");
  }
  actualizarIconoTema();
});

// ---------- View switching ----------
function showView(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  $(id).classList.remove("hidden");
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  const map = { "view-dashboard": "dashboard", "view-efectivos": "efectivos", "view-directivas": "directivas", "view-agenda": "agenda", "view-documentos": "documentos", "view-panel": "panel", "view-historial": "historial" };
  if (map[id]) {
    document.querySelector(`.tab-btn[data-view="${map[id]}"]`)?.classList.add("active");
  }
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.view;
    if (target === "dashboard") { showView("view-dashboard"); loadNotas(); }
    if (target === "efectivos") { showView("view-efectivos"); loadEfectivos(); }
    if (target === "directivas") { showView("view-directivas"); loadDirectivasView(); }
    if (target === "agenda") { showView("view-agenda"); renderAgendaNotas(); }
    if (target === "documentos") { showView("view-documentos"); loadDocumentosGenerados(); }
    if (target === "panel") { showView("view-panel"); renderPanel(); }
    if (target === "historial") { showView("view-historial"); loadHistorial(); }
  });
});

$("btnVolverDashboard").addEventListener("click", () => { showView("view-dashboard"); loadNotas(); });

// ---------- Paleta de búsqueda global (Ctrl + K) ----------
// Reemplaza tener Efectivos como pestaña siempre visible: cualquiera puede
// buscar una persona por nombre/apellido/CIP/DNI (si escribe solo un apellido
// salen todas las personas que lo tienen) y saltar a un expediente, sin
// recorrer pestañas. Trabaja sobre lo ya cargado en memoria (state.efectivos
// es el padrón completo; state.notas ya viene filtrado por RLS a lo que este
// usuario puede ver), así que no dispara consultas nuevas.
const paleta = {
  overlay: $("paletaBuscar"),
  input: $("paletaInput"),
  resultados: $("paletaResultados"),
  activo: -1,
  items: [],
};

function abrirPaleta() {
  if (!state.session) return;
  paleta.overlay.classList.remove("hidden");
  paleta.input.value = "";
  renderPaleta("");
  paleta.input.focus();
}

function cerrarPaleta() {
  paleta.overlay.classList.add("hidden");
}

function coincidePorTokens(consultaTokens, textoTokens) {
  return consultaTokens.every((qt) => textoTokens.some((t) => t.startsWith(qt)));
}

function renderPaleta(raw) {
  const q = (raw || "").trim();
  const qTokens = tokens(q);
  const qDigits = q.replace(/\D+/g, "");
  paleta.resultados.innerHTML = "";
  paleta.items = [];
  paleta.activo = -1;

  if (!qTokens.length && qDigits.length < 3) {
    paleta.resultados.innerHTML = `<p class="palette-empty">Escriba un nombre, apellido, CIP o DNI.</p>`;
    return;
  }

  const efectivos = (state.efectivos || []).filter((ef) => {
    const textoTokens = tokens(`${ef.apellidos_nombres || ""} ${ef.grado || ""}`);
    const porNombre = qTokens.length && coincidePorTokens(qTokens, textoTokens);
    const porDoc = qDigits.length >= 3 &&
      [`${ef.cip || ""}`, `${ef.dni || ""}`].some((d) => d.includes(qDigits));
    return porNombre || porDoc;
  }).sort((a, b) => (a.apellidos_nombres || "").localeCompare(b.apellidos_nombres || ""));

  const expedientes = (state.notas || []).filter((n) => {
    if (!qTokens.length) return false;
    const textoTokens = tokens(`${n.apellidos || ""} ${n.nombres || ""} ${n.grado || ""} ${n.codigo_infraccion || ""} ${n.numero_nota_falta || ""}`);
    return coincidePorTokens(qTokens, textoTokens);
  });

  const cont = document.createDocumentFragment();

  if (efectivos.length) {
    const h = document.createElement("div");
    h.className = "palette-group-title";
    h.textContent = `Personas (${efectivos.length})`;
    cont.appendChild(h);
    const MAX = 40;
    for (const ef of efectivos.slice(0, MAX)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "palette-item";
      b.innerHTML = `<span class="pi-nombre">${escapeHtml(ef.grado || "")} ${escapeHtml(limpiarNombreVisible(ef.apellidos_nombres || ""))}</span>` +
        `<span class="pi-meta">CIP ${escapeHtml(ef.cip || "—")} · DNI ${escapeHtml(ef.dni || "—")}</span>`;
      b.addEventListener("click", () => copiarAlPortapapeles(ef.cip || "", b));
      cont.appendChild(b);
      paleta.items.push(b);
    }
    if (efectivos.length > MAX) {
      const p = document.createElement("p");
      p.className = "palette-empty";
      p.textContent = `y ${efectivos.length - MAX} más — afine la búsqueda`;
      cont.appendChild(p);
    }
  }

  if (expedientes.length) {
    const h = document.createElement("div");
    h.className = "palette-group-title";
    h.textContent = `Expedientes (${expedientes.length})`;
    cont.appendChild(h);
    for (const n of expedientes.slice(0, 20)) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "palette-item";
      b.innerHTML = `<span class="pi-nombre">${escapeHtml(nombreInvestigadoVisible(n, true))}</span>` +
        `<span class="pi-meta">${escapeHtml(n.codigo_infraccion || "sin código")} · falta ${formatDate(n.fecha_falta)}</span>`;
      b.addEventListener("click", () => { cerrarPaleta(); openNotaDetail(n.id); });
      cont.appendChild(b);
      paleta.items.push(b);
    }
  }

  if (!efectivos.length && !expedientes.length) {
    paleta.resultados.innerHTML = `<p class="palette-empty">Sin coincidencias para «${escapeHtml(q)}».</p>`;
    return;
  }
  paleta.resultados.appendChild(cont);
}

function copiarAlPortapapeles(texto, btnEl) {
  if (!texto) return;
  navigator.clipboard?.writeText(texto).then(() => {
    const meta = btnEl.querySelector(".pi-meta");
    if (!meta) return;
    const original = meta.textContent;
    meta.textContent = "CIP copiado ✓";
    setTimeout(() => { meta.textContent = original; }, 1200);
  }).catch(() => {});
}

function moverActivo(delta) {
  if (!paleta.items.length) return;
  paleta.items[paleta.activo]?.classList.remove("is-active");
  paleta.activo = (paleta.activo + delta + paleta.items.length) % paleta.items.length;
  const el = paleta.items[paleta.activo];
  el.classList.add("is-active");
  el.scrollIntoView({ block: "nearest" });
}

$("btnPaletaBuscar").addEventListener("click", abrirPaleta);
$("paletaCerrar").addEventListener("click", cerrarPaleta);
paleta.overlay.addEventListener("click", (e) => { if (e.target === paleta.overlay) cerrarPaleta(); });
paleta.input.addEventListener("input", (e) => renderPaleta(e.target.value));
paleta.input.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); moverActivo(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); moverActivo(-1); }
  else if (e.key === "Enter") { e.preventDefault(); paleta.items[paleta.activo]?.click(); }
});

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "k" || e.key === "K")) {
    e.preventDefault();
    if (paleta.overlay.classList.contains("hidden")) abrirPaleta(); else cerrarPaleta();
  } else if (e.key === "Escape" && !paleta.overlay.classList.contains("hidden")) {
    cerrarPaleta();
  }
});

// ---------- Auth ----------
async function loadProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("email, role")
    .eq("id", userId)
    .single();
  if (error) { console.error(error); return; }
  state.role = data.role;
  state.email = data.email;
  // Los oficiales inician sesión con "{cip}@moralydisciplina.local"; de ahí se
  // saca el CIP para saber, más adelante, cuáles notas le corresponden (en las
  // que él figura como oficial que constató).
  state.cip = (state.email || "").split("@")[0];
  // El correo interno "{cip}@moralydisciplina.local" no se muestra tal cual:
  // en la barra basta el CIP.
  const correoInterno = /@moralydisciplina\.local$/i.test(state.email || "");
  $("userEmail").textContent = correoInterno ? `CIP ${state.cip}` : (state.email || "");
  $("userRole").textContent = state.role;
  document.querySelectorAll(".admin-only").forEach((el) => {
    el.classList.toggle("hidden", state.role !== "admin");
  });
}

async function onAuthed(session) {
  state.session = session;
  $("topbar").classList.remove("hidden");
  await loadProfile(session.user.id);
  showView("view-dashboard");
  // Efectivos se carga ANTES que las notas (y se espera) porque
  // renderNotasTable decide si mostrar el botón "Descargar Imputación" según
  // state.efectivos; si las notas se pintaran primero, ese arreglo estaría
  // vacío en el primer render y el botón no aparecería en ninguna fila hasta
  // que algo más (como una búsqueda) forzara un segundo render.
  await loadEfectivos();
  loadNotas();
  // Se precarga en segundo plano (no se espera) para que estén listas en
  // cuanto se abra el modal de Orden de Sanción o el asistente flotante,
  // sin retrasar el inicio de sesión.
  loadDirectivasView();
}

function onSignedOut() {
  state.session = null;
  state.role = null;
  $("topbar").classList.add("hidden");
  showView("view-login");
}

supabase.auth.onAuthStateChange((_event, session) => {
  if (session) onAuthed(session); else onSignedOut();
});

supabase.auth.getSession().then(({ data }) => {
  if (data.session) onAuthed(data.session); else onSignedOut();
});

$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("loginError").classList.add("hidden");
  let email = $("loginEmail").value.trim();
  // Los oficiales inician sesión solo con su CIP (Supabase exige un correo
  // internamente, así que si lo escrito es puro número se le agrega el
  // dominio interno sin que el usuario tenga que verlo ni escribirlo).
  if (/^\d+$/.test(email)) email = `${email}@moralydisciplina.local`;
  const password = $("loginPassword").value;
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    $("loginError").textContent = "Correo o clave incorrectos.";
    $("loginError").classList.remove("hidden");
  }
});

$("btnLogout").addEventListener("click", async () => {
  await supabase.auth.signOut();
});

// ---------- Notas informativas ----------
async function loadNotas() {
  const { data, error } = await supabase
    .from("notas_informativas")
    .select("*, expedientes(*)")
    .order("fecha_falta", { ascending: false });
  if (error) { console.error(error); toast("No se pudieron cargar los expedientes: " + (error.message || "error de red o de sesión") + ". Intente recargar la página."); return; }
  // La política de RLS "ve notas propias o es admin" ya filtra en el
  // servidor qué filas puede ver este usuario (por oficial_constato_cip);
  // el navegador nunca recibe las que no le corresponden, así que aquí ya
  // no hace falta (ni conviene) repetir el filtro en JavaScript.
  state.notas = data || [];
  renderNotasTable(state.notas);
}

let notasVisibles = [];

function renderResumenRapidoNotas() {
  const notas = state.notas || [];
  const sinReincorporacion = notas.filter((n) => !n.fecha_reincorporacion).length;
  const porNotificar = notas.filter((n) => n.fecha_reincorporacion && !n.imputacion_generada_at).length;
  const plazosVencidos = notas.filter((n) => n.fecha_reincorporacion && n.imputacion_generada_at && !n.fecha_descargo && !n.orden_sancion_generada_at && plazoDescargoVencido(n)).length;
  $("notasResumenRapido").innerHTML = `
    <div class="quick-summary-copy">
      <span class="eyebrow">Prioridades de hoy</span>
      <strong>${notas.length ? "Revise primero los pasos que bloquean el trámite" : "Aún no hay notas informativas registradas"}</strong>
      <span class="muted small">${notas.length ? "La vista resalta reincorporaciones, notificaciones y plazos que requieren acción." : "Cree la primera nota para iniciar el seguimiento."}</span>
    </div>
    <div class="quick-summary-stats">
      <div><b>${sinReincorporacion}</b><span>sin reincorporación</span></div>
      <div><b>${porNotificar}</b><span>por notificar</span></div>
      <div class="${plazosVencidos ? "is-urgent" : ""}"><b>${plazosVencidos}</b><span>plazo vencido</span></div>
    </div>`;
}

function obtenerAccionesPrioritariasNotas() {
  return (state.notas || []).flatMap((nota) => {
    const nombre = nombreInvestigadoVisible(nota, true) || "Nota sin nombre";
    if (nota.fecha_reincorporacion && nota.imputacion_generada_at && !nota.fecha_descargo && !nota.orden_sancion_generada_at && plazoDescargoVencido(nota)) {
      return [{ nota, nombre, prioridad: 1, tipo: "Plazo vencido", detalle: "Defina el siguiente trámite: acta de no descargo u orden de sanción.", clase: "is-urgent" }];
    }
    if (nota.fecha_descargo && !nota.orden_sancion_generada_at) {
      return [{ nota, nombre, prioridad: 2, tipo: "Descargo recibido", detalle: "Revise el descargo y prepare la orden de sanción.", clase: "is-ready" }];
    }
    if (nota.fecha_reincorporacion && !nota.imputacion_generada_at) {
      return [{ nota, nombre, prioridad: 3, tipo: "Generar imputación", detalle: "Verifique los datos y genere la notificación de imputación.", clase: "is-pending" }];
    }
    if (!nota.fecha_reincorporacion) {
      return [{ nota, nombre, prioridad: 4, tipo: "Registrar reincorporación", detalle: "Cargue la fecha, hora y nota de reincorporación para continuar.", clase: "is-pending" }];
    }
    return [];
  }).sort((a, b) => a.prioridad - b.prioridad);
}

function renderBandejaAccionesNotas() {
  const acciones = obtenerAccionesPrioritariasNotas();
  const bandeja = $("bandejaAcciones");
  bandeja.classList.toggle("hidden", acciones.length === 0);
  if (!acciones.length) return;
  $("bandejaAccionesCount").textContent = `${acciones.length} pendiente${acciones.length === 1 ? "" : "s"}`;
  $("bandejaAccionesLista").innerHTML = acciones.slice(0, 5).map((accion) => `
    <article class="action-item ${accion.clase}">
      <div class="action-item-copy">
        <span class="action-type">${escapeHtml(accion.tipo)}</span>
        <strong>${escapeHtml(accion.nombre)}</strong>
        <span class="muted small">${escapeHtml(accion.detalle)}</span>
      </div>
      <button type="button" class="btn-secondary btn-abrir-accion" data-id="${escapeHtml(accion.nota.id)}">Resolver</button>
    </article>`).join("");
  document.querySelectorAll(".btn-abrir-accion").forEach((btn) => {
    btn.addEventListener("click", () => openNotaDetail(btn.dataset.id));
  });
}

function renderAgendaNotas() {
  const query = $("buscarAgenda").value.trim().toLowerCase();
  const acciones = obtenerAccionesPrioritariasNotas().filter((accion) =>
    !query || `${accion.nombre} ${accion.tipo} ${accion.detalle}`.toLowerCase().includes(query)
  );
  $("agendaEmpty").classList.toggle("hidden", acciones.length > 0);
  $("agendaLista").innerHTML = acciones.map((accion, index) => `
    <article class="agenda-item ${accion.clase}">
      <div class="agenda-order">${index + 1}</div>
      <div class="action-item-copy">
        <span class="action-type">${escapeHtml(accion.tipo)}</span>
        <strong>${escapeHtml(accion.nombre)}</strong>
        <span class="muted small">${escapeHtml(accion.detalle)}</span>
      </div>
      <button type="button" class="btn-primary btn-abrir-agenda" data-id="${escapeHtml(accion.nota.id)}">Abrir nota</button>
    </article>`).join("");
  document.querySelectorAll(".btn-abrir-agenda").forEach((btn) => btn.addEventListener("click", () => openNotaDetail(btn.dataset.id)));
}

$("buscarAgenda").addEventListener("input", renderAgendaNotas);

function exportarAgendaCalendario() {
  const fechaIcs = (fecha) => String(fecha || new Date().toISOString().slice(0, 10)).slice(0, 10).replaceAll("-", "");
  const escaparIcs = (texto) => String(texto || "").replace(/[\\,;]/g, "\\$&").replace(/\n/g, "\\n");
  const eventos = obtenerAccionesPrioritariasNotas().map((accion, index) => {
    const fecha = accion.tipo === "Plazo vencido" ? fechaLimiteDescargo(accion.nota) : (accion.nota.created_at || new Date().toISOString());
    const stamp = `${Date.now()}-${index}@moral-y-disciplina`;
    return ["BEGIN:VEVENT", `UID:${stamp}`, `DTSTAMP:${fechaIcs(new Date().toISOString())}T000000Z`, `DTSTART;VALUE=DATE:${fechaIcs(fecha)}`, `SUMMARY:${escaparIcs(`${accion.tipo}: ${accion.nombre}`)}`, `DESCRIPTION:${escaparIcs(accion.detalle)}`, "END:VEVENT"].join("\r\n");
  });
  const contenido = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Moral y Disciplina//Agenda//ES", ...eventos, "END:VCALENDAR"].join("\r\n");
  saveAs(new Blob([contenido], { type: "text/calendar;charset=utf-8" }), `agenda_moral_disciplina_${new Date().toISOString().slice(0, 10)}.ics`);
}

$("btnExportarAgenda").addEventListener("click", exportarAgendaCalendario);

let documentosGenerados = [];

async function loadDocumentosGenerados() {
  const { data, error } = await supabase.from("documentos_generados").select("*").order("generado_at", { ascending: false });
  if (error) { console.error(error); return; }
  documentosGenerados = data || [];
  await renderDocumentosGenerados();
}

async function renderDocumentosGenerados() {
  const query = $("buscarDocumentos").value.trim().toLowerCase();
  const docs = documentosGenerados.filter((doc) => !query || `${doc.tipo || ""} ${doc.archivo_nombre || ""} ${doc.generado_por_email || ""}`.toLowerCase().includes(query));
  $("documentosEmpty").classList.toggle("hidden", docs.length > 0);
  const etiquetas = { imputacion: "Imputación", acta_no_descargo: "Acta de No Descargo", orden_sancion: "Orden de Sanción" };
  const filas = await Promise.all(docs.map(async (doc) => {
    const enlace = await fileLinkHtml("notas", doc.archivo_path, doc.archivo_nombre);
    return `<article class="document-item"><div><span class="action-type">${escapeHtml(etiquetas[doc.tipo] || doc.tipo || "Documento")}</span><strong>${escapeHtml(doc.archivo_nombre || "Sin nombre")}</strong><span class="muted small">Generado ${formatFechaHora(String(doc.generado_at || "").slice(0, 10), String(doc.generado_at || "").slice(11, 16))} · ${escapeHtml(doc.generado_por_email || "-")}</span></div><div>${enlace}</div></article>`;
  }));
  $("documentosLista").innerHTML = filas.join("");
}

$("buscarDocumentos").addEventListener("input", () => { renderDocumentosGenerados(); });

function renderNotasTable(list) {
  notasVisibles = list;
  renderResumenRapidoNotas();
  renderBandejaAccionesNotas();
  const tbody = $("notasTableBody");
  tbody.innerHTML = "";
  $("notasEmpty").classList.toggle("hidden", list.length > 0);
  for (const n of list) {
    const tr = document.createElement("tr");
    const puedeDescargar = puedeGenerarImputacion(n, state.efectivos);
    const puedeActa = puedeGenerarActaNoDescargo(n, state.efectivos);
    tr.innerHTML = `
      <td>${escapeHtml(n.grado || "")}</td>
      <td>${escapeHtml(nombreInvestigadoVisible(n))}</td>
      <td>${formatFechaHora(n.fecha_falta, n.hora_falta)}</td>
      <td>${escapeHtml(n.numero_nota_falta || "")}</td>
      <td>${escapeHtml(n.oficial_constato || "-")}</td>
      <td>${formatFechaHora(n.fecha_reincorporacion, n.hora_reincorporacion)}</td>
      <td>${escapeHtml(n.numero_nota_reincorporacion || "-")}</td>
      <td>${formatearHorasFalto(n) || "-"}</td>
      <td>${escapeHtml(n.codigo_infraccion || "")}</td>
      <td>${progresoNotaHtml(n)}</td>
      <td class="row-actions"><div class="row-actions-inner">${puedeDescargar ? `<button type="button" class="btn-secondary btn-descargar-imputacion" title="Descargar Inicio de Imputación de Infracción Leve">⬇ Imputación</button>` : ""}${puedeActa ? `<button type="button" class="btn-secondary btn-descargar-acta" title="Descargar Acta de No Recepción de Descargos">⬇ Acta No Descargo</button>` : ""} <span class="row-chevron">›</span></div></td>
    `;
    tr.addEventListener("click", () => openNotaDetail(n.id));
    tr.querySelector(".btn-descargar-imputacion")?.addEventListener("click", (e) => {
      e.stopPropagation();
      handleDescargarImputacion(n, e.currentTarget);
    });
    tr.querySelector(".btn-descargar-acta")?.addEventListener("click", (e) => {
      e.stopPropagation();
      handleDescargarActaNoDescargo(n, e.currentTarget);
    });
    tbody.appendChild(tr);
  }
}

// Archiva en Storage y registra en documentos_generados cada versión de un
// documento generado -- "mejor esfuerzo": si falla (red, permisos), se deja
// constancia en consola pero NUNCA bloquea la descarga real del oficial,
// que ya ocurrió antes de llamar a esta función.
async function registrarVersionDocumento(notaId, tipo, blob, nombreArchivo) {
  try {
    const path = `${notaId}/generados/${tipo}_${Date.now()}_${nombreArchivo}`;
    const { error: upErr } = await supabase.storage.from("notas").upload(path, blob);
    if (upErr) { console.error("No se pudo archivar la versión del documento:", upErr); return; }
    const { error } = await supabase.from("documentos_generados").insert({
      nota_id: notaId,
      tipo,
      archivo_path: path,
      archivo_nombre: nombreArchivo,
      generado_por: state.session.user.id,
      generado_por_email: state.email,
    });
    if (error) console.error("No se pudo registrar la versión del documento:", error);
  } catch (err) {
    console.error("No se pudo archivar la versión del documento:", err);
  }
}

function nombreArchivoDocumento(prefijo, nota) {
  return `${prefijo} - ${nombreInvestigadoVisible(nota, true)}.docx`.replace(/\s+/g, " ").trim();
}

// Nombre del investigado en el formato visible "Nombres APELLIDOS" (apellidos
// en MAYÚSCULAS), opcionalmente con el grado delante. Se usa en tablas,
// exportaciones, nombres de archivo, encabezados y en lo que se manda a la IA.
function nombreInvestigadoVisible(nota, incluirGrado = false) {
  const nombre = nombreCompletoVisible(nota?.apellidos, nota?.nombres);
  return `${incluirGrado ? (nota?.grado || "").trim() : ""} ${nombre}`.replace(/\s+/g, " ").trim();
}

// La IA (o el propio oficial) puede dejar el resumen del descargo vacío o con
// la frase genérica de relleno. En ese caso el resumen no sirve para la Orden
// y hay que exigir uno real de los puntos relevantes y argumentos de defensa.
function esResumenDescargoInsuficiente(texto) {
  const resumen = String(texto || "").replace(/\s+/g, " ").trim();
  return !resumen || /^El descargo presentado debe ser valorado junto con el archivo original\.?$/i.test(resumen);
}

async function handleDescargarImputacion(nota, btnEl) {
  const textoOriginal = btnEl ? btnEl.textContent : null;
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = "Generando..."; }
  try {
    const blob = await renderizarImputacionDocx(nota, state.efectivos);
    const nombreArchivo = nombreArchivoDocumento("IMPUTACION LEVE", nota);
    saveAs(blob, nombreArchivo);
    registrarVersionDocumento(nota.id, "imputacion", blob, nombreArchivo);
    // Se registra la primera vez que se genera/descarga: es la fecha que se usa
    // como notificación al investigado para contar el plazo de descargo.
    if (!nota.imputacion_generada_at) {
      const ahora = new Date().toISOString();
      const { error } = await supabase.from("notas_informativas").update({ imputacion_generada_at: ahora }).eq("id", nota.id);
      if (!error) nota.imputacion_generada_at = ahora;
    }
  } catch (err) {
    console.error(err);
    alert(err.message || "No se pudo generar el documento de imputación.");
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = textoOriginal; }
  }
}

async function handleDescargarActaNoDescargo(nota, btnEl) {
  const textoOriginal = btnEl ? btnEl.textContent : null;
  if (btnEl) { btnEl.disabled = true; btnEl.textContent = "Generando..."; }
  try {
    const blob = await renderizarActaNoDescargoDocx(nota, state.efectivos);
    const nombreArchivo = nombreArchivoDocumento("ACTA NO DESCARGO", nota);
    saveAs(blob, nombreArchivo);
    registrarVersionDocumento(nota.id, "acta_no_descargo", blob, nombreArchivo);
  } catch (err) {
    console.error(err);
    alert(err.message || "No se pudo generar el acta de no descargo.");
  } finally {
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = textoOriginal; }
  }
}

function aplicarFiltrosNotas() {
  const q = $("searchNotas").value.toLowerCase();
  const desde = $("filtroDesde").value;
  const hasta = $("filtroHasta").value;
  const filtered = state.notas.filter((n) => {
    const coincideTexto = !q || [n.nombres, n.apellidos, n.numero_nota_falta, n.codigo_infraccion, n.grado]
      .filter(Boolean).join(" ").toLowerCase().includes(q);
    // Filtra por fecha de la falta. Los campos de tipo date de Supabase vienen
    // como "YYYY-MM-DD", igual que los inputs de fecha, así que se comparan
    // directamente como texto sin necesidad de convertir a Date.
    const coincideDesde = !desde || (n.fecha_falta && n.fecha_falta >= desde);
    const coincideHasta = !hasta || (n.fecha_falta && n.fecha_falta <= hasta);
    return coincideTexto && coincideDesde && coincideHasta;
  });
  renderNotasTable(filtered);
}

$("searchNotas").addEventListener("input", aplicarFiltrosNotas);
$("filtroDesde").addEventListener("change", aplicarFiltrosNotas);
$("filtroHasta").addEventListener("change", aplicarFiltrosNotas);
$("btnLimpiarFiltroFecha").addEventListener("click", () => {
  $("filtroDesde").value = "";
  $("filtroHasta").value = "";
  aplicarFiltrosNotas();
});

// ---------- Resumen ejecutivo (IA) ----------
// Arma, a partir de lo que YA se ve en el dashboard (respetando el filtro de
// visibilidad por oficial de loadNotas), el estado de cada caso con los datos
// que sí se registran en notas_informativas — se envían tal cual a la IA, sin
// inventar campos que la app no trackea (p.ej. "Acta notificada" no existe
// como estado persistido, así que no se manda).
function construirResumenEstadoCasos() {
  return state.notas.map((n) => ({
    investigado: nombreInvestigadoVisible(n, true),
    codigo_infraccion: n.codigo_infraccion || null,
    fecha_hecho: n.fecha_falta || null,
    reincorporado: !!n.fecha_reincorporacion,
    imputacion_notificada: !!n.imputacion_generada_at,
    fecha_notificacion_imputacion: n.imputacion_generada_at ? n.imputacion_generada_at.slice(0, 10) : null,
    plazo_descargo_vencido: plazoDescargoVencido(n),
    descargo_recibido: !!n.fecha_descargo,
    orden_sancion_generada: !!n.orden_sancion_generada_at,
    sancion_impuesta: n.sancion_tipo === "amonestacion" ? "amonestación" : (n.sancion_dias ? `${n.sancion_dias} días de sanción simple` : null),
  }));
}

async function generarResumenEjecutivo() {
  const btn = $("btnResumenEjecutivo");
  const panel = $("resumenEjecutivoPanel");
  const statusEl = $("resumenEjecutivoStatus");
  const contenidoEl = $("resumenEjecutivoContenido");
  panel.classList.remove("hidden");
  contenidoEl.textContent = "";
  statusEl.textContent = "Generando resumen ejecutivo con IA...";
  statusEl.classList.remove("hidden");
  btn.disabled = true;
  try {
    const casos = construirResumenEstadoCasos();
    const { data, error } = await supabase.functions.invoke("generar-resumen-casos", {
      body: { fechaHoy: new Date().toISOString().slice(0, 10), casos },
    });
    if (error) throw new Error(await mensajeErrorFuncion(error));
    if (data?.error) throw new Error(data.error);
    contenidoEl.textContent = data?.resumen || "No se pudo generar el resumen.";
    statusEl.classList.add("hidden");
  } catch (err) {
    console.error(err);
    statusEl.textContent = "No se pudo generar el resumen: " + (err.message || err);
  } finally {
    btn.disabled = false;
  }
}

$("btnResumenEjecutivo").addEventListener("click", generarResumenEjecutivo);
$("btnCerrarResumenEjecutivo").addEventListener("click", () => {
  $("resumenEjecutivoPanel").classList.add("hidden");
});

$("btnExportarExcel").addEventListener("click", () => {
  if (!notasVisibles.length) { alert("No hay notas para exportar (revise el buscador)."); return; }
  const filas = notasVisibles.map((n) => ({
    "Grado": n.grado || "",
    "Nombres y apellidos": nombreInvestigadoVisible(n),
    "Fecha/hora falta": formatFechaHora(n.fecha_falta, n.hora_falta),
    "N.º nota": n.numero_nota_falta || "",
    "Oficial": n.oficial_constato || "-",
    "Fecha/hora reinc.": formatFechaHora(n.fecha_reincorporacion, n.hora_reincorporacion),
    "N.º nota reinc.": n.numero_nota_reincorporacion || "-",
    "Tiempo ausente": formatearHorasFalto(n) || "-",
    "Código infracción": n.codigo_infraccion || "",
    "Reincorporado": n.fecha_reincorporacion ? "Sí" : "Pendiente",
  }));
  const hoja = XLSX.utils.json_to_sheet(filas);
  hoja["!cols"] = Object.keys(filas[0]).map((k) => ({ wch: Math.max(k.length, 14) }));
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(libro, hoja, "Notas informativas");
  const fecha = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(libro, `notas_informativas_${fecha}.xlsx`);
});

// ---------- Revisar antes de generar (control de calidad + vista previa) ----------
// Ubica al investigado de la nota dentro del padrón de Efectivos con el mismo
// criterio que el resto de la app (>= 2 palabras en común).
function ubicarInvestigadoEnEfectivos(nota, efectivos) {
  const objetivo = tokens(`${nota?.apellidos || ""} ${nota?.nombres || ""}`);
  if (objetivo.length < 2 || !efectivos?.length) return null;
  let mejor = null, mejorScore = 0;
  for (const ef of efectivos) {
    const t = new Set(tokens(ef.apellidos_nombres));
    const s = objetivo.filter((x) => t.has(x)).length;
    if (s > mejorScore) { mejorScore = s; mejor = ef; }
  }
  return mejorScore >= 2 ? mejor : null;
}

// Junta en un solo lugar las validaciones que hoy están dispersas
// (puedeGenerar*, plazos, consistencia código/horas, coincidencia con
// Efectivos, resumen del descargo) y las devuelve como lista legible. `tipo`
// es "imputacion" | "acta" | "orden".
function revisarExpediente(nota, tipo) {
  const bloqueos = [];
  const avisos = [];
  const ef = state.efectivos || [];
  const codigo = normalizarCodigoInfraccion(nota.codigo_infraccion);
  const infraccion = getInfraccion(codigo);
  const esLeve = /^L/i.test((nota.codigo_infraccion || "").trim());

  if (!nota.codigo_infraccion) bloqueos.push("Falta el código de infracción.");
  else if (!infraccion) bloqueos.push(`El código «${nota.codigo_infraccion}» no está en el Anexo I de infracciones leves.`);
  else if (!esLeve) avisos.push("El código registrado no es Leve (L…); esta aplicación solo tramita infracciones leves.");

  if (!nota.fecha_falta) bloqueos.push("Falta la fecha de la falta.");
  if (!nota.numero_nota_falta) bloqueos.push("Falta el N.º de nota de la falta.");
  if (!nota.hora_falta) avisos.push("No se registró la hora de la falta.");

  if (!nota.fecha_reincorporacion) bloqueos.push("Falta registrar la reincorporación (fecha).");
  if (!nota.numero_nota_reincorporacion) bloqueos.push("Falta el N.º de nota de reincorporación.");
  if (nota.fecha_reincorporacion && !nota.hora_reincorporacion) avisos.push("No se registró la hora de reincorporación.");

  if (!nota.oficial_constato) bloqueos.push("No se indicó el oficial que constató la falta.");
  else if (!buscarOficialConstato(nota.oficial_constato, ef)) bloqueos.push(`El oficial «${nota.oficial_constato}» no se ubicó en Efectivos (revise el apellido).`);

  if (!nota.apellidos || !nota.nombres) bloqueos.push("Faltan apellidos o nombres del investigado.");
  else if (!ubicarInvestigadoEnEfectivos(nota, ef)) avisos.push(`${nombreInvestigadoVisible(nota)} no se ubicó en Efectivos: su CIP/DNI no se completará en los documentos.`);

  const cons = verificarConsistenciaCodigo(nota);
  if (cons) avisos.push(`Por el tiempo ausente (${formatearHorasFalto(nota) || "?"}) el código esperado sería ${cons.sugerido}, pero está ${cons.actual}. Verifique fechas y horas.`);

  if (tipo === "acta" || tipo === "orden") {
    if (!nota.imputacion_generada_at) bloqueos.push("La Imputación aún no se ha notificado (no se ha descargado por primera vez).");
  }
  if (tipo === "acta") {
    if (nota.fecha_descargo) bloqueos.push("El investigado sí presentó descargo: no corresponde el Acta de No Descargo.");
    else if (nota.imputacion_generada_at && !plazoDescargoVencido(nota)) bloqueos.push(`El plazo de descargo aún está vigente (vence el ${formatDate(fechaLimiteDescargo(nota))}).`);
  }
  if (tipo === "orden") {
    if (!nota.fecha_descargo && !plazoDescargoVencido(nota)) bloqueos.push("Todavía no hay descargo ni ha vencido el plazo: aún no corresponde la Orden.");
    const descargoActual = $("sSancionDescargo") ? $("sSancionDescargo").value : nota.sancion_descargo_resumen;
    if (nota.fecha_descargo && esResumenDescargoInsuficiente(descargoActual)) {
      avisos.push("Hay descargo presentado pero sin resumen: use «Analizar descargo con IA» o redáctelo antes de generar la Orden.");
    }
    if (!document.querySelector('input[name="sancionTercio"]:checked')) avisos.push("Aún no ha elegido el tercio de la sanción.");
    if (!($("sSancionAnalisis")?.value || "").trim()) avisos.push("El Análisis y Evaluación está vacío.");
  }
  return { bloqueos, avisos };
}

const DP_LABEL = {
  investigado_completo: "Investigado", unidad_investigado: "Unidad",
  descripcion_hecho: "Descripción del hecho", hecho_completo: "Hecho / caso concreto",
  bien_juridico: "Bien jurídico", codigo_infraccion_texto: "Código de infracción",
  codigo_texto: "Código de infracción", sancion_texto: "Rango de sanción", sancion_rango: "Rango de sanción",
  descargo_texto: "Descargo (resumen)", analisis_texto: "Análisis y evaluación",
  decision_texto: "Decisión", superior_completo: "Superior / firma",
  signer_nombre: "Firma (nombre)", signer_grado: "Firma (grado)", signer_oa: "Firma (OA)",
  oficial_nombre_completo: "Sello (nombre)", oficial_grado_seal: "Sello (grado)",
  oficial_cip: "Sello (CIP)", oficial_cargo: "Cargo",
  fecha_larga: "Fecha", fecha_corta: "Fecha (corta)", fecha_larga_punto: "Fecha",
  superior_apellidos: "Superior (apellidos)", superior_nombres: "Superior (nombres)",
  superior_grado: "Superior (grado)", superior_cip: "Superior (CIP)", superior_dni: "Superior (DNI)",
  testigo_apellidos: "Testigo (apellidos)", testigo_nombres: "Testigo (nombres)",
  testigo_grado: "Testigo (grado)", testigo_cip: "Testigo (CIP)", testigo_dni: "Testigo (DNI)",
  investigado_apellidos: "Investigado (apellidos)", investigado_nombres: "Investigado (nombres)",
  investigado_cip: "Investigado (CIP)", investigado_dni: "Investigado (DNI)", investigado_grado: "Investigado (grado)",
  hora_apertura: "Hora de apertura", hora_cierre: "Hora de cierre",
};
const DP_CLAVE = new Set(["investigado_completo", "hecho_completo", "codigo_texto", "codigo_infraccion_texto", "decision_texto", "sancion_rango", "sancion_texto", "signer_nombre", "superior_completo", "analisis_texto", "descargo_texto"]);

function datosDocumento(tipo, nota) {
  if (tipo === "imputacion") return construirDatosImputacion(nota, state.efectivos);
  if (tipo === "acta") return construirDatosActaNoDescargo(nota, state.efectivos);
  if (tipo === "orden") {
    return construirDatosOrdenSancion(nota, state.efectivos, {
      tercioValue: document.querySelector('input[name="sancionTercio"]:checked')?.value || "",
      analisisTexto: $("sSancionAnalisis")?.value.trim() || "",
      descargoTexto: $("sSancionDescargo")?.value.trim() || "",
    });
  }
  return {};
}

function datosPreviewHtml(datos) {
  const filas = Object.entries(datos).map(([k, v]) => {
    const val = String(v ?? "").trim() || "—";
    return `<div class="dp-row ${DP_CLAVE.has(k) ? "is-clave" : ""}">
      <div class="dp-key">${escapeHtml(DP_LABEL[k] || k)}</div>
      <div class="dp-val">${escapeHtml(val)}</div>
    </div>`;
  });
  return `<div class="datos-preview">${filas.join("")}</div>`;
}

const REVISION_TITULO = { imputacion: "Revisar la Imputación", acta: "Revisar el Acta de No Descargo", orden: "Revisar la Orden de Sanción" };

function abrirRevision(tipo, nota) {
  const { bloqueos, avisos } = revisarExpediente(nota, tipo);
  $("revisionTitulo").textContent = REVISION_TITULO[tipo] || "Revisar antes de generar";

  let datosHtml;
  try {
    datosHtml = datosPreviewHtml(datosDocumento(tipo, nota));
  } catch (err) {
    datosHtml = `<p class="muted small">No se puede mostrar la vista previa todavía: ${escapeHtml(err.message || String(err))}</p>`;
  }

  const listaHtml = (items, clase) => items.length
    ? `<ul class="revision-list">${items.map((t) => `<li class="${clase}">${clase === "is-bloqueo" ? "⛔" : "⚠"} ${escapeHtml(t)}</li>`).join("")}</ul>`
    : "";

  $("revisionContenido").innerHTML = `
    <div class="revision-section">
      <h4>Antes de generar</h4>
      ${bloqueos.length || avisos.length ? "" : `<div class="revision-ok">✓ No se detectaron problemas. Puede generar el documento.</div>`}
      ${listaHtml(bloqueos, "is-bloqueo")}
      ${listaHtml(avisos, "is-aviso")}
      ${bloqueos.length ? `<p class="muted small" style="margin-top:8px">Los puntos en rojo impiden generar un documento correcto; corríjalos primero.</p>` : ""}
    </div>
    <div class="revision-section">
      <h4>Datos que se insertarán</h4>
      ${datosHtml}
    </div>
  `;
  $("modalRevision").classList.remove("hidden");
}

function cerrarRevision() { $("modalRevision").classList.add("hidden"); }
$("btnCerrarRevision").addEventListener("click", cerrarRevision);
$("modalRevision").addEventListener("click", (e) => { if (e.target === $("modalRevision")) cerrarRevision(); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !$("modalRevision").classList.contains("hidden")) cerrarRevision();
});

// ---------- Nota detail ----------
async function openNotaDetail(id) {
  const { data: nota, error } = await supabase
    .from("notas_informativas")
    .select("*, expedientes(*)")
    .eq("id", id)
    .single();
  if (error) { console.error(error); toast("No se pudo abrir el expediente: " + (error.message || "error de red o de sesión") + "."); return; }
  state.currentNotaId = id;
  await renderNotaDetail(nota);
  showView("view-nota-detail");
}

async function fileLinkHtml(bucket, path, name) {
  if (!path) return '<span class="muted small">No adjuntado</span>';
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 300);
  if (error || !data) return '<span class="muted small">Error al obtener archivo</span>';
  return `<a class="file-link" href="${data.signedUrl}" target="_blank" rel="noopener">📎 ${escapeHtml(name || "Ver archivo")}</a>`;
}

async function renderNotaDetail(nota) {
  const exp = (nota.expedientes && nota.expedientes[0]) || null;
  const isAdmin = state.role === "admin";
  const esDuenoDeLaNota = !!state.cip && nota.oficial_constato_cip === state.cip;

  const notaArchivo = await fileLinkHtml("notas", nota.archivo_nota_path, nota.archivo_nota_nombre);
  const reincArchivo = await fileLinkHtml("notas", nota.archivo_reincorporacion_path, nota.archivo_reincorporacion_nombre);
  const expArchivo = exp ? await fileLinkHtml("expedientes", exp.archivo_expediente_path, exp.archivo_expediente_nombre) : "";
  const descargoArchivo = await fileLinkHtml("notas", nota.archivo_descargo_path, nota.archivo_descargo_nombre);

  const { data: versionesDocs } = await supabase
    .from("documentos_generados")
    .select("*")
    .eq("nota_id", nota.id)
    .order("generado_at", { ascending: false });
  const TIPO_DOCUMENTO_LABEL = { imputacion: "Imputación", acta_no_descargo: "Acta de No Descargo", orden_sancion: "Orden de Sanción" };
  const versionesHtml = versionesDocs?.length
    ? (await Promise.all(versionesDocs.map(async (v) => {
        const link = await fileLinkHtml("notas", v.archivo_path, v.archivo_nombre);
        return `<div class="detail-field"><div class="label">${escapeHtml(TIPO_DOCUMENTO_LABEL[v.tipo] || v.tipo)} — ${formatFechaHora(v.generado_at.slice(0, 10), v.generado_at.slice(11, 16))}</div><div class="value">${link} <span class="muted small">(${escapeHtml(v.generado_por_email || "-")})</span></div></div>`;
      }))).join("")
    : "";

  const puedeDescargar = puedeGenerarImputacion(nota, state.efectivos);
  const codigoEsLeve = /^L/i.test((nota.codigo_infraccion || "").trim());
  const puedeActa = puedeGenerarActaNoDescargo(nota, state.efectivos);
  const plazoVencido = plazoDescargoVencido(nota);
  const fechaLimite = fechaLimiteDescargo(nota);
  const puedeSancion = puedeGenerarOrdenSancion(nota, state.efectivos);
  const opcionesSancion = opcionesTercio(nota.codigo_infraccion) || [];
  const avisoConsistencia = verificarConsistenciaCodigo(nota);

  $("notaDetailContent").innerHTML = `
    <div class="detail-card">
      <div class="detail-card-header">
        <h3>${escapeHtml(nombreInvestigadoVisible(nota, true))}</h3>
        ${codigoEsLeve ? `
          <button type="button" class="btn-ghost" id="btnRevisarImputacion">🔍 Revisar</button>
          <button type="button" class="btn-secondary" id="btnDescargarImputacion" ${puedeDescargar ? "" : "disabled"}>⬇ Descargar Imputación</button>
        ` : ""}
      </div>
      <div class="timeline-card">
        <div class="detail-card-header"><h3>Ruta del trámite</h3><span class="muted small">Estado por etapa</span></div>
        ${cronologiaNotaHtml(nota)}
      </div>
      ${avisoConsistencia ? `<p class="error small">⚠ Según las horas transcurridas entre la falta y la reincorporación (${formatearHorasFalto(nota)}), el código esperado sería <strong>${avisoConsistencia.sugerido}</strong>, pero el registrado es <strong>${escapeHtml(avisoConsistencia.actual)}</strong>. Verifique la fecha/hora de falta y de reincorporación (pueden venir mal leídas de un PDF/OCR) antes de generar los documentos.</p>` : ""}
      ${codigoEsLeve && !puedeDescargar ? `<p class="muted small">Para poder generar el documento, complete la reincorporación (fecha, hora y N.º de nota) y verifique que el oficial que constató la falta ("${escapeHtml(nota.oficial_constato || "")}") esté registrado en Efectivos.</p>` : ""}
      <div class="detail-grid">
        <div class="detail-field"><div class="label">Fecha de falta</div><div class="value">${formatDate(nota.fecha_falta)}</div></div>
        <div class="detail-field"><div class="label">Hora de falta</div><div class="value">${escapeHtml((nota.hora_falta || "").slice(0, 5) || "-")}</div></div>
        <div class="detail-field"><div class="label">N.º de nota</div><div class="value">${escapeHtml(nota.numero_nota_falta || "-")}</div></div>
        <div class="detail-field">
          <div class="label">Código de infracción</div>
          <div class="value">
            ${isAdmin ? `
              <form id="codigoInfraccionForm" class="inline-edit">
                <input type="text" id="fCodigoInfraccionEdit" value="${escapeHtml(nota.codigo_infraccion || "")}" placeholder="Pendiente" />
                <button type="submit" class="btn-secondary">Guardar</button>
              </form>
              <p id="codigoInfraccionMsg" class="error small hidden"></p>
            ` : escapeHtml(nota.codigo_infraccion || "Pendiente")}
          </div>
        </div>
        <div class="detail-field"><div class="label">Oficial que constató</div><div class="value">${escapeHtml(nota.oficial_constato || "-")}</div></div>
        <div class="detail-field"><div class="label">Archivo de la nota</div><div class="value">${notaArchivo}</div></div>
      </div>
      ${isAdmin ? `<button class="btn-danger" id="btnEliminarNota">Eliminar nota</button>` : ""}
    </div>

    <div class="detail-card">
      <h3>Reincorporación</h3>
      ${nota.fecha_reincorporacion ? `
        <div class="detail-grid">
          <div class="detail-field"><div class="label">Fecha de reincorporación</div><div class="value">${formatDate(nota.fecha_reincorporacion)}</div></div>
          <div class="detail-field"><div class="label">Hora de reincorporación</div><div class="value">${escapeHtml((nota.hora_reincorporacion || "").slice(0, 5) || "-")}</div></div>
          <div class="detail-field"><div class="label">N.º de nota de reincorporación</div><div class="value">${escapeHtml(nota.numero_nota_reincorporacion || "-")}</div></div>
          <div class="detail-field"><div class="label">Tiempo ausente</div><div class="value">${formatearHorasFalto(nota) || "-"}</div></div>
          <div class="detail-field"><div class="label">Archivo</div><div class="value">${reincArchivo}</div></div>
        </div>
        ${nota.reincorporacion_observacion ? `<p class="ai-box ai-box-warning" style="margin-top:12px">⚕ ${escapeHtml(nota.reincorporacion_observacion)}</p>` : ""}
      ` : `
        <p class="muted small">Aún no ha sido reincorporado.</p>
        ${isAdmin ? `
        <form id="reincForm">
          <div class="grid-2">
            <label>Fecha de reincorporación<input type="date" id="rFecha" required /></label>
            <label>N.º de nota de reincorporación<input type="text" id="rNumero" required /></label>
          </div>
          <label>Hora de reincorporación<input type="time" id="rHora" /></label>
          <label>Observación (opcional — p.ej. descanso médico expedido por Sanidad, no se presentó físicamente)
            <textarea id="rObservacion" rows="2" placeholder="Déjelo en blanco si se reincorporó físicamente sin ninguna circunstancia particular."></textarea>
          </label>
          <label>Archivo de reincorporación<input type="file" id="rArchivo" accept="application/pdf,image/*" /></label>
          <p id="reincAutoStatus" class="muted small hidden"></p>
          <p id="reincError" class="error hidden"></p>
          <button type="submit" class="btn-primary">Registrar reincorporación</button>
        </form>` : ""}
      `}
    </div>

    ${codigoEsLeve ? `
    <div class="detail-card">
      <h3>Acta de No Descargo</h3>
      <div class="detail-field" style="margin-bottom:14px">
        <div class="label">Fecha de notificación de la Imputación</div>
        <div class="value">
          <form id="notificacionForm" class="inline-edit">
            <input type="date" id="fNotificacion" value="${nota.imputacion_generada_at ? nota.imputacion_generada_at.slice(0, 10) : ""}" required />
            <button type="submit" class="btn-secondary">Guardar</button>
          </form>
          <p id="notificacionMsg" class="error small hidden"></p>
        </div>
      </div>
      ${!nota.imputacion_generada_at ? `
        <p class="muted small">Registre la fecha en que notificó la Imputación para calcular el plazo de descargo.</p>
      ` : nota.fecha_descargo ? `
        <p class="muted small">El investigado sí presentó descargo — no corresponde generar el acta.</p>
        <div class="detail-grid">
          <div class="detail-field"><div class="label">Fecha de descargo</div><div class="value">${formatDate(nota.fecha_descargo)}</div></div>
          <div class="detail-field"><div class="label">N.º de documento</div><div class="value">${escapeHtml(nota.numero_descargo || "-")}</div></div>
          <div class="detail-field"><div class="label">Archivo</div><div class="value">${descargoArchivo}</div></div>
        </div>
      ` : `
        <p class="muted small">Plazo de descargo vence el ${formatDate(fechaLimite)}.</p>
        ${plazoVencido ? `
          <button type="button" class="btn-ghost" id="btnRevisarActa">🔍 Revisar</button>
          ${puedeActa ? `<button type="button" class="btn-secondary" id="btnDescargarActaDetalle">⬇ Descargar Acta de No Descargo</button>` : `<p class="muted small">Venció el plazo, pero no se pudo ubicar en Efectivos al oficial o al investigado para generar el acta. Use «Revisar» para ver qué falta.</p>`}
        ` : `<p class="muted small">El plazo aún está vigente, todavía no corresponde generar el acta.</p>`}
        <form id="descargoForm">
          <p class="muted small">Si el investigado sí presenta su descargo, regístrelo aquí para que ya no se genere el acta:</p>
          <div class="grid-2">
            <label>Fecha de descargo<input type="date" id="dFecha" required /></label>
            <label>N.º de documento<input type="text" id="dNumero" /></label>
          </div>
          <label>Archivo del descargo<input type="file" id="dArchivo" /></label>
          <p id="descargoError" class="error hidden"></p>
          <button type="submit" class="btn-secondary">Registrar descargo recibido</button>
        </form>
      `}
    </div>
    ` : ""}

    ${codigoEsLeve && (nota.fecha_descargo || plazoVencido) ? `
    <div class="detail-card">
      <h3>Orden de Sanción</h3>
      ${puedeSancion ? `
        <form id="sancionForm">
          <div class="label" style="margin-bottom:8px">Sanción a imponer (evaluando el descargo${nota.fecha_descargo ? " — puede marcarla usted o dejar que la IA la elija" : ""})</div>
          ${opcionesSancion.map((o) => {
            const marcado = (o.value === "amonestacion" && nota.sancion_tipo === "amonestacion") ||
              (nota.sancion_tipo === "dias" && String(nota.sancion_dias) === o.value);
            return `<label class="checkbox-row"><input type="radio" name="sancionTercio" value="${o.value}" ${marcado ? "checked" : ""} required /> ${escapeHtml(o.label)}</label>`;
          }).join("")}
          <label>Descargo del investigado (resumen de puntos relevantes y argumentos de defensa${nota.fecha_descargo ? " — deje en blanco y presione \"Redactar con IA\" para que se lea solo del archivo subido" : ""})
            <textarea id="sSancionDescargo" rows="4" placeholder="${nota.fecha_descargo ? "Primero use 'Redactar con IA' o escriba un resumen propio. No copie el descargo completo." : ""}">${escapeHtml(nota.sancion_descargo_resumen || (nota.fecha_descargo ? "" : "El investigado no presentó su descargo por escrito dentro del plazo de un (01) día hábil establecido por ley, conforme acta respectiva, precluyendo su derecho a la defensa en la presente etapa procedimental."))}</textarea>
          </label>
          <label>Análisis y evaluación ${nota.fecha_descargo ? "(notas sueltas o texto final)" : "(se completa solo al elegir el tercio; puede editarlo si lo desea)"}
            <textarea id="sSancionAnalisis" rows="6" required placeholder="Anote en sus palabras: qué se acredita, qué alega el investigado, y por qué corresponde el tercio elegido... o escriba el texto final directamente.">${escapeHtml(nota.sancion_analisis || "")}</textarea>
          </label>
          ${nota.fecha_descargo ? `
          <div class="modal-actions" style="justify-content:flex-start; margin-bottom:10px">
            <button type="button" class="btn-secondary" id="btnRedactarIA">✨ Analizar descargo y redactar con IA</button>
          </div>
          <p class="muted small">La IA elige el tercio y redacta el resumen del descargo y el análisis, usando las directivas internas activas como única fuente de reglas institucionales — si el descargo invoca algo que ninguna directiva regula, la IA lo dice en vez de inventarlo.</p>
          <p id="sancionIAStatus" class="muted small hidden"></p>
          ` : `<p class="muted small">Sin descargo: el texto se genera automáticamente según el tercio que elija arriba — no necesita IA ni escribir nada, solo revisar.</p>`}
          <p id="sancionError" class="error hidden"></p>
          <div class="modal-actions" style="justify-content:flex-start">
            <button type="button" class="btn-ghost" id="btnRevisarOrden">🔍 Revisar antes de generar</button>
            <button type="submit" class="btn-primary">Guardar y descargar Orden de Sanción</button>
          </div>
        </form>
        ${nota.orden_sancion_generada_at ? `<p class="muted small">Generada por última vez el ${formatDate(nota.orden_sancion_generada_at.slice(0, 10))}.</p>` : ""}
      ` : `<p class="muted small">Para generar la Orden de Sanción, verifique que el oficial que constató la falta y el investigado estén registrados en Efectivos.</p>`}
    </div>
    ` : ""}

    ${(isAdmin || esDuenoDeLaNota) && nota.orden_sancion_generada_at ? `
    <div class="detail-card">
      <h3>Notificación de la Orden de Sanción</h3>
      ${nota.orden_notificada_at ? `
        <p class="muted small">Notificada el ${formatDate(nota.orden_notificada_at.slice(0, 10))}.</p>
      ` : `
        <p class="muted small">Suba el cargo de notificación firmado por el investigado (la IA verifica que corresponda antes de guardar).</p>
        <form id="ordenNotifForm">
          <label>Cargo de notificación firmado (PDF o foto)
            <input type="file" id="fOrdenNotifArchivo" accept="application/pdf,image/*" required />
          </label>
          <div class="modal-actions" style="justify-content:flex-start; margin:8px 0">
            <button type="button" class="btn-secondary" id="btnVerificarNotifIA">✨ Verificar con IA</button>
          </div>
          <p id="ordenNotifIAStatus" class="muted small hidden"></p>
          <label>Fecha de notificación (la completa la IA si la detecta; verifíquela)
            <input type="date" id="fOrdenNotifFecha" required />
          </label>
          <p id="ordenNotifError" class="error hidden"></p>
          <button type="submit" class="btn-primary">Registrar notificación</button>
        </form>
      `}
    </div>
    ` : ""}

    ${isAdmin ? `
    <div class="detail-card">
      <h3>Expediente</h3>
      ${exp ? `
        <div class="detail-grid">
          <div class="detail-field"><div class="label">N.º de oficio</div><div class="value">${escapeHtml(exp.numero_oficio || "-")}</div></div>
          <div class="detail-field"><div class="label">N.º de HT</div><div class="value">${escapeHtml(exp.numero_ht || "-")}</div></div>
          <div class="detail-field"><div class="label">Días de sanción</div><div class="value">${exp.dias_sancion ?? "-"}</div></div>
          <div class="detail-field"><div class="label">Archivo</div><div class="value">${expArchivo}</div></div>
        </div>
      ` : `
        <p class="muted small">Sin expediente registrado.</p>
        <form id="expForm">
          <div class="grid-2">
            <label>N.º de oficio<input type="text" id="eOficio" required /></label>
            <label>N.º de HT<input type="text" id="eHt" required /></label>
          </div>
          <label>Días de sanción<input type="number" id="eDias" min="0" /></label>
          <label>Archivo del expediente<input type="file" id="eArchivo" /></label>
          <p id="expError" class="error hidden"></p>
          <button type="submit" class="btn-primary">Registrar expediente</button>
        </form>
      `}
    </div>
    ` : ""}

    ${versionesDocs?.length ? `
    <div class="detail-card">
      <h3>Versiones generadas</h3>
      <p class="muted small">Cada vez que se genera un documento queda archivada esta copia exacta, aunque después se regenere con datos distintos.</p>
      <div class="detail-grid">${versionesHtml}</div>
    </div>
    ` : ""}
  `;

  $("btnDescargarImputacion")?.addEventListener("click", async (e) => {
    await handleDescargarImputacion(nota, e.currentTarget);
    openNotaDetail(nota.id);
  });
  $("btnDescargarActaDetalle")?.addEventListener("click", (e) => handleDescargarActaNoDescargo(nota, e.currentTarget));
  $("btnRevisarImputacion")?.addEventListener("click", () => abrirRevision("imputacion", nota));
  $("btnRevisarActa")?.addEventListener("click", () => abrirRevision("acta", nota));
  $("btnRevisarOrden")?.addEventListener("click", () => abrirRevision("orden", nota));
  // Registrar la notificación y el descargo lo puede hacer cualquier usuario
  // autenticado (cada oficial notifica en persona y marca su propio caso),
  // no solo admin como el resto de la edición de la nota.
  $("notificacionForm")?.addEventListener("submit", (e) => submitNotificacion(e, nota.id));
  $("descargoForm")?.addEventListener("submit", (e) => submitDescargo(e, nota.id));
  $("sancionForm")?.addEventListener("submit", (e) => submitSancion(e, nota));
  $("btnRedactarIA")?.addEventListener("click", () => redactarConIA(nota));
  $("btnVerificarNotifIA")?.addEventListener("click", () => verificarNotificacionOrdenIA(nota));
  $("ordenNotifForm")?.addEventListener("submit", (e) => submitNotificacionOrden(e, nota));

  // Si no hubo descargo, al elegir el tercio se rellena el "Análisis y
  // Evaluación" con el párrafo estándar (venció el plazo...) cerrando según
  // el extremo (mínimo/medio/máximo) elegido. Solo se pisa el campo si sigue
  // vacío o si su contenido fue puesto por este mismo autocompletado (no si
  // el oficial ya escribió algo a mano).
  const analisisEl = $("sSancionAnalisis");
  if (analisisEl && !nota.fecha_descargo) {
    document.querySelectorAll('input[name="sancionTercio"]').forEach((radio) => {
      radio.addEventListener("change", () => {
        const esVacioOAutocompletado = !analisisEl.value.trim() || analisisEl.dataset.autofilled === "true";
        if (esVacioOAutocompletado) {
          analisisEl.value = analisisSinDescargoDefault(nota.codigo_infraccion, radio.value);
          analisisEl.dataset.autofilled = "true";
        }
      });
    });
    // Un input real del usuario (no un .value asignado por JS) sí dispara este
    // evento, así que basta para distinguir "lo escribió el oficial" de
    // "lo puso el autocompletado".
    analisisEl.addEventListener("input", () => {
      analisisEl.dataset.autofilled = "false";
    });
  }

  activarAutoguardadoSancion(nota);

  if (isAdmin) {
    $("btnEliminarNota")?.addEventListener("click", () => eliminarNota(nota.id));
    $("codigoInfraccionForm")?.addEventListener("submit", (e) => submitCodigoInfraccion(e, nota.id));
    $("reincForm")?.addEventListener("submit", (e) => submitReincorporacion(e, nota.id));
    $("rArchivo")?.addEventListener("change", (e) => autocompletarReincorporacion(e.target.files[0]));
    $("expForm")?.addEventListener("submit", (e) => submitExpediente(e, nota.id));
  }
}

async function submitNotificacion(e, notaId) {
  e.preventDefault();
  const msgEl = $("notificacionMsg");
  msgEl.classList.add("hidden");
  const fecha = $("fNotificacion").value;
  if (!fecha) return;
  const { error } = await supabase.rpc("registrar_notificacion_imputacion", { p_nota_id: notaId, p_fecha: fecha });
  if (error) { msgEl.textContent = "Error: " + error.message; msgEl.classList.remove("hidden"); return; }
  openNotaDetail(notaId);
}

// Casos previos del mismo investigado ya registrados en el sistema (mismo
// criterio de emparejamiento por nombre que usa el resto de la app: al menos
// 2 palabras en común entre apellidos y nombres). Se le pasa a la IA como
// posible agravante, igual que en notificacion-imputacion-pnp.
function buscarAntecedentes(nota, todasNotas) {
  if (!nota?.apellidos || !todasNotas?.length) return [];
  const objetivo = tokens(`${nota.apellidos} ${nota.nombres || ""}`);
  if (!objetivo.length) return [];
  return todasNotas
    .filter((n) => n.id !== nota.id)
    .filter((n) => {
      const t = new Set(tokens(`${n.apellidos || ""} ${n.nombres || ""}`));
      return objetivo.filter((tok) => t.has(tok)).length >= 2;
    })
    .map((n) => ({ codigo_infraccion: n.codigo_infraccion || null, fecha_falta: n.fecha_falta || null }))
    .sort((a, b) => (b.fecha_falta || "").localeCompare(a.fecha_falta || ""));
}

// A diferencia de la versión anterior, la IA ya no solo redacta un tercio que
// el oficial eligió a mano: ahora ELLA misma evalúa el descargo (apoyada en
// las directivas internas cargadas y los antecedentes del investigado) y
// elige el tercio, marcando el radio correspondiente. El oficial sigue
// revisando y puede cambiar la selección o el texto antes de guardar — el
// botón "Guardar y descargar" sigue siendo el paso final manual.
async function redactarConIA(nota) {
  const btn = $("btnRedactarIA");
  const statusEl = $("sancionIAStatus");
  const errEl = $("sancionError");
  errEl.classList.add("hidden");

  const opciones = opcionesTercio(nota.codigo_infraccion) || [];
  const infraccion = getInfraccion(nota.codigo_infraccion);

  btn.disabled = true;
  statusEl.classList.remove("hidden");
  try {
    let descargoNotas = $("sSancionDescargo").value.trim();
    // Un resumen guardado antes de esta corrección pudo quedar con la frase
    // genérica de relleno: no debe analizarse como si fuera el descargo, se
    // vuelve a leer el archivo original para obtener sus argumentos reales.
    if (esResumenDescargoInsuficiente(descargoNotas)) descargoNotas = "";
    if (!descargoNotas && nota.archivo_descargo_path) {
      statusEl.textContent = "Leyendo el archivo del descargo ya subido...";
      descargoNotas = (await extraerTextoDescargo(nota, (msg) => { statusEl.textContent = msg; })).trim();
    }
    if (!descargoNotas) {
      throw new Error("No se encontró texto legible del descargo. Revise que el archivo esté cargado o escriba un resumen manual de los puntos relevantes y argumentos de defensa.");
    }

    statusEl.textContent = "Consultando directivas internas y antecedentes...";
    const directivas = directivasParaIA(state.directivas.length ? state.directivas : await listarDirectivas(supabase));
    const antecedentes = buscarAntecedentes(nota, state.notas);

    statusEl.textContent = "Analizando el descargo y redactando con IA...";
    const { data, error } = await supabase.functions.invoke("redactar-analisis", {
      body: {
        investigadoCompleto: nombreInvestigadoVisible(nota, true),
        codigoInfraccion: normalizarCodigoInfraccion(nota.codigo_infraccion),
        infraccionTexto: infraccion?.infraccion || "",
        hechoResumen: buildCasoConcreto(nota),
        tercios: opciones.map((o) => ({ value: o.value, label: o.label, extremo: o.extremo })),
        descargoNotas,
        analisisNotas: $("sSancionAnalisis").value.trim(),
        antecedentes,
        directivas,
      },
    });
    if (error) throw new Error(await mensajeErrorFuncion(error));
    if (data?.error) throw new Error(data.error);
    if (data?.descargo_texto && !esResumenDescargoInsuficiente(data.descargo_texto)) {
      $("sSancionDescargo").value = data.descargo_texto;
    } else {
      throw new Error("No se pudo obtener un resumen útil del descargo. Revise el archivo o redacte un resumen de los puntos relevantes y argumentos de defensa antes de generar la orden.");
    }
    if (data?.analisis_texto) {
      $("sSancionAnalisis").value = data.analisis_texto;
      $("sSancionAnalisis").dataset.autofilled = "false";
    }
    if (data?.tercio_value) {
      const radio = [...document.querySelectorAll('input[name="sancionTercio"]')]
        .find((r) => r.value === data.tercio_value);
      if (radio) radio.checked = true;
    }
    // Guarda lo que redactó la IA como borrador: si se recarga antes de
    // "Guardar y descargar", no se pierde.
    guardarBorrador(nota.id, "descargo", $("sSancionDescargo").value);
    guardarBorrador(nota.id, "analisis", $("sSancionAnalisis").value);
    statusEl.textContent = "Listo — la IA evaluó el descargo y eligió el tercio. Revise la selección y el texto antes de guardar.";
  } catch (err) {
    console.error(err);
    statusEl.classList.add("hidden");
    errEl.textContent = "No se pudo redactar con IA: " + (err.message || err);
    errEl.classList.remove("hidden");
  } finally {
    btn.disabled = false;
  }
}

async function verificarNotificacionOrdenIA(nota) {
  const file = $("fOrdenNotifArchivo").files[0];
  const statusEl = $("ordenNotifIAStatus");
  if (!file) { statusEl.textContent = "Seleccione primero el archivo del cargo firmado."; statusEl.classList.remove("hidden"); return; }
  const btn = $("btnVerificarNotifIA");
  btn.disabled = true;
  statusEl.classList.remove("hidden");
  statusEl.textContent = "Leyendo el archivo...";
  try {
    const esPdf = file.type === "application/pdf";
    const esImagen = file.type.startsWith("image/");
    const textoDocumento = esPdf
      ? await extractPdfText(file, (msg) => { statusEl.textContent = msg; })
      : esImagen
      ? await extractImagenTextoConOcr(file, (msg) => { statusEl.textContent = msg; })
      : "";

    statusEl.textContent = "Verificando con IA...";
    const infraccion = getInfraccion(nota.codigo_infraccion);
    const sancionImpuesta = nota.sancion_tipo === "amonestacion" ? "amonestación" : `${nota.sancion_dias} días de Sanción Simple`;
    const { data, error } = await supabase.functions.invoke("revisar-documento-ia", {
      body: {
        tipo: "notificacion_orden",
        investigadoCompleto: nombreInvestigadoVisible(nota, true),
        codigoInfraccion: normalizarCodigoInfraccion(nota.codigo_infraccion),
        sancionImpuesta,
        textoDocumento,
      },
    });
    if (error) throw new Error(await mensajeErrorFuncion(error));
    if (data?.error) throw new Error(data.error);
    if (data?.fecha_detectada) $("fOrdenNotifFecha").value = data.fecha_detectada;
    const observaciones = (data?.observaciones || []).join(" · ");
    statusEl.textContent = data?.consistente
      ? `✓ El documento corresponde a esta notificación.${observaciones ? " " + observaciones : ""}`
      : `⚠ ${observaciones || "La IA no pudo confirmar que el documento corresponda. Revise antes de guardar."}`;
  } catch (err) {
    console.error(err);
    statusEl.textContent = "No se pudo verificar con IA: " + (err.message || err);
  } finally {
    btn.disabled = false;
  }
}

async function submitNotificacionOrden(e, nota) {
  e.preventDefault();
  const errEl = $("ordenNotifError");
  errEl.classList.add("hidden");
  const file = $("fOrdenNotifArchivo").files[0];
  const fecha = $("fOrdenNotifFecha").value;
  if (!file || !fecha) return;

  const path = `${nota.id}/orden_notif_${Date.now()}_${file.name}`;
  const { error: upErr } = await supabase.storage.from("notas").upload(path, file);
  if (upErr) { errEl.textContent = "Error al subir archivo: " + upErr.message; errEl.classList.remove("hidden"); return; }

  const { error } = await supabase.rpc("registrar_notificacion_orden", {
    p_nota_id: nota.id,
    p_fecha: fecha,
    p_archivo_path: path,
    p_archivo_nombre: file.name,
  });
  if (error) { errEl.textContent = "Error: " + error.message; errEl.classList.remove("hidden"); return; }
  openNotaDetail(nota.id);
}

async function submitSancion(e, nota) {
  e.preventDefault();
  const errEl = $("sancionError");
  errEl.classList.add("hidden");
  const tercioValue = document.querySelector('input[name="sancionTercio"]:checked')?.value;
  const analisisTexto = $("sSancionAnalisis").value.trim();
  const descargoTexto = $("sSancionDescargo").value.trim();

  if (!tercioValue) { errEl.textContent = "Seleccione la sanción a imponer."; errEl.classList.remove("hidden"); return; }
  if (!analisisTexto) { errEl.textContent = "Escriba el Análisis y Evaluación."; errEl.classList.remove("hidden"); return; }
  if (nota.fecha_descargo && esResumenDescargoInsuficiente(descargoTexto)) {
    errEl.textContent = "Falta el resumen del descargo. Use «Analizar descargo y redactar con IA» o escriba los puntos relevantes y argumentos de defensa antes de generar la orden.";
    errEl.classList.remove("hidden");
    return;
  }

  const submitBtn = e.target.querySelector("button[type=submit]");
  const textoOriginal = submitBtn.textContent;
  submitBtn.disabled = true;
  submitBtn.textContent = "Generando...";
  try {
    const blob = await renderizarOrdenSancionDocx(nota, state.efectivos, { tercioValue, analisisTexto, descargoTexto });
    const nombreArchivo = nombreArchivoDocumento("ORDEN DE SANCION", nota);
    saveAs(blob, nombreArchivo);
    registrarVersionDocumento(nota.id, "orden_sancion", blob, nombreArchivo);
    const tipo = tercioValue === "amonestacion" ? "amonestacion" : "dias";
    const dias = tercioValue === "amonestacion" ? null : Number(tercioValue);
    const { error } = await supabase.rpc("registrar_sancion", {
      p_nota_id: nota.id,
      p_tipo: tipo,
      p_dias: dias,
      p_analisis: analisisTexto,
      p_descargo_resumen: descargoTexto,
    });
    if (error) { errEl.textContent = "Se generó el documento, pero no se pudo guardar la decisión: " + error.message; errEl.classList.remove("hidden"); return; }
    limpiarBorradoresNota(nota.id);
    openNotaDetail(nota.id);
  } catch (err) {
    console.error(err);
    errEl.textContent = err.message || "No se pudo generar la Orden de Sanción.";
    errEl.classList.remove("hidden");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = textoOriginal;
  }
}

async function submitDescargo(e, notaId) {
  e.preventDefault();
  const errEl = $("descargoError");
  errEl.classList.add("hidden");
  const fecha = $("dFecha").value;
  const numero = $("dNumero").value.trim();
  const file = $("dArchivo").files[0];

  let archivo_descargo_path = null;
  let archivo_descargo_nombre = null;
  if (file) {
    const path = `${notaId}/descargo_${Date.now()}_${file.name}`;
    const { error: upErr } = await supabase.storage.from("notas").upload(path, file);
    if (upErr) { errEl.textContent = "Error al subir archivo: " + upErr.message; errEl.classList.remove("hidden"); return; }
    archivo_descargo_path = path;
    archivo_descargo_nombre = file.name;
  }

  const { error } = await supabase.rpc("registrar_descargo", {
    p_nota_id: notaId,
    p_fecha: fecha,
    p_numero: numero,
    p_archivo_path: archivo_descargo_path,
    p_archivo_nombre: archivo_descargo_nombre,
  });

  if (error) { errEl.textContent = "Error: " + error.message; errEl.classList.remove("hidden"); return; }
  openNotaDetail(notaId);
}

async function submitCodigoInfraccion(e, notaId) {
  e.preventDefault();
  const msgEl = $("codigoInfraccionMsg");
  msgEl.classList.add("hidden");
  const codigo_infraccion = $("fCodigoInfraccionEdit").value.trim();
  const { error } = await supabase.from("notas_informativas").update({ codigo_infraccion }).eq("id", notaId);
  if (error) { msgEl.textContent = "Error: " + error.message; msgEl.classList.remove("hidden"); return; }
  openNotaDetail(notaId);
}

async function eliminarNota(id) {
  if (!confirm("¿Eliminar esta nota informativa? Esta acción no se puede deshacer.")) return;
  const { error } = await supabase.from("notas_informativas").delete().eq("id", id);
  if (error) { alert("No se pudo eliminar: " + error.message); return; }
  showView("view-dashboard");
  loadNotas();
}

async function submitReincorporacion(e, notaId) {
  e.preventDefault();
  const errEl = $("reincError");
  errEl.classList.add("hidden");
  const fecha = $("rFecha").value;
  const numero = $("rNumero").value.trim();
  const hora = $("rHora").value || null;
  const observacion = $("rObservacion").value.trim() || null;
  const file = $("rArchivo").files[0];

  let archivo_reincorporacion_path = null;
  let archivo_reincorporacion_nombre = null;
  if (file) {
    const path = `${notaId}/reincorporacion_${Date.now()}_${file.name}`;
    const { error: upErr } = await supabase.storage.from("notas").upload(path, file);
    if (upErr) { errEl.textContent = "Error al subir archivo: " + upErr.message; errEl.classList.remove("hidden"); return; }
    archivo_reincorporacion_path = path;
    archivo_reincorporacion_nombre = file.name;
  }

  const { data: notaActual } = await supabase
    .from("notas_informativas")
    .select("fecha_falta, hora_falta, codigo_infraccion")
    .eq("id", notaId)
    .single();

  let codigo_infraccion;
  if (notaActual && !notaActual.codigo_infraccion) {
    const sugerido = sugerirCodigoInfraccion(horasAusente({ ...notaActual, fecha_reincorporacion: fecha, hora_reincorporacion: hora }));
    if (sugerido) codigo_infraccion = sugerido;
  }

  const { error } = await supabase.from("notas_informativas").update({
    fecha_reincorporacion: fecha,
    numero_nota_reincorporacion: numero,
    hora_reincorporacion: hora,
    reincorporacion_observacion: observacion,
    ...(codigo_infraccion ? { codigo_infraccion } : {}),
    ...(archivo_reincorporacion_path ? { archivo_reincorporacion_path, archivo_reincorporacion_nombre } : {}),
  }).eq("id", notaId);

  if (error) { errEl.textContent = "Error: " + error.message; errEl.classList.remove("hidden"); return; }
  openNotaDetail(notaId);
}

async function submitExpediente(e, notaId) {
  e.preventDefault();
  const errEl = $("expError");
  errEl.classList.add("hidden");
  const numero_oficio = $("eOficio").value.trim();
  const numero_ht = $("eHt").value.trim();
  const dias_sancion = $("eDias").value ? Number($("eDias").value) : null;
  const file = $("eArchivo").files[0];

  const { data: inserted, error } = await supabase.from("expedientes").insert({
    nota_id: notaId, numero_oficio, numero_ht, dias_sancion,
  }).select().single();

  if (error) { errEl.textContent = "Error: " + error.message; errEl.classList.remove("hidden"); return; }

  if (file) {
    const path = `${inserted.id}/${Date.now()}_${file.name}`;
    const { error: upErr } = await supabase.storage.from("expedientes").upload(path, file);
    if (!upErr) {
      await supabase.from("expedientes").update({
        archivo_expediente_path: path, archivo_expediente_nombre: file.name,
      }).eq("id", inserted.id);
    }
  }
  openNotaDetail(notaId);
}

// ---------- Efectivos ----------
async function loadEfectivos() {
  const { data, error } = await supabase
    .from("efectivos")
    .select("*")
    .order("apellidos_nombres", { ascending: true });
  if (error) { console.error(error); toast("No se pudo cargar el padrón de Efectivos: " + (error.message || "error de red") + ". Los documentos podrían no completar CIP/DNI."); return; }
  state.efectivos = data || [];
  renderEfectivosTable(state.efectivos);
}

function renderEfectivosTable(list) {
  const tbody = $("efectivosTableBody");
  tbody.innerHTML = "";
  $("efectivosEmpty").classList.toggle("hidden", list.length > 0);
  for (const ef of list) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(ef.grado || "")}</td>
      <td>${escapeHtml(ef.apellidos_nombres || "")}</td>
      <td>${escapeHtml(ef.cip || "")}</td>
      <td>${escapeHtml(ef.dni || "")}</td>
    `;
    tbody.appendChild(tr);
  }
}

$("searchEfectivos").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  const filtered = state.efectivos.filter((ef) =>
    [ef.cip, ef.dni, ef.apellidos_nombres, ef.grado].filter(Boolean).join(" ").toLowerCase().includes(q)
  );
  renderEfectivosTable(filtered);
});

// Alta manual de un efectivo al padrón (solo admin; la RLS ya lo exige).
function cerrarModalEfectivo() { $("modalNuevoEfectivo").classList.add("hidden"); }
$("btnNuevoEfectivo")?.addEventListener("click", () => {
  $("efectivoForm").reset();
  $("efectivoFormError").classList.add("hidden");
  $("modalNuevoEfectivo").classList.remove("hidden");
  $("efGrado").focus();
});
$("btnCerrarModalEfectivo")?.addEventListener("click", cerrarModalEfectivo);
$("btnCancelarEfectivo")?.addEventListener("click", cerrarModalEfectivo);
$("modalNuevoEfectivo")?.addEventListener("click", (e) => { if (e.target === $("modalNuevoEfectivo")) cerrarModalEfectivo(); });

$("efectivoForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = $("efectivoFormError");
  errEl.classList.add("hidden");
  const cip = $("efCip").value.trim();
  const dni = $("efDni").value.trim();
  const apellidos_nombres = $("efApellidosNombres").value.trim();
  const grado = $("efGrado").value.trim();
  if (!cip || !dni || !apellidos_nombres) {
    errEl.textContent = "Complete grado, CIP, DNI y apellidos y nombres.";
    errEl.classList.remove("hidden");
    return;
  }
  const btn = e.target.querySelector("button[type=submit]");
  btn.disabled = true;
  try {
    const { error } = await supabase.from("efectivos").insert({
      grado, cip, dni, apellidos_nombres,
      created_by: state.session.user.id,
    });
    if (error) {
      errEl.textContent = /duplicate key|unique/i.test(error.message)
        ? `Ya existe un efectivo con ese CIP o DNI.`
        : "No se pudo guardar: " + error.message;
      errEl.classList.remove("hidden");
      return;
    }
    cerrarModalEfectivo();
    await loadEfectivos();
    $("searchEfectivos").value = cip;
    $("searchEfectivos").dispatchEvent(new Event("input"));
  } finally {
    btn.disabled = false;
  }
});

// ---------- Nueva nota modal ----------
let pdfCandidates = [];

$("btnNuevaNota").addEventListener("click", () => {
  $("notaForm").reset();
  $("lookupResult").classList.add("hidden");
  $("notaFormError").classList.add("hidden");
  $("pdfAutoStatus").classList.add("hidden");
  pdfCandidates = [];
  renderCandidatesChecklist();
  // Quien registra la nota suele ser el mismo oficial que constató --
  // se autocompleta con sus propios datos (buscados por su CIP de sesión),
  // igual que en notificacion-imputacion-pnp; se puede editar si no aplica.
  // Se marca dataset.autofilled="true" para que, si luego se sube un PDF
  // y la IA detecta un oficial distinto, ese dato SÍ pueda reemplazar este
  // valor puesto por default (antes el autocompletado con el propio nombre
  // bloqueaba silenciosamente la detección real del PDF, porque esa lógica
  // solo llenaba el campo si estaba vacío).
  const yoMismo = state.cip ? state.efectivos.find((ef) => ef.cip === state.cip) : null;
  $("fOficialConstato").value = yoMismo ? `${yoMismo.grado || ""} ${yoMismo.apellidos_nombres || ""}`.replace(/\s+/g, " ").trim() : "";
  $("fOficialConstato").dataset.autofilled = yoMismo ? "true" : "false";
  $("modalNuevaNota").classList.remove("hidden");
});
$("fOficialConstato").addEventListener("input", () => {
  $("fOficialConstato").dataset.autofilled = "false";
});
$("btnCerrarModal").addEventListener("click", closeModal);
$("btnCancelarNota").addEventListener("click", closeModal);
function closeModal() { $("modalNuevaNota").classList.add("hidden"); }

function splitApellidosNombres(full) {
  const txt = (full || "").replace(/\s*\([^)]*\)\s*$/, "").trim();
  if (txt.includes(",")) {
    const [ap, no] = txt.split(",");
    return { apellidos: ap.trim(), nombres: (no || "").trim() };
  }
  const words = txt.split(/\s+/).filter(Boolean);
  if (words.length <= 2) return { apellidos: txt, nombres: "" };
  return { apellidos: words.slice(0, 2).join(" "), nombres: words.slice(2).join(" ") };
}

function renderCandidatesChecklist() {
  const container = $("multiplesEfectivos");
  const list = $("multiplesEfectivosList");
  if (pdfCandidates.length <= 1) {
    container.classList.add("hidden");
    list.innerHTML = "";
    return;
  }
  list.innerHTML = pdfCandidates.slice(1).map((c) => `
    <div class="multi-efectivo-row">
      <label class="checkbox-row"><input type="checkbox" class="multiCheck" checked /></label>
      <div class="grid-3">
        <input type="text" class="multiGrado" value="${escapeHtml(c.grado)}" placeholder="Grado" />
        <input type="text" class="multiApellidos" value="${escapeHtml(c.apellidos)}" placeholder="Apellidos" />
        <input type="text" class="multiNombres" value="${escapeHtml(c.nombres)}" placeholder="Nombres" />
      </div>
    </div>
  `).join("");
  container.classList.remove("hidden");
}

// ---------- Autocompletado desde PDF (Nota Informativa) ----------
const MESES_ABREV = {
  ENE: "01", FEB: "02", MAR: "03", ABR: "04", MAY: "05", JUN: "06",
  JUL: "07", AGO: "08", SET: "09", SEP: "09", OCT: "10", NOV: "11", DIC: "12",
};

// Antes esto usaba tesseract.js (OCR genérico corriendo en el navegador):
// lentísimo en documentos largos (minutos) y con errores frecuentes en
// escaneos reales (sellos, membretes, mala calidad). Ahora, cuando el PDF no
// tiene texto seleccionable, cada página se manda como imagen a la función
// "extraer-texto-vision" (Claude con visión) -- mucho más preciso, y corre
// en el servidor en vez de trabar el navegador del oficial.
const PAGINAS_POR_LOTE_VISION = 4;

function canvasABase64Jpeg(canvas) {
  const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

async function blobABase64(blob) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return dataUrl.slice(dataUrl.indexOf(",") + 1);
}

async function transcribirPaginasConIA(paginas, onEstado) {
  const lotes = [];
  for (let i = 0; i < paginas.length; i += PAGINAS_POR_LOTE_VISION) {
    lotes.push(paginas.slice(i, i + PAGINAS_POR_LOTE_VISION));
  }
  const textos = [];
  for (let i = 0; i < lotes.length; i++) {
    const desde = i * PAGINAS_POR_LOTE_VISION + 1;
    const hasta = Math.min((i + 1) * PAGINAS_POR_LOTE_VISION, paginas.length);
    onEstado?.(paginas.length > 1
      ? `Transcribiendo con IA: página${hasta > desde ? "s" : ""} ${desde}${hasta > desde ? `-${hasta}` : ""} de ${paginas.length}...`
      : "Transcribiendo la imagen con IA...");
    const { data, error } = await supabase.functions.invoke("extraer-texto-vision", {
      body: { paginas: lotes[i] },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    textos.push(data?.texto || "");
  }
  return textos.join("\n\n");
}

async function extractPdfText(file, onEstado) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str).join(" ") + "\n";
  }
  // Algunas notas se generan como una foto/escaneo de la página (sin texto
  // seleccionable): pdf.js no extrae nada de ellas. En ese caso se recurre a IA con visión.
  if (text.trim().length < 30) {
    onEstado?.("Esta nota es una imagen escaneada: preparando las páginas para leerlas con IA...");
    const paginas = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 1.8 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      paginas.push({ data: canvasABase64Jpeg(canvas), mediaType: "image/jpeg" });
    }
    text = await transcribirPaginasConIA(paginas, onEstado);
  }
  return text;
}

async function extractImagenTextoConOcr(blob, onEstado) {
  const base64 = await blobABase64(blob);
  return await transcribirPaginasConIA([{ data: base64, mediaType: blob.type || "image/jpeg" }], onEstado);
}

// Lee automáticamente el archivo de descargo ya subido (PDF o foto), para
// que el oficial no tenga que volver a escribir lo que ya alegó el
// investigado por escrito. Si no se puede leer, devuelve "" y el oficial
// puede escribir sus notas a mano como respaldo.
async function extraerTextoDescargo(nota, onEstado) {
  if (!nota.archivo_descargo_path) return "";
  const { data: blob, error } = await supabase.storage.from("notas").download(nota.archivo_descargo_path);
  if (error || !blob) return "";
  const nombre = nota.archivo_descargo_nombre || "";
  const esPdf = /\.pdf$/i.test(nombre) || blob.type === "application/pdf";
  const esImagen = /\.(jpe?g|png|webp|bmp)$/i.test(nombre) || blob.type.startsWith("image/");
  try {
    if (esPdf) return await extractPdfText(blob, onEstado);
    if (esImagen) return await extractImagenTextoConOcr(blob, onEstado);
  } catch (err) {
    console.error("No se pudo leer el archivo de descargo:", err);
  }
  return "";
}

// Extrae los efectivos mencionados en la nota. Prioriza la lista con viñetas
// ("- GRADO PNP NOMBRE"), usada cuando hay varios efectivos faltos; si no hay
// viñetas, cae a la frase "... del/de los/de las GRADO PNP NOMBRE" y entre
// todas sus menciones toma la de más palabras (el PDF a veces pega el
// apellido sin espacio en una mención pero lo repite bien espaciado en otra).
function extractPersonCandidates(norm) {
  const bulletPattern = /-\s*([A-Z0-9./]{1,8})\s+PNP\.?\s+([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ]*(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]{2,}){0,4})/g;
  const bullets = [...norm.matchAll(bulletPattern)];
  if (bullets.length) {
    return bullets.map((m) => ({ grado: m[1].trim(), nombreCompleto: m[2].trim() }));
  }

  // "el Comisario ... da cuenta que el/la GRADO PNP NOMBRE, GRADO PNP NOMBRE, ...
  // y GRADO PNP NOMBRE se <verbo>". Formato más estable entre notas de falta y
  // de reincorporación: a diferencia del ASUNTO (que a veces omite "PNP"), este
  // párrafo siempre antepone "PNP" a cada nombre. El artículo (el/la/los/las)
  // solo suele preceder al primer efectivo de la lista; los demás (separados
  // por comas, y el último por "y") normalmente no lo llevan, así que aquí es
  // opcional en vez de obligatorio.
  const mBloque = norm.match(/da\s+cuenta\s+que\s+([\s\S]*?)\s+se\s+\w+/i);
  if (mBloque) {
    const personPattern = /(?:(?:el|la|los|las)\s+)?([A-Z0-9./]{1,8})\s+PNP\s+([A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ]*(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+){0,4}?)(?=\s*,|\s+y\s+|\s*$)/g;
    const personas = [...mBloque[1].matchAll(personPattern)];
    if (personas.length) {
      return personas.map((m) => ({ grado: m[1].trim(), nombreCompleto: m[2].trim() }));
    }
  }

  // Admite "del", "de la", "de los", "de las" y también "de" sin artículo.
  // El nombre termina en coma/punto, justo antes de la siguiente mención
  // "NOTA INFORMATIVA", o al final del texto (partes sin puntuación ahí).
  const prosePattern = /\bde(?:l|\s+la|\s+los|\s+las)?\s+([A-Z0-9./]{1,8}\s+PNP\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ]*(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+){0,5})(?=[.,]|\s+NOTA\s+INFORMATIVA|\s*$)/gi;
  const matches = [...norm.matchAll(prosePattern)];
  let best = null;
  let bestWordCount = -1;
  for (const m of matches) {
    const raw = m[1].trim();
    const idxPnp = raw.toUpperCase().indexOf("PNP");
    if (idxPnp === -1) continue;
    const nombreCompleto = raw.slice(idxPnp + 3).trim();
    const wordCount = nombreCompleto.split(/\s+/).filter(Boolean).length;
    if (wordCount > bestWordCount) {
      bestWordCount = wordCount;
      best = { grado: raw.slice(0, idxPnp).trim(), nombreCompleto };
    }
  }
  return best ? [best] : [];
}

// Extracción estructurada por IA (reemplaza al parser por expresiones
// regulares como método principal): manda el texto crudo del PDF/OCR a la
// Edge Function "extraer-nota-informativa" y devuelve el resultado ya
// normalizado a la misma forma que devolvía parseNotaInformativa/
// parseReincorporacion, para no tener que tocar el resto de los llamadores.
// Si la llamada falla (red caída, IA sin configurar, etc.) el llamador cae
// de vuelta al parser por patrones como respaldo — nunca deja al oficial sin
// autocompletado por un error transitorio.
async function extraerDatosNotaIA(texto, tipo) {
  const { data, error } = await supabase.functions.invoke("extraer-nota-informativa", {
    body: { tipo, texto },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  return data;
}

function normalizarResultadoFaltaIA(ia) {
  const candidates = (ia.candidatos || []).map((c) => ({
    grado: (c.grado || "").trim(),
    apellidos: (c.apellidos || "").trim(),
    nombres: (c.nombres || "").trim(),
  }));
  const result = {
    numero_nota_falta: ia.numero_nota || undefined,
    fecha_falta: ia.fecha || undefined,
    hora_falta: ia.hora || undefined,
    oficial_constato: ia.oficial_constato || undefined,
    candidates,
  };
  if (candidates.length) {
    result.grado = candidates[0].grado;
    result.apellidos = candidates[0].apellidos;
    result.nombres = candidates[0].nombres;
  }
  return result;
}

function normalizarResultadoReincorporacionIA(ia) {
  const candidates = (ia.candidatos || []).map((c) => ({
    grado: (c.grado || "").trim(),
    apellidos: (c.apellidos || "").trim(),
    nombres: (c.nombres || "").trim(),
  }));
  return {
    numero_nota_reincorporacion: ia.numero_nota || undefined,
    numero_nota_falta_ref: ia.numero_nota_referencia || undefined,
    fecha_reincorporacion: ia.fecha || undefined,
    hora_reincorporacion: ia.hora || undefined,
    candidates,
  };
}

// ---------- Parser por patrones (respaldo si la extracción por IA falla) ----------
function parseNotaInformativa(text) {
  const norm = text.replace(/\s+/g, " ");
  const result = {};

  // El símbolo "N°" varía mucho al venir de OCR (N°, Nº, No, N*, o directo "N
  // 123..." sin símbolo), así que se acepta cualquiera de esas variantes.
  const mNumero = norm.match(/NOTA\s+INFORMATIVA\s+N[°ºo*]?\.?\s*([0-9]+)/i);
  if (mNumero) result.numero_nota_falta = mNumero[1];

  // El OCR a veces confunde la "O" de un mes con el dígito "0" (p. ej. "AGO"
  // sale como "AG0"), así que el patrón admite ambos y luego se normaliza.
  const mFecha = norm.match(/d[ií]a\s+(\d{1,2})\s*(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AG[O0]|SET|SEP|[O0]CT|N[O0]V|DIC)\s*(\d{4})/i);
  if (mFecha) {
    const dd = mFecha[1].padStart(2, "0");
    const mm = MESES_ABREV[mFecha[2].toUpperCase().replace(/0/g, "O")];
    result.fecha_falta = `${mFecha[3]}-${mm}-${dd}`;
  }

  // Hora en que se pasó lista y se constató la ausencia.
  const mHora = norm.match(/a\s+horas\s+(\d{1,2}:\d{2})\s*,?\s*constat[oó]/i);
  if (mHora) result.hora_falta = mHora[1];

  result.candidates = extractPersonCandidates(norm).map((c) => ({
    grado: c.grado,
    ...splitApellidosNombres(c.nombreCompleto),
  }));
  if (result.candidates.length) {
    result.grado = result.candidates[0].grado;
    result.apellidos = result.candidates[0].apellidos;
    result.nombres = result.candidates[0].nombres;
  }

  // El oficial que constató suele mencionarse justo antes de la palabra "constató".
  // "PNP" puede venir con punto ("TNTE PNP. ZEGOBIA...") o sin él ("CMDTE. PNP SOLIS...").
  const namePattern = /((?:[A-ZÁÉÍÓÚÑ.]{2,}\.?\s+){1,3}PNP\.?\s+[A-Z][A-Za-zÁÉÍÓÚÑáéíóúñ]*(?:\s+[A-Z][A-Za-zÁÉÍÓÚÑáéíóúñ]*){0,3})/g;
  const idxConstato = norm.search(/constat[oó]/i);
  if (idxConstato !== -1) {
    let bestOficial = null;
    let m;
    while ((m = namePattern.exec(norm))) {
      if (m.index < idxConstato) bestOficial = m[1];
      else break;
    }
    if (bestOficial) {
      result.oficial_constato = bestOficial.replace(/\s*\bPNP\b\.?\s*/i, " ").replace(/\s+/g, " ").trim();
    }
  }

  const oficialCorr = oficialCorregidoDesdeTexto(text);
  if (oficialCorr) result.oficial_constato = oficialCorr;

  return result;
}

// Algunas Notas Informativas son una "Corrección de información" de otra: en
// el cuerpo repiten el párrafo original (con el dato equivocado) y luego
// aclaran, p. ej., que el oficial que dio cuenta de los faltos no fue el que
// figuraba, "debiendo consignarse al CAP. PNP X, quien se encontraba como
// Oficial de Permanencia". Tanto la IA como el parser por patrones leen el
// nombre del párrafo original; esta función detecta la corrección y devuelve
// el oficial correcto (mismo formato "GRADO. APELLIDOS Nombres", sin "PNP").
function oficialCorregidoDesdeTexto(texto) {
  const t = (texto || "").replace(/\s+/g, " ");
  if (!/correcci[oó]n|error\s+material|se\s+consign[oó]\s+de\s+manera\s+err[oó]nea/i.test(t)) return null;
  // El terminador no incluye "." a secas para no cortar en el punto de la
  // abreviatura del grado ("CAP.", "MY.", "TNTE."); se corta en coma, punto
  // y coma, o las palabras que suelen seguir al nombre.
  const patrones = [
    /debiendo\s+consignars?e\s+(?:a\s+|al\s+)?(.{3,80}?)(?:\s*[,;]|\s+quien|\s+como|\s+el\s+mismo|\s+siendo|$)/i,
    /siendo\s+lo\s+correcto\s+(?:el\s+|la\s+)?(.{3,80}?)(?:\s*[,;]|\s+quien|\s+como|$)/i,
    /lo\s+correcto\s+es\s+(?:el\s+|que\s+sea\s+)?(.{3,80}?)(?:\s*[,;]|\s+quien|\s+como|$)/i,
    /en\s+lugar\s+de\s+.+?\s+debe(?:r[ií]a)?\s+(?:decir|consignarse|ser)\s+(.{3,80}?)(?:\s*[,;]|\s+quien|$)/i,
  ];
  for (const re of patrones) {
    const m = t.match(re);
    // "PNP" puede venir pegado al apellido si el PDF se extrajo sin espacio
    // ("PNPQUISPE"), así que no se exige límite de palabra; y al limpiarlo se
    // quita también ese "PNP" pegado como prefijo del nombre.
    if (m && /PNP/i.test(m[1])) {
      return m[1].replace(/\s*\bPNP\b\.?\s*/i, " ").replace(/\bPNP\.?/i, "").replace(/\s+/g, " ").trim();
    }
  }
  return null;
}

function parseReincorporacion(text) {
  const norm = text.replace(/\s+/g, " ");
  const result = {};

  // El propio número de nota aparece primero; el número de la nota de falta
  // original referenciada en "REF." aparece como la segunda mención.
  const notaNumberMatches = [...norm.matchAll(/NOTA\s+INFORMATIVA\s+N[°ºo*]?\.?\s*([0-9]+)/gi)];
  if (notaNumberMatches[0]) result.numero_nota_reincorporacion = notaNumberMatches[0][1];
  if (notaNumberMatches[1]) result.numero_nota_falta_ref = notaNumberMatches[1][1];

  // Ancla en "se incorporó/incorporaron/reincorporó/reincorporaron" y acota el
  // tramo hasta "quien(es) se encontraba(n)", que es donde arranca la mención
  // de la falta ORIGINAL (con su propia fecha, que no debe confundirse con esta).
  const mActo = norm.match(/se\s+(?:re)?incorpor\w*([\s\S]*?)(?:quien(?:es)?\s+se\s+encontrab|$)/i);
  const tramo = mActo ? mActo[1] : norm;

  // El año puede venir abreviado a 2 dígitos (p. ej. "11AGO26"). El OCR a
  // veces confunde la "O" de un mes con el dígito "0" (p. ej. "AG0"), así que
  // el patrón admite ambos y luego se normaliza antes de buscar en el mapa.
  const mFecha = tramo.match(/(\d{1,2})\s*(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AG[O0]|SET|SEP|[O0]CT|N[O0]V|DIC)\s*(\d{2,4})/i);
  if (mFecha) {
    const dd = mFecha[1].padStart(2, "0");
    const mm = MESES_ABREV[mFecha[2].toUpperCase().replace(/0/g, "O")];
    let yyyy = mFecha[3];
    if (yyyy.length === 2) yyyy = (Number(yyyy) >= 70 ? "19" : "20") + yyyy;
    result.fecha_reincorporacion = `${yyyy}-${mm}-${dd}`;
  }

  const mHora = tramo.match(/(?:a\s+las|las)\s+(\d{1,2}:\d{2})/i);
  if (mHora) result.hora_reincorporacion = mHora[1];

  return result;
}

async function autocompletarReincorporacion(file) {
  const statusEl = $("reincAutoStatus");
  if (!statusEl) return;
  if (!file || file.type !== "application/pdf") {
    statusEl.classList.add("hidden");
    return;
  }
  statusEl.textContent = "Leyendo PDF...";
  statusEl.classList.remove("hidden");
  try {
    const text = await extractPdfText(file, (msg) => { statusEl.textContent = msg; });
    let data;
    try {
      statusEl.textContent = "Interpretando el contenido con IA...";
      data = normalizarResultadoReincorporacionIA(await extraerDatosNotaIA(text, "reincorporacion"));
    } catch (iaErr) {
      console.error("Extracción por IA falló, se usa el reconocimiento por patrones como respaldo:", iaErr);
      data = parseReincorporacion(text);
    }
    if (data.fecha_reincorporacion && !$("rFecha").value) $("rFecha").value = data.fecha_reincorporacion;
    if (data.numero_nota_reincorporacion && !$("rNumero").value) $("rNumero").value = data.numero_nota_reincorporacion;
    if (data.hora_reincorporacion && !$("rHora").value) $("rHora").value = data.hora_reincorporacion;
    if (data.fecha_reincorporacion) {
      statusEl.textContent = `Datos autocompletados desde el PDF (reincorporación: ${formatDate(data.fecha_reincorporacion)}${data.hora_reincorporacion ? " a las " + data.hora_reincorporacion + " horas" : ""}). Verifique antes de guardar.`;
    } else {
      statusEl.textContent = "No se pudo detectar la fecha de reincorporación en el PDF. Complete el formulario manualmente.";
    }
  } catch (err) {
    console.error(err);
    statusEl.textContent = "No se pudo leer el PDF automáticamente. Complete el formulario manualmente.";
  }
}

async function autocompletarDesdeArchivo(file) {
  const statusEl = $("pdfAutoStatus");
  if (!file || file.type !== "application/pdf") {
    statusEl.classList.add("hidden");
    return;
  }
  statusEl.textContent = "Leyendo PDF...";
  statusEl.classList.remove("hidden");
  pdfCandidates = [];
  renderCandidatesChecklist();
  try {
    const text = await extractPdfText(file, (msg) => { statusEl.textContent = msg; });
    let data;
    try {
      statusEl.textContent = "Interpretando el contenido con IA...";
      data = normalizarResultadoFaltaIA(await extraerDatosNotaIA(text, "falta"));
    } catch (iaErr) {
      console.error("Extracción por IA falló, se usa el reconocimiento por patrones como respaldo:", iaErr);
      data = parseNotaInformativa(text);
    }
    // Si es una Nota de "Corrección", el oficial que constató del párrafo
    // original está equivocado: la corrección es autoritativa y pisa lo que
    // haya extraído la IA o el parser (y lo que ya estuviera en el campo).
    const oficialCorr = oficialCorregidoDesdeTexto(text);
    if (oficialCorr) {
      data.oficial_constato = oficialCorr;
      $("fOficialConstato").value = oficialCorr;
      $("fOficialConstato").dataset.autofilled = "false";
    }
    if (data.grado && !$("fGrado").value) $("fGrado").value = data.grado;
    if (data.apellidos && !$("fApellidos").value) $("fApellidos").value = data.apellidos;
    if (data.nombres && !$("fNombres").value) $("fNombres").value = data.nombres;
    if (data.fecha_falta && !$("fFechaFalta").value) $("fFechaFalta").value = data.fecha_falta;
    if (data.numero_nota_falta && !$("fNumeroNotaFalta").value) $("fNumeroNotaFalta").value = data.numero_nota_falta;
    if (data.hora_falta && !$("fHoraFalta").value) $("fHoraFalta").value = data.hora_falta;
    if (data.oficial_constato && (!$("fOficialConstato").value || $("fOficialConstato").dataset.autofilled === "true")) {
      $("fOficialConstato").value = data.oficial_constato;
      $("fOficialConstato").dataset.autofilled = "false";
    }
    pdfCandidates = data.candidates || [];
    renderCandidatesChecklist();
    if (Object.keys(data).length) {
      let msg = "Datos autocompletados desde el PDF. Verifique antes de guardar (falta el código de infracción).";
      if (pdfCandidates.length > 1) {
        msg += ` Se detectaron ${pdfCandidates.length} efectivos en este PDF — revise la lista de abajo y desmarque los que no correspondan; se creará una nota para cada uno marcado.`;
      }
      statusEl.textContent = msg;
    } else {
      statusEl.textContent = "No se pudieron extraer datos del PDF. Complete el formulario manualmente.";
    }
  } catch (err) {
    console.error(err);
    statusEl.textContent = "No se pudo leer el PDF automáticamente. Complete el formulario manualmente.";
  }
}

$("btnBuscarEfectivo").addEventListener("click", async () => {
  const term = $("lookupCipDni").value.trim();
  const resultEl = $("lookupResult");
  if (!term) return;
  const { data, error } = await supabase
    .from("efectivos")
    .select("*")
    .or(`cip.eq.${term},dni.eq.${term}`)
    .maybeSingle();
  if (error || !data) {
    resultEl.textContent = "No se encontró un efectivo con ese CIP/DNI.";
    resultEl.classList.remove("hidden");
    return;
  }
  const { apellidos, nombres } = splitApellidosNombres(data.apellidos_nombres);
  $("fGrado").value = data.grado || "";
  $("fApellidos").value = apellidos;
  $("fNombres").value = nombres;
  resultEl.textContent = `Encontrado: ${data.grado || ""} ${data.apellidos_nombres || ""}`;
  resultEl.classList.remove("hidden");
});

$("fArchivoNota").addEventListener("change", (e) => {
  autocompletarDesdeArchivo(e.target.files[0]);
});

$("notaForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = $("notaFormError");
  errEl.classList.add("hidden");

  const oficialConstatoTexto = $("fOficialConstato").value.trim() || null;
  const compartido = {
    fecha_falta: $("fFechaFalta").value,
    numero_nota_falta: $("fNumeroNotaFalta").value.trim(),
    hora_falta: $("fHoraFalta").value || null,
    codigo_infraccion: $("fCodigoInfraccion").value.trim(),
    oficial_constato: oficialConstatoTexto,
    // Se resuelve y guarda ya en la creación (mismo emparejamiento que usa
    // el resto de la app): es lo que la política de RLS usa para decidir
    // qué notas puede ver cada oficial, así que sin esto la nota quedaría
    // invisible para el propio oficial que constató la falta.
    oficial_constato_cip: buscarOficialConstato(oficialConstatoTexto, state.efectivos)?.cip || null,
    created_by: state.session.user.id,
  };

  const personas = [{
    grado: $("fGrado").value.trim(),
    apellidos: $("fApellidos").value.trim(),
    nombres: $("fNombres").value.trim(),
  }];

  if (pdfCandidates.length > 1) {
    document.querySelectorAll("#multiplesEfectivosList .multi-efectivo-row").forEach((row) => {
      if (!row.querySelector(".multiCheck").checked) return;
      personas.push({
        grado: row.querySelector(".multiGrado").value.trim(),
        apellidos: row.querySelector(".multiApellidos").value.trim(),
        nombres: row.querySelector(".multiNombres").value.trim(),
      });
    });
  }

  const payloads = personas.map((p) => ({ ...compartido, ...p }));

  const { data: inserted, error } = await supabase
    .from("notas_informativas")
    .insert(payloads)
    .select();

  if (error) { errEl.textContent = "Error: " + error.message; errEl.classList.remove("hidden"); return; }

  const file = $("fArchivoNota").files[0];
  if (file && inserted?.length) {
    const path = `${inserted[0].id}/${Date.now()}_${file.name}`;
    const { error: upErr } = await supabase.storage.from("notas").upload(path, file);
    if (!upErr) {
      await supabase.from("notas_informativas")
        .update({ archivo_nota_path: path, archivo_nota_nombre: file.name })
        .in("id", inserted.map((n) => n.id));
    }
  }

  pdfCandidates = [];
  closeModal();
  loadNotas();
});

// ---------- Reincorporación desde PDF (uno o varios archivos) ----------
let reincLoteFilas = [];

function normalizarTexto(s) {
  return (s || "")
    .toUpperCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
function normalizarNombre(apellidos, nombres) {
  return `${normalizarTexto(apellidos)} ${normalizarTexto(nombres)}`.replace(/\s+/g, " ").trim();
}

// Empareja primero por el N.º de la nota de falta original (campo REF. del PDF
// de reincorporación) porque es exacto; si no está disponible, cae al nombre.
// Si varias notas pendientes comparten ese N.º (falta grupal con varios
// efectivos aún no reincorporados), se desambigua por nombre entre ellas:
// primero por nombre completo exacto, y si no coincide (el PDF de
// reincorporación a veces abrevia u omite el segundo nombre, o lo escribe con
// una variante como "Patrick" vs "Patrik") por apellidos exactos únicamente,
// que rara vez varían entre ambos documentos.
function buscarNotaPendiente(numeroFaltaRef, candidate) {
  const pendientes = state.notas.filter((n) => !n.fecha_reincorporacion);
  let pool = pendientes;

  if (numeroFaltaRef) {
    const porNumero = pendientes.filter((n) => n.numero_nota_falta === numeroFaltaRef);
    if (porNumero.length === 1) return porNumero[0];
    pool = porNumero.length > 1 ? porNumero : (candidate ? pendientes : []);
  }

  if (!candidate) return pool.length === 1 ? pool[0] : null;

  const objetivo = normalizarNombre(candidate.apellidos, candidate.nombres);
  const exactos = pool.filter((n) => normalizarNombre(n.apellidos, n.nombres) === objetivo);
  if (exactos.length === 1) return exactos[0];

  const apellidosCand = normalizarTexto(candidate.apellidos);
  const porApellidos = pool.filter((n) => normalizarTexto(n.apellidos) === apellidosCand);
  if (porApellidos.length === 1) return porApellidos[0];

  return null;
}

function renderReincLoteList() {
  const el = $("rlLista");
  if (!reincLoteFilas.length) { el.innerHTML = ""; return; }
  el.innerHTML = reincLoteFilas.map((f) => {
    const nombreLinea = f.candidate
      ? escapeHtml(nombreInvestigadoVisible(f.candidate, true))
      : "No se detectó un efectivo en este archivo";
    const pill = f.nota
      ? `<span class="pill pill-yes">Nota encontrada${f.matchPor === "numero" ? " (por N.º de nota)" : " (por nombre)"} — falta ${formatDate(f.nota.fecha_falta)} · N.º ${escapeHtml(f.nota.numero_nota_falta || "-")}</span>`
      : `<span class="pill pill-no">No se encontró una nota pendiente que corresponda</span>`;
    return `
      <div class="multi-efectivo-row">
        <label class="checkbox-row"><input type="checkbox" class="rlCheck" ${f.nota ? "checked" : "disabled"} /></label>
        <div class="value" style="flex:1">
          <div>${nombreLinea} <span class="muted small">(${escapeHtml(f.file.name)})</span></div>
          <div style="display:flex; gap:8px; margin-top:6px">
            <input type="date" class="rlFechaRow" value="${escapeHtml(f.fecha_reincorporacion)}" style="flex:1" />
            <input type="time" class="rlHoraRow" value="${escapeHtml(f.hora_reincorporacion)}" style="flex:1" />
            <input type="text" class="rlNumeroRow" value="${escapeHtml(f.numero_nota_reincorporacion)}" placeholder="N.º nota de reincorporación" style="flex:1" />
          </div>
          ${pill}
        </div>
      </div>
    `;
  }).join("");
}

$("btnReincorporacionLote").addEventListener("click", () => {
  $("rlArchivo").value = "";
  $("rlStatus").classList.add("hidden");
  $("rlError").classList.add("hidden");
  reincLoteFilas = [];
  renderReincLoteList();
  $("modalReincorporacionLote").classList.remove("hidden");
});
$("btnCerrarModalReinc").addEventListener("click", closeReincLoteModal);
$("btnCancelarReincLote").addEventListener("click", closeReincLoteModal);
function closeReincLoteModal() { $("modalReincorporacionLote").classList.add("hidden"); }

$("rlArchivo").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  const statusEl = $("rlStatus");
  reincLoteFilas = [];
  renderReincLoteList();
  if (!files.length) {
    statusEl.classList.add("hidden");
    return;
  }
  statusEl.textContent = `Leyendo ${files.length} archivo(s)...`;
  statusEl.classList.remove("hidden");
  try {
    const filas = [];
    for (const file of files) {
      if (file.type !== "application/pdf") continue;
      const text = await extractPdfText(file, (msg) => { statusEl.textContent = `${file.name}: ${msg}`; });
      const norm = text.replace(/\s+/g, " ");
      let doc, candidates;
      try {
        statusEl.textContent = `${file.name}: interpretando el contenido con IA...`;
        const ia = normalizarResultadoReincorporacionIA(await extraerDatosNotaIA(text, "reincorporacion"));
        doc = ia;
        candidates = ia.candidates;
      } catch (iaErr) {
        console.error("Extracción por IA falló, se usa el reconocimiento por patrones como respaldo:", iaErr);
        doc = parseReincorporacion(text);
        candidates = extractPersonCandidates(norm).map((c) => ({ grado: c.grado, ...splitApellidosNombres(c.nombreCompleto) }));
      }
      const base = {
        file,
        fecha_reincorporacion: doc.fecha_reincorporacion || "",
        numero_nota_reincorporacion: doc.numero_nota_reincorporacion || "",
        hora_reincorporacion: doc.hora_reincorporacion || "",
      };
      if (candidates.length) {
        for (const candidate of candidates) {
          const nota = buscarNotaPendiente(doc.numero_nota_falta_ref, candidate);
          filas.push({ ...base, candidate, nota, matchPor: nota && doc.numero_nota_falta_ref && nota.numero_nota_falta === doc.numero_nota_falta_ref ? "numero" : "nombre" });
        }
      } else {
        const nota = buscarNotaPendiente(doc.numero_nota_falta_ref, null);
        filas.push({ ...base, candidate: null, nota, matchPor: "numero" });
      }
    }
    reincLoteFilas = filas;
    renderReincLoteList();

    const encontrados = filas.filter((f) => f.nota).length;
    statusEl.textContent = `Se procesaron ${files.length} archivo(s): ${encontrados} de ${filas.length} coinciden con notas pendientes de reincorporación. Verifique antes de guardar.`;
  } catch (err) {
    console.error(err);
    statusEl.textContent = "No se pudieron leer algunos archivos automáticamente.";
  }
});

$("btnGuardarReincLote").addEventListener("click", async () => {
  const errEl = $("rlError");
  errEl.classList.add("hidden");

  const rows = [...document.querySelectorAll("#rlLista .multi-efectivo-row")];
  const seleccionados = rows
    .map((row, i) => ({ row, fila: reincLoteFilas[i] }))
    .filter(({ row, fila }) => row.querySelector(".rlCheck").checked && fila?.nota);

  if (!seleccionados.length) {
    errEl.textContent = "No hay notas coincidentes seleccionadas para actualizar.";
    errEl.classList.remove("hidden");
    return;
  }

  for (const { row, fila } of seleccionados) {
    const fecha = row.querySelector(".rlFechaRow").value;
    const numero = row.querySelector(".rlNumeroRow").value.trim();
    if (!fecha || !numero) {
      errEl.textContent = `Complete fecha y N.º de nota para ${nombreInvestigadoVisible(fila.nota)}.`;
      errEl.classList.remove("hidden");
      return;
    }
  }

  const archivosSubidos = new Map();
  for (const { fila } of seleccionados) {
    if (archivosSubidos.has(fila.file)) continue;
    const path = `lote/${Date.now()}_${fila.file.name}`;
    const { error: upErr } = await supabase.storage.from("notas").upload(path, fila.file);
    if (!upErr) archivosSubidos.set(fila.file, { path, nombre: fila.file.name });
  }

  let ultimoError = null;
  for (const { row, fila } of seleccionados) {
    const fecha = row.querySelector(".rlFechaRow").value;
    const numero = row.querySelector(".rlNumeroRow").value.trim();
    const hora = row.querySelector(".rlHoraRow").value || null;
    const archivo = archivosSubidos.get(fila.file);
    let codigo_infraccion;
    if (!fila.nota.codigo_infraccion) {
      const sugerido = sugerirCodigoInfraccion(horasAusente({ ...fila.nota, fecha_reincorporacion: fecha, hora_reincorporacion: hora }));
      if (sugerido) codigo_infraccion = sugerido;
    }
    const { error } = await supabase.from("notas_informativas").update({
      fecha_reincorporacion: fecha,
      numero_nota_reincorporacion: numero,
      hora_reincorporacion: hora,
      ...(codigo_infraccion ? { codigo_infraccion } : {}),
      ...(archivo ? { archivo_reincorporacion_path: archivo.path, archivo_reincorporacion_nombre: archivo.nombre } : {}),
    }).eq("id", fila.nota.id);
    if (error) ultimoError = error;
  }

  if (ultimoError) {
    errEl.textContent = "Algunas notas no se pudieron actualizar: " + ultimoError.message;
    errEl.classList.remove("hidden");
  }

  reincLoteFilas = [];
  closeReincLoteModal();
  loadNotas();
});

// ---------- Faltas desde PDF (uno o varios archivos), en lote ----------
// Equivalente a la reincorporación en lote, pero para el inicio del trámite:
// cada PDF de nota de falta -- uno por efectivo o uno grupal con varios --
// crea una nota nueva por cada efectivo. El código de infracción se completa
// después, en cada expediente (depende del tiempo ausente, que aún no se sabe).
let faltasLoteFilas = [];

// ¿Ya hay una nota para esta persona con este mismo N.º de nota de falta?
// Evita duplicar si el mismo PDF grupal se sube dos veces o la falta ya se
// registró a mano. Sin N.º, cualquier nota de esa persona ya cuenta como
// posible duplicado (se marca para que el oficial decida).
function faltaYaRegistrada(numeroNotaFalta, candidate) {
  if (!candidate || !candidate.apellidos) return null;
  const objetivo = normalizarNombre(candidate.apellidos, candidate.nombres);
  const apellidosObj = normalizarTexto(candidate.apellidos);
  return state.notas.find((n) => {
    const mismoNombre = normalizarNombre(n.apellidos, n.nombres) === objetivo ||
      (!candidate.nombres && normalizarTexto(n.apellidos) === apellidosObj);
    if (!mismoNombre) return false;
    if (numeroNotaFalta && n.numero_nota_falta) return n.numero_nota_falta === numeroNotaFalta;
    return true;
  }) || null;
}

function renderFaltasLoteList() {
  const el = $("flLista");
  if (!faltasLoteFilas.length) { el.innerHTML = ""; return; }
  el.innerHTML = faltasLoteFilas.map((f, i) => {
    const dup = f.duplicada;
    const pill = dup
      ? `<span class="pill pill-warning">Ya existe una nota de esta persona${dup.numero_nota_falta ? ` (N.º ${escapeHtml(dup.numero_nota_falta)})` : ""} — no se creará de nuevo</span>`
      : `<span class="pill pill-yes">Se creará una nota nueva</span>`;
    return `
      <div class="multi-efectivo-row" data-idx="${i}">
        <label class="checkbox-row"><input type="checkbox" class="flCheck" ${dup ? "" : "checked"} /></label>
        <div class="value" style="flex:1">
          <div style="display:flex; gap:8px">
            <input type="text" class="flGrado" value="${escapeHtml(f.grado || "")}" placeholder="Grado" style="flex:1" />
            <input type="text" class="flApellidos" value="${escapeHtml(f.apellidos || "")}" placeholder="Apellidos" style="flex:2" />
            <input type="text" class="flNombres" value="${escapeHtml(f.nombres || "")}" placeholder="Nombres" style="flex:2" />
          </div>
          <div style="display:flex; gap:8px; margin-top:6px">
            <input type="date" class="flFechaRow" value="${escapeHtml(f.fecha_falta || "")}" style="flex:1" />
            <input type="time" class="flHoraRow" value="${escapeHtml(f.hora_falta || "")}" style="flex:1" />
            <input type="text" class="flNumeroRow" value="${escapeHtml(f.numero_nota_falta || "")}" placeholder="N.º nota de falta" style="flex:1" />
          </div>
          <div class="muted small" style="margin-top:4px">Oficial que constató: ${escapeHtml(f.oficial_constato || "—")} · Archivo: ${escapeHtml(f.file.name)}</div>
          ${pill}
        </div>
      </div>
    `;
  }).join("");
}

$("btnFaltasLote").addEventListener("click", () => {
  $("flArchivo").value = "";
  $("flStatus").classList.add("hidden");
  $("flError").classList.add("hidden");
  faltasLoteFilas = [];
  renderFaltasLoteList();
  $("modalFaltasLote").classList.remove("hidden");
});
$("btnCerrarModalFaltas").addEventListener("click", closeFaltasLoteModal);
$("btnCancelarFaltasLote").addEventListener("click", closeFaltasLoteModal);
function closeFaltasLoteModal() { $("modalFaltasLote").classList.add("hidden"); }

$("flArchivo").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  const statusEl = $("flStatus");
  faltasLoteFilas = [];
  renderFaltasLoteList();
  if (!files.length) { statusEl.classList.add("hidden"); return; }
  statusEl.textContent = `Leyendo ${files.length} archivo(s)...`;
  statusEl.classList.remove("hidden");
  try {
    const filas = [];
    for (const file of files) {
      if (file.type !== "application/pdf") continue;
      const text = await extractPdfText(file, (msg) => { statusEl.textContent = `${file.name}: ${msg}`; });
      const norm = text.replace(/\s+/g, " ");
      let doc, candidates;
      try {
        statusEl.textContent = `${file.name}: interpretando el contenido con IA...`;
        doc = normalizarResultadoFaltaIA(await extraerDatosNotaIA(text, "falta"));
        candidates = doc.candidates;
      } catch (iaErr) {
        console.error("Extracción por IA falló, se usa el reconocimiento por patrones como respaldo:", iaErr);
        doc = parseNotaInformativa(text);
        candidates = (doc.candidates && doc.candidates.length)
          ? doc.candidates
          : extractPersonCandidates(norm).map((c) => ({ grado: c.grado, ...splitApellidosNombres(c.nombreCompleto) }));
      }
      // Nota de "Corrección": el oficial correcto es el que indica el cuerpo,
      // no el del párrafo original que copia la nota corregida.
      const oficialCorr = oficialCorregidoDesdeTexto(text);
      if (oficialCorr) doc.oficial_constato = oficialCorr;
      const base = {
        file,
        fecha_falta: doc.fecha_falta || "",
        hora_falta: doc.hora_falta || "",
        numero_nota_falta: doc.numero_nota_falta || "",
        oficial_constato: doc.oficial_constato || "",
      };
      const lista = (candidates && candidates.length)
        ? candidates
        : [{ grado: doc.grado || "", apellidos: doc.apellidos || "", nombres: doc.nombres || "" }];
      for (const c of lista) {
        filas.push({
          ...base,
          grado: (c.grado || "").trim(),
          apellidos: (c.apellidos || "").trim(),
          nombres: (c.nombres || "").trim(),
          duplicada: faltaYaRegistrada(base.numero_nota_falta, c),
        });
      }
    }
    faltasLoteFilas = filas;
    renderFaltasLoteList();
    const nuevas = filas.filter((f) => !f.duplicada).length;
    statusEl.textContent = `Se procesaron ${files.length} archivo(s): ${filas.length} persona(s), ${nuevas} nueva(s). Verifique los datos y desmarque lo que no corresponda antes de guardar.`;
  } catch (err) {
    console.error(err);
    statusEl.textContent = "No se pudieron leer algunos archivos automáticamente.";
  }
});

$("btnGuardarFaltasLote").addEventListener("click", async () => {
  const errEl = $("flError");
  errEl.classList.add("hidden");
  const rows = [...document.querySelectorAll("#flLista .multi-efectivo-row")];
  const seleccionados = rows
    .map((row, i) => ({ row, fila: faltasLoteFilas[i] }))
    .filter(({ row }) => row.querySelector(".flCheck").checked);

  if (!seleccionados.length) {
    errEl.textContent = "No hay faltas marcadas para registrar.";
    errEl.classList.remove("hidden");
    return;
  }

  const registros = [];
  for (const { row, fila } of seleccionados) {
    const grado = row.querySelector(".flGrado").value.trim();
    const apellidos = row.querySelector(".flApellidos").value.trim();
    const nombres = row.querySelector(".flNombres").value.trim();
    const fecha_falta = row.querySelector(".flFechaRow").value;
    const hora_falta = row.querySelector(".flHoraRow").value || null;
    const numero_nota_falta = row.querySelector(".flNumeroRow").value.trim();
    if (!apellidos || !nombres || !fecha_falta || !numero_nota_falta) {
      errEl.textContent = `Complete apellidos, nombres, fecha y N.º de nota para ${apellidos || "(sin apellido)"} ${nombres}.`;
      errEl.classList.remove("hidden");
      return;
    }
    registros.push({ file: fila.file, grado, apellidos, nombres, fecha_falta, hora_falta, numero_nota_falta, oficial_constato: fila.oficial_constato || null });
  }

  // Cada PDF se sube una sola vez; el path se enlaza a todas sus notas.
  const archivosSubidos = new Map();
  for (const r of registros) {
    if (archivosSubidos.has(r.file)) continue;
    const path = `lote_faltas/${Date.now()}_${r.file.name}`;
    const { error: upErr } = await supabase.storage.from("notas").upload(path, r.file);
    if (!upErr) archivosSubidos.set(r.file, { path, nombre: r.file.name });
  }

  const payloads = registros.map((r) => ({
    grado: r.grado,
    apellidos: r.apellidos,
    nombres: r.nombres,
    fecha_falta: r.fecha_falta,
    hora_falta: r.hora_falta,
    numero_nota_falta: r.numero_nota_falta,
    codigo_infraccion: "",
    oficial_constato: r.oficial_constato,
    // Igual que en la creación individual: es lo que usa la RLS para decidir
    // qué notas ve cada oficial.
    oficial_constato_cip: buscarOficialConstato(r.oficial_constato, state.efectivos)?.cip || null,
    created_by: state.session.user.id,
  }));

  const { data: inserted, error } = await supabase
    .from("notas_informativas")
    .insert(payloads)
    .select();

  if (error) {
    errEl.textContent = "No se pudieron registrar las faltas: " + error.message;
    errEl.classList.remove("hidden");
    return;
  }

  for (let i = 0; i < inserted.length; i++) {
    const archivo = archivosSubidos.get(registros[i].file);
    if (!archivo) continue;
    await supabase.from("notas_informativas")
      .update({ archivo_nota_path: archivo.path, archivo_nota_nombre: archivo.nombre })
      .eq("id", inserted[i].id);
  }

  faltasLoteFilas = [];
  closeFaltasLoteModal();
  loadNotas();
});

// ---------- Directivas internas ----------
async function loadDirectivasView() {
  try {
    state.directivas = await listarDirectivas(supabase);
  } catch (err) {
    console.error(err);
    state.directivas = [];
  }
  renderDirectivasList(state.directivas);
}

function renderDirectivasList(list) {
  const container = $("directivasList");
  if (!container) return;
  $("directivasEmpty").classList.toggle("hidden", list.length > 0);
  const isAdmin = state.role === "admin";
  container.innerHTML = list.map((d) => `
    <div class="directiva-card" data-id="${d.id}">
      <div class="directiva-card-header">
        <h3>${escapeHtml(d.titulo)}${d.numero_documento ? ` <span class="muted small">(${escapeHtml(d.numero_documento)})</span>` : ""}</h3>
        <span class="pill ${d.activa ? "pill-yes" : "pill-inactive"}">${d.activa ? "Activa" : "Inactiva"}</span>
      </div>
      <div class="directiva-contenido">${escapeHtml(d.contenido)}</div>
      ${isAdmin ? `
        <div class="directiva-actions">
          <button type="button" class="btn-secondary btn-editar-directiva">Editar</button>
          <button type="button" class="btn-danger btn-eliminar-directiva">Eliminar</button>
        </div>
      ` : ""}
    </div>
  `).join("");

  if (!isAdmin) return;
  container.querySelectorAll(".btn-editar-directiva").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const id = e.currentTarget.closest(".directiva-card").dataset.id;
      const directiva = state.directivas.find((d) => String(d.id) === id);
      if (directiva) abrirModalDirectiva(directiva);
    });
  });
  container.querySelectorAll(".btn-eliminar-directiva").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const id = e.currentTarget.closest(".directiva-card").dataset.id;
      if (!confirm("¿Eliminar esta directiva? Esta acción no se puede deshacer.")) return;
      try {
        await eliminarDirectiva(supabase, id);
        loadDirectivasView();
      } catch (err) {
        alert("No se pudo eliminar: " + (err.message || err));
      }
    });
  });
}

function abrirModalDirectiva(directiva) {
  $("directivaForm").reset();
  $("dvId").value = directiva?.id || "";
  $("dvTitulo").value = directiva?.titulo || "";
  $("dvNumero").value = directiva?.numero_documento || "";
  $("dvContenido").value = directiva?.contenido || "";
  $("dvActiva").checked = directiva ? !!directiva.activa : true;
  $("dvArchivoStatus").classList.add("hidden");
  $("directivaError").classList.add("hidden");
  $("directivaModalTitulo").textContent = directiva ? "Editar directiva" : "Nueva directiva";
  $("modalDirectiva").classList.remove("hidden");
}
function closeModalDirectiva() { $("modalDirectiva").classList.add("hidden"); }

$("btnNuevaDirectiva")?.addEventListener("click", () => abrirModalDirectiva(null));
$("btnCerrarModalDirectiva")?.addEventListener("click", closeModalDirectiva);
$("btnCancelarDirectiva")?.addEventListener("click", closeModalDirectiva);

$("dvArchivo")?.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  const statusEl = $("dvArchivoStatus");
  if (!file) { statusEl.classList.add("hidden"); return; }
  statusEl.textContent = "Leyendo archivo...";
  statusEl.classList.remove("hidden");
  try {
    let texto = "";
    if (file.type === "application/pdf") {
      texto = await extractPdfText(file, (msg) => { statusEl.textContent = msg; });
    } else if (file.type.startsWith("image/")) {
      texto = await extractImagenTextoConOcr(file, (msg) => { statusEl.textContent = msg; });
    }
    texto = texto.trim();
    if (texto) {
      if (!$("dvContenido").value.trim()) $("dvContenido").value = texto;
      statusEl.textContent = "Texto extraído del archivo con IA. Revíselo antes de guardar — puede tener errores puntuales en fragmentos poco legibles.";
    } else {
      statusEl.textContent = "No se pudo extraer texto del archivo. Péguelo usted mismo en el campo de abajo.";
    }
  } catch (err) {
    console.error(err);
    statusEl.textContent = "No se pudo leer el archivo automáticamente. Péguelo usted mismo en el campo de abajo.";
  }
});

$("directivaForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = $("directivaError");
  errEl.classList.add("hidden");
  const id = $("dvId").value || null;
  const titulo = $("dvTitulo").value.trim();
  const numero_documento = $("dvNumero").value.trim();
  const contenido = $("dvContenido").value.trim();
  const activa = $("dvActiva").checked;
  if (!titulo || !contenido) return;

  const submitBtn = e.target.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  try {
    const savedId = await guardarDirectiva(supabase, { id, titulo, numero_documento, contenido, activa, userId: state.session.user.id });
    const file = $("dvArchivo").files[0];
    if (file) {
      const { path, nombre } = await subirArchivoDirectiva(supabase, savedId, file);
      await guardarDirectiva(supabase, { id: savedId, titulo, numero_documento, contenido, activa, archivo_path: path, archivo_nombre: nombre });
    }
    closeModalDirectiva();
    loadDirectivasView();
  } catch (err) {
    console.error(err);
    errEl.textContent = "Error: " + (err.message || err);
    errEl.classList.remove("hidden");
  } finally {
    submitBtn.disabled = false;
  }
});

// ---------- Asistente de consulta flotante ----------
function agregarMensajeAsistente(role, texto) {
  state.asistenteHistorial.push({ role, texto });
  const div = document.createElement("div");
  div.className = `asistente-msg ${role === "asistente" ? "asistente-msg-bot" : "asistente-msg-user"}`;
  div.textContent = texto;
  const mensajesEl = $("asistenteMensajes");
  mensajesEl.appendChild(div);
  mensajesEl.scrollTop = mensajesEl.scrollHeight;
}

$("btnAbrirAsistente")?.addEventListener("click", () => {
  $("asistenteWidget").classList.remove("hidden");
  if (!state.asistenteHistorial.length) {
    agregarMensajeAsistente("asistente", "Hola, soy el asistente de consulta de Moral y Disciplina. Puede preguntarme sobre el procedimiento (Nota Informativa → reincorporación → descargo → Orden de Sanción), sobre L21/L24, o sobre las directivas internas cargadas en el sistema.");
  }
});
$("btnCerrarAsistente")?.addEventListener("click", () => {
  $("asistenteWidget").classList.add("hidden");
});

$("asistenteForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("asistenteInput");
  const pregunta = input.value.trim();
  if (!pregunta) return;
  agregarMensajeAsistente("oficial", pregunta);
  input.value = "";
  const submitBtn = e.target.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  try {
    const directivas = directivasParaIA(state.directivas.length ? state.directivas : await listarDirectivas(supabase));
    const { data, error } = await supabase.functions.invoke("asistente-md", {
      body: {
        catalogo: CATALOGO_ASISTENTE,
        directivas,
        historial: state.asistenteHistorial.slice(0, -1).slice(-8),
        pregunta,
      },
    });
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    agregarMensajeAsistente("asistente", data?.respuesta || "No se pudo obtener una respuesta.");
  } catch (err) {
    console.error(err);
    agregarMensajeAsistente("asistente", "Ocurrió un error al consultar: " + (err.message || err));
  } finally {
    submitBtn.disabled = false;
  }
});

// ---------- Panel de métricas ----------
let chartsPanel = {};

// Mismas etapas que ya se muestran en el detalle de cada nota (Acta de No
// Descargo / Orden de Sanción), resumidas en una sola categoría por caso
// para el gráfico de estado.
function estadoDeNota(n) {
  if (!n.fecha_reincorporacion) return "Reincorporación pendiente";
  if (!n.imputacion_generada_at) return "Notificación pendiente";
  if (n.orden_sancion_generada_at) return "Sanción generada";
  if (n.fecha_descargo) return "Con descargo, evaluando";
  if (plazoDescargoVencido(n)) return "Plazo vencido, pendiente";
  return "Plazo de descargo vigente";
}

function claseEstadoNota(n) {
  if (n.orden_sancion_generada_at) return "pill-yes";
  if (n.fecha_descargo) return "pill-info";
  if (n.fecha_reincorporacion && n.imputacion_generada_at && plazoDescargoVencido(n)) return "pill-danger";
  if (n.imputacion_generada_at) return "pill-warning";
  return "pill-neutral";
}

function progresoNotaHtml(n) {
  const paso = n.orden_sancion_generada_at ? 5 : n.fecha_descargo ? 4 : n.imputacion_generada_at ? 3 : n.fecha_reincorporacion ? 2 : 1;
  const etiquetas = ["Falta", "Reinc.", "Imput.", "Descargo", "Sanción"];
  return `<div class="case-progress" title="${escapeHtml(estadoDeNota(n))}">
    <div class="case-progress-steps">${etiquetas.map((etiqueta, i) => `<span class="${i + 1 <= paso ? "is-done" : ""} ${i + 1 === paso ? "is-current" : ""}">${i + 1}</span>`).join("")}</div>
    <span class="pill ${claseEstadoNota(n)}">${escapeHtml(estadoDeNota(n))}</span>
  </div>`;
}

// Guía del trámite: cada etapa con su estado -- completo / pendiente /
// vencido / no disponible todavía -- para que el oficial vea de un vistazo
// qué sigue sin abrir cada sección.
function cronologiaNotaHtml(nota) {
  const exp = (nota.expedientes && nota.expedientes[0]) || null;
  const vencidoDescargo = !!nota.imputacion_generada_at && !nota.fecha_descargo && plazoDescargoVencido(nota);
  const hayEvaluacion = !!(nota.sancion_analisis && String(nota.sancion_analisis).trim()) || !!nota.orden_sancion_generada_at;
  const listoDescargo = nota.fecha_descargo || vencidoDescargo;
  const cerrado = !!(nota.orden_notificada_at || (exp && (exp.numero_oficio || exp.numero_ht)));

  const nd = "nd";
  const etapas = [
    { titulo: "Hecho registrado", fecha: nota.created_at, estado: "completo" },
    { titulo: "Reincorporación", fecha: nota.fecha_reincorporacion, estado: nota.fecha_reincorporacion ? "completo" : "pendiente" },
    { titulo: "Imputación / notificación", fecha: nota.imputacion_generada_at, estado: nota.imputacion_generada_at ? "completo" : (nota.fecha_reincorporacion ? "pendiente" : nd) },
    { titulo: "Descargo", fecha: nota.fecha_descargo, estado: nota.fecha_descargo ? "completo" : (!nota.imputacion_generada_at ? nd : (vencidoDescargo ? "vencido" : "pendiente")) },
    { titulo: "Evaluación del descargo", fecha: null, estado: !listoDescargo ? nd : (hayEvaluacion ? "completo" : "pendiente") },
    { titulo: "Orden de Sanción", fecha: nota.orden_sancion_generada_at, estado: nota.orden_sancion_generada_at ? "completo" : (listoDescargo ? "pendiente" : nd) },
    { titulo: "Cierre (notificación / expediente)", fecha: nota.orden_notificada_at, estado: cerrado ? "completo" : (nota.orden_sancion_generada_at ? "pendiente" : nd) },
  ];
  const LABEL = { completo: "Completo", pendiente: "Pendiente", vencido: "Vencido", nd: "No disponible" };
  const ICON = { completo: "✓", pendiente: "•", vencido: "!", nd: "–" };
  return `<ol class="tramite-etapas">${etapas.map((e) => `
    <li class="tramite-etapa te-${e.estado}">
      <span class="te-icon">${ICON[e.estado]}</span>
      <span class="te-nombre">${escapeHtml(e.titulo)}${e.fecha && e.estado === "completo" ? ` <span class="muted small">— ${formatDate(String(e.fecha).slice(0, 10))}</span>` : ""}</span>
      <span class="te-estado">${LABEL[e.estado]}</span>
    </li>`).join("")}</ol>`;
}

function colorTema(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
}

const MESES_CORTO_PANEL = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function renderPanel() {
  const notas = state.notas;
  $("panelEmpty").classList.toggle("hidden", notas.length > 0);
  $("panelContenido").classList.toggle("hidden", notas.length === 0);
  Object.values(chartsPanel).forEach((c) => c.destroy());
  chartsPanel = {};
  if (!notas.length) return;

  const text = colorTema("--text");
  const textMuted = colorTema("--text-muted");
  const border = colorTema("--border");
  const accent = colorTema("--accent");
  const accentSoft = colorTema("--accent-soft");

  const pendientesVencidos = notas.filter((n) =>
    n.fecha_reincorporacion && n.imputacion_generada_at && !n.fecha_descargo && !n.orden_sancion_generada_at && plazoDescargoVencido(n)
  ).length;
  const sancionados = notas.filter((n) => n.orden_sancion_generada_at).length;
  $("panelStats").innerHTML = `
    <div class="stat-tile"><div class="stat-value">${notas.length}</div><div class="stat-label">Casos totales</div></div>
    <div class="stat-tile"><div class="stat-value">${pendientesVencidos}</div><div class="stat-label">Plazo vencido sin resolver</div></div>
    <div class="stat-tile"><div class="stat-value">${sancionados}</div><div class="stat-label">Con sanción generada</div></div>
  `;

  const estadoCounts = {};
  notas.forEach((n) => { const e = estadoDeNota(n); estadoCounts[e] = (estadoCounts[e] || 0) + 1; });
  const paletaEstado = ["#1f9d55", "#d99a2b", "#4a90d9", "#8a6fd6", "#e5484d", "#5b6b78"];

  const codigoCounts = {};
  notas.forEach((n) => { const c = (n.codigo_infraccion || "").trim() || "Sin código"; codigoCounts[c] = (codigoCounts[c] || 0) + 1; });
  const codigosOrdenados = Object.entries(codigoCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

  const mesesCounts = {};
  notas.forEach((n) => {
    if (!n.fecha_falta) return;
    const mes = n.fecha_falta.slice(0, 7);
    mesesCounts[mes] = (mesesCounts[mes] || 0) + 1;
  });
  const mesesOrdenados = Object.keys(mesesCounts).sort();
  const mesesLabels = mesesOrdenados.map((m) => {
    const [y, mm] = m.split("-");
    return `${MESES_CORTO_PANEL[Number(mm) - 1]} ${y}`;
  });

  chartsPanel.estado = new Chart($("chartEstado"), {
    type: "doughnut",
    data: {
      labels: Object.keys(estadoCounts),
      datasets: [{ data: Object.values(estadoCounts), backgroundColor: paletaEstado, borderColor: border, borderWidth: 2 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { position: "bottom", labels: { color: text, boxWidth: 12, padding: 10, font: { size: 11 } } } },
    },
  });

  chartsPanel.codigo = new Chart($("chartCodigo"), {
    type: "bar",
    data: {
      labels: codigosOrdenados.map((e) => e[0]),
      datasets: [{ data: codigosOrdenados.map((e) => e[1]), backgroundColor: accent, borderRadius: 4 }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: textMuted, precision: 0 }, grid: { color: border } },
        y: { ticks: { color: text }, grid: { display: false } },
      },
    },
  });

  chartsPanel.tendencia = new Chart($("chartTendencia"), {
    type: "line",
    data: {
      labels: mesesLabels,
      datasets: [{
        data: mesesOrdenados.map((m) => mesesCounts[m]),
        borderColor: accent, backgroundColor: accentSoft,
        fill: true, tension: 0.3, pointRadius: 3, pointBackgroundColor: accent,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: textMuted }, grid: { display: false } },
        y: { ticks: { color: textMuted, precision: 0 }, grid: { color: border }, beginAtZero: true },
      },
    },
  });
}

// ---------- Historial de actividad ----------
async function loadHistorial() {
  const { data, error } = await supabase
    .from("audit_log")
    .select("*")
    .order("changed_at", { ascending: false })
    .limit(200);
  if (error) { console.error(error); return; }
  renderHistorialTable(data || []);
}

// Para UPDATE, arma una lista legible de "campo: antes → después" comparando
// el jsonb guardado por el trigger; para INSERT/DELETE no hay comparación
// posible (solo existe un lado), así que se muestra un texto fijo.
function diffResumenHistorial(entry) {
  if (entry.action === "INSERT") return "Registro creado.";
  if (entry.action === "DELETE") return "Registro eliminado.";
  const anterior = entry.old_data || {};
  const nuevo = entry.new_data || {};
  const campos = new Set([...Object.keys(anterior), ...Object.keys(nuevo)]);
  const cambios = [];
  campos.forEach((c) => {
    if (c === "updated_at" || c === "created_at") return;
    const a = anterior[c];
    const b = nuevo[c];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      cambios.push(`${escapeHtml(c)}: ${escapeHtml(String(a ?? "-"))} → ${escapeHtml(String(b ?? "-"))}`);
    }
  });
  return cambios.length ? cambios.join(" · ") : "Sin cambios en los campos.";
}

function renderHistorialTable(entries) {
  const tbody = $("historialTableBody");
  tbody.innerHTML = "";
  $("historialEmpty").classList.toggle("hidden", entries.length > 0);
  for (const e of entries) {
    const tr = document.createElement("tr");
    const pillClase = e.action === "INSERT" ? "pill-yes" : e.action === "DELETE" ? "pill-no" : "pill-inactive";
    const fecha = e.changed_at.slice(0, 10);
    const hora = e.changed_at.slice(11, 16);
    tr.innerHTML = `
      <td>${formatFechaHora(fecha, hora)}</td>
      <td>${escapeHtml(e.changed_by_email || "-")}</td>
      <td>${escapeHtml(e.table_name)}</td>
      <td><span class="pill ${pillClase}">${escapeHtml(e.action)}</span></td>
      <td class="small">${diffResumenHistorial(e)}</td>
    `;
    tbody.appendChild(tr);
  }
}

// ---------- Utils ----------
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}
function formatDate(d) {
  if (!d) return "-";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}
function formatFechaHora(fecha, hora) {
  const f = formatDate(fecha);
  if (f === "-") return "-";
  return hora ? `${f} ${hora.slice(0, 5)}` : f;
}
// Revisor de consistencia L21/L24 (determinístico, no por IA: es una simple
// comparación aritmética entre las horas ausente ya calculadas y el código
// guardado — más confiable pidiéndole a un LLM que verifique una resta).
// Devuelve null si no hay nada que advertir (falta algún dato, o el código
// coincide con lo esperado), o { sugerido, actual, horas } si no coinciden —
// típicamente porque el código se completó a mano o vino de un PDF/OCR con
// una fecha/hora mal leída.
function verificarConsistenciaCodigo(nota) {
  const horas = horasAusente(nota);
  if (horas == null || !nota.codigo_infraccion) return null;
  const sugerido = sugerirCodigoInfraccion(horas);
  const actual = nota.codigo_infraccion.trim().toUpperCase();
  if (!sugerido || sugerido === actual) return null;
  return { sugerido, actual, horas };
}

function formatearHorasFalto(nota) {
  const totalHoras = horasAusente(nota);
  if (totalHoras == null) return null;
  const totalMin = Math.round(totalHoras * 60);
  const dias = Math.floor(totalMin / 1440);
  const horas = Math.floor((totalMin % 1440) / 60);
  const min = totalMin % 60;
  const partes = [];
  if (dias) partes.push(`${dias}d`);
  partes.push(`${horas}h`);
  partes.push(`${min}m`);
  return partes.join(" ");
}
