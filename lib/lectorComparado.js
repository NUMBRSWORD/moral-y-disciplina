import { candidatos, etiquetas, motivoRevisionDescargo } from "./cotejoOcr.js";

function elemento(tipo, texto) {
  const el = document.createElement(tipo);
  if (texto !== undefined) el.textContent = texto;
  return el;
}

function lienzo(ancho, alto) {
  const c = elemento("canvas");
  c.width = Math.ceil(ancho);
  c.height = Math.ceil(alto);
  return c;
}

async function interpretar(canvas, numero, invocar) {
  const resultado = await invocar(canvas.toDataURL("image/jpeg", .92).split(",")[1]);
  if (!resultado?.doble || !Array.isArray(resultado.lineas)) throw new Error("Actualice la central para usar la doble lectura.");
  return { numero, canvas, motorVision:resultado.motorVision || "GLM-OCR", motorGlm:resultado.motorVisionDisponible ?? resultado.motorGlm, motorTesseract:resultado.motorTesseract, glm: resultado.glm || "", lineas: resultado.lineas,
    optico: resultado.lineas.map(l => l.texto).join("\n") };
}

// Se conserva una sola página en memoria mientras se lee o se coteja el archivo.
export async function recorrerDocumento(file, nombre, {pdfjs, invocar, recibir, vigente, estado, revisarTexto}) {
  if (/\.(md|markdown|txt)$/i.test(nombre) || /^text\/(plain|markdown)/.test(file.type)) {
    const digital = await file.text();
    if (vigente()) await recibir({numero:1,digital});
    return;
  }
  if (!/\.pdf$/i.test(nombre) && file.type !== "application/pdf") {
    if (!file.type.startsWith("image/") && !/\.(png|jpe?g|webp|bmp)$/i.test(nombre)) throw new Error("Seleccione un PDF, imagen o Markdown para leerlo.");
    const imagen = await createImageBitmap(file);
    const escala = Math.min(1, 2500 / Math.max(imagen.width, imagen.height));
    const c = lienzo(imagen.width * escala, imagen.height * escala);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(imagen, 0, 0, c.width, c.height);
    imagen.close();
    estado("Comparando la imagen con GLM-OCR y Tesseract…");
    if (vigente()) {
      const leida = await interpretar(c, 1, invocar);
      if (vigente()) await recibir(leida);
    }
    return;
  }
  const pdf = await pdfjs.getDocument({data:await file.arrayBuffer()}).promise;
  try {
    for (let n = 1; n <= pdf.numPages && vigente(); n++) {
      const pagina = await pdf.getPage(n);
      const contenido = await pagina.getTextContent();
      const digital = contenido.items.map(it => (it.str || "") + (it.hasEOL ? "\n" : " ")).join("").trim();
      if (digital && !revisarTexto(digital)) {
        if (vigente()) await recibir({numero:n, digital});
      } else {
        estado("Comparando la página " + n + " de " + pdf.numPages + " con GLM-OCR y Tesseract…");
        const base = pagina.getViewport({scale:1});
        const vista = pagina.getViewport({scale:Math.min(3, 2500 / Math.max(base.width, base.height))});
        const c = lienzo(vista.width, vista.height);
        await pagina.render({canvasContext:c.getContext("2d"), viewport:vista}).promise;
        if (!vigente()) return;
        const leida = await interpretar(c, n, invocar);
        if (vigente()) await recibir(leida);
        c.width = c.height = 0;
      }
      pagina.cleanup();
    }
  } finally { await pdf.destroy(); }
}

function imagenOriginal(canvas, caja) {
  let vista = canvas;
  if (caja?.length === 4) {
    const x = Math.max(0, Math.floor(caja[0] * canvas.width) - 12);
    const y = Math.max(0, Math.floor(caja[1] * canvas.height) - 12);
    const w = Math.max(1, Math.min(canvas.width-x, Math.ceil(caja[2]*canvas.width)-x+12));
    const h = Math.max(1, Math.min(canvas.height-y, Math.ceil(caja[3]*canvas.height)-y+12));
    vista = lienzo(w,h);
    vista.getContext("2d").drawImage(canvas,x,y,w,h,0,0,w,h);
  }
  const img = elemento("img");
  img.alt = caja ? "Recorte del renglón original" : "Página original";
  img.style.maxWidth = "100%";
  img.src = vista.toDataURL("image/jpeg",.87);
  return img;
}

