// Pruebas de la lectura de personal por texto -- ver lib/nombresNota.js.
// Los nombres son ficticios; el texto reproduce la forma de una reincorporación
// grupal real (lista sin coma entre uno y otro, iniciales sueltas, "y" final).
//
// Corre con: node --test lib/

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { bloqueReincorporados, personalPNPEnTexto, mismoEfectivo, completarCandidatos, buscarReincorporada } from "./nombresNota.js";

// Nótese "Marcos R.P S2 PNP" (sin coma) y el "y" antes del último.
const TEXTO = `NOTA INFORMATIVA N° 202601000002 ASUNTO Ampliación de información sobre reincorporación al servicio del S3 PNP VEGA RIOS Luis
Alberto, S2 PNP CASTRO PAREDES Ana Maria, S3 PNP LUNA ROJAS Marcos R.P S2 PNP MENDOZA RAMOS Carlos Jose, S3 PNP REYES MEDINA
Jorge y S2 PNP GOMEZ PRADO Diego pertenecientes a la CPNP Ventanilla. Siendo las 06:55 horas del 21SET2026, el Comisario de la
CPNP Ventanilla, MAY. PNP TORRES SOTO Mario Enrique, con celular Nro. 900000000, da cuenta que el S3 PNP VEGA RIOS Luis Alberto,
S2 PNP CASTRO PAREDES Ana Maria, S3 PNP LUNA ROJAS Marcos R.P S2 PNP MENDOZA RAMOS Carlos Jose, S3 PNP REYES MEDINA Jorge y S2 PNP
GOMEZ PRADO Diego, se reincorporaron a esta sub unidad PNP a las 07:45 horas del día 21SET2026, quienes se encontraban faltos.
Formulado por S2 LUIS PEREZ SOTO`;

describe("bloqueReincorporados", () => {
  test("toma el párrafo de 'da cuenta que' hasta 'se reincorporaron' y deja fuera a quien firma", () => {
    const b = bloqueReincorporados(TEXTO);
    assert.match(b, /^el S3 PNP VEGA RIOS Luis Alberto/);
    assert.match(b, /GOMEZ PRADO Diego$/);
    assert.doesNotMatch(b, /TORRES SOTO/);
  });
  test("también corta en 'quienes se encontraban'", () => {
    const b = bloqueReincorporados("da cuenta que el S3 PNP VEGA RIOS Luis y S2 PNP GOMEZ PRADO Diego, quienes se encontraban faltos");
    assert.match(b, /GOMEZ PRADO Diego$/);
  });
  test("sin ese párrafo devuelve vacío (no agrega a nadie)", () => {
    assert.equal(bloqueReincorporados("Nota de otro tipo sin la frase esperada"), "");
    assert.equal(bloqueReincorporados(""), "");
  });
});

describe("personalPNPEnTexto", () => {
  const personas = personalPNPEnTexto(bloqueReincorporados(TEXTO));

  test("encuentra a los 6, incluido el que viene sin coma con iniciales sueltas", () => {
    assert.deepEqual(personas.map((p) => p.apellidos), [
      "VEGA RIOS", "CASTRO PAREDES", "LUNA ROJAS", "MENDOZA RAMOS", "REYES MEDINA", "GOMEZ PRADO",
    ]);
  });
  test("separa nombres e iniciales", () => {
    assert.equal(personas[2].nombres, "Marcos R.P");
    assert.equal(personas[3].nombres, "Carlos Jose");
    assert.equal(personas[0].nombres, "Luis Alberto");
  });
  test("el 'y' antes del último no se cuela en el nombre", () => {
    assert.equal(personas[4].nombres, "Jorge");
    assert.equal(personas[5].grado, "S2");
  });
  test("una coma cierra al efectivo y lo que sigue no es nombre", () => {
    const p = personalPNPEnTexto("S2 PNP GOMEZ PRADO Diego, se reincorporaron a esta unidad");
    assert.deepEqual(p, [{ grado: "S2", apellidos: "GOMEZ PRADO", nombres: "Diego" }]);
  });
  test("acepta ñ y tildes en los apellidos", () => {
    const p = personalPNPEnTexto("S3 PNP PEÑA MUÑOZ Pablo Jose y S3 PNP ÁLVAREZ NÚÑEZ Pedro");
    assert.deepEqual(p.map((x) => x.apellidos), ["PEÑA MUÑOZ", "ÁLVAREZ NÚÑEZ"]);
  });
  test("texto sin ningún 'GRADO PNP' no da nadie", () => {
    assert.deepEqual(personalPNPEnTexto("no hay personal aquí"), []);
    assert.deepEqual(personalPNPEnTexto(undefined), []);
  });
});

