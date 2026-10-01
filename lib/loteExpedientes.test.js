// Pruebas de la carga en lote de expedientes firmados.
// Los textos imitan la forma de los documentos reales, con personas y números
// inventados: este repositorio es público.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  nombreSeguro,
  nombreDelRecorte,
  prepararLote,
  marcarRepetidos,
  filasGuardables,
  resumenDelLote,
  filaARegistroDeExpediente,
  necesitaAyudaDeIA,
  aplicarLecturaDeIA,
} from "./loteExpedientes.js";

// --- Páginas de ejemplo -----------------------------------------------------

const imputacion = (persona, nota, codigo, rango) => `
INICIO DE IMPUTACION DE INFRACCION LEVE
GRADO Y NOMBRE DEL INVESTIGADO : ${persona}.
UNIDAD/SUB-UNIDAD : DIVOPUS 3-CPNP VENTANILLA.
DESCRIPCIÓN DEL HECHO : Por llegar con retraso a su servicio, dando cuenta a la
superioridad con la NOTA INFORMATIVA N° ${nota}-COMOPPOL-PNP/DIRNOS/REGPOL CALLAO.
DESCRIPCION DE LA INFRACCION
1. Bien jurídico : CONTRA LA DISCIPLINA POLICIAL
2. Código de la infracción : ${codigo} "Llegar con retraso a su unidad"
3. Sanción : ${rango}
GRADO Y NOMBRE DEL SUPERIOR : TNTE. PNP Andres Felipe BEDOYA ROJAS
UNIDAD/SUB-UNIDAD : REGIÓN POLICIAL CALLAO / DIVOPUS 3 / COMISARIA VENTANILLA
Ventanilla, 30 de julio del 2026
`;

const notificacion = (persona, casilla, fecha) => `
NOTIFICACIÓN Y ENTREGA DE ACTO ADMINISTRATIVO
Señor (a) : ${persona}.
Domicilio : Mz. 23 Lte. 13 Urb. Satélite.
1.- Inicio de imputación de infracción leve ${casilla === 1 ? "X S/N " + fecha : ""}
2.- Orden de Sanción ${casilla === 2 ? "X S/N " + fecha : ""}
3.- Resolución de Archivo de Infracción leve (primera instancia)
17.- Otros
CONSTANCIA DE RECEPCION:
GRADO, NOMBRES Y APELLIDOS IMPRESIÒN DACTITALR
Ventanilla, ${fecha} del 2026.
`;

const acta = (persona) => `
ACTA DE NO RECEPCIÓN DE DESCARGO
---- En el Distrito de Ventanilla, siendo las 11:00 horas del día 18 de agosto del 2026,
presentes el TNTE.PNP Andres Felipe BEDOYA ROJAS y el testigo S2. PNP Ricardo LOAYZA
PARRA, se ha verificado que el ${persona}, no ha presentado sus descargos, en
consecuencia se deja constancia mediante la presente acta.
SUPERIOR QUE CONDUCE EL P/A/D APELLIDOS: BEDOYA ROJAS NOMBRES: Andres Felipe
GRADO: TNTE. PNP CIP. : 410777
`;

const orden = (persona, nota, codigo, cip, decision) => `
MINISTERIO DEL INTERIOR
POLICIA NACIONAL DEL PERU
ORDEN DE SANCIÓN
GRADO Y NOMBRE DEL INVESTIGADO: ${persona}.
I. DESCRIPCION DEL HECHO : dando cuenta con la NOTA INFORMATIVA N° ${nota}
COMOPPOL-PNP/DIRNOS/REGPOL CALLAO/DIVOPUS VENTANILLA.
II. DESCARGO DEL INVESTIGADO : se procede a formular el ACTA DE NO RECEPCION DE
DESCARGO correspondiente.
III. DESCRIPCION DE LA INFRACCION
Por FALTA CON LA DISCIPLINA POLICIAL ${codigo} "Llegar con retraso a su unidad"
IV. ANALISIS Y EVALUACION: corresponde imponer la medida.
V. DECISION
Sancionar al efectivo policial ${persona}, CIP N° ${cip}, perteneciente a la unidad
policial de la DIVOPUS 03/ COM VENTANILLA, ${decision} por la comisión de la
Infracción Leve Código ${codigo}, tipificada en el anexo i de la ley 30714.
Ventanilla, 19 de agosto del 2026.
`;