export function mostrarCampos(pagina, campos, panel, formulario) {
  const digital = pagina.digital !== undefined;
  const lecturas = digital ? [["Texto original", pagina.digital]] : [[pagina.motorVision || "GLM-OCR",pagina.glm],["Tesseract",pagina.optico]];
  const valores = lecturas.map(([motor,texto]) => ({motor, campos:candidatos(texto,campos)}));
  let total = 0;
  for (const campo of campos) {
    const encontrados = valores.map(v => v.campos.filter(c => c.campo === campo));
    const opciones = [...new Set(encontrados.flat().map(c => c.valor))];
    if (!opciones.length) continue;
    total++;
    const bloque = elemento("section");
    const coinciden = opciones.length === 1 && encontrados.every(grupo => grupo.length);
    const cajas = digital ? [] : pagina.lineas.filter(l => encontrados[1].some(c => c.linea === l.texto));
    const dudosos = [...new Set(cajas.flatMap(l => l.numerosDudosos || []))];
    let titulo = digital ? "Texto original" : coinciden ? "Ambas lecturas coinciden" : "Revisar diferencia";
    if (coinciden && dudosos.length) titulo = "Lecturas coincidentes · comprobar cifras";
    bloque.append(elemento("h4",etiquetas[campo] + " · Página " + pagina.numero + " · " + titulo));
    valores.forEach((v,i) => bloque.append(elemento("p", v.motor + ": " +
      (encontrados[i].map(c => c.linea).join(" / ") || ((!digital && (i === 0 ? pagina.motorGlm : pagina.motorTesseract) === false) ? "Motor no disponible" : "Sin valor identificado")))));
    if (!digital) {
      const detalles = elemento("details");
      detalles.append(elemento("summary","Ver original"));
      if (dudosos.length) {
        bloque.append(elemento("p", "Cifras de lectura dudosa: " + dudosos.join(", ")));
        detalles.open = true;
      }
      if (cajas.length) cajas.forEach(l => detalles.append(imagenOriginal(pagina.canvas,l.caja)));
      else detalles.append(imagenOriginal(pagina.canvas));
      bloque.append(detalles);
    }
    for (const valor of opciones) {
      const btn = elemento("button","Usar " + valor);
      btn.type = "button"; btn.className = "btn-secondary";
      btn.onclick = () => {
        const input = formulario.querySelector("#"+campo);
        if (input.value && input.value !== valor && !confirm("¿Reemplazar el valor escrito por " + valor + "?")) return;
        input.value = valor;
        input.dataset.lecturaArchivo = input.value;
        input.dispatchEvent(new Event("input",{bubbles:true}));
      };
      bloque.append(btn);
    }
    panel.append(bloque);
  }
  return total;
}

export async function confirmarDescargo(pagina, panel) {
  if (pagina.digital !== undefined) return pagina.digital;
  const motivo = motivoRevisionDescargo(pagina.glm, pagina.optico, pagina.lineas);
  if (!motivo) return pagina.glm;
  const bloque = elemento("section");
  bloque.append(elemento("h4","Comprobar transcripción · Página " + pagina.numero),
    elemento("p", motivo + " Compare la transcripción con el original."));
  for (const [motor,texto] of [[pagina.motorVision || "GLM-OCR",pagina.glm],["Tesseract",pagina.optico]]) {
    const detalle = elemento("details");
    detalle.append(elemento("summary",motor),elemento("p",texto || "Sin lectura"));
    bloque.append(detalle);
  }
  const original = elemento("details");
  original.open = true;
  original.append(elemento("summary","Ver página original"), imagenOriginal(pagina.canvas));
  const etiqueta = elemento("label","Texto que pasará al análisis");
  const editor = elemento("textarea");
  editor.rows = 6; editor.value = pagina.glm || pagina.optico;
  etiqueta.append(editor);
  const usar = elemento("button","Confirmar lectura de esta página"), cancelar = elemento("button","Cancelar lectura");
  for (const btn of [usar,cancelar]) {btn.type = "button";btn.className = "btn-secondary";}
  bloque.append(original,etiqueta,usar,cancelar); panel.append(bloque);
  return new Promise((resolve,reject) => {
    usar.onclick = () => {bloque.remove();resolve(editor.value.trim());};
    cancelar.onclick = () => {bloque.remove();reject(new Error("Lectura cancelada."));};
  });
}
