// Pruebas de la lectura de expedientes firmados que se suben en lote.
// Los textos imitan la forma exacta de los documentos reales (Hoja de Trámite del
// SIGE, oficio y orden de sanción), pero con personas y números inventados: este
// repositorio es público y no debe contener datos de nadie.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  esPaginaDeHojaDeTramite,
  esPaginaDeInicioDeExpediente,
  separarExpedientes,
  numeroHojaTramite,
  numeroOficio,
  numerosDeNotaInformativa,
  codigoInfraccion,
  sancionImpuesta,
  cipDelInvestigado,
  dniDelInvestigado,
  infractor,
  superiorQueSanciona,
  fechaDelDocumento,
  fechaDeNotificacionDeLaOrden,
  piezasDelExpediente,
  leerExpediente,
  buscarFaltaDelExpediente,
} from "./expedienteFirmado.js";

const hojaDeTramite = (ht, oficio, sancion, grado, persona) => `
Hoja de Trámite
Sistema de Gestión de Expedientes - SIGE MIN
Ministerio del Interior
Nro Hoja de Trámite : ${ht}
Procedencia : INTERNO
Nro de documento : ${oficio}
Tipo de Documento : OFICIO
Oficina Registro : REGION POLICIAL CALLAO - DIVISION DE ORDEN PUBLICO Y SEGURIDAD
Asunto
REMITIRLE ADJUNTO AL PRESENTE, EN EJEMPLAR TRIPLICADO (03), LA DE ORDEN DE SANCIÓN CON SANCIÓN
IMPUESTA DE ${sancion}, ACTA DE RECEPCIÓN DE DESCARGO, DESCARGO Y NOTIFICACIÓN DE
IMPUTACIÓN DE INFRACCIÓN LEVE (L21), IMPUESTA POR EL MAYOR PNP ALVARO SOTO MENDEZ AL ${grado}
PNP ${persona}.`;

const ordenDeSancion = (nota, codigo, sancion, grado, persona) => `
CONFIDENCIAL
MINISTERIO DEL INTERIOR
POLICÍA NACIONAL DEL PERÚ
ORDEN DE SANCIÓN
GRADO Y NOMBRE DEL INFRACTOR : ${grado} PNP ${persona}.
UNIDAD/SUB-UNIDAD : DIVOPUS 3 - Comisaría PNP Ventanilla.
DESCRIPCION DE LA INFRACCIÓN Y MOTIVACION DE LA SANCION : "Llegar con retraso a su unidad".
Dicho accionar fue constatado dando cuenta mediante NOTA INFORMATIVA N° ${nota}-COMOPPOL-PNP/DIRNOS.
CÓDIGO DE LA INFRACCIÓN : ${codigo}
SANCIÓN IMPUESTA : ${sancion}
NOTIFICACION DEL INVESTIGADO`;

describe("separar un fajo escaneado en expedientes", () => {
  test("cada Hoja de Trámite abre un expediente y se queda con sus páginas", () => {
    const paginas = [
      hojaDeTramite("20260359833", "137-2026-REGPOLCALLAO-COMVA", "AMONESTACION", "S2", "PEREZ QUISPE Juan Carlos"),
      "OFICIO N°137-2026 ... Dios guarde a Ud.",
      ordenDeSancion("202600520525", "L21", "AMONESTACION", "S2", "PEREZ QUISPE, Juan Carlos"),
      "ACTA DE NO RECEPCIÓN DE DESCARGOS ...",
      "NOTIFICACIÓN DE IMPUTACIÓN DE INFRACCIÓN LEVE ...",
      hojaDeTramite("20260357678", "135-2026-REGPOLCALLAO-COMVA", "DOS (02) DÍAS SIMPLES", "S3", "RAMOS LEON Nixon Ivan"),
      "OFICIO N°135-2026 ...",
      ordenDeSancion("202600411111", "L21", "DOS (02) DÍAS SIMPLES", "S3", "RAMOS LEON, Nixon Ivan"),
    ];
    const bloques = separarExpedientes(paginas);
    assert.equal(bloques.length, 2);
    assert.deepEqual([bloques[0].desde, bloques[0].hasta], [1, 5]);
    assert.deepEqual([bloques[1].desde, bloques[1].hasta], [6, 8]);
  });

  test("una carátula suelta al inicio no se pierde: va con el primer expediente", () => {
    const bloques = separarExpedientes([
      "SANCIONES JULIO 2026",
      hojaDeTramite("20260359833", "137-2026-X", "AMONESTACION", "S2", "PEREZ QUISPE Juan Carlos"),
      "OFICIO ...",
    ]);
    assert.equal(bloques.length, 1);
    assert.deepEqual([bloques[0].desde, bloques[0].hasta], [1, 3]);
  });

  test("un PDF sin Hoja de Trámite se trata como un solo expediente", () => {
    const bloques = separarExpedientes(["algo", "otra cosa"]);
    assert.equal(bloques.length, 1);
    assert.deepEqual([bloques[0].desde, bloques[0].hasta], [1, 2]);
  });

  test("un PDF vacío no produce expedientes", () => {
    assert.deepEqual(separarExpedientes([]), []);
  });

  test("reconoce la página de Hoja de Trámite y descarta las demás", () => {
    assert.ok(esPaginaDeHojaDeTramite(hojaDeTramite("2026035", "1-2026-X", "AMONESTACION", "S2", "PEREZ QUISPE Juan")));
    assert.ok(!esPaginaDeHojaDeTramite("ORDEN DE SANCIÓN ... CÓDIGO DE LA INFRACCIÓN : L21"));
  });
});