/** Las seis páginas de un expediente terminado, en el orden en que se escanean. */
const expediente = ({ persona, nota, codigo, cip, rango, decision }) => [
  imputacion(persona, nota, codigo, rango),
  notificacion(persona, 1, "30 de julio"),
  acta(persona),
  notificacion(persona, 2, "19 de agosto"),
  orden(persona, nota, codigo, cip, decision),
];

const MELGAR = {
  persona: "S2. PNP Bruno Alonso MELGAR TAPIA",
  nota: "202601710488", codigo: "L-21", cip: "31770914",
  rango: "De AMONESTACION a CUATRO (04) días de Sanción Simple",
  decision: "con CUATRO (04) días de Sanción Simple",
};
const CARRANZA = {
  persona: "S3 PNP CARRANZA VEGA, Milton Aldo",
  nota: "202601500311", codigo: "L-24", cip: "31447206",
  rango: "De 8 a 10 días de Sanción Simple",
  decision: "con ocho (08) días de Sanción Simple",
};

const notas = [
  { id: "c1", numero_nota_falta: "202601710488", apellidos: "MELGAR TAPIA", nombres: "Bruno Alonso", codigo_infraccion: "L-21" },
  { id: "c2", numero_nota_falta: "202601500311", apellidos: "CARRANZA VEGA", nombres: "Milton Aldo", codigo_infraccion: "L-24" },
  { id: "c3", numero_nota_falta: "202601599999", apellidos: "CARRANZA VEGA", nombres: "Milton Aldo", codigo_infraccion: "L-24" },
];
const efectivos = [
  { cip: "31770914", apellidos_nombres: "MELGAR TAPIA Bruno Alonso" },
  { cip: "31447206", apellidos_nombres: "CARRANZA VEGA Milton Aldo" },
];

// --- Pruebas ----------------------------------------------------------------

describe("nombres de archivo", () => {
  test("quita lo que el depósito no admite", () => {
    assert.equal(nombreSeguro('MELGAR/TAPIA: "Bruno"'), "MELGAR-TAPIA- -Bruno-");
  });

  test("sin tildes y con respaldo cuando no queda nada", () => {
    assert.equal(nombreSeguro("  "), "expediente");
    assert.equal(nombreSeguro("ZAMORA PIÑEDO"), "ZAMORA PINEDO");
  });

  test("el recorte se nombra con la persona y el número de nota", () => {
    assert.equal(
      nombreDelRecorte({ numero_nota_falta: "202601710488" }, { apellidos: "MELGAR TAPIA", nombres: "Bruno Alonso" }),
      "Expediente firmado - MELGAR TAPIA Bruno Alonso - N 202601710488.pdf");
  });
});

describe("un solo PDF con un solo expediente", () => {
  const archivos = [{ nombre: "escaneo.pdf", textosPorPagina: expediente(MELGAR) }];

  test("sale una fila, lista, con sus páginas y su caso", () => {
    const filas = prepararLote(archivos, notas, efectivos);
    assert.equal(filas.length, 1);
    const f = filas[0];
    assert.equal(f.estado, "listo");
    assert.equal(f.nota.id, "c1");
    assert.equal(f.motivo, "numero_nota");
    assert.deepEqual([f.desde, f.hasta, f.paginas], [1, 5, 5]);
    assert.deepEqual(f.avisos, []);
    assert.equal(f.datos.dias_sancion, 4);
  });

  test("se registra igual que el formulario de un solo caso", () => {
    const f = prepararLote(archivos, notas, efectivos)[0];
    assert.deepEqual(filaARegistroDeExpediente(f, { path: "c1/x.pdf", nombre: "x.pdf" }), {
      p_nota_id: "c1",
      p_fecha: "2026-08-19",
      p_archivo_path: "c1/x.pdf",
      p_archivo_nombre: "x.pdf",
    });
  });
});

describe("un PDF con varios expedientes seguidos", () => {
  const archivos = [{
    nombre: "fajo.pdf",
    textosPorPagina: [...expediente(MELGAR), ...expediente(CARRANZA)],
  }];

  test("se parte en dos, cada uno con sus páginas exactas", () => {
    const filas = prepararLote(archivos, notas, efectivos);
    assert.equal(filas.length, 2);
    assert.deepEqual([filas[0].desde, filas[0].hasta], [1, 5]);
    assert.deepEqual([filas[1].desde, filas[1].hasta], [6, 10]);
    assert.deepEqual(filas.map((f) => f.nota.id), ["c1", "c2"]);
    assert.deepEqual(filas.map((f) => f.datos.dias_sancion), [4, 8]);
  });

  test("los dos quedan listos y guardables", () => {
    const filas = prepararLote(archivos, notas, efectivos);
    assert.deepEqual(resumenDelLote(filas), { total: 2, listos: 2, revisar: 0, detenidos: 0 });
    assert.equal(filasGuardables(filas).length, 2);
  });
});