describe("mismoEfectivo", () => {
  test("tolera iniciales sueltas en los nombres", () => {
    assert.equal(mismoEfectivo({ apellidos: "LUNA ROJAS", nombres: "Marcos" }, { apellidos: "LUNA ROJAS", nombres: "Marcos R.P" }), true);
  });
  test("ñ y tildes no impiden la coincidencia", () => {
    assert.equal(mismoEfectivo({ apellidos: "PEÑA MUÑOZ", nombres: "Pablo" }, { apellidos: "PENA MUNOZ", nombres: "Pablo Jose" }), true);
  });
  test("mismos apellidos y otro nombre son personas distintas", () => {
    assert.equal(mismoEfectivo({ apellidos: "LUNA ROJAS", nombres: "Marcos" }, { apellidos: "LUNA ROJAS", nombres: "Pedro" }), false);
  });
  test("un apellido suelto nunca coincide con otro más largo", () => {
    assert.equal(mismoEfectivo({ apellidos: "LUNA", nombres: "" }, { apellidos: "LUNA ROJAS", nombres: "" }), false);
  });
  test("todo en MAYÚSCULAS (nombres dentro de apellidos) coincide si contiene los apellidos", () => {
    assert.equal(mismoEfectivo({ apellidos: "LUNA ROJAS MARCOS", nombres: "" }, { apellidos: "LUNA ROJAS", nombres: "Marcos" }), true);
  });
  test("sin apellidos no hay coincidencia", () => {
    assert.equal(mismoEfectivo({ apellidos: "", nombres: "X" }, { apellidos: "", nombres: "X" }), false);
  });
});

describe("completarCandidatos", () => {
  const texto = personalPNPEnTexto(bloqueReincorporados(TEXTO));

  test("agrega a quien la IA se saltó y no duplica a los demás", () => {
    const ia = [
      { grado: "S3", apellidos: "VEGA RIOS", nombres: "Luis Alberto" },
      { grado: "S2", apellidos: "CASTRO PAREDES", nombres: "Ana Maria" },
      { grado: "S2", apellidos: "MENDOZA RAMOS", nombres: "Carlos Jose" },
      { grado: "S3", apellidos: "REYES MEDINA", nombres: "Jorge" },
      { grado: "S2", apellidos: "GOMEZ PRADO", nombres: "Diego" },
    ]; // falta LUNA ROJAS
    const r = completarCandidatos(ia, texto);
    assert.equal(r.length, 6);
    assert.deepEqual(r[5], { grado: "S3", apellidos: "LUNA ROJAS", nombres: "Marcos R.P" });
  });
  test("si la IA ya los trajo a todos no cambia nada", () => {
    const ia = texto.map((p) => ({ ...p }));
    assert.equal(completarCandidatos(ia, texto).length, 6);
  });
  test("tolera listas ausentes", () => {
    assert.deepEqual(completarCandidatos(undefined, undefined), []);
  });
});

describe("buscarReincorporada", () => {
  const notas = [
    { apellidos: "LUNA ROJAS", nombres: "Marcos", fecha_falta: "2026-09-10", fecha_reincorporacion: "2026-09-11", numero_nota_reincorporacion: "111" },
    { apellidos: "LUNA ROJAS", nombres: "Marcos", fecha_falta: "2026-09-20", fecha_reincorporacion: "2026-09-21", numero_nota_reincorporacion: "202601000002" },
    { apellidos: "GOMEZ PRADO", nombres: "Diego", fecha_falta: "2026-09-20", fecha_reincorporacion: null },
  ];
  const cand = { apellidos: "LUNA ROJAS", nombres: "Marcos R.P" };

  test("reconoce que ya se registró con ESTA misma nota", () => {
    const r = buscarReincorporada(notas, cand, { numeroNota: "202601000002", fecha: "2026-09-21" });
    assert.equal(r.mismaNota, true);
    assert.equal(r.nota.fecha_falta, "2026-09-20");
  });
  test("si fue con otra nota, lo dice sin marcarla como la misma (prefiere la de esa fecha)", () => {
    const r = buscarReincorporada(notas, cand, { numeroNota: "999", fecha: "2026-09-21" });
    assert.equal(r.mismaNota, false);
    assert.equal(r.nota.numero_nota_reincorporacion, "202601000002");
  });
  test("sin coincidencia de fecha, toma la reincorporación más reciente", () => {
    const r = buscarReincorporada(notas, cand, { numeroNota: "999", fecha: "2026-01-01" });
    assert.equal(r.nota.fecha_falta, "2026-09-20");
  });
  test("quien tiene la falta abierta no cuenta como reincorporado", () => {
    assert.equal(buscarReincorporada(notas, { apellidos: "GOMEZ PRADO", nombres: "Diego" }, {}), null);
  });
  test("persona sin notas devuelve null", () => {
    assert.equal(buscarReincorporada(notas, { apellidos: "OTRO NOMBRE", nombres: "X" }, {}), null);
    assert.equal(buscarReincorporada(undefined, cand, {}), null);
  });
});
