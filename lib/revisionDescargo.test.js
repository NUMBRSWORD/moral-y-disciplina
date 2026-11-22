import test from "node:test";
import assert from "node:assert/strict";
import { prepararConsultas, comprobarPuntos, textoDelBorrador } from "./revisionDescargo.js";

const d = { tipo: "D", etiqueta: "Descargo, página 2", pagina: 2, texto: "No falté al turno.\nAdjunto el registro de asistencia." };
const h = { tipo: "H", etiqueta: "Hecho consignado", texto: "La planilla estaba sin firma." };
const [{ fuentes }] = prepararConsultas([d], [h]);
const punto = { fuente: "D1", cita: "No falté al turno.", referencia: "H1", cita_contraste: h.texto, comprobacion: "registro" };
const revisar = puntos => comprobarPuntos({version: 1, puntos}, fuentes);

test("conserva negación, página y contraste; el modelo no puede introducir frases libres en el borrador", () => {
  const {puntos, omitidos} = revisar([{...punto, alegacion: "Faltó al turno.", valoracion: "Culpable."}]);
  assert.equal(omitidos, 0);
  const salida = textoDelBorrador(puntos);
  assert.match(salida.resumen, /No falté al turno.*página 2/);
  assert.match(salida.analisis, /La planilla estaba sin firma/);
  assert.doesNotMatch(JSON.stringify(salida), /Culpable|Faltó al turno/);
});

test("descarta citas inventadas, mal atribuidas o ausentes del escrito", () => {
  const r = revisar([{...punto, cita: "Nunca avisé al encargado."}, {...punto, fuente:"H1", cita:h.texto}, null]);
  assert.equal(r.omitidos, 3);
  assert.deepEqual(r.puntos, []);
  assert.throws(() => comprobarPuntos({analisis_texto: "respuesta antigua"}, fuentes), /fuentes/);
});

test("un contraste sin respaldo se omite conservando la cita del descargo", () => {
  const r = revisar([{...punto, referencia:"N8"}]);
  assert.equal(r.omitidos, 1);
  assert.equal(r.puntos[0].contraste, null);
  assert.equal(r.puntos[0].fuente.pagina, 2);
});

test("conserva todas las páginas largas y avisa de contexto parcial", () => {
  const extenso = "La parte solicita revisar el registro. ".repeat(320);
  const lotes = prepararConsultas([{...d, texto:extenso}], [h, {tipo:"N", etiqueta:"Directiva", texto:extenso}]);
  assert.ok(lotes.length > 1);
  const todas = lotes.flatMap(l => l.fuentes.filter(f => f.tipo === "D"));
  assert.equal(todas.map(f => f.texto).join(" "), extenso.trim());
  assert.ok(todas.every(f => f.pagina === 2));
  assert.ok(lotes.every(l => l.contextoParcial && l.fuentes.some(f => f.tipo === "H")));
});

test("repone una negación que la cita recortó", () => {
  const { puntos } = revisar([{ ...punto, cita: "falté al turno." }]);
  assert.equal(puntos[0].cita, "No falté al turno.");
});
