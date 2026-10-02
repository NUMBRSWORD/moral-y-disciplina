// Pruebas del archivo: folder manila por caso, rotulado con su número de oficio.
// Personas y números inventados: este repositorio es público.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  normalizarNumeroOficio,
  codigoDeArchivo,
  listoParaArchivar,
  casosPorArchivar,
  compararCodigos,
  piezasDelLegajo,
  datosDelRotulo,
  faltaParaArchivar,
} from "./archivo.js";

describe("número de oficio", () => {
  test("se escribe siempre igual en el rótulo", () => {
    assert.equal(normalizarNumeroOficio("45-2026"), "045-2026");
    assert.equal(normalizarNumeroOficio("045-2026"), "045-2026");
    assert.equal(normalizarNumeroOficio("0045 - 2026"), "045-2026");
    assert.equal(normalizarNumeroOficio("1203-2026"), "1203-2026");
  });

  test("del código completo del documento se toma solo el correlativo y el año", () => {
    assert.equal(normalizarNumeroOficio("045-2026-COMOPPOL-PNP/DIRNOS/REGPOL-CALL"), "045-2026");
    assert.equal(normalizarNumeroOficio("OFICIO N° 7-2026-COMOPPOL"), "007-2026");
  });

  test("lo que no es un número de oficio no se inventa", () => {
    assert.equal(normalizarNumeroOficio(""), "");
    assert.equal(normalizarNumeroOficio(null), "");
    assert.equal(normalizarNumeroOficio("sin número"), "");
    assert.equal(normalizarNumeroOficio("0-2026"), "");
    assert.equal(normalizarNumeroOficio("45/2026"), "");
  });
});

describe("código de archivo", () => {
  test("con oficio, el oficio", () => {
    assert.equal(codigoDeArchivo({ id: "a" }, { numero_oficio: "45-2026" }), "OF 045-2026");
  });

  test("archivado sin sanción, su resolución", () => {
    const nota = { id: "b", archivo_leve_generada_at: "2026-09-01", archivo_leve_resolucion_numero: "12-2026" };
    assert.equal(codigoDeArchivo(nota, null), "RES 012-2026");
  });

  test("sin ninguno de los dos, vacío para que se complete a mano", () => {
    assert.equal(codigoDeArchivo({ id: "c" }, null), "");
    assert.equal(codigoDeArchivo({ id: "c" }, { numero_oficio: "" }), "");
  });
});

describe("qué casos esperan su folder", () => {
  const remitido = { id: "r", archivo_orden_notificacion_path: "r/exp.pdf" };
  const sinOficio = { id: "s", archivo_orden_notificacion_path: "s/exp.pdf" };
  const archivadoSinSancion = { id: "l", archivo_leve_generada_at: "2026-09-01" };
  const enTramite = { id: "t" };
  const remitidos = [
    { nota_id: "r", archivo_oficio_path: "r/oficio.pdf", archivo_ht_path: "r/ht.pdf" },
    { nota_id: "s", archivo_oficio_path: null, archivo_ht_path: null },
  ];

  test("solo los que terminaron la remisión o se archivaron sin sanción", () => {
    assert.equal(listoParaArchivar(remitido, remitidos), true);
    assert.equal(listoParaArchivar(archivadoSinSancion, remitidos), true);
    assert.equal(listoParaArchivar(sinOficio, remitidos), false);
    assert.equal(listoParaArchivar(enTramite, remitidos), false);
  });

  test("un caso ya archivado no vuelve a la bandeja", () => {
    const notas = [remitido, sinOficio, archivadoSinSancion, enTramite];
    assert.deepEqual(casosPorArchivar(notas, remitidos, []).map((n) => n.id), ["r", "l"]);
    assert.deepEqual(casosPorArchivar(notas, remitidos, [{ nota_id: "r" }]).map((n) => n.id), ["l"]);
  });
});

describe("orden del archivo", () => {
  test("por año y correlativo; los oficios antes que las resoluciones", () => {
    const codigos = ["RES 001-2026", "OF 010-2026", "OF 002-2026", "OF 099-2025", "", "OF 100-2026"];
    assert.deepEqual([...codigos].sort(compararCodigos),
      ["OF 099-2025", "OF 002-2026", "OF 010-2026", "OF 100-2026", "RES 001-2026", ""]);
  });
});

describe("legajo", () => {
  test("las piezas en el orden del trámite, solo las que existen y en PDF", () => {
    const nota = {
      archivo_nota_path: "n/nota.pdf",
      archivo_descargo_path: "n/descargo.PDF",
      archivo_reincorporacion_path: "n/reinc.docx",
      archivo_orden_notificacion_path: "n/expediente.pdf",
    };
    const remision = { archivo_oficio_path: "r/oficio.pdf", archivo_ht_path: null };
    assert.deepEqual(piezasDelLegajo(nota, remision).map((p) => p.titulo),
      ["Nota informativa", "Descargo del investigado", "Expediente firmado", "Oficio de remisión"]);
    assert.equal(piezasDelLegajo(nota, remision)[3].bucket, "expedientes-terminados-pnp");
  });

  test("un caso sin documentos no arma un legajo vacío", () => {
    assert.deepEqual(piezasDelLegajo({}, null), []);
  });
});

describe("rótulo del folder", () => {
  test("lleva código, persona, falta y ubicación", () => {
    const rotulo = datosDelRotulo(
      { grado: "S3", apellidos: "PRUEBA DEMO", nombres: "Juan", fecha_falta: "2026-08-01", codigo_infraccion: "L21" },
      { codigo: "OF 045-2026", ubicacion: "Archivador 2", folios: 34 });
    assert.equal(rotulo.codigo, "OF 045-2026");
    assert.equal(rotulo.investigado, "S3 PNP PRUEBA DEMO Juan");
    assert.equal(rotulo.folios, "34");
    assert.equal(rotulo.ubicacion, "Archivador 2");
  });
});

describe("antes de archivar", () => {
  const piezas = [{ titulo: "Expediente firmado" }];
  test("con todo completo, nada falta", () => {
    assert.deepEqual(faltaParaArchivar({ codigo: "OF 045-2026", folios: 34, piezas }), []);
  });
  test("dice exactamente qué falta", () => {
    assert.equal(faltaParaArchivar({ codigo: "", folios: 0, piezas: [] }).length, 3);
    assert.match(faltaParaArchivar({ codigo: "OF 45", folios: 3, piezas })[0], /número de oficio/);
    assert.match(faltaParaArchivar({ codigo: "OF 045-2026", folios: 2.5, piezas })[0], /folios/);
  });
});
