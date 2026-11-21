// Lectura de expedientes YA FIRMADOS que se suben en lote.
//
// El comando escanea los expedientes terminados y sube los PDF de golpe. Un
// archivo puede traer un solo expediente o varios seguidos, y cada expediente
// ocupa varias páginas (imputación, notificaciones, acta y orden de sanción).
//
// Aquí vive la parte que se puede probar sin red: partir el documento por
// expedientes, sacar sus datos del texto y decidir a qué falta pertenece cada
// uno. La IA se usa después, y solo para lo que estas reglas no logren leer.

const limpiar = (texto = "") => texto.replace(/\s+/g, " ").trim();

/** Una página que abre expediente: la Hoja de Trámite del SIGE. */
export function esPaginaDeHojaDeTramite(texto = "") {
  const t = limpiar(texto);
  return /Hoja\s+de\s+Tr[aá]mite/i.test(t) && /Nro\s*Hoja\s*de\s*Tr[aá]mite/i.test(t);
}

/**
 * Una página que abre expediente. Hay dos formas reales:
 *  - el fajo que llega por mesa de partes, que empieza por la Hoja de Trámite;
 *  - el expediente suelto, que empieza directamente por el inicio de imputación.
 *
 * La hoja de "Notificación y entrega de acto administrativo" también menciona
 * "1.- Inicio de imputación de infracción leve", porque es una de sus diecisiete
 * casillas. Por eso no basta el título: se exige además el cuerpo del documento
 * y se descarta expresamente la hoja de notificación.
 */
export function esPaginaDeInicioDeExpediente(texto = "") {
  if (esPaginaDeHojaDeTramite(texto)) return true;
  const t = limpiar(texto);
  if (/NOTIFICACI[ÓO]N\s+Y\s+ENTREGA\s+DE\s+ACTO\s+ADMINISTRATIVO/i.test(t)) return false;
  return /INICIO\s+DE\s+IMPUTACI[ÓO]N\s+DE\s+INFRACCI[ÓO]N\s+LEVE/i.test(t)
    && /DESCRIPCI[ÓO]N\s+DEL\s+HECHO/i.test(t);
}

/**
 * Agrupa las páginas en expedientes. Devuelve [{ desde, hasta, texto }] con los
 * números de página en base 1, ambos incluidos, tal como los necesita el recorte.
 *
 * Si el fajo no empieza por una página de apertura (por ejemplo, alguien escaneó
 * primero una carátula), esas páginas iniciales se quedan con el primer
 * expediente en vez de perderse.
 */
export function separarExpedientes(textosPorPagina = []) {
  const inicios = [];
  textosPorPagina.forEach((texto, i) => {
    if (esPaginaDeInicioDeExpediente(texto)) inicios.push(i);
  });
  if (!textosPorPagina.length) return [];
  if (!inicios.length) {
    return [{ desde: 1, hasta: textosPorPagina.length, texto: textosPorPagina.join("\n") }];
  }
  return inicios.map((inicio, i) => {
    // Lo que venga antes de la primera apertura (una carátula, una hoja suelta)
    // se queda con el primer expediente en vez de perderse o formar uno propio
    // que no existe.
    const desde = i === 0 ? 0 : inicio;
    const fin = i + 1 < inicios.length ? inicios[i + 1] - 1 : textosPorPagina.length - 1;
    return {
      desde: desde + 1,
      hasta: fin + 1,
      texto: textosPorPagina.slice(desde, fin + 1).join("\n"),
    };
  });
}

/** Número de Hoja de Trámite del SIGE (11 dígitos en los documentos reales). */
export function numeroHojaTramite(texto = "") {
  const m = limpiar(texto).match(/Nro\s*Hoja\s*de\s*Tr[aá]mite\s*[:\-]?\s*(\d{6,})/i);
  return m ? m[1] : null;
}