describe("datos de cada expediente", () => {
  const texto = hojaDeTramite("20260359833", "137-2026-REGPOLCALLAO-DIVOPSVENTANILLA-COMVA",
    "AMONESTACION", "S2", "PEREZ QUISPE Juan Carlos")
    + ordenDeSancion("202600520525", "L21", "AMONESTACION", "S2", "PEREZ QUISPE, Juan Carlos");

  test("número de Hoja de Trámite", () => {
    assert.equal(numeroHojaTramite(texto), "20260359833");
    assert.equal(numeroHojaTramite("sin nada"), null);
  });

  test("número de oficio", () => {
    assert.equal(numeroOficio(texto), "137-2026-REGPOLCALLAO-DIVOPSVENTANILLA-COMVA");
  });

  test("lo saca también del propio oficio si no hay Hoja de Trámite", () => {
    assert.equal(numeroOficio("OFICIO N°137-2026-COMOPPOL-PNP/DIRNOS/REGPOL-CALL"),
      "137-2026-COMOPPOL-PNP/DIRNOS/REGPOL-CALL");
  });

  test("números de nota informativa, sin repetir y en orden", () => {
    const conDos = ordenDeSancion("202600520525", "L21", "AMONESTACION", "S2", "PEREZ QUISPE, Juan")
      + " reportado conforme a NOTA INFORMATIVA N° 202600525836-COMOPPOL-PNP.";
    assert.deepEqual(numerosDeNotaInformativa(conDos), ["202600520525", "202600525836"]);
  });

  test("código de infracción, del campo o del paréntesis del asunto", () => {
    assert.equal(codigoInfraccion(texto), "L21");
    assert.equal(codigoInfraccion("NOTIFICACIÓN DE IMPUTACIÓN DE INFRACCIÓN LEVE (L21)"), "L21");
    assert.equal(codigoInfraccion("no dice nada"), null);
  });

  test("amonestación: sin días", () => {
    const s = sancionImpuesta("SANCIÓN IMPUESTA : AMONESTACION");
    assert.equal(s.dias, 0);
    assert.equal(s.tipo, "amonestacion");
  });

  test("días simples escritos como DOS (02) DÍAS SIMPLES", () => {
    const s = sancionImpuesta("SANCIÓN IMPUESTA : DOS (02) DÍAS SIMPLES");
    assert.equal(s.dias, 2);
    assert.equal(s.tipo, "simple");
  });

  test("días de rigor escritos con cifra", () => {
    const s = sancionImpuesta("SANCIÓN IMPUESTA : 05 días de sanción de rigor");
    assert.equal(s.dias, 5);
    assert.equal(s.tipo, "rigor");
  });

  test("días escritos solo en letras", () => {
    const s = sancionImpuesta("se le impone tres días simples");
    assert.equal(s.dias, 3);
    assert.equal(s.tipo, "simple");
  });

  test("el código puede venir con guion, como en la imputación real", () => {
    assert.equal(codigoInfraccion('2. Código de la Infracción : L-21 "Llegar con retraso a su unidad"'), "L21");
  });

  test("el rango del Anexo que trae la imputación no es la sanción impuesta", () => {
    // "3. Sanción : De AMONESTACION a CUATRO (04) días de Sanción Simple" es el
    // rango posible del código, no lo que se resolvió imponer.
    const s = sancionImpuesta("3. Sanción : De AMONESTACION a CUATRO (04) días de Sanción Simple. PLAZO DE DESCARGO");
    assert.equal(s.texto, null);
    assert.equal(s.dias, null);
  });

  test("con la orden de sanción delante, manda su campo y no el rango", () => {
    const fajo = "3. Sanción : De AMONESTACION a CUATRO (04) días de Sanción Simple."
      + " ORDEN DE SANCIÓN ... SANCIÓN IMPUESTA : DOS (02) DÍAS SIMPLES PLAZO PARA IMPUGNAR";
    const s = sancionImpuesta(fajo);
    assert.equal(s.dias, 2);
    assert.equal(s.tipo, "simple");
  });

  test("reconoce la hoja aparte de notificación con su constancia de recepción", () => {
    const piezas = piezasDelExpediente(
      "NOTIFICACIÓN Y ENTREGA DE ACTO ADMINISTRATIVO ... 1.- Inicio de imputación de infracción leve X"
      + " ... CONSTANCIA DE RECEPCION: GRADO, NOMBRES Y APELLIDOS ... IMPRESIÓN DACTILAR");
    assert.ok(piezas.notificacion_firmada);
  });

  test("sin sanción legible no inventa un número", () => {
    const s = sancionImpuesta("ORDEN DE SANCIÓN");
    assert.equal(s.dias, null);
    assert.equal(s.texto, null);
  });

  test("infractor con coma, como lo escribe la orden de sanción", () => {
    assert.deepEqual(infractor("GRADO Y NOMBRE DEL INFRACTOR : S2 PNP PEREZ QUISPE, Juan Carlos. UNIDAD"),
      { grado: "S2", apellidos: "PEREZ QUISPE", nombres: "Juan Carlos", completo: "PEREZ QUISPE Juan Carlos" });
  });

  test("infractor sin coma, como lo escribe el asunto", () => {
    assert.deepEqual(infractor("IMPUESTA POR EL MAYOR PNP ALVARO SOTO MENDEZ AL S3 PNP RAMOS LEON Nixon Ivan."),
      { grado: "S3", apellidos: "RAMOS LEON", nombres: "Nixon Ivan", completo: "RAMOS LEON Nixon Ivan" });
  });

  test("todo junto", () => {
    const datos = leerExpediente(texto);
    assert.equal(datos.numero_ht, "20260359833");
    assert.equal(datos.numero_nota_falta, "202600520525");
    assert.equal(datos.codigo_infraccion, "L21");
    assert.equal(datos.dias_sancion, 0);
    assert.equal(datos.infractor.apellidos, "PEREZ QUISPE");
  });
});

