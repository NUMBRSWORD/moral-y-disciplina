import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as pdfjsLib from "https://esm.sh/pdfjs-dist@4.6.82/build/pdf.mjs";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = "https://esm.sh/pdfjs-dist@4.6.82/build/pdf.worker.mjs";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
  session: null,
  role: null,
  email: null,
  notas: [],
  efectivos: [],
  currentNotaId: null,
};

const $ = (id) => document.getElementById(id);

// ---------- View switching ----------
function showView(id) {
  document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
  $(id).classList.remove("hidden");
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
  const map = { "view-dashboard": "dashboard", "view-efectivos": "efectivos" };
  if (map[id]) {
    document.querySelector(`.tab-btn[data-view="${map[id]}"]`)?.classList.add("active");
  }
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    const target = btn.dataset.view;
    if (target === "dashboard") { showView("view-dashboard"); loadNotas(); }
    if (target === "efectivos") { showView("view-efectivos"); loadEfectivos(); }
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
  loadNotas();
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
  const email = $("loginEmail").value.trim();
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
  state.notas = data || [];
  renderNotasTable(state.notas);
}

function renderNotasTable(list) {
  const tbody = $("notasTableBody");
  tbody.innerHTML = "";
  $("notasEmpty").classList.toggle("hidden", list.length > 0);
  for (const n of list) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(n.grado || "")}</td>
      <td>${escapeHtml(n.apellidos || "")} ${escapeHtml(n.nombres || "")}</td>
      <td>${formatDate(n.fecha_falta)}</td>
      <td>${escapeHtml(n.numero_nota_falta || "")}</td>
      <td>${escapeHtml(n.codigo_infraccion || "")}</td>
      <td>${n.fecha_reincorporacion ? '<span class="pill pill-yes">Sí</span>' : '<span class="pill pill-no">Pendiente</span>'}</td>
      <td>›</td>
    `;
    tr.addEventListener("click", () => openNotaDetail(n.id));
    tbody.appendChild(tr);
  }
}

$("searchNotas").addEventListener("input", (e) => {
  const q = e.target.value.toLowerCase();
  const filtered = state.notas.filter((n) =>
    [n.nombres, n.apellidos, n.numero_nota_falta, n.codigo_infraccion, n.grado]
      .filter(Boolean).join(" ").toLowerCase().includes(q)
  );
  renderNotasTable(filtered);
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

  $("notaDetailContent").innerHTML = `
    <div class="detail-card">
      <h3>${escapeHtml(nota.grado || "")} ${escapeHtml(nota.apellidos || "")} ${escapeHtml(nota.nombres || "")}</h3>
      <div class="detail-grid">
        <div class="detail-field"><div class="label">Fecha de falta</div><div class="value">${formatDate(nota.fecha_falta)}</div></div>
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
          <div class="detail-field"><div class="label">N.º de nota de reincorporación</div><div class="value">${escapeHtml(nota.numero_nota_reincorporacion || "-")}</div></div>
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
          <label>Archivo de reincorporación<input type="file" id="rArchivo" accept="application/pdf,image/*" /></label>
          <p id="reincAutoStatus" class="muted small hidden"></p>
          <p id="reincError" class="error hidden"></p>
          <button type="submit" class="btn-primary">Registrar reincorporación</button>
        </form>` : ""}
      `}
    </div>

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
        ${isAdmin ? `
        <form id="expForm">
          <div class="grid-2">
            <label>N.º de oficio<input type="text" id="eOficio" required /></label>
            <label>N.º de HT<input type="text" id="eHt" required /></label>
          </div>
          <label>Días de sanción<input type="number" id="eDias" min="0" /></label>
          <label>Archivo del expediente<input type="file" id="eArchivo" /></label>
          <p id="expError" class="error hidden"></p>
          <button type="submit" class="btn-primary">Registrar expediente</button>
        </form>` : ""}
      `}
    </div>
  `;

  if (isAdmin) {
    $("btnEliminarNota")?.addEventListener("click", () => eliminarNota(nota.id));
    $("codigoInfraccionForm")?.addEventListener("submit", (e) => submitCodigoInfraccion(e, nota.id));
    $("reincForm")?.addEventListener("submit", (e) => submitReincorporacion(e, nota.id));
    $("rArchivo")?.addEventListener("change", (e) => autocompletarReincorporacion(e.target.files[0]));
    $("expForm")?.addEventListener("submit", (e) => submitExpediente(e, nota.id));
  }
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

  const { error } = await supabase.from("notas_informativas").update({
    fecha_reincorporacion: fecha,
    numero_nota_reincorporacion: numero,
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

async function extractPdfText(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str).join(" ") + "\n";
  }
  return text;
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

  const prosePattern = /\bde(?:l|\s+los|\s+las)\s+([A-Z0-9./]{1,8}\s+PNP\s+[A-ZÁÉÍÓÚÑ][A-Za-zÁÉÍÓÚÑáéíóúñ]*(?:\s+[A-Za-zÁÉÍÓÚÑáéíóúñ]+){0,5})[.,]/gi;
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

function parseNotaInformativa(text) {
  const norm = text.replace(/\s+/g, " ");
  const result = {};

  const mNumero = norm.match(/NOTA\s+INFORMATIVA\s+N[°ºo]\s*([0-9]+)/i);
  if (mNumero) result.numero_nota_falta = mNumero[1];

  const mFecha = norm.match(/d[ií]a\s+(\d{1,2})\s*(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SET|SEP|OCT|NOV|DIC)\s*(\d{4})/i);
  if (mFecha) {
    const dd = mFecha[1].padStart(2, "0");
    const mm = MESES_ABREV[mFecha[2].toUpperCase()];
    result.fecha_falta = `${mFecha[3]}-${mm}-${dd}`;
  }

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
  const namePattern = /((?:[A-ZÁÉÍÓÚÑ.]{2,}\.?\s+){1,3}PNP\s+[A-Z][A-Za-zÁÉÍÓÚÑáéíóúñ]*(?:\s+[A-Z][A-Za-zÁÉÍÓÚÑáéíóúñ]*){0,3})/g;
  const idxConstato = norm.search(/constat[oó]/i);
  if (idxConstato !== -1) {
    let bestOficial = null;
    let m;
    while ((m = namePattern.exec(norm))) {
      if (m.index < idxConstato) bestOficial = m[1];
      else break;
    }
    if (bestOficial) {
      result.oficial_constato = bestOficial.replace(/\s*\bPNP\b\s*/i, " ").replace(/\s+/g, " ").trim();
    }
  }

  return result;
}

function parseReincorporacion(text) {
  const norm = text.replace(/\s+/g, " ");
  const result = {};

  const mNumero = norm.match(/NOTA\s+INFORMATIVA\s+N[°ºo]\s*([0-9]+)/i);
  if (mNumero) result.numero_nota_reincorporacion = mNumero[1];

  // Ancla en "reincorpor..." y toma la fecha/hora más cercana que sigue, para no
  // confundirla con la fecha de la falta original que suele aparecer después en el mismo párrafo.
  const mFecha = norm.match(/reincorpor\w*(?:(?!reincorpor).)*?(\d{1,2})\s*(ENE|FEB|MAR|ABR|MAY|JUN|JUL|AGO|SET|SEP|OCT|NOV|DIC)\s*(\d{4})/i);
  if (mFecha) {
    const dd = mFecha[1].padStart(2, "0");
    const mm = MESES_ABREV[mFecha[2].toUpperCase()];
    result.fecha_reincorporacion = `${mFecha[3]}-${mm}-${dd}`;
  }

  const mHora = norm.match(/reincorpor\w*(?:(?!reincorpor).)*?a\s+las\s+(\d{1,2}:\d{2})\s*horas/i);
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
    const text = await extractPdfText(file);
    const data = parseReincorporacion(text);
    if (data.fecha_reincorporacion && !$("rFecha").value) $("rFecha").value = data.fecha_reincorporacion;
    if (data.numero_nota_reincorporacion && !$("rNumero").value) $("rNumero").value = data.numero_nota_reincorporacion;
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
    const text = await extractPdfText(file);
    const data = parseNotaInformativa(text);
    if (data.grado && !$("fGrado").value) $("fGrado").value = data.grado;
    if (data.apellidos && !$("fApellidos").value) $("fApellidos").value = data.apellidos;
    if (data.nombres && !$("fNombres").value) $("fNombres").value = data.nombres;
    if (data.fecha_falta && !$("fFechaFalta").value) $("fFechaFalta").value = data.fecha_falta;
    if (data.numero_nota_falta && !$("fNumeroNotaFalta").value) $("fNumeroNotaFalta").value = data.numero_nota_falta;
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

  const compartido = {
    fecha_falta: $("fFechaFalta").value,
    numero_nota_falta: $("fNumeroNotaFalta").value.trim(),
    codigo_infraccion: $("fCodigoInfraccion").value.trim(),
    oficial_constato: $("fOficialConstato").value.trim() || null,
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