describe("varios PDF a la vez", () => {
  test("cada fila recuerda de qué archivo salió", () => {
    const filas = prepararLote([
      { nombre: "uno.pdf", textosPorPagina: expediente(MELGAR) },
      { nombre: "dos.pdf", textosPorPagina: expediente(CARRANZA) },
    ], notas, efectivos);
    assert.deepEqual(filas.map((f) => f.archivo), ["uno.pdf", "dos.pdf"]);
    assert.deepEqual(filas.map((f) => f.indiceArchivo), [0, 1]);
    assert.deepEqual(filas.map((f) => [f.desde, f.hasta]), [[1, 5], [1, 5]]);
  });
});

describe("lo que obliga a revisar antes de guardar", () => {
  // MELGAR tiene un solo caso, así que el CIP basta. CARRANZA no sirve para
  // esta prueba: tiene dos casos con el mismo código y por eso se detiene.
  test("sin el número de nota legible, lo encuentra por el CIP y lo avisa", () => {
    const paginas = expediente(MELGAR).map((p) => p.replace(/NOTA INFORMATIVA N° \d+/g, "NOTA INFORMATIVA N° ilegible"));
    const filas = prepararLote([{ nombre: "a.pdf", textosPorPagina: paginas }], notas, efectivos);
    assert.equal(filas[0].estado, "revisar");
    assert.equal(filas[0].nota.id, "c1");
    assert.match(filas[0].avisos.join(" "), /CIP del investigado/);
  });

  test("dos casos del mismo efectivo con el mismo código: no elige", () => {
    const paginas = expediente(CARRANZA).map((p) => p.replace(/NOTA INFORMATIVA N° \d+/g, "NOTA INFORMATIVA N° ilegible"));
    const filas = prepararLote([{ nombre: "a.pdf", textosPorPagina: paginas }], notas, efectivos);
    assert.equal(filas[0].estado, "detenido");
    assert.match(filas[0].avisos.join(" "), /Coinciden varios casos/);
  });

  test("si falta una pieza, lo dice y no queda listo", () => {
    const sinNotificacionDeLaOrden = expediente(MELGAR).filter((p) => !/2\.- Orden de Sanción X/.test(p));
    const filas = prepararLote([{ nombre: "a.pdf", textosPorPagina: sinNotificacionDeLaOrden }], notas, efectivos);
    assert.equal(filas[0].estado, "listo");
    // La hoja de la casilla 1 sigue sirviendo como notificación firmada; lo que
    // se comprueba aquí es que quitar una hoja no rompe el corte.
    assert.deepEqual([filas[0].desde, filas[0].hasta], [1, 4]);
  });

  test("un expediente sin orden ni archivo se detiene: no está terminado", () => {
    const soloImputacion = [imputacion(MELGAR.persona, MELGAR.nota, MELGAR.codigo, MELGAR.rango)];
    const filas = prepararLote([{ nombre: "a.pdf", textosPorPagina: soloImputacion }], notas, efectivos);
    assert.equal(filas[0].estado, "detenido");
    assert.match(filas[0].avisos.join(" "), /no está terminado/);
    assert.equal(filasGuardables(filas).length, 0);
  });

  test("el caso que ya tiene expediente avisa que se reemplaza", () => {
    const filas = prepararLote(
      [{ nombre: "a.pdf", textosPorPagina: expediente(MELGAR) }], notas, efectivos, ["c1"]);
    assert.equal(filas[0].estado, "revisar");
    assert.match(filas[0].avisos.join(" "), /ya tiene un expediente/);
    assert.equal(filasGuardables(filas).length, 1);
  });

  test("si no se reconoce dónde empieza, lo dice en vez de callarlo", () => {
    const filas = prepararLote(
      [{ nombre: "a.pdf", textosPorPagina: [acta(MELGAR.persona), orden(MELGAR.persona, MELGAR.nota, MELGAR.codigo, MELGAR.cip, MELGAR.decision)] }],
      notas, efectivos);
    assert.equal(filas[0].estado, "revisar");
    assert.match(filas[0].avisos.join(" "), /No se reconoció dónde empieza/);
  });
});

