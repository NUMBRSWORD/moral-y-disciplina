// Generación del "Informe Administrativo" (Informe Pormenorizado) que remite
// al órgano disciplinario competente los casos de ausencia continua que
// escalan a infracción GRAVE (G39: 2 días consecutivos; MG32: 3 días o más).
// Este módulo es el único punto de la app que toca infracciones que NO son
// Leves — la app solo tramita leves (L21/L24) hasta la Orden de Sanción; este
// informe no sanciona nada, solo documenta y REMITE el caso a otra instancia.
//
// Usa docxtemplater sobre la plantilla plantillas/plantilla_informe_administrativo.docx
// (copia con placeholders {tag} del formato real aprobado por el usuario —
// ver plantillas/plantilla_informe_administrativo_ejemplo.docx).

import { cargarDocxDeps } from "./docxDeps.js";
import { conPnp, fechaLarga, buscarOficialConstato } from "./imputacion.js";
import { nombreCompletoVisible, addDays } from "./utils.js";

const MESES_CORTO = [
  "ENE", "FEB", "MAR", "ABR", "MAY", "JUN",
  "JUL", "AGO", "SET", "OCT", "NOV", "DIC",
];

// Texto legal exacto (Anexo II de la tabla de infracciones y sanciones graves
// incorporada por el Decreto Supremo N° 016-2025-IN) para cada código que
// puede llegar a este informe. G39 está confirmado contra un caso real ya
// aprobado por el usuario. MG32 queda en null a propósito: no se pudo
// verificar su texto exacto (descripción y rango de sanción) — inventarlo
// sería poner una cita legal falsa en un documento que se remite a otra
// instancia disciplinaria. Antes de habilitarlo, cargar aquí el texto exacto
// verificado contra el Anexo II.
export const INFRACCIONES_GRAVES = {
  G39: {
    descripcion: "Faltar dos (2) días consecutivos a su unidad o no presentarse por igual plazo al término de sus vacaciones, permisos, comisiones, licencias o descansos médicos.",
    sancion: "De diez (10) a quince (15) días de Sanción de Rigor.",
  },
  MG32: null,
};

function fechaCorta(fechaISO) {
  if (!fechaISO) return "";
  const [y, m, d] = fechaISO.split("-");
  return `${d}/${m}/${y}`;
}

function fechaCompacta(fechaISO) {
  if (!fechaISO) return "";
  const [y, m, d] = fechaISO.split("-").map(Number);
  return `${String(d).padStart(2, "0")}${MESES_CORTO[m - 1]}${y}`;
}

function horaCorta(hora) {
  return (hora || "").slice(0, 5);
}

// "G39" -> "G 39", "MG32" -> "MG 32": así se cita el código en la prosa,
// aunque en `notas_informativas.codigo_infraccion` se guarde sin espacio.
export function formatearCodigoEspaciado(codigo) {
  const m = String(codigo || "").match(/^([A-Z]+)(\d+)$/);
  return m ? `${m[1]} ${m[2]}` : String(codigo || "");
}