describe("a qué falta pertenece cada expediente", () => {
  const notas = [
    { id: "n1", numero_nota_falta: "202600520525", grado: "S2", apellidos: "PEREZ QUISPE", nombres: "Juan Carlos" },
    { id: "n2", numero_nota_falta: "202600411111", grado: "S3", apellidos: "RAMOS LEON", nombres: "Nixon Ivan" },
    { id: "n3", numero_nota_falta: "202600422222", grado: "S1", apellidos: "RAMOS LEON", nombres: "Otro Distinto" },
  ];

  test("por número de nota: es inequívoco", () => {
    const datos = leerExpediente(ordenDeSancion("202600520525", "L21", "AMONESTACION", "S2", "PEREZ QUISPE, Juan Carlos"));
    const hallado = buscarFaltaDelExpediente(datos, notas);
    assert.equal(hallado.nota.id, "n1");
    assert.equal(hallado.motivo, "numero_nota");
  });

  test("sin número legible, por apellidos y nombres", () => {
    const datos = leerExpediente("GRADO Y NOMBRE DEL INFRACTOR : S3 PNP RAMOS LEON, Nixon Ivan. UNIDAD");
    const hallado = buscarFaltaDelExpediente(datos, notas);
    assert.equal(hallado.nota.id, "n2");
    assert.equal(hallado.motivo, "nombre");
  });

  test("dos personas con los mismos apellidos y nombre ilegible: no elige, avisa", () => {
    const hallado = buscarFaltaDelExpediente(
      { numeros_nota: [], infractor: { grado: "S3", apellidos: "RAMOS LEON", nombres: "" } }, notas);
    assert.equal(hallado.nota, null);
    assert.equal(hallado.motivo, "varios");
    assert.equal(hallado.candidatas.length, 2);
  });

  test("si no encuentra nada, devuelve nulo en vez de adivinar", () => {
    const datos = leerExpediente(ordenDeSancion("209900000000", "L21", "AMONESTACION", "S2", "AJENO LEJANO, Persona"));
    assert.equal(buscarFaltaDelExpediente(datos, notas), null);
  });

  test("sin datos no revienta", () => {
    assert.equal(buscarFaltaDelExpediente(null, notas), null);
  });
});

