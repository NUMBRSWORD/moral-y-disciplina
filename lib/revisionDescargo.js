// La página y su etiqueta pertenecen al lector del archivo, nunca al modelo.
const normalizar = texto => texto.normalize("NFC").replace(/\s+/gu, " ").trim();

function fragmentos(fuentes) {
  const salida = [];
  for (const fuente of fuentes) {
    let texto = normalizar(fuente.texto || "");
    while (texto) {
      const corte = texto.length <= 3000 ? texto.length : texto.lastIndexOf(" ", 3000);
      const fin = corte > 0 ? corte : 3000;
      salida.push({ ...fuente, texto: texto.slice(0, fin), id: fuente.tipo + (salida.length + 1) });
      texto = texto.slice(fin).trimStart();
    }
  }
  return salida;
}

export function prepararConsultas(descargo, contexto) {
  const fragmentosDescargo = fragmentos(descargo);
  const referencias = fragmentos(contexto);
  const lotes = [];
  let lote = [], longitud = 0;
  for (const parte of fragmentosDescargo) {
    if (lote.length && (longitud + parte.texto.length > 4800 || lote.length >= 12)) {
      lotes.push(lote);
      lote = [];
      longitud = 0;
    }
    lote.push(parte);
    longitud += parte.texto.length;
  }
  if (lote.length) lotes.push(lote);
  return lotes.map(partes => {
    const palabras = new Set(partes.flatMap(p => p.texto.toLowerCase().match(/\p{L}{5,}/gu) || []));
    const prioridad = ref => {
      if (ref.tipo === "H") return Infinity;
      const terminos = new Set(ref.texto.toLowerCase().match(/\p{L}{5,}/gu) || []);
      return [...terminos].filter(t => palabras.has(t)).length;
    };
    const ordenadas = referencias.map(ref => ({ ref, peso: prioridad(ref) })).sort((a,b) => b.peso - a.peso);
    const elegidas = [];
    let restante = 6000;
    for (const { ref } of ordenadas) {
      if (ref.texto.length <= restante && elegidas.length < 10) {
        elegidas.push(ref);
        restante -= ref.texto.length;
      }
    }
    return { fuentes: [...partes, ...elegidas], contextoParcial: elegidas.length < referencias.length };
  });
}

function citaEn(fuente, texto) {
  if (!fuente || typeof texto !== "string") return "";
  const cita = normalizar(texto);
  if (cita.length < 12) return "";
  const posicion = fuente.texto.indexOf(cita);
  if (posicion < 0) return "";
  // Conserva el enunciado alrededor de una cita recortada, incluidas sus negaciones.
  const antes = fuente.texto.slice(0, posicion);
  const inicio = Math.max(antes.lastIndexOf(". "), antes.lastIndexOf("? "), antes.lastIndexOf("! "));
  const fin = posicion + cita.length;
  const despues = fuente.texto.slice(fin);
  const resto = /[.!?](?=\s|$)/u.exec(despues);
  const hasta = /[.!?]$/u.test(cita) ? fin : resto ? fin + resto.index + 1 : fuente.texto.length;
  return fuente.texto.slice(inicio < 0 ? 0 : inicio + 2, hasta).trim();
}

// Una cita acredita que la frase figura en esa fuente. El oficial evalúa su significado.
const comprobaciones = new Map([
  ["documento", "Comprobar si el documento mencionado obra en el expediente y qué parte de lo alegado respalda."],
  ["registro", "Consultar el registro correspondiente y cotejar su contenido con esta manifestación."],
  ["fecha", "Cotejar las fechas y horas mencionadas con los documentos del expediente."],
  ["circunstancia", "Identificar qué elementos del expediente permiten corroborar esta circunstancia."]
]);

export function comprobarPuntos(respuesta, fuentes) {
  if (respuesta?.version !== 1 || !Array.isArray(respuesta.puntos)) {
    throw new Error("La central no devolvió una revisión con fuentes. Actualice la central y vuelva a intentarlo.");
  }
  const puntos = [];
  let omitidos = 0;
  for (const p of respuesta.puntos) {
    const fuente = fuentes.find(f => f.tipo === "D" && f.id === p?.fuente);
    const cita = citaEn(fuente, p?.cita);
    if (!cita) { omitidos++; continue; }
    const referencia = fuentes.find(f => f.tipo !== "D" && f.id === p.referencia);
    const citaContraste = citaEn(referencia, p.cita_contraste);
    let contraste = null;
    if (p.referencia || p.cita_contraste) {
      if (citaContraste) {
        contraste = { etiqueta: referencia.etiqueta, cita: citaContraste };
      } else { omitidos++; }
    }
    puntos.push({ fuente, cita, contraste,
      pregunta: comprobaciones.get(p.comprobacion) || "" });
  }
  return { puntos, omitidos };
}

export function textoDelBorrador(puntos) {
  const resumen = puntos.map(p => "El escrito señala «" + p.cita + "» (" + p.fuente.etiqueta + ").").join("\n\n");
  const analisis = puntos.map(p => {
    const frases = ['Respecto de «' + p.cita + '» (' + p.fuente.etiqueta + '), corresponde valorar su sustento en el expediente.'];
    if (p.contraste) frases.push('Para el cotejo, ' + p.contraste.etiqueta + ' consigna «' + p.contraste.cita + '».');
    if (p.pregunta) frases.push("Pendiente de verificar: " + p.pregunta);
    return frases.join(" ");
  }).join("\n\n");
  return { resumen, analisis };
}