describe("lo que se detiene", () => {
  test("sin caso que le corresponda", () => {
    const ajeno = { ...MELGAR, nota: "202609999999", cip: "99999999", persona: "S2. PNP Otro AJENO PRUEBA" };
    const filas = prepararLote([{ nombre: "a.pdf", textosPorPagina: expediente(ajeno) }], notas, efectivos);
    assert.equal(filas[0].estado, "detenido");
    assert.match(filas[0].avisos.join(" "), /No se encontró el caso/);
  });

  test("con varios casos posibles no elige", () => {
    const paginas = expediente(CARRANZA).map((p) => p.replace(/NOTA INFORMATIVA N° \d+/g, "NOTA INFORMATIVA N° ilegible")
      .replace(/L-24/g, "ilegible"));
    const filas = prepararLote([{ nombre: "a.pdf", textosPorPagina: paginas }], notas, efectivos);
    assert.equal(filas[0].estado, "detenido");
    assert.match(filas[0].avisos.join(" "), /Coinciden varios casos/);
  });

  test("dos expedientes del lote para el mismo caso: se detienen los dos", () => {
    const filas = prepararLote([{
      nombre: "fajo.pdf",
      textosPorPagina: [...expediente(MELGAR), ...expediente(MELGAR)],
    }], notas, efectivos);
    assert.equal(filas.length, 2);
    assert.deepEqual(filas.map((f) => f.estado), ["detenido", "detenido"]);
    assert.match(filas[0].avisos.join(" "), /mismo lote apunta al mismo caso/);
    assert.equal(filasGuardables(filas).length, 0);
  });

  test("marcarRepetidos no toca las filas sin caso", () => {
    const filas = marcarRepetidos([
      { nota: null, estado: "detenido", avisos: [] },
      { nota: null, estado: "detenido", avisos: [] },
    ]);
    assert.deepEqual(filas.map((f) => f.avisos), [[], []]);
  });
});

describe("resumen del lote", () => {
  test("cuenta cada estado", () => {
    const ajeno = { ...MELGAR, nota: "202609999999", cip: "99999999", persona: "S2. PNP Otro AJENO PRUEBA" };
    const filas = prepararLote([
      { nombre: "uno.pdf", textosPorPagina: expediente(MELGAR) },
      { nombre: "dos.pdf", textosPorPagina: expediente(CARRANZA) },
      { nombre: "tres.pdf", textosPorPagina: expediente(ajeno) },
    ], notas, efectivos, ["c2"]);
    assert.deepEqual(resumenDelLote(filas), { total: 3, listos: 1, revisar: 1, detenidos: 1 });
  });

  test("un lote vacío no revienta", () => {
    assert.deepEqual(prepararLote([], notas, efectivos), []);
    assert.deepEqual(resumenDelLote([]), { total: 0, listos: 0, revisar: 0, detenidos: 0 });
  });
});