// Segundo modelo real (29/09/2026): un expediente suelto de seis páginas, SIN
// Hoja de Trámite, con la orden de sanción en el formato nuevo por secciones
// numeradas. Las páginas van aquí en el mismo desorden en que salieron del
// escáner: la segunda hoja de la orden llegó antes que la primera.
const impPag = `
INICIO DE IMPUTACIÓN DE INFRACCIÓN LEVE
---En observancia de los artículos 22°, 35°, 37° y 62° de la Ley N° 30714 - Ley que
regula el Régimen Disciplinario de la Policía Nacional del Perú, se notifica el inicio del
Procedimiento Administrativo Disciplinario por la presunta comisión de infracción Leve,
tipificada en el Anexo I de la Tabla de Infracciones y Sanciones Leves:
GRADO Y NOMBRE DEL INVESTIGADO : S3 PNP QUISPE ROJAS, Daniel Ernesto.
UNIDAD/SUB-UNIDAD : DIVOPUS 3-CPNP VENTANILLA.
DESCRIPCIÓN DEL HECHO
se encontraba nombrado según el rol de servicio de la Comisaría PNP Ventanilla,
constatando la ausencia física del investigado a la lista, hecho comunicado a la
superioridad mediante NOTA INFORMATIVA N° 202601000311-COMOPPOL-PNP/DIRNOS/
REGPOL CALLAO/DIVOPUS VENTANILLA/COM VENTANILLA A.
DESCRIPCIÓN DE LA INFRACCIÓN:
1. Bien Jurídico: Disciplina Policial
2. Código de la infracción: L-24 (Faltar a su turno, servicio o un (1) día a su unidad,
de acuerdo con el reglamento de horarios y turnos de trabajo correspondiente).
3. Sanción: De 8 a 10 días de Sanción Simple.
GRADO Y NOMBRE DEL SUPERIOR : CAPITAN PNP TORRES MEZA, Raul Ernesto.
UNIDAD/SUB-UNIDAD : DIVOPUS 3-CPNP VENTANILLA.
Ventanilla, 19 de agosto del 2026.
`;

const notifPag = (casilla, fecha) => `
NOTIFICACIÓN Y ENTREGA DE ACTO ADMINISTRATIVO
Señor (a) : S3 PNP QUISPE ROJAS, Daniel Ernesto.
Domicilio : DIVOPUS 3-CPNP VENTANILLA.
Marca la casilla Número y siglas Fecha del sistema
1.- Inicio de imputación de infracción leve ${casilla === 1 ? "X S/N " + fecha : ""}
2.- Orden de Sanción ${casilla === 2 ? "X S/N " + fecha : ""}
3.- Resolución de Archivo de Infracción leve (primera instancia)
4.- Resolución de comunicación de acciones previas
17.- Otros
CONSTANCIA DE RECEPCION:
GRADO, NOMBRES Y APELLIDOS CIP /DNI FECHA Y HORA VINCULO FIRMA
IMPRESION DACTILAR
Ventanilla, ${fecha} del 2026
`;

const actaPag = `
ACTA DE NO RECEPCIÓN DE DESCARGOS
--- En el distrito de Ventanilla, siendo las 11:16 horas del día 21 de agosto del 2026, en
uno de los ambientes de la Comisaría PNP Ventanilla, presentes el SUPERIOR QUE SANCIONA
CAPITAN PNP TORRES MEZA Raul Ernesto, identificado con CIP N°355104 y DNI N°43111222
y el TESTIGO S2 PNP SALAS BRIONES Hugo Martin, identificado con CIP N° 30445566, se
procede a levantar la presente acta, luego de haber culminado el plazo de un (01) día hábil,
no habiendo presentado descargo el PRESUNTO INFRACTOR S3 PNP Daniel Ernesto QUISPE
ROJAS, identificado con CIP N°31000206 y DNI N°70000482, continuándose con el
procedimiento administrativo disciplinario.-
SUPERIOR CONDUCE P/A/D Apellidos: TORRES MEZA Nombres: Raul Ernesto Grado: CAPITAN PNP
TESTIGO Apellidos: SALAS BRIONES Nombres: Hugo Martin Grado: S2 PNP
`;

const ordenPag1 = `
MINISTERIO DEL INTERIOR
POLICIA NACIONAL DEL PERÚ
ORDEN DE SANCION
GRADO Y NOMBRE DEL INVESTIGADO: S3 PNP Daniel Ernesto QUISPE ROJAS
I. DESCRIPCIÓN DEL HECHO : El investigado se encontraba nombrado según el rol de servicio
de la Comisaría PNP Ventanilla, hecho comunicado mediante Nota Informativa
N° 202601000311-COMOPPOL-PNP/DIRNOS/REGPOL CALLAO/DIVOPUS VENTANILLA/COM
VENTANILLA A.
II. DESCARGO DEL INVESTIGADO : El investigado no presentó su descargo por escrito dentro
del plazo de un (01) día hábil establecido por ley, conforme acta respectiva.
III. DESCRIPCIÒN DE LA INFRACCIÓN :
Bien Jurídico: Disciplina Policial.
Código de la infracción: L-24 (Faltar a su turno, servicio o un (1) día a su unidad).
Sanción: De 8 a 10 días de Sanción Simple.
IV. ANALISIS Y EVALUACIÓN : Habiendo vencido el plazo reglamentario sin que el
administrado haga ejercicio de su derecho a la defensa, corresponde imponer la medida en
su extremo mínimo.
`;

