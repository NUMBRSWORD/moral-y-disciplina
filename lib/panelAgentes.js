import { consultarAgente, redactarDesdeFuentes } from "./agentesOficina.js";
import { fechaLima, hoyLima } from "./fechas.js";

const titulos = {
  jornada: "Preparar mi jornada",
  expediente: "Revisar expediente",
  parte: "Parte mensual"
};

function elemento(tag, texto, clase) {
  const nodo = document.createElement(tag);
  if (texto) nodo.textContent = texto;
  if (clase) nodo.className = clase;
  return nodo;
}

function boton(texto, accion, clase = "btn-secondary") {
  const b = elemento("button", texto, clase);
  b.type = "button";
  b.addEventListener("click", accion);
  return b;
}

function fuente(g, modo, abrirNota) {
  const ficha = elemento("details");
  ficha.append(elemento("summary", g.titulo + (modo === "expediente" ? "" : " · " + g.cantidad)));
  let visibles = 0;
  function cargar() {
    const lote = g.filas.slice(visibles, visibles + 20);
    for (const n of lote) {
      const p = elemento("p");
      if (n.detalle) p.append(elemento("span", n.detalle + " "));
      const nombre = [n.grado, n.apellidos, n.nombres].filter(Boolean).join(" ");
      p.append(boton("Abrir nota " + (n.numero_nota_falta || "sin número") + (nombre ? " · " + nombre : ""), () => abrirNota(n.id), "btn-ghost"));
      const fechas = [["Falta", n.fecha_falta], ["Límite", n.fecha_limite], ["Reportada", n.reportada_at], ["Recibida", n.recibido_at]]
        .filter(([,fecha]) => fecha).map(([tipo,fecha]) => tipo + " " + fechaLima(fecha));
      if (n.oficial_constato) fechas.push("Responsable " + n.oficial_constato);
      p.append(elemento("small", fechas.join(" · "), "muted"));
      ficha.append(p);
    }
    visibles += lote.length;
    if (!visibles) ficha.append(elemento("p","Sin casos en este grupo.", "muted"));
    if (visibles < g.filas.length) {
      const mas = boton("Ver más casos", () => { mas.remove(); cargar(); });
      ficha.append(mas);
    }
  }
  ficha.addEventListener("toggle", () => { if (ficha.open && ficha.children.length === 1) cargar(); });
  return ficha;
}

export function abrirPanelAgente({ db, state, modo, id, showView, abrirNota, volver }) {
  const usuario = state.session?.user?.id;
  if (!usuario || !Object.hasOwn(titulos, modo)) return;
  document.getElementById("view-agentes")?.remove();
  const panel = elemento("section", "", "view hidden");
  panel.id = "view-agentes";
  const parent = document.getElementById("view-dashboard").parentElement;
  parent.append(panel);
  panel.append(boton("← Volver", volver, "btn-ghost"), elemento("h2", titulos[modo]));
  const mes = elemento("input");
  mes.type = "month";
  mes.value = hoyLima().slice(0,7);
  if (modo === "parte") {
    const label = elemento("label","Mes del parte ");
    label.append(mes);
    panel.append(label);
  }
  const estado = elemento("p", "", "muted");
  estado.setAttribute("role","status");
  const registros = elemento("div");
  let version = 0;
  const vigente = v => panel.isConnected && version === v && state.session?.user?.id === usuario;

  async function consultar() {
    const v = ++version;
    registros.replaceChildren();
    estado.textContent = "Consultando registros…";
    const periodo = mes.value;
    try {
      const grupos = await consultarAgente(db, modo, {mes:periodo, id});
      if (!vigente(v)) return;
      estado.textContent = modo === "jornada" ? "Jornada del " + hoyLima() + " (Lima)." :
        modo === "parte" ? "Faltas por fecha del hecho. Entregas y recepciones por su fecha de registro en Lima." :
        "Comprobación de los datos y archivos registrados en este expediente.";
      if (!grupos.length) {
        registros.append(elemento("p", "Sin observaciones automáticas en los campos revisados."));
        if (modo === "expediente") registros.append(boton("Abrir expediente", () => abrirNota(id)));
        return;
      }
      const texto = elemento("textarea");
      texto.readOnly = true;
      texto.rows = 5;
      texto.style.width = "100%";
      texto.setAttribute("aria-label","Resumen de los registros");
      texto.value = redactarDesdeFuentes(modo, grupos, [], periodo);
      const aviso = elemento("p","","muted small");
      aviso.setAttribute("role","status");
      const consulta = elemento("input");
      consulta.type = "text";
      consulta.maxLength = 350;
      consulta.placeholder = modo === "expediente" ? "¿Qué documento falta?" : "¿Qué entregas esperan confirmación?";
      const label = elemento("label","Pregunta para Ollama ");
      label.append(consulta);
      const preguntar = boton("Consultar a Ollama", async () => {
        const pregunta = consulta.value.trim();
        if (!pregunta) { consulta.focus(); return; }
        preguntar.disabled = true;
        aviso.textContent = "Consultando al modelo de la oficina…";
        try {
          const local = ["localhost","127.0.0.1"].includes(location.hostname);
          const ruta = local ? "generar-resumen-casos" : "ia-oficina/generar-resumen-casos";
          const { data, error } = await db.functions.invoke(ruta, { body:{
            modo:"asistente_oficina", agente:modo, pregunta,
            hechos:grupos.map(({clave,titulo,cantidad}) => ({clave,titulo,cantidad}))
          }});
          if (!vigente(v)) return;
          if (error || !Array.isArray(data?.claves) || !data.claves.every(k => grupos.some(g => g.clave === k))) throw new Error();
          if (!data.claves.length) {
            aviso.textContent = "Los registros consultados no permiten responder esa pregunta.";
            texto.value = redactarDesdeFuentes(modo, grupos, [], periodo);
          } else {
            texto.value = redactarDesdeFuentes(modo, grupos, data.claves, periodo);
            aviso.textContent = "Ollama seleccionó los registros pertinentes. Puede abrir las notas debajo.";
          }
        } catch {
          if (vigente(v)) {
            texto.value = redactarDesdeFuentes(modo, grupos, [], periodo);
            aviso.textContent = "La consulta a Ollama no se completó. Se muestra el resumen de los registros.";
          }
        } finally { if (vigente(v)) preguntar.disabled = false; }
      });
      const copiar = boton("Copiar resumen", async () => {
        try { await navigator.clipboard.writeText(texto.value); aviso.textContent = "Resumen copiado."; }
        catch { texto.focus(); texto.select(); aviso.textContent = "Texto seleccionado para copiar."; }
      });
      registros.append(texto, copiar, label, preguntar, aviso, elemento("h3","Registros de respaldo"));
      grupos.forEach(g => registros.append(fuente(g, modo, abrirNota)));
    } catch (error) {
      if (vigente(v)) estado.textContent = error.message || "No se pudo completar la consulta.";
    }
  }
  mes.addEventListener("change", consultar);
  panel.append(boton("Actualizar registros", consultar), estado, registros);
  showView(panel.id);
  void consultar();
}
