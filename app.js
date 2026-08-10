import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

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
        <div class="detail-field"><div class="label">Código de infracción</div><div class="value">${escapeHtml(nota.codigo_infraccion || "-")}</div></div>
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
          <label>Archivo de reincorporación<input type="file" id="rArchivo" /></label>
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
    $("reincForm")?.addEventListener("submit", (e) => submitReincorporacion(e, nota.id));
    $("expForm")?.addEventListener("submit", (e) => submitExpediente(e, nota.id));
  }
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
$("btnNuevaNota").addEventListener("click", () => {
  $("notaForm").reset();
  $("lookupResult").classList.add("hidden");
  $("notaFormError").classList.add("hidden");
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

$("notaForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const errEl = $("notaFormError");
  errEl.classList.add("hidden");

  const payload = {
    grado: $("fGrado").value.trim(),
    apellidos: $("fApellidos").value.trim(),
    nombres: $("fNombres").value.trim(),
    fecha_falta: $("fFechaFalta").value,
    numero_nota_falta: $("fNumeroNotaFalta").value.trim(),
    codigo_infraccion: $("fCodigoInfraccion").value.trim(),
    oficial_constato: $("fOficialConstato").value.trim() || null,
    created_by: state.session.user.id,
  };

  const { data: inserted, error } = await supabase
    .from("notas_informativas")
    .insert(payload)
    .select()
    .single();

  if (error) { errEl.textContent = "Error: " + error.message; errEl.classList.remove("hidden"); return; }

  const file = $("fArchivoNota").files[0];
  if (file) {
    const path = `${inserted.id}/${Date.now()}_${file.name}`;
    const { error: upErr } = await supabase.storage.from("notas").upload(path, file);
    if (!upErr) {
      await supabase.from("notas_informativas").update({
        archivo_nota_path: path, archivo_nota_nombre: file.name,
      }).eq("id", inserted.id);
    }
  }

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
