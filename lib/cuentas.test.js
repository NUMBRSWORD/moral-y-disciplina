import { test } from "node:test";
import assert from "node:assert/strict";
import { esCuentaCip, cipDeCuenta, vistaDeAcceso, validarSolicitud, organizarCuentas } from "./cuentas.js";

// Personas inventadas.
const cipViejo = (cip, extra = {}) => ({ id: `cip-${cip}`, email: `${cip}@moralydisciplina.local`, role: "viewer", estado: "aprobado", cip: null, ...extra });
const google = (id, extra = {}) => ({ id, email: `${id}@example.invalid`, role: "viewer", estado: "pendiente", cip: null, ...extra });
const solicitud = (user_id, cip, creado_at = "2026-10-07T10:00:00Z") => ({ user_id, cip, grado: "S2", apellidos: "PRUEBA", nombres: "UNO", creado_at });

test("reconoce las cuentas de CIP y saca su CIP", () => {
  assert.equal(esCuentaCip("90000001@MoralYDisciplina.local"), true);
  assert.equal(esCuentaCip("alguien@example.invalid"), false);
  assert.equal(cipDeCuenta(cipViejo("90000001")), "90000001");
  assert.equal(cipDeCuenta(google("g", { cip: "90000002" })), "90000002");
  assert.equal(cipDeCuenta(google("g")), null);
});

test("vista de acceso según estado y solicitud", () => {
  assert.equal(vistaDeAcceso({ estado: "aprobado" }, false), "aprobada");
  assert.equal(vistaDeAcceso({ estado: "pendiente", email: "a@example.invalid" }, false), "formulario");
  assert.equal(vistaDeAcceso({ estado: "pendiente", email: "a@example.invalid" }, true), "en_revision");
  assert.equal(vistaDeAcceso({ estado: "rechazado", email: "a@example.invalid" }, true), "rechazada");
  assert.equal(vistaDeAcceso({ estado: "rechazado", email: "90000001@moralydisciplina.local" }, false), "retirada");
  assert.equal(vistaDeAcceso(null, false), "formulario");
});

test("valida la solicitud con las mismas reglas que la base", () => {
  const base = { grado: " S2 PNP ", apellidos: "prueba", nombres: "uno", cip: "90000001", dni: "99000001", telefono: "999 000-001", acepta: true };
  assert.deepEqual(validarSolicitud(base).datos, { grado: "S2 PNP", apellidos: "PRUEBA", nombres: "UNO", cip: "90000001", dni: "99000001", telefono: "999000001" });
  assert.match(validarSolicitud({ ...base, grado: "" }).error, /grado/);
  assert.match(validarSolicitud({ ...base, cip: "12a" }).error, /CIP/);
  assert.match(validarSolicitud({ ...base, dni: "123" }).error, /DNI/);
  assert.match(validarSolicitud({ ...base, telefono: "12345" }).error, /teléfono/);
  assert.match(validarSolicitud({ ...base, acepta: false }).error, /aceptar/);
});

test("organiza solicitudes, cuentas por retirar y por migrar", () => {
  const perfiles = [
    cipViejo("90000001"),                                        // pidió Google: se retira al aprobar
    cipViejo("90000002"),                                        // ya aprobado con Google: por retirar
    cipViejo("90000003"),                                        // aún no pide Google
    cipViejo("90000004", { role: "admin" }),                     // admin: conserva su CIP
    cipViejo("90000005", { estado: "rechazado" }),               // ya retirada
    google("g1"),                                                // solicitud con CIP 90000001
    google("g2", { estado: "aprobado", cip: "90000002" }),
    google("g3"),                                                // solicitud de alguien nuevo
    google("g4"),                                                // entró pero no llenó la solicitud
  ];
  const solicitudes = [solicitud("g3", "90000009", "2026-10-07T09:00:00Z"), solicitud("g1", "90000001"), solicitud("g2", "90000002")];
  const r = organizarCuentas(perfiles, solicitudes);
  assert.deepEqual(r.porAprobar.map((x) => [x.perfil.id, x.cuentaCip?.id || null]), [["g3", null], ["g1", "cip-90000001"]]);
  assert.deepEqual(r.porRetirar.map((x) => [x.cuentaCip.id, x.cuentaGoogle.id]), [["cip-90000002", "g2"]]);
  assert.deepEqual(r.porMigrar.map((p) => p.id), ["cip-90000003"]);
  assert.deepEqual(r.sinSolicitud.map((p) => p.id), ["g4"]);
});

test("sin datos no falla", () => {
  assert.deepEqual(organizarCuentas(), { porAprobar: [], porRetirar: [], porMigrar: [], sinSolicitud: [] });
});