const ordenPag2 = `
Verificación de los principios de la potestad sancionadora administrativa (artículo 230 del
Texto Único Ordenado de la Ley N° 27444, Ley del Procedimiento Administrativo General).
V. DECISIÓN: Se resuelve SANCIONAR al S3 PNP Daniel Ernesto QUISPE ROJAS, CIP N° 31000206,
perteneciente a la comisaría PNP Ventanilla, con ocho (08) días de Sanción Simple por la
comisión de la infracción leve código L-24 tipificada en el Anexo I de la tabla de infracción
y sanciones de la ley 30714 y sus modificatorias.
PLAZO PARA IMPUGNAR
El sancionado cuenta con el plazo de tres (3) días hábiles para interponer recurso de
apelación contra la presente Orden de Sanción, directamente y sin conducto regular, ante el
suscrito o la Mesa de Partes de la unidad policial donde presta servicios.
Ventanilla, 21 de agosto del 2026.
`;

const expedienteSuelto = [
  impPag, notifPag(1, "19 de agosto"), actaPag, notifPag(2, "21 de agosto"),
  ordenPag2, ordenPag1,
];
const todoElExpediente = expedienteSuelto.join("\n");

describe("expediente suelto, sin Hoja de Trámite (modelo real del 29/09/2026)", () => {
  test("la imputación abre expediente aunque no venga Hoja de Trámite", () => {
    assert.equal(esPaginaDeInicioDeExpediente(impPag), true);
    assert.equal(esPaginaDeHojaDeTramite(impPag), false);
  });

  test("la hoja de notificación NO abre expediente, aunque liste la casilla 1", () => {
    assert.equal(esPaginaDeInicioDeExpediente(notifPag(2, "21 de agosto")), false);
  });

  test("las seis páginas forman un solo expediente", () => {
    const partes = separarExpedientes(expedienteSuelto);
    assert.equal(partes.length, 1);
    assert.deepEqual([partes[0].desde, partes[0].hasta], [1, 6]);
  });

  test("dos expedientes sueltos seguidos se separan por su imputación", () => {
    const partes = separarExpedientes([...expedienteSuelto, impPag, ordenPag2]);
    assert.equal(partes.length, 2);
    assert.deepEqual([partes[0].desde, partes[0].hasta], [1, 6]);
    assert.deepEqual([partes[1].desde, partes[1].hasta], [7, 8]);
  });

  test("manda la decisión: ocho días impuestos, no los diez del rango del Anexo", () => {
    assert.deepEqual(sancionImpuesta(todoElExpediente),
      { texto: "OCHO (08) DÍAS DE SANCIÓN SIMPLE", dias: 8, tipo: "simple" });
  });

  test("el rango solo, sin decisión, no se toma por sanción", () => {
    assert.deepEqual(sancionImpuesta(impPag), { texto: null, dias: null, tipo: null });
  });

  test("los tres días para impugnar no son sanción", () => {
    assert.equal(sancionImpuesta(ordenPag2).dias, 8);
  });

  test("CIP del investigado, no el del superior ni el del testigo", () => {
    assert.equal(cipDelInvestigado(todoElExpediente), "31000206");
    assert.equal(cipDelInvestigado(actaPag), "31000206");
    assert.equal(cipDelInvestigado(ordenPag2), "31000206");
  });

  test("DNI del investigado, del acta", () => {
    assert.equal(dniDelInvestigado(todoElExpediente), "70000482");
  });

  test("el código sale también del texto de la decisión", () => {
    assert.equal(codigoInfraccion(ordenPag2), "L24");
  });

  test("el nombre se lee aunque la orden lo escriba al revés", () => {
    assert.equal(infractor(ordenPag1).completo, "Daniel Ernesto QUISPE ROJAS");
    assert.equal(infractor(impPag).completo, "QUISPE ROJAS Daniel Ernesto");
  });

  test("superior que sanciona", () => {
    assert.equal(superiorQueSanciona(impPag).completo, "TORRES MEZA Raul Ernesto");
    assert.equal(superiorQueSanciona(actaPag).completo, "TORRES MEZA Raul Ernesto");
  });

  test("fecha del documento en ISO", () => {
    assert.equal(fechaDelDocumento(ordenPag2), "2026-08-21");
  });

  test("lectura completa del expediente", () => {
    const d = leerExpediente(todoElExpediente);
    assert.equal(d.resultado, "sancion");
    assert.deepEqual(d.faltan, []);
    assert.equal(d.numero_nota_falta, "202601000311");
    assert.equal(d.cip_investigado, "31000206");
    assert.equal(d.codigo_infraccion, "L24");
    assert.equal(d.dias_sancion, 8);
    assert.equal(d.tipo_sancion, "simple");
    assert.equal(d.fecha_documento, "2026-08-19");
  });
});