// Lista de fechas ISO (inclusive) entre fecha_falta y fecha_reincorporacion.
export function diasDeAusencia(fechaFalta, fechaReincorporacion) {
  const dias = [];
  let cursor = fechaFalta;
  let guard = 0;
  while (cursor <= fechaReincorporacion && guard < 60) {
    dias.push(cursor);
    if (cursor === fechaReincorporacion) break;
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return dias;
}

// Determina si la nota tiene todo lo necesario para generar el informe:
// código GRAVE con texto legal ya cargado (ver INFRACCIONES_GRAVES), la
// ausencia completa (falta + reincorporación) y el investigado ubicable.
export function puedeGenerarInformeAdministrativo(nota, efectivos) {
  const codigo = String(nota.codigo_infraccion || "").toUpperCase().replace(/\s+/g, "");
  if (!INFRACCIONES_GRAVES[codigo]) return false;
  if (!nota.fecha_falta || !nota.hora_falta || !nota.numero_nota_falta) return false;
  if (!nota.fecha_reincorporacion || !nota.hora_reincorporacion || !nota.numero_nota_reincorporacion) return false;
  if (!nota.investigado_cip && !nota.apellidos) return false;
  return true;
}

// Arma el objeto {tag: valor} para docxtemplater.
//   firmantes: { conforme: {grado, nombre, cargo}, instructor: {grado, nombre} }
//   rolesServicio: array de filas de la tabla roles_servicio (para citar, si
//     existe, el rol guardado de cada día intermedio de la ausencia).
export function construirDatosInformeAdministrativo(nota, efectivos, rolesServicio, firmantes) {
  const codigo = String(nota.codigo_infraccion || "").toUpperCase().replace(/\s+/g, "");
  const infraccion = INFRACCIONES_GRAVES[codigo];
  if (!infraccion) {
    throw new Error(`No hay texto legal verificado para el código ${codigo || "(vacío)"} en lib/informeAdministrativo.js. Por ahora solo está disponible G39.`);
  }
  if (!nota.fecha_falta || !nota.hora_falta || !nota.numero_nota_falta) {
    throw new Error("Falta la fecha, hora y N.º de nota de la falta original.");
  }
  if (!nota.fecha_reincorporacion || !nota.hora_reincorporacion || !nota.numero_nota_reincorporacion) {
    throw new Error("Falta registrar la reincorporación (fecha, hora y N.º de nota) antes de generar el informe.");
  }
  if (!firmantes?.conforme?.nombre?.trim() || !firmantes?.instructor?.nombre?.trim()) {
    throw new Error("Complete el nombre de ambos firmantes (ES CONFORME e instructor) antes de generar el informe.");
  }

  const investigadoCompleto = `${conPnp(nota.grado)} ${nombreCompletoVisible(nota.apellidos, nota.nombres)}`.replace(/\s+/g, " ").trim();
  const horaFalta = horaCorta(nota.hora_falta);
  const horaReinc = horaCorta(nota.hora_reincorporacion);
  const fechaFaltaCompacta = fechaCompacta(nota.fecha_falta);
  const fechaReincCompacta = fechaCompacta(nota.fecha_reincorporacion);
  const codigoEspaciado = formatearCodigoEspaciado(codigo);

  const dias = diasDeAusencia(nota.fecha_falta, nota.fecha_reincorporacion);
  const diasIntermedios = dias.slice(1, -1);
  const rangoDiasCorto = diasIntermedios.length || dias.length > 1
    ? `${dias.slice(0, -1).map(fechaCompacta).join(", ")}`
    : fechaFaltaCompacta;
  const cantidadDiasCompletos = dias.length - 1;

  // Sección II — un bloque "A./B./C..." por día, unido con doble salto de
  // línea (docxtemplater con linebreaks:true los convierte en saltos reales).
  const letras = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const bloquesDias = dias.map((fecha, i) => {
    const letra = letras[i] || `(${i + 1})`;
    const esPrimero = i === 0;
    const esUltimo = i === dias.length - 1;
    if (esPrimero) {
      return `${letra}. Día ${fechaCompacta(fecha)} (primer día de inasistencia): Al pasarse lista al personal policial de servicio a las ${horaFalta} horas${nota.oficial_constato ? ` por parte del ${nota.oficial_constato}` : ""}, se constató la ausencia física del ${investigadoCompleto}, y se formuló la Nota Informativa N° ${nota.numero_nota_falta}-COMOPPOL-PNP/DIRNOS/REGPOL CALLAO/DIVOPUS VENTANILLA/COM VENTANILLA A.`;
    }
    if (esUltimo) {
      return `${letra}. Día ${fechaCompacta(fecha)} (reincorporación): A las ${horaReinc} horas, el ${investigadoCompleto} se reincorporó físicamente a la Comisaría PNP Ventanilla. El hecho fue comunicado mediante Nota Informativa N° ${nota.numero_nota_reincorporacion}-COMOPPOL-PNP/DIRNOS/REGPOL CALLAO/DIVOPUS VENTANILLA/COM VENTANILLA A.`;
    }
    // El seguimiento diario (Continúan faltos) trae el N.º de nota REAL de ese
    // día — más fuerte como evidencia que el rol de servicio — así que se cita
    // primero si está disponible; el rol de servicio queda como respaldo, y si
    // no hay ninguno de los dos, se avisa en vez de inventar un documento.
    const seguimiento = (nota.seguimiento_faltas || []).find((s) => s.fecha === fecha);
    if (seguimiento) {
      return `${letra}. Día ${fechaCompacta(fecha)} (día ${i + 1} de inasistencia): Al pasarse revista${seguimiento.oficial_constato ? ` por parte del ${seguimiento.oficial_constato}` : ""}, se constató que el administrado continuaba falto al servicio, y se formuló la Nota Informativa N° ${seguimiento.numero_nota}-COMOPPOL-PNP/DIRNOS/REGPOL CALLAO/DIVOPUS VENTANILLA/COM VENTANILLA A.`;
    }
    const rol = (rolesServicio || []).find((r) => r.fecha === fecha);
    const detalleRol = rol
      ? `conforme al rol de servicio del ${fechaCompacta(fecha)}, que lo mantuvo consignado en el rubro "PERSONAL PNP FALTOS AL SERVICIO"`
      : `sin que se ubique en el sistema una nota de seguimiento ni un rol de servicio guardado para esa fecha que lo acredite — verificar manualmente antes de remitir`;
    return `${letra}. Día ${fechaCompacta(fecha)} (día ${i + 1} de inasistencia): El administrado continuó sin presentarse a la Comisaría PNP Ventanilla, ${detalleRol}.`;
  });

  const diasSinEvidencia = diasIntermedios.filter((fecha) =>
    !(nota.seguimiento_faltas || []).some((s) => s.fecha === fecha) && !(rolesServicio || []).some((r) => r.fecha === fecha));

  return {
    asunto_texto: `Remite Informe Pormenorizado sobre presuntos indicios de conducta funcional indebida (infracción GRAVE ${codigoEspaciado}) atribuible al ${investigadoCompleto}, quien permaneció ausente durante ${cantidadDiasCompletos > 1 ? `los días ${rangoDiasCorto}` : `el día ${fechaFaltaCompacta}`} y se reincorporó a las ${horaReinc} horas del ${fechaReincCompacta}, sin causa justificada acreditada en los actuados.`,
    ref_texto: `Ley N° 30714, Ley que regula el Régimen Disciplinario de la Policía Nacional del Perú; Reglamento aprobado por Decreto Supremo N° 003-2020-IN, modificado por Decreto Supremo N° 016-2025-IN; Notas Informativas N.os ${nota.numero_nota_falta} y ${nota.numero_nota_reincorporacion}.`,
    investigado_completo: investigadoCompleto,
    antecedentes_p2: `Dicho conocimiento se obtuvo mediante el control de la lista de diana del ${fechaFaltaCompacta}, fecha en la que se documentó la ausencia física del administrado. Los hechos fueron comunicados a la superioridad mediante la nota informativa correspondiente.`,
    antecedentes_p3: `Mediante Nota Informativa N° ${nota.numero_nota_reincorporacion} se dejó constancia de que el administrado se reincorporó físicamente a la Comisaría PNP Ventanilla a las ${horaReinc} horas del ${fechaReincCompacta}.`,
    descripcion_dias: bloquesDias.join("\n\n"),
    descripcion_cierre: `Conforme a lo expuesto, la ausencia material del administrado se extendió desde las ${horaFalta} horas del ${fechaFaltaCompacta} hasta las ${horaReinc} horas del ${fechaReincCompacta}. Documentalmente comprende ${cantidadDiasCompletos} día(s) consecutivo(s) completo(s) de inasistencia.`,
    investigado_nombres_completo: nombreCompletoVisible(nota.apellidos, nota.nombres),
    investigado_grado_texto: conPnp(nota.grado),
    servicio_roles_texto: diasSinEvidencia.length
      ? `registrado como falto al servicio; no se ubicó en el sistema nota de seguimiento ni rol guardado de ${diasSinEvidencia.map(fechaCompacta).join(", ")} — verificar antes de remitir`
      : "registrado como falto al servicio en los roles y notas de seguimiento examinados",
    indicios_lista: [
      `• Nota Informativa N° ${nota.numero_nota_falta}, de fecha ${fechaFaltaCompacta}, que acredita la primera inasistencia.`,
      ...diasIntermedios
        .map((fecha) => (nota.seguimiento_faltas || []).find((s) => s.fecha === fecha))
        .filter(Boolean)
        .map((s) => `• Nota Informativa N° ${s.numero_nota}, de fecha ${fechaCompacta(s.fecha)}, que acredita la continuidad de la ausencia.`),
      `• Nota Informativa N° ${nota.numero_nota_reincorporacion}, de fecha ${fechaReincCompacta}, que acredita la reincorporación a las ${horaReinc} horas.`,
      ...dias.map((fecha) => `• Rol de servicio correspondiente al ${fechaCompacta(fecha)}.`),
    ].join("\n"),
    subsuncion_parrafo: `La conducta documentada comprende ${cantidadDiasCompletos} día(s) consecutivo(s) completo(s) de ausencia. Conforme al Anexo II de la tabla de infracciones y sanciones graves incorporada por el Decreto Supremo N° 016-2025-IN, los hechos se subsumen preliminarmente en la infracción GRAVE ${codigoEspaciado}.`,
    subsuncion_lista: `• Código de infracción: ${codigoEspaciado}.\n• Descripción: "${infraccion.descripcion.replace(/\.\s*$/, "")}".\n• Sanción prevista: ${infraccion.sancion}`,
    conclusiones_lista: [
      `1. Se encuentra documentado que el ${investigadoCompleto} no se presentó a la lista de las ${horaFalta} horas del ${fechaFaltaCompacta}.`,
      `2. El administrado se reincorporó físicamente a la Comisaría PNP Ventanilla a las ${horaReinc} horas del ${fechaReincCompacta}, conforme a la Nota Informativa N° ${nota.numero_nota_reincorporacion}.`,
      `3. En los documentos proporcionados no obra informe, descargo, permiso, licencia, descanso médico ni otro elemento que justifique la ausencia; por consiguiente, su causa no se encuentra acreditada documentalmente en el presente expediente.`,
      `4. El periodo documentado presenta correspondencia preliminar con la infracción GRAVE ${codigoEspaciado}: "${infraccion.descripcion.replace(/\.\s*$/, "")}", sancionada con ${infraccion.sancion.replace(/\.\s*$/, "")}. La determinación definitiva corresponde al órgano disciplinario competente.`,
    ].join("\n"),
    recomendaciones_lista: [
      `1. REMITIR el presente informe y los actuados al órgano disciplinario competente para que evalúe el inicio del procedimiento correspondiente por la presunta infracción GRAVE ${codigoEspaciado}.`,
      `2. PONER EN CONOCIMIENTO la reincorporación del ${investigadoCompleto}, ocurrida el ${fechaReincCompacta} a las ${horaReinc} horas, dejando constancia de que dicho acto no justifica automáticamente las inasistencias anteriores.`,
    ].join("\n"),
    anexos_lista: [
      `1. Rol(es) de servicio de la Comisaría PNP Ventanilla correspondientes a los días ${dias.map(fechaCompacta).join(", ")}.`,
      `2. Nota Informativa N° ${nota.numero_nota_falta}, de fecha ${fechaFaltaCompacta}, sobre la inasistencia del ${investigadoCompleto}.`,
      `3. Nota Informativa N° ${nota.numero_nota_reincorporacion}, de fecha ${fechaReincCompacta}, sobre la reincorporación al servicio del ${investigadoCompleto}.`,
    ].join("\n"),
    fecha_larga_cierre: `Ventanilla ${fechaLarga(new Date().toISOString().slice(0, 10))}`,
    conforme_grado: (firmantes.conforme.grado || "").trim(),
    conforme_nombre: firmantes.conforme.nombre.trim(),
    conforme_cargo: (firmantes.conforme.cargo || "").trim(),
    instructor_grado: (firmantes.instructor.grado || "").trim(),
    instructor_nombre: firmantes.instructor.nombre.trim(),
  };
}

export async function renderizarInformeAdministrativoDocx(nota, efectivos, rolesServicio, firmantes) {
  const data = construirDatosInformeAdministrativo(nota, efectivos, rolesServicio, firmantes);
  const { PizZip, Docxtemplater } = await cargarDocxDeps();

  const response = await fetch(new URL("../plantillas/plantilla_informe_administrativo.docx", import.meta.url));
  if (!response.ok) throw new Error("No se pudo cargar la plantilla del Informe Administrativo.");
  const arrayBuffer = await response.arrayBuffer();

  const zip = new PizZip(arrayBuffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: "{", end: "}" },
  });
  doc.render(data);

  return doc.getZip().generate({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

export async function generarInformeAdministrativoDocx(nota, efectivos, rolesServicio, firmantes) {
  const out = await renderizarInformeAdministrativoDocx(nota, efectivos, rolesServicio, firmantes);
  const { saveAs } = await cargarDocxDeps();
  const nombreArchivo = `INFORME ADMINISTRATIVO - ${(nota.grado || "").trim()} ${nombreCompletoVisible(nota.apellidos, nota.nombres)}.docx`.replace(/\s+/g, " ").trim();
  saveAs(out, nombreArchivo);
}
