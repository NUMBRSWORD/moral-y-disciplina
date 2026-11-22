import test from "node:test";
import assert from "node:assert/strict";
import {candidatos, revisarNegaciones, motivoRevisionDescargo} from "./cotejoOcr.js";
const campos = ["eOficio","eHt","eDias","rFecha"];

test("el descargo requiere revisión si cambian las cifras o el lector marca un dígito dudoso", () => {
  assert.match(motivoRevisionDescargo("HT 00190753", "HT 00190758", []), /cifras/);
  assert.match(motivoRevisionDescargo("HT 0012", "HT 12", []), /cifras/);
  assert.match(motivoRevisionDescargo("HT 0012", "HT 0012", [{numerosDudosos:["0012"]}]), /0012/);
  assert.equal(motivoRevisionDescargo("Fecha 17/08/2026", "Fecha 17 / 08 / 2026", [{texto:"sin metadatos"}]), "");
  assert.match(motivoRevisionDescargo("No asistí.", "Asistí.", []), /negación/);
});

test("se conservan ceros iniciales y se exige fecha válida y etiquetada", () => {
  const texto = "Oficio N.º 00481-2026\nHoja de trámite N.º 00190753\nFecha de reincorporación: 17/08/2026\nDías de sanción consignados: 03";
  assert.deepEqual(candidatos(texto,campos).map(x => x.valor), ["00481-2026","00190753","2026-08-17","3"]);
  assert.deepEqual(candidatos("Fecha de reincorporación: 31/02/2026\nFecha de presentación: 17/08/2026",campos), []);
});
test("un oficio mencionado como referencia y días propuestos o revocados no se copian", () => {
  for(const t of ["Ref. Oficio N.º 0009", "No se le impone 3 días", "Se le impone 3 días.\nSe revoca la medida.", "Solicita 3 días de sanción","Días de sanción: 3 a 5"]) assert.deepEqual(candidatos(t,campos), []);
});
test("la negación debe acompañar las mismas palabras en ambas lecturas", () => {
  assert.equal(revisarNegaciones("No asistí al turno","Asistí al turno"),true);
  assert.equal(revisarNegaciones("No firmé el acta. Asistí al turno.","Firmé el acta. No asistí al turno."),true);
  assert.equal(revisarNegaciones("No asistí al turno.","NO asistí\nal turno."),false);
  assert.equal(revisarNegaciones("Asistí.",""),true);
});