describe("cruce con los casos de la web", () => {
  const efectivos = [
    { cip: "31000206", grado: "S3", apellidos_nombres: "QUISPE ROJAS Daniel Ernesto" },
    { cip: "30445566", grado: "S2", apellidos_nombres: "SALAS BRIONES Hugo Martin" },
  ];
  const casos = [
    { id: "c1", numero_nota_falta: "202601000311", apellidos: "QUISPE ROJAS", nombres: "Daniel Ernesto", codigo_infraccion: "L-24" },
    { id: "c2", numero_nota_falta: "202601500999", apellidos: "QUISPE ROJAS", nombres: "Daniel Ernesto", codigo_infraccion: "L-21" },
  ];

  test("el número de nota manda sobre todo lo demás", () => {
    const hallado = buscarFaltaDelExpediente(leerExpediente(todoElExpediente), casos, efectivos);
    assert.equal(hallado.nota.id, "c1");
    assert.equal(hallado.motivo, "numero_nota");
  });

  test("sin número de nota legible, el CIP lleva al efectivo y el código al caso", () => {
    const datos = { ...leerExpediente(todoElExpediente), numeros_nota: [] };
    const hallado = buscarFaltaDelExpediente(datos, casos, efectivos);
    assert.equal(hallado.nota.id, "c1");
    assert.equal(hallado.motivo, "cip_y_codigo");
  });

  test("mismo CIP y dos casos que no se pueden distinguir: no elige, avisa", () => {
    const datos = { ...leerExpediente(todoElExpediente), numeros_nota: [], codigo_infraccion: null };
    const hallado = buscarFaltaDelExpediente(datos, casos, efectivos);
    assert.equal(hallado.nota, null);
    assert.equal(hallado.motivo, "varios");
    assert.equal(hallado.candidatas.length, 2);
  });

  test("el nombre al revés encuentra el mismo caso", () => {
    const datos = {
      numeros_nota: [], codigo_infraccion: "L24",
      infractor: { grado: "S3", apellidos: "", nombres: "", completo: "Daniel Ernesto QUISPE ROJAS" },
    };
    assert.equal(buscarFaltaDelExpediente(datos, casos, efectivos).nota.id, "c1");
  });

  test("un CIP que no está en la lista de efectivos no inventa un caso", () => {
    const datos = { numeros_nota: [], cip_investigado: "99999999", infractor: null };
    assert.equal(buscarFaltaDelExpediente(datos, casos, efectivos), null);
  });
});

// Tercer modelo real (29/09/2026): el otro expediente completo de seis páginas.
// Se diferencia del anterior en cuatro cosas que conviene fijar en pruebas:
// el fajo NO empieza por la imputación sino por su notificación; el rango del
// Anexo se escribe "De AMONESTACION a CUATRO (04) días"; la orden titula el
// código como "FALTA CON LA DISCIPLINA POLICIAL L-21"; y la decisión dice
// "Sancionar al efectivo policial" en vez de "Se resuelve SANCIONAR al".
const notifB = (casilla, fecha) => `
NOTIFICACIÓN Y ENTREGA DE ACTO ADMINISTRATIVO
Señor (a) : S2. PNP Mario Andres MONTES LARA.
Domicilio : Mz. 23 Lte. 13 Urb. Satélite.
De conformidad a la Ley N° 30714 se le NOTIFICA Y HACE ENTREGA el siguiente acto
administrativo disciplinario, para su conocimiento y fines pertinentes:
Marca la casilla Número y siglas Fecha del sistema
1.- Inicio de imputación de infracción leve ${casilla === 1 ? "X S/N " + fecha : ""}
2.- Orden de Sanción ${casilla === 2 ? "X S/N " + fecha : ""}
3.- Resolución de Archivo de Infracción leve (primera instancia)
17.- Otros
CONSTANCIA DE RECEPCION:
GRADO, NOMBRES Y APELLIDOS S2 PNP MONTES LARA MARIO ANDRES
CIP /DNI 31000914 / 70111333
IMPRESIÒN DACTITALR
Ventanilla, ${fecha} del 2026.
`;