/** Número del oficio que remite la sanción. */
export function numeroOficio(texto = "") {
  const t = limpiar(texto);
  const enHoja = t.match(/Nro\s*de\s*documento\s*[:\-]?\s*([0-9]+-[0-9]{4}-[A-ZÁÉÍÓÚÑ0-9/.\-]+)/i);
  if (enHoja) return enHoja[1].replace(/[.,;]$/, "");
  const enOficio = t.match(/OFICIO\s*N[°º]?\s*([0-9]+-[0-9]{4}-[A-ZÁÉÍÓÚÑ0-9/."\-]+)/i);
  return enOficio ? enOficio[1].replace(/[.,;]$/, "") : null;
}

/**
 * Número de la Nota Informativa de la falta: es la llave para encontrar el caso.
 * La orden de sanción puede citar dos (la de la falta y la del reporte posterior);
 * se devuelven todas las encontradas, en el orden en que aparecen.
 *
 * En los documentos reales el número va pegado a la unidad que la emitió
 * ("N° 202601329345-COMOPPOL-PNP/DIRNOS/..."), así que solo se toman los dígitos.
 */
export function numerosDeNotaInformativa(texto = "") {
  const t = limpiar(texto);
  const encontrados = [];
  const re = /NOTA\s+INFORMATIVA\s*N[°º]?\s*(\d{8,})/gi;
  let m;
  while ((m = re.exec(t)) !== null) {
    if (!encontrados.includes(m[1])) encontrados.push(m[1]);
  }
  return encontrados;
}

/**
 * CIP del investigado: la llave más confiable después del número de nota, porque
 * es única por efectivo y va impresa (no manuscrita) en la orden de sanción y en
 * el acta.
 *
 * Cuidado: en la misma página aparecen los CIP del superior y del testigo. Solo
 * se aceptan los que van pegados al investigado o al sancionado.
 */
export function cipDelInvestigado(texto = "") {
  const t = limpiar(texto);
  const patrones = [
    // "Se resuelve SANCIONAR al S3 PNP Kevin Arturo CHAVEZ MORI, CIP N° 30445577"
    /SANCIONAR\s+al\s+[\s\S]{0,120}?\bCIP\s*N?[°º]?\s*(\d{6,9})/i,
    // "el PRESUNTO INFRACTOR S3 PNP ... identificado con CIP N°30445577"
    /PRESUNTO\s+INFRACTOR\s+[\s\S]{0,120}?\bCIP\s*N?[°º]?\s*(\d{6,9})/i,
    // "GRADO Y NOMBRE DEL INVESTIGADO : ... CIP N° ..."
    /INVESTIGADO\s*[:\-][\s\S]{0,120}?\bCIP\s*N?[°º]?\s*(\d{6,9})/i,
  ];
  for (const re of patrones) {
    const m = t.match(re);
    if (m) return m[1];
  }
  return null;
}

/** DNI del investigado, cuando el acta lo consigna. Sirve de comprobación. */
export function dniDelInvestigado(texto = "") {
  const t = limpiar(texto);
  const m = t.match(/PRESUNTO\s+INFRACTOR\s+[\s\S]{0,160}?\bDNI\s*N?[°º]?\s*(\d{8})/i);
  return m ? m[1] : null;
}

/** Código del Anexo I (L1 a L117). */
export function codigoInfraccion(texto = "") {
  const t = limpiar(texto);
  // Los documentos reales lo escriben de las tres formas: L21, L-21 y L 21.
  const normalizar = (codigo) => codigo.replace(/[\s-]/g, "").toUpperCase();
  const explicito = t.match(/C[ÓO]DIGO\s+DE\s+LA\s+INFRACCI[ÓO]N\s*[:\-]?\s*\(?\s*(L\s*-?\s*\d{1,3})/i);
  if (explicito) return normalizar(explicito[1]);
  // "por la comisión de la infracción leve código L-24"
  const enDecision = t.match(/infracci[oó]n\s+leve\s+c[óo]digo\s*[:\-]?\s*(L\s*-?\s*\d{1,3})/i);
  if (enDecision) return normalizar(enDecision[1]);
  // "Por FALTA CON LA DISCIPLINA POLICIAL L-21", como titula la sección III de
  // la orden nueva. Segunda fuente por si el reconocimiento óptico estropea la
  // línea de la decisión.
  const enTitulo = t.match(/FALTA\s+CON\s+LA\s+DISCIPLINA\s+POLICIAL\s*[:\-]?\s*(L\s*-?\s*\d{1,3})/i);
  if (enTitulo) return normalizar(enTitulo[1]);
  const entreParentesis = t.match(/infracci[oó]n\s+leve\s*\(\s*(L\s*-?\s*\d{1,3})\s*\)/i);
  return entreParentesis ? normalizar(entreParentesis[1]) : null;
}

const NUMEROS_EN_LETRA = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7,
  ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
};

const CON_PARENTESIS = /([A-Za-zÁÉÍÓÚÑáéíóúñ]+)\s*\(\s*(\d{1,3})\s*\)\s*D[ÍI]AS?\s+(?:DE\s+SANCI[ÓO]N\s+)?(SIMPLES?|DE\s+RIGOR|RIGOR)/i;
const SOLO_NUMERO = /(\d{1,3})\s*D[ÍI]AS?\s+(?:DE\s+SANCI[ÓO]N\s+)?(SIMPLES?|DE\s+RIGOR|RIGOR)/i;
const EN_LETRA = /\b(un|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince)\s+d[íi]as?\s+(?:de\s+sanci[óo]n\s+)?(simples?|de\s+rigor|rigor)/i;

/**
 * El rango del Anexo I, que NO es lo que se impuso. Aparece en la imputación y
 * otra vez dentro de la propia orden de sanción, en "Descripción de la
 * infracción". Se ha visto de dos formas: "De 8 a 10 días de Sanción Simple" y
 * "De AMONESTACION a CUATRO (04) días de Sanción Simple".
 */
const RANGO_DEL_ANEXO = /\bDe\s+(?:AMONESTACI[ÓO]N|\d{1,3}|[A-Za-zÁÉÍÓÚÑáéíóúñ]+\s*\(\s*\d{1,3}\s*\))\s+a\s+(?:\d{1,3}|[A-Za-zÁÉÍÓÚÑáéíóúñ]+\s*\(\s*\d{1,3}\s*\))\s*d[íi]as?/i;

function interpretarSancion(t) {
  if (/AMONESTACI[ÓO]N/i.test(t)) return { texto: "AMONESTACION", dias: 0, tipo: "amonestacion" };
  const conParentesis = t.match(CON_PARENTESIS);
  if (conParentesis) {
    return {
      texto: limpiar(conParentesis[0]).toUpperCase(),
      dias: Number(conParentesis[2]),
      tipo: /RIGOR/i.test(conParentesis[3]) ? "rigor" : "simple",
    };
  }
  const soloNumero = t.match(SOLO_NUMERO);
  if (soloNumero) {
    return {
      texto: limpiar(soloNumero[0]).toUpperCase(),
      dias: Number(soloNumero[1]),
      tipo: /RIGOR/i.test(soloNumero[2]) ? "rigor" : "simple",
    };
  }
  const enLetra = t.match(EN_LETRA);
  if (enLetra) {
    return {
      texto: limpiar(enLetra[0]).toUpperCase(),
      dias: NUMEROS_EN_LETRA[enLetra[1].toLowerCase()] ?? null,
      tipo: /rigor/i.test(enLetra[2]) ? "rigor" : "simple",
    };
  }
  return { texto: null, dias: null, tipo: null };
}

/**
 * Sanción realmente impuesta. Este es el dato que más fácil se lee mal, porque
 * el mismo expediente trae hasta tres cifras de días y solo una vale:
 *
 *  - el RANGO del Anexo I ("De 8 a 10 días de Sanción Simple"), que sale dos
 *    veces: en la imputación y dentro de la orden;
 *  - el plazo para impugnar ("tres (3) días hábiles"), que no es sanción;
 *  - la DECISIÓN, que es la única que dice lo impuesto.
 *
 * Por eso se busca en orden: la decisión de la orden nueva, el campo "SANCIÓN
 * IMPUESTA" de la orden antigua y, si no hay ninguna, se declara no resuelto en
 * vez de adivinar. Registrar 10 días donde se impusieron 8 es un error grave.
 */
export function sancionImpuesta(texto = "") {
  const completo = limpiar(texto);
  // Orden nueva: "V. DECISIÓN: Se resuelve SANCIONAR al S3 PNP ..., CIP N° ...,
  // perteneciente a la comisaría PNP Ventanilla, con ocho (08) días de Sanción
  // Simple por la comisión de la infracción leve código L-24".
  // Se lee el tramo que sigue a "SANCIONAR al" en vez de buscar el primer "con",
  // porque en otros documentos ese "con" es el de "identificado con CIP N°...".
  const marca = completo.match(/\bSANCIONAR\s+al\b/i);
  if (marca) {
    // La decisión termina en "por la comisión de la Infracción Leve Código...".
    // Cortar ahí evita que, si las páginas vienen desordenadas, se cuele el
    // rango de la imputación que pudiera seguir.
    let region = completo.slice(marca.index, marca.index + 320);
    const cierre = region.match(/\s+por\s+la\s+comisi[óo]n/i);
    if (cierre) region = region.slice(0, cierre.index);
    const leida = interpretarSancion(region);
    if (leida.tipo) return leida;
  }
  // Orden antigua: campo "SANCIÓN IMPUESTA : AMONESTACION".
  const campo = completo.match(
    /SANCI[ÓO]N\s+IMPUESTA\s*[:\-]?\s*([^:]{3,80}?)(?:\s+PLAZO|\s+NOTIFICACI[ÓO]N|\s+C[ÓO]DIGO|$)/i);
  if (campo) return interpretarSancion(limpiar(campo[1]));
  // Sin decisión ni campo: lo que quede son rangos y plazos, no una sanción.
  if (RANGO_DEL_ANEXO.test(completo)) return { texto: null, dias: null, tipo: null };
  return interpretarSancion(completo);
}

const GRADOS = "S1|S2|S3|SB|SS|ST1|ST2|ST3|SOB|SOS|TNTE|CAP|MAY|CMDTE|CRNL|ALF|SO|CAPITAN|MAYOR|COMANDANTE|CORONEL|TENIENTE|ALFEREZ";

/**
 * Grado y nombre del investigado.
 *
 * ATENCIÓN: en un mismo expediente real el nombre aparece en los dos órdenes.
 * La imputación decía "S3 PNP CHAVEZ MORI, Kevin Arturo" y el acta y la
 * orden, del mismo caso y la misma persona, "S3 PNP Kevin Arturo CHAVEZ
 * JHON". Por eso se devuelve además `completo` con todas las palabras del
 * nombre, y el cruce compara palabras sueltas sin depender del orden. La
 * separación en apellidos y nombres es una suposición para mostrar, no para
 * decidir.
 */
export function infractor(texto = "") {
  const t = limpiar(texto);
  const etiqueta = new RegExp(
    // El corte "\\s[IVX]{1,4}\\." evita que el nombre se trague el "I." con el que
    // empieza la sección siguiente de la orden de sanción.
    `GRADO\\s+Y\\s+NOMBRE\\s+DEL\\s+(?:INFRACTOR|INVESTIGADO)\\s*[:\\-]?\\s*(${GRADOS})\\s*\\.?\\s*PNP\\s+([^:]{4,80}?)\\s*(?:\\s[IVX]{1,4}\\.|\\.|\\bUNIDAD\\b|\\bCIP\\b|\\bDNI\\b|$)`, "i");
  const enOrden = t.match(etiqueta);
  if (enOrden) return normalizarPersona(enOrden[1], enOrden[2]);
  const enDecision = t.match(
    new RegExp(`SANCIONAR\\s+al\\s+(${GRADOS})\\s*\\.?\\s*PNP\\s+([^,]{4,80}?)\\s*(?:,|\\bCIP\\b|$)`, "i"));
  if (enDecision) return normalizarPersona(enDecision[1], enDecision[2]);
  const enActa = t.match(
    new RegExp(`PRESUNTO\\s+INFRACTOR\\s+(${GRADOS})\\s*\\.?\\s*PNP\\s+([^,]{4,80}?)\\s*(?:,|\\bidentificado\\b|$)`, "i"));
  if (enActa) return normalizarPersona(enActa[1], enActa[2]);
  const enAsunto = t.match(
    new RegExp(`\\bAL\\s+(${GRADOS})\\s*\\.?\\s*PNP\\s+([A-ZÁÉÍÓÚÑ][^.]{3,80}?)\\s*(?:\\.|$)`, "i"));
  if (enAsunto) return normalizarPersona(enAsunto[1], enAsunto[2]);
  return null;
}

/**
 * Separa el nombre en apellidos y nombres. Con coma, lo de delante se toma como
 * apellidos; sin coma, los dos primeros. Es solo para mostrar: el orden no es
 * fiable ni siquiera dentro del mismo expediente.
 */
function normalizarPersona(grado, resto) {
  const completo = limpiar(resto).replace(/[.,;]$/, "");
  const conComa = completo.split(",");
  if (conComa.length >= 2) {
    return {
      grado: grado.toUpperCase(),
      apellidos: limpiar(conComa[0]).toUpperCase(),
      nombres: limpiar(conComa.slice(1).join(" ")),
      completo: limpiar(completo.replace(/,/g, " ")),
    };
  }
  const partes = completo.split(" ").filter(Boolean);
  return {
    grado: grado.toUpperCase(),
    apellidos: partes.slice(0, 2).join(" ").toUpperCase(),
    nombres: partes.slice(2).join(" "),
    completo: limpiar(completo),
  };
}

/**
 * Superior que impone la sanción. No sirve para encontrar el caso, pero sí para
 * comprobar que el expediente devuelto es el que la web generó y para dejar
 * constancia de quién firmó.
 */
export function superiorQueSanciona(texto = "") {
  const t = limpiar(texto);
  const enImputacion = t.match(
    new RegExp(`GRADO\\s+Y\\s+NOMBRE\\s+DEL\\s+SUPERIOR\\s*[:\\-]?\\s*(${GRADOS})\\s*\\.?\\s*PNP\\s+([^:]{4,80}?)\\s*(?:\\s[IVX]{1,4}\\.|\\.|\\bUNIDAD\\b|\\bCIP\\b|$)`, "i"));
  if (enImputacion) return normalizarPersona(enImputacion[1], enImputacion[2]);
  const enActa = t.match(
    new RegExp(`SUPERIOR\\s+QUE\\s+SANCIONA\\s+(${GRADOS})\\s*\\.?\\s*PNP\\s+([^,]{4,80}?)\\s*(?:,|\\bidentificado\\b|$)`, "i"));
  if (enActa) return normalizarPersona(enActa[1], enActa[2]);
  return null;
}

const MESES = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, setiembre: 9, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

/**
 * Fecha de la orden de sanción, en ISO. Los documentos la escriben al pie como
 * "Ventanilla, 21 de agosto del 2026". Se usa para ordenar y para avisar si el
 * expediente es de otro año que el caso.
 */
export function fechaDelDocumento(texto = "") {
  const t = limpiar(texto);
  const m = t.match(/(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+del?\s+(\d{4})/i);
  if (!m) return null;
  const mes = MESES[m[2].toLowerCase()];
  if (!mes) return null;
  return `${m[3]}-${String(mes).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`;
}

/**
 * Fecha en que se notificó la ORDEN DE SANCIÓN al investigado. No es un dato
 * más: de ella arrancan los tres días hábiles para apelar, y es la que deja el
 * caso por concluido.
 *
 * Se busca primero en la hoja de notificación, en la fila de la casilla 2
 * ("2.- Orden de Sanción  X  S/N  19/08/2026"). Si no se deja leer, se toma la
 * fecha más tardía del expediente, que es la del último acto. En los dos casos
 * es una PROPUESTA: la fecha se confirma a la vista antes de guardar, porque
 * una fecha legal no se adivina en silencio.
 */
export function fechaDeNotificacionDeLaOrden(texto = "") {
  const t = limpiar(texto);
  // El documento numera las casillas como "2.-", con punto Y guion.
  const enCasilla = t.match(/2\s*[.\-]{1,2}\s*Orden\s+de\s+Sanci[óo]n[\s\S]{0,60}?(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})/i);
  if (enCasilla) {
    return `${enCasilla[3]}-${String(Number(enCasilla[2])).padStart(2, "0")}-${String(Number(enCasilla[1])).padStart(2, "0")}`;
  }
  const todas = [];
  const enLetra = /(\d{1,2})\s+de\s+([a-záéíóúñ]+)\s+del?\s+(\d{4})/gi;
  let m;
  while ((m = enLetra.exec(t)) !== null) {
    const mes = MESES[m[2].toLowerCase()];
    if (mes) todas.push(`${m[3]}-${String(mes).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`);
  }
  const enCifras = /\b(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})\b/g;
  while ((m = enCifras.exec(t)) !== null) {
    todas.push(`${m[3]}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[1])).padStart(2, "0")}`);
  }
  return todas.length ? todas.sort().at(-1) : null;
}

/**
 * Un expediente terminado lleva: la imputación y su notificación, el descargo o
 * el acta de no recepción, y la orden de sanción con su notificación —o, si no
 * hubo sanción, la resolución de archivo con la suya.
 *
 * Se reconoce qué piezas trae para poder avisar en la revisión cuando falta
 * alguna, en vez de archivar en silencio un expediente a medio hacer.
 */
export function piezasDelExpediente(texto = "") {
  const t = limpiar(texto);
  return {
    imputacion: /NOTIFICACI[ÓO]N\s+DE\s+IMPUTACI[ÓO]N|IMPUTACI[ÓO]N\s+DE\s+INFRACCI[ÓO]N\s+LEVE/i.test(t),
    acta_no_descargo: /ACTA\s+DE\s+NO\s+RECEPCI[ÓO]N\s+DE\s+DESCARGOS?/i.test(t),
    descargo: /ACTA\s+DE\s+RECEPCI[ÓO]N\s+DE\s+DESCARGOS?|PRESENT[ÓO]\s+SU\s+DESCARGO|ESCRITO\s+DE\s+DESCARGO/i.test(t),
    orden_sancion: /ORDEN\s+DE\s+SANCI[ÓO]N/i.test(t),
    archivo: /RESOLUCI[ÓO]N\s+DE\s+ARCHIVO|SE\s+RESUELVE\s*:?\s*ARCHIVAR|ARCHIVO\s+DEL\s+PROCEDIMIENTO/i.test(t),
    // Dos formas reales: el recuadro al pie del propio documento y la hoja
    // aparte de "Notificación y entrega de acto administrativo", donde se marca
    // con una X cuál de los diecisiete actos se está notificando.
    notificacion_firmada: /NOTIFICACI[ÓO]N\s+DEL\s+INVESTIGADO/i.test(t)
      || (/NOTIFICACI[ÓO]N\s+Y\s+ENTREGA\s+DE\s+ACTO\s+ADMINISTRATIVO/i.test(t)
          && /CONSTANCIA\s+DE\s+RECEPCI[ÓO]N/i.test(t)),
  };
}

/**
 * En qué terminó: con sanción impuesta o archivado. "incompleto" significa que
 * el documento no trae ninguna de las dos cosas y no debe darse por terminado.
 */
export function resultadoDelExpediente(texto = "") {
  const piezas = piezasDelExpediente(texto);
  if (piezas.archivo && !piezas.orden_sancion) return "archivo";
  if (piezas.orden_sancion) return "sancion";
  return "incompleto";
}

/** Piezas que deberían estar y no aparecen; se muestran en la revisión. */
export function piezasQueFaltan(texto = "") {
  const piezas = piezasDelExpediente(texto);
  const faltan = [];
  if (!piezas.imputacion) faltan.push("la notificación de imputación");
  if (!piezas.acta_no_descargo && !piezas.descargo) faltan.push("el descargo o el acta de no recepción");
  if (!piezas.orden_sancion && !piezas.archivo) faltan.push("la orden de sanción o la resolución de archivo");
  if (!piezas.notificacion_firmada) faltan.push("la notificación firmada por el investigado");
  return faltan;
}

/** Todo lo que se puede leer de un expediente sin preguntar a la IA. */
export function leerExpediente(texto = "") {
  const notas = numerosDeNotaInformativa(texto);
  const sancion = sancionImpuesta(texto);
  return {
    resultado: resultadoDelExpediente(texto),
    piezas: piezasDelExpediente(texto),
    faltan: piezasQueFaltan(texto),
    numero_ht: numeroHojaTramite(texto),
    numero_oficio: numeroOficio(texto),
    numeros_nota: notas,
    numero_nota_falta: notas[0] || null,
    cip_investigado: cipDelInvestigado(texto),
    dni_investigado: dniDelInvestigado(texto),
    codigo_infraccion: codigoInfraccion(texto),
    sancion_texto: sancion.texto,
    dias_sancion: sancion.dias,
    tipo_sancion: sancion.tipo,
    infractor: infractor(texto),
    superior: superiorQueSanciona(texto),
    fecha_documento: fechaDelDocumento(texto),
    fecha_notificacion_orden: fechaDeNotificacionDeLaOrden(texto),
  };
}

const sinTildes = (texto = "") => texto.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().trim();

/** Palabras del nombre, sin tildes ni partículas, para comparar sin depender del orden. */
function palabrasDeNombre(texto = "") {
  return sinTildes(texto)
    .replace(/[^A-ZÑ\s]/g, " ")
    .split(/\s+/)
    .filter((p) => p.length > 1 && !["DE", "DEL", "LA", "LAS", "LOS", "PNP"].includes(p));
}

/** Verdadero si un conjunto de palabras contiene al otro; el orden no importa. */
function mismoNombre(a = [], b = []) {
  if (!a.length || !b.length) return false;
  const [corto, largo] = a.length <= b.length ? [a, b] : [b, a];
  return corto.every((p) => largo.includes(p));
}

/**
 * Busca a qué falta registrada pertenece el expediente, en el orden en que los
 * datos son de fiar:
 *
 *  1. el número de Nota Informativa, que identifica el caso, no a la persona;
 *  2. el CIP impreso en la orden, que identifica al efectivo sin ambigüedad y se
 *     cruza con la lista de efectivos para llegar a sus casos;
 *  3. el nombre, que es el más débil: en los documentos reales el orden de
 *     apellidos y nombres cambia incluso dentro del mismo expediente.
 *
 * Cuando una persona tiene varios casos abiertos se afina por código de
 * infracción. Si aun así queda más de uno, se devuelve "varios" para que lo
 * resuelva quien revisa: es preferible preguntar a archivar en el caso errado.
 *
 * Devuelve { nota, motivo } o null. El motivo se muestra en la revisión para que
 * quien confirma sepa por qué se propuso ese caso.
 */
export function buscarFaltaDelExpediente(datos, notas = [], efectivos = []) {
  if (!datos) return null;

  for (const numero of datos.numeros_nota || []) {
    const porNota = notas.find((n) => String(n.numero_nota_falta || "").trim() === numero);
    if (porNota) return { nota: porNota, motivo: "numero_nota", numero };
  }

  const afinar = (candidatas, motivo) => {
    if (candidatas.length === 1) return { nota: candidatas[0], motivo };
    if (!candidatas.length) return null;
    const porCodigo = datos.codigo_infraccion
      ? candidatas.filter((n) => sinTildes(n.codigo_infraccion).replace(/[\s-]/g, "") === datos.codigo_infraccion)
      : [];
    if (porCodigo.length === 1) return { nota: porCodigo[0], motivo: `${motivo}_y_codigo` };
    return { nota: null, motivo: "varios", candidatas: porCodigo.length ? porCodigo : candidatas };
  };

  if (datos.cip_investigado) {
    const efectivo = efectivos.find((e) => String(e.cip || "").trim() === datos.cip_investigado);
    if (efectivo) {
      const suyas = palabrasDeNombre(efectivo.apellidos_nombres);
      const candidatas = notas.filter((n) => mismoNombre(suyas, palabrasDeNombre(`${n.apellidos} ${n.nombres}`)));
      const hallada = afinar(candidatas, "cip");
      if (hallada) return hallada;
    }
  }

  const persona = datos.infractor;
  if (!persona) return null;
  const delDocumento = palabrasDeNombre(persona.completo || `${persona.apellidos} ${persona.nombres}`);
  if (!delDocumento.length) return null;
  const candidatas = notas.filter((n) => mismoNombre(delDocumento, palabrasDeNombre(`${n.apellidos} ${n.nombres}`)));
  return afinar(candidatas, "nombre");
}
