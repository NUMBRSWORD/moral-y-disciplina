import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as pdfjsLib from "https://esm.sh/pdfjs-dist@4.6.82/build/pdf.mjs";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import { createWorker } from "https://esm.sh/tesseract.js@5.1.1";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";
import saveAs from "https://esm.sh/file-saver@2.0.5";
import { renderizarImputacionDocx, puedeGenerarImputacion, buscarOficialConstato, tokens } from "./lib/imputacion.js";
import { renderizarActaNoDescargoDocx, puedeGenerarActaNoDescargo, plazoDescargoVencido, fechaLimiteDescargo } from "./lib/actaNoDescargo.js";
import { renderizarOrdenSancionDocx, puedeGenerarOrdenSancion, opcionesTercio, buildCasoConcreto, analisisSinDescargoDefault } from "./lib/ordenSancion.js";
import { getInfraccion, normalizarCodigoInfraccion } from "./lib/anexoI.js";
import { listarDirectivas, directivasParaIA, guardarDirectiva, eliminarDirectiva, subirArchivoDirectiva } from "./lib/directivas.js";
import { horasAusente, sugerirCodigoInfraccion } from "./lib/utils.js";
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
  const map = { "view-dashboard": "dashboard", "view-efectivos": "efectivos", "view-directivas": "directivas", "view-panel": "panel", "view-historial": "historial" };
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
    if (target === "panel") { showView("view-panel"); renderPanel(); }
    if (target === "historial") { showView("view-historial"); loadHistorial(); }
  });
});

$("btnVolverDashboard").addEventListener("click", () => { showView("view-dashboard"); loadNotas(); });

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
  $("userEmail").textContent = state.email;
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
  if (error) { console.error(error); return; }
  // La política de RLS "ve notas propias o es admin" ya filtra en el
  // servidor qué filas puede ver este usuario (por oficial_constato_cip);
  // el navegador nunca recibe las que no le corresponden, así que aquí ya
  // no hace falta (ni conviene) repetir el filtro en JavaScript.
  state.notas = data || [];
  renderNotasTable(state.notas);
}

let notasVisibles = [];