const impB = `
INICIO DE IMPUTACION DE INFRACCION LEVE
- - - En observancia a los artículos 22, 27, 28, 29, 30, 35, 37 y 62 de la Ley No 30714,
se procede a notificar formalmente la presunta comisión de infracción leve tipificada en
el Anexo I de la Tabla de Infracciones y Sanciones Leves de la "la Ley", conforme se detalla
GRADO Y NOMBRE DEL INVESTIGADO : S2. PNP Mario Andres MONTES LARA.
UNIDAD/SUB-UNIDAD : DIVOPUS 3-CPNP VENTANILLA.
DESCRIPCIÓN DEL HECHO : Por llegar con retraso a su servicio del día 29JUL26 a las
06:30 Hrs., dando cuenta a la superioridad con la NOTA INFORMATIVA N° 202601000488 -
COMOPPOL-PNP/DIRNOS/REGPOL CALLAO/DIVOPUS VENTANILLA/COM VENTANILLA A y
NOTA INFORMATIVA N° 202601000305 - COMOPPOL-PNP/DIRNOS/REGPOL CALLAO/DIVOPUS
VENTANILLA/COM VENTANILLA A.
DESCRIPCION DE LA INFRACCION
1. Bien jurídico : CONTRA LA DISCIPLINA POLICIAL
2. Código de la infracción : L-21 "Llegar con retraso a su unidad, servicio o turno,
instrucción, ceremonia, curso, conferencia o a los diversos actos del servicio para el que
sea designado o tuviera obligación de asistir"
3. Sanción : De AMONESTACION a CUATRO (04) días de Sanción Simple
GRADO Y NOMBRE DEL SUPERIOR : TNTE. PNP Julio Cesar FLORES DIAZ
UNIDAD/SUB-UNIDAD : REGIÓN POLICIAL CALLAO / DIVOPUS 3 / COMISARIA VENTANILLA
DIRECCION : Av. Pedro Beltrán N°138 Urb. Satélite - Ventanilla
Ventanilla, 30 de julio del 2026
`;

const actaB = `
ACTA DE NO RECEPCIÓN DE DESCARGO
---- En el Distrito de Ventanilla, siendo las 11:00 horas del día 18 de agosto del 2026, en
uno de los ambientes de la Comisaria PNP Ventanilla, presentes el TNTE.PNP Julio Cesar
FLORES DIAZ, de la Comisaria Ventanilla, perteneciente a la DIVOPUS 03 VENTANILLA en el
procedimiento administrativo disciplinario por infracción Leve, y el testigo S2. PNP Ricardo
VILLA CANO, perteneciente a la DIVOPUS 03 - CPNP VENTANILLA, luego de haber culminado
el plazo de descargo, se ha verificado que el S2. PNP Mario Andres MONTES LARA, no ha
presentado sus descargos, en consecuencia, se deja constancia de ello mediante la presente
acta y se continúa con el procedimiento administrativo disciplinario.
SUPERIOR QUE CONDUCE EL P/A/D APELLIDOS: FLORES DIAZ NOMBRES: Julio Cesar
GRADO: TNTE. PNP CIP. : 410777
TESTIGO APELLIDOS: VILLA CANO NOMBRES: Ricardo GRADO: S2. PNP CIP. : 30445599
`;

const ordenB1 = `
MINISTERIO DEL INTERIOR
POLICIA NACIONAL DEL PERU
ORDEN DE SANCIÓN
---En cumplimiento al procedimiento administrativo disciplinario para infracciones leves,
establecido en los artículos 22, 35, 37 y 62 de la Ley N° 30714, se tiene lo siguiente:
GRADO Y NOMBRE DEL INVESTIGADO: S2. PNP Mario Andres MONTES LARA.
I. DESCRIPCION DEL HECHO : Por llegar con retraso a su servicio del día 29JUL26 a las
06:30 Hrs., dando cuenta a la superioridad con la NOTA INFORMATIVA N° 202601000488
COMOPPOL-PNP/DIRNOS/REGPOL CALLAO/DIVOPUS VENTANILLA/COM VENTANILLA A y NOTA
INFORMATIVA N° 202601000305 COMOPPOL-PNP/DIRNOS/REGPOL CALLAO/DIVOPUS
VENTANILLA/COM VENTANILLA A.
II. DESCARGO DEL INVESTIGADO
Con fecha 18AGO2026 siendo las 11:00 horas, después de haberse vencido los plazos
establecidos (01 día), se procede a formular el ACTA DE NO RECEPCION DE DESCARGO
correspondiente.
III. DESCRIPCION DE LA INFRACCION
Por FALTA CON LA DISCIPLINA POLICIAL L-21 "Llegar con retraso a su unidad, servicio o
turno, instrucción, ceremonia, curso, conferencia o a los diversos actos del servicio para el
que sea designado o tuviera obligación de asistir"
IV. ANALISIS Y EVALUACION:
Que el S2. PNP Mario Andres MONTES LARA, al llegar con retraso a su servicio, habría
incurrido en una FALTA CONTRA LA DISCIPLINA POLICIAL, motivo por el cual se resuelve
establecer una sanción administrativa.
V. DECISION
Sancionar al efectivo policial S2. PNP Mario Andres MONTES LARA, CIP N° 31000914,
perteneciente a la unidad policial de la DIVOPUS 03/ COM VENTANILLA, con CUATRO (04)
días de Sanción Simple por la comisión de la Infracción Leve Código L-21, tipificada en el
anexo i de la tabla de infracciones y sanciones de la ley 30714 y sus modificatorias.
`;

