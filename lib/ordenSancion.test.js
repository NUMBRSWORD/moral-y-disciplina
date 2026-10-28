import { test } from "node:test";
import assert from "node:assert/strict";
import { ordenSinDescargoDesactualizada, textoInicialSancion, RESUMEN_SIN_DESCARGO, analisisSinDescargoDefault } from "./ordenSancion.js";

const generadaSinDescargo = {
  orden_sancion_generada_at: "2026-10-22T22:15:00Z",
  sancion_descargo_resumen: RESUMEN_SIN_DESCARGO,
  sancion_analisis: analisisSinDescargoDefault("L21", "4"),
};

test("la Orden 'sin descargo' queda desactualizada al registrar después el descargo", () => {
  assert.equal(ordenSinDescargoDesactualizada(generadaSinDescargo), false);
  assert.equal(ordenSinDescargoDesactualizada({ ...generadaSinDescargo, fecha_descargo: "2026-10-21" }), true);
  assert.equal(ordenSinDescargoDesactualizada({ fecha_descargo: "2026-10-21", sancion_descargo_resumen: RESUMEN_SIN_DESCARGO }), false, "sin Orden generada no hay nada que rehacer");
});

test("una Orden ya generada evaluando el descargo no se marca", () => {
  assert.equal(ordenSinDescargoDesactualizada({
    fecha_descargo: "2026-10-21",
    orden_sancion_generada_at: "2026-10-29T15:00:00Z",
    sancion_descargo_resumen: "El investigado alega que se encontraba enfermo.",
    sancion_analisis: "Del descargo se desprende que...",
  }), false);
});

test("el formulario no arrastra el texto 'sin descargo' cuando ya hay descargo", () => {
  const conDescargo = { ...generadaSinDescargo, fecha_descargo: "2026-10-21" };
  assert.equal(textoInicialSancion(conDescargo, "sancion_descargo_resumen"), "");
  assert.equal(textoInicialSancion(conDescargo, "sancion_analisis"), "");
  assert.equal(textoInicialSancion({}, "sancion_descargo_resumen"), RESUMEN_SIN_DESCARGO);
  assert.equal(textoInicialSancion({ fecha_descargo: "2026-10-21", sancion_analisis: "Propio" }, "sancion_analisis"), "Propio");
});