function renderNotasTable(list) {
  notasVisibles = list;
  const tbody = $("notasTableBody");
  tbody.innerHTML = "";
  $("notasEmpty").classList.toggle("hidden", list.length > 0);
  for (const n of list) {
    const tr = document.createElement("tr");
    const puedeDescargar = puedeGenerarImputacion(n, state.efectivos);
    const puedeActa = puedeGenerarActaNoDescargo(n, state.efectivos);
    tr.innerHTML = `
      <td>${escapeHtml(n.grado || "")}</td>
      <td>${escapeHtml(n.apellidos || "")} ${escapeHtml(n.nombres || "")}</td>
      <td>${formatFechaHora(n.fecha_falta, n.hora_falta)}</td>
      <td>${escapeHtml(n.numero_nota_falta || "")}</td>
      <td>${escapeHtml(n.oficial_constato || "-")}</td>
      <td>${formatFechaHora(n.fecha_reincorporacion, n.hora_reincorporacion)}</td>
      <td>${escapeHtml(n.numero_nota_reincorporacion || "-")}</td>
      <td>${formatearHorasFalto(n) || "-"}</td>
      <td>${escapeHtml(n.codigo_infraccion || "")}</td>
      <td>${n.fecha_reincorporacion ? '<span class="pill pill-yes">Sí</span>' : '<span class="pill pill-no">Pendiente</span>'}</td>
      <td class="row-actions">${puedeDescargar ? `<button type="button" class="btn-secondary btn-descargar-imputacion" title="Descargar Inicio de Imputación de Infracción Leve">⬇ Imputación</button>` : ""}${puedeActa ? `<button type="button" class="btn-secondary btn-descargar-acta" title="Descargar Acta de No Recepción de Descargos">⬇ Acta No Descargo</button>` : ""} <span class="row-chevron">›</span></td>
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
  return `${prefijo} - ${(nota.grado || "").trim()} ${(nota.apellidos || "").trim()} ${(nota.nombres || "").trim()}.docx`.replace(/\s+/g, " ").trim();
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
    investigado: `${n.grado || ""} ${n.apellidos || ""} ${n.nombres || ""}`.replace(/\s+/g, " ").trim(),
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
    if (error) throw error;
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
    "Apellidos y nombres": `${n.apellidos || ""} ${n.nombres || ""}`.trim(),
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

// ---------- Nota detail ----------
async function openNotaDetail(id) {
  const { data: nota, error } = await supabase
    .from("notas_informativas")
    .select("*, expedientes(*)")
    .eq("id", id)
    .single();
  if (error) { console.error(error); return; }
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
        <h3>${escapeHtml(nota.grado || "")} ${escapeHtml(nota.apellidos || "")} ${escapeHtml(nota.nombres || "")}</h3>
        ${codigoEsLeve ? `
          <button type="button" class="btn-secondary" id="btnDescargarImputacion" ${puedeDescargar ? "" : "disabled"}>⬇ Descargar Imputación</button>
        ` : ""}
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
      ` : `
        <p class="muted small">Aún no ha sido reincorporado.</p>
        ${isAdmin ? `
        <form id="reincForm">
          <div class="grid-2">
            <label>Fecha de reincorporación<input type="date" id="rFecha" required /></label>
            <label>N.º de nota de reincorporación<input type="text" id="rNumero" required /></label>
          </div>
          <label>Hora de reincorporación<input type="time" id="rHora" /></label>
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
          ${puedeActa ? `<button type="button" class="btn-secondary" id="btnDescargarActaDetalle">⬇ Descargar Acta de No Descargo</button>` : `<p class="muted small">Venció el plazo, pero no se pudo ubicar en Efectivos al oficial o al investigado para generar el acta.</p>`}
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
          <label>Descargo del investigado (resumen${nota.fecha_descargo ? " — deje en blanco y presione \"Redactar con IA\" para que se lea solo del archivo subido" : ""})
            <textarea id="sSancionDescargo" rows="3" placeholder="${nota.fecha_descargo ? "Déjelo en blanco: 'Redactar con IA' lee el archivo del descargo ya subido. O escriba usted mismo un resumen." : ""}">${escapeHtml(nota.sancion_descargo_resumen || (nota.fecha_descargo ? "" : "El investigado no presentó su descargo por escrito dentro del plazo de un (01) día hábil establecido por ley, conforme acta respectiva, precluyendo su derecho a la defensa en la presente etapa procedimental."))}</textarea>
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
          <button type="submit" class="btn-primary">Guardar y descargar Orden de Sanción</button>
        </form>
        ${nota.orden_sancion_generada_at ? `<p class="muted small">Generada por última vez el ${formatDate(nota.orden_sancion_generada_at.slice(0, 10))}.</p>` : ""}
      ` : `<p class="muted small">Para generar la Orden de Sanción, verifique que el oficial que constató la falta y el investigado estén registrados en Efectivos.</p>`}
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
  // Registrar la notificación y el descargo lo puede hacer cualquier usuario
  // autenticado (cada oficial notifica en persona y marca su propio caso),
  // no solo admin como el resto de la edición de la nota.
  $("notificacionForm")?.addEventListener("submit", (e) => submitNotificacion(e, nota.id));
  $("descargoForm")?.addEventListener("submit", (e) => submitDescargo(e, nota.id));
  $("sancionForm")?.addEventListener("submit", (e) => submitSancion(e, nota));
  $("btnRedactarIA")?.addEventListener("click", () => redactarConIA(nota));

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
    if (!descargoNotas && nota.archivo_descargo_path) {
      statusEl.textContent = "Leyendo el archivo del descargo ya subido...";
      descargoNotas = (await extraerTextoDescargo(nota, (msg) => { statusEl.textContent = msg; })).trim();
    }

    statusEl.textContent = "Consultando directivas internas y antecedentes...";
    const directivas = directivasParaIA(state.directivas.length ? state.directivas : await listarDirectivas(supabase));
    const antecedentes = buscarAntecedentes(nota, state.notas);

    statusEl.textContent = "Analizando el descargo y redactando con IA...";
    const { data, error } = await supabase.functions.invoke("redactar-analisis", {
      body: {
        investigadoCompleto: `${nota.grado || ""} ${nota.apellidos || ""} ${nota.nombres || ""}`.replace(/\s+/g, " ").trim(),
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
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    if (data?.descargo_texto) $("sSancionDescargo").value = data.descargo_texto;
    if (data?.analisis_texto) {
      $("sSancionAnalisis").value = data.analisis_texto;
      $("sSancionAnalisis").dataset.autofilled = "false";
    }
    if (data?.tercio_value) {
      const radio = [...document.querySelectorAll('input[name="sancionTercio"]')]
        .find((r) => r.value === data.tercio_value);
      if (radio) radio.checked = true;
    }
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

async function submitSancion(e, nota) {
  e.preventDefault();
  const errEl = $("sancionError");
  errEl.classList.add("hidden");
  const tercioValue = document.querySelector('input[name="sancionTercio"]:checked')?.value;
  const analisisTexto = $("sSancionAnalisis").value.trim();
  const descargoTexto = $("sSancionDescargo").value.trim();

  if (!tercioValue) { errEl.textContent = "Seleccione la sanción a imponer."; errEl.classList.remove("hidden"); return; }
  if (!analisisTexto) { errEl.textContent = "Escriba el Análisis y Evaluación."; errEl.classList.remove("hidden"); return; }

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
  if (error) { console.error(error); return; }
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

// ---------- Nueva nota modal ----------
let pdfCandidates = [];

$("btnNuevaNota").addEventListener("click", () => {
  $("notaForm").reset();
  $("lookupResult").classList.add("hidden");
  $("notaFormError").classList.add("hidden");
  $("pdfAutoStatus").classList.add("hidden");
  pdfCandidates = [];
  renderCandidatesChecklist();
  $("modalNuevaNota").classList.remove("hidden");
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
  // seleccionable): pdf.js no extrae nada de ellas. En ese caso se recurre a
  // reconocimiento óptico de caracteres (OCR) sobre la página renderizada.
  if (text.trim().length < 30) {
    onEstado?.("Esta nota es una imagen escaneada: leyendo con reconocimiento de texto (OCR), puede tardar unos segundos...");
    text = await extractPdfTextConOcr(pdf);
  }
  return text;
}

async function extractPdfTextConOcr(pdf) {
  const worker = await createWorker("spa");
  let text = "";
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 3 });
      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      const { data } = await worker.recognize(canvas);
      text += data.text + "\n";
    }
  } finally {
    await worker.terminate();
  }
  return text;
}

async function extractImagenTextoConOcr(blob) {
  const worker = await createWorker("spa");
  try {
    const { data } = await worker.recognize(blob);
    return data.text || "";
  } finally {
    await worker.terminate();
  }
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
    if (esImagen) {
      onEstado?.("Leyendo el archivo del descargo con reconocimiento de texto (OCR)...");
      return await extractImagenTextoConOcr(blob);
    }
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

  return result;
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
    if (data.grado && !$("fGrado").value) $("fGrado").value = data.grado;
    if (data.apellidos && !$("fApellidos").value) $("fApellidos").value = data.apellidos;
    if (data.nombres && !$("fNombres").value) $("fNombres").value = data.nombres;
    if (data.fecha_falta && !$("fFechaFalta").value) $("fFechaFalta").value = data.fecha_falta;
    if (data.numero_nota_falta && !$("fNumeroNotaFalta").value) $("fNumeroNotaFalta").value = data.numero_nota_falta;
    if (data.hora_falta && !$("fHoraFalta").value) $("fHoraFalta").value = data.hora_falta;
    if (data.oficial_constato && !$("fOficialConstato").value) $("fOficialConstato").value = data.oficial_constato;
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
      ? `${escapeHtml(f.candidate.grado)} ${escapeHtml(f.candidate.apellidos)} ${escapeHtml(f.candidate.nombres)}`
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
      errEl.textContent = `Complete fecha y N.º de nota para ${fila.nota.apellidos} ${fila.nota.nombres}.`;
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
      statusEl.textContent = "Leyendo imagen con reconocimiento de texto (OCR)...";
      texto = await extractImagenTextoConOcr(file);
    }
    texto = texto.trim();
    if (texto) {
      if (!$("dvContenido").value.trim()) $("dvContenido").value = texto;
      statusEl.textContent = "Texto extraído del archivo. Revíselo y corríjalo antes de guardar — el reconocimiento automático puede tener errores.";
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