describe("la IA como respaldo", () => {
  const ilegible = (paginas) => paginas.map((p) => p
    .replace(/NOTA INFORMATIVA N° \d+/gi, "N0TA 1NF0RMAT1VA N° ilegible")
    .replace(/Nota Informativa N° \d+/g, "N0ta 1nf0rmativa N° ilegible")
    .replace(/CIP N° \d+/g, "C1P N° ilegible"));

  // Con las dos llaves borradas queda el nombre, que sí encuentra el caso pero
  // es la vía más floja: por eso se pide ayuda igual, para poder confirmarlo
  // con el número de nota en vez de fiarse del nombre.
  test("se pide ayuda cuando no quedó ninguna llave legible", () => {
    const filas = prepararLote(
      [{ nombre: "a.pdf", textosPorPagina: ilegible(expediente(MELGAR)) }], notas, efectivos);
    assert.equal(necesitaAyudaDeIA(filas[0]), true);
    assert.equal(filas[0].estado, "revisar");
    assert.equal(filas[0].motivo, "nombre");
  });

  test("no se molesta a la IA cuando las reglas bastaron", () => {
    const filas = prepararLote([{ nombre: "a.pdf", textosPorPagina: expediente(MELGAR) }], notas, efectivos);
    assert.equal(necesitaAyudaDeIA(filas[0]), false);
  });

  test("lo que la IA aporta encuentra el caso, y la fila queda para revisar", () => {
    const fila = prepararLote(
      [{ nombre: "a.pdf", textosPorPagina: ilegible(expediente(MELGAR)) }], notas, efectivos)[0];
    const conIA = aplicarLecturaDeIA(fila,
      { numero_nota_falta: "202601710488", cip_investigado: "31770914", dias_sancion: 4 },
      notas, efectivos);
    assert.equal(conIA.nota.id, "c1");
    assert.equal(conIA.estado, "revisar");
    assert.deepEqual(conIA.leidoPorIA, ["numero_nota_falta", "cip_investigado"]);
    assert.match(conIA.avisos.join(" "), /la IA completó parte de los datos/);
  });

  test("la IA nunca pisa lo que las reglas ya leyeron", () => {
    const fila = prepararLote([{ nombre: "a.pdf", textosPorPagina: expediente(MELGAR) }], notas, efectivos)[0];
    const conIA = aplicarLecturaDeIA(fila, { dias_sancion: 99, codigo_infraccion: "L99" }, notas, efectivos);
    assert.equal(conIA.datos.dias_sancion, 4);
    assert.equal(conIA.datos.codigo_infraccion, "L21");
    assert.equal(conIA.leidoPorIA, undefined);
  });

  test("si la IA tampoco lo saca, la fila se queda como estaba", () => {
    // Aquí ni el nombre se deja leer: no hay por dónde encontrar el caso.
    const aCiegas = ilegible(expediente(MELGAR)).map((p) => p.replace(/MELGAR TAPIA/g, "ilegible"));
    const fila = prepararLote([{ nombre: "a.pdf", textosPorPagina: aCiegas }], notas, efectivos)[0];
    assert.equal(fila.estado, "detenido");
    const conIA = aplicarLecturaDeIA(fila, { numero_nota_falta: null, cip_investigado: null }, notas, efectivos);
    assert.equal(conIA.estado, "detenido");
  });

  test("sin respuesta de la IA, la fila no cambia", () => {
    const fila = prepararLote([{ nombre: "a.pdf", textosPorPagina: expediente(MELGAR) }], notas, efectivos)[0];
    assert.equal(aplicarLecturaDeIA(fila, null, notas, efectivos), fila);
  });
});

describe("la fecha que cierra el caso y los días que ya estaban", () => {
  const archivos = [{ nombre: "escaneo.pdf", textosPorPagina: expediente(MELGAR) }];

  test("la fecha se propone leída del documento", () => {
    assert.equal(prepararLote(archivos, notas, efectivos)[0].fechaNotificacion, "2026-08-19");
  });

  test("sin fecha legible avisa y no se puede guardar", () => {
    const sinFechas = expediente(MELGAR).map((p) => p.replace(/\d{1,2} de (julio|agosto) del 2026/g, "[ilegible]"));
    const filas = prepararLote([{ nombre: "a.pdf", textosPorPagina: sinFechas }], notas, efectivos);
    assert.equal(filas[0].fechaNotificacion, null);
    assert.match(filas[0].avisos.join(" "), /fecha en que se notificó la orden/);
    assert.equal(filasGuardables(filas).length, 0);
  });

  test("escrita a mano, ya se puede guardar", () => {
    const sinFechas = expediente(MELGAR).map((p) => p.replace(/\d{1,2} de (julio|agosto) del 2026/g, "[ilegible]"));
    const filas = prepararLote([{ nombre: "a.pdf", textosPorPagina: sinFechas }], notas, efectivos)
      .map((f) => ({ ...f, fechaNotificacion: "2026-08-19" }));
    assert.equal(filasGuardables(filas).length, 1);
  });

  test("si los días del papel no cuadran con los del caso, avisa y no queda listo", () => {
    const conOtrosDias = [{ ...notas[0], sancion_dias: 10 }, notas[1], notas[2]];
    const filas = prepararLote(archivos, conOtrosDias, efectivos);
    assert.equal(filas[0].estado, "revisar");
    assert.match(filas[0].avisos.join(" "), /dice 4 día\(s\) y el caso tiene registrados 10/);
  });

  test("si cuadran, no dice nada", () => {
    const iguales = [{ ...notas[0], sancion_dias: 4 }, notas[1], notas[2]];
    const filas = prepararLote(archivos, iguales, efectivos);
    assert.equal(filas[0].estado, "listo");
    assert.deepEqual(filas[0].avisos, []);
  });
});