const ordenB2 = `
PLAZO PARA IMPUGNAR
El sancionado cuenta con el plazo de tres (3) días hábiles para interponer recurso de
apelación contra la presente Orden de Sanción, directamente y sin conducto regular, ante el
suscrito o a la Mesa de Parte de la unidad policial donde presta servicios.
Ventanilla, 19 de agosto del 2026.
Julio Cesar FLORES DIAZ TNTE PNP OFICIAL DE PERMANENCIA DE LA COMISARIA PNP
`;

// Tal como salió del escáner: la notificación primero y la orden con sus dos
// hojas al revés.
const fajoB = [notifB(1, "30 de julio"), impB, actaB, notifB(2, "19 de agosto"), ordenB2, ordenB1];
const todoB = fajoB.join("\n");

describe("segundo expediente completo (modelo real del 29/09/2026)", () => {
  test("el fajo empieza por la notificación: esa página no se pierde", () => {
    const partes = separarExpedientes(fajoB);
    assert.equal(partes.length, 1);
    assert.deepEqual([partes[0].desde, partes[0].hasta], [1, 6]);
  });

  test("cuatro días impuestos, no la amonestación con que abre el rango", () => {
    assert.deepEqual(sancionImpuesta(todoB),
      { texto: "CUATRO (04) DÍAS DE SANCIÓN SIMPLE", dias: 4, tipo: "simple" });
  });

  test("el rango 'De AMONESTACION a CUATRO (04) días' no es la sanción", () => {
    assert.deepEqual(sancionImpuesta(impB), { texto: null, dias: null, tipo: null });
  });

  test("el código se lee del título de la sección III de la orden", () => {
    assert.equal(codigoInfraccion(ordenB1), "L21");
  });

  test("CIP impreso en la decisión, no el del superior ni el del testigo", () => {
    assert.equal(cipDelInvestigado(todoB), "31000914");
    assert.equal(cipDelInvestigado(ordenB1), "31000914");
  });

  test("lectura completa", () => {
    const d = leerExpediente(todoB);
    assert.equal(d.resultado, "sancion");
    assert.deepEqual(d.faltan, []);
    assert.equal(d.numero_nota_falta, "202601000488");
    assert.deepEqual(d.numeros_nota, ["202601000488", "202601000305"]);
    assert.equal(d.cip_investigado, "31000914");
    assert.equal(d.codigo_infraccion, "L21");
    assert.equal(d.dias_sancion, 4);
    assert.equal(d.tipo_sancion, "simple");
    assert.equal(d.infractor.completo, "Mario Andres MONTES LARA");
    assert.equal(d.superior.completo, "Julio Cesar FLORES DIAZ");
  });
});

describe("fecha en que se notificó la orden de sanción", () => {
  // Como en el documento real: la fila de la casilla trae la fecha del sistema
  // en cifras, y puede ser distinta de la del resto del expediente.
  test("de la fila de la casilla 2, escrita en cifras", () => {
    const conCasilla = todoElExpediente.replace("2.- Orden de Sanción X S/N 21 de agosto", "2.- Orden de Sanción X S/N 19/08/2026");
    assert.equal(fechaDeNotificacionDeLaOrden(conCasilla), "2026-08-19");
  });

  test("si la casilla no trae fecha en cifras, la más tardía del expediente", () => {
    assert.equal(fechaDeNotificacionDeLaOrden(todoElExpediente), "2026-08-21");
  });

  test("sin ninguna fecha legible no inventa una", () => {
    assert.equal(fechaDeNotificacionDeLaOrden("ORDEN DE SANCION sin fechas"), null);
  });

  test("va también en la lectura completa", () => {
    assert.equal(leerExpediente(todoElExpediente).fecha_notificacion_orden, "2026-08-21");
  });
});
