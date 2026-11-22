// Pasarela de IA: la PC de la oficina (Ollama) responde si puede; si no, Claude.
// Los .ts de las Edge Functions se cargan quitándoles los tipos (Node 22).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";

async function cargar(ruta) {
  const fuente = await readFile(new URL(ruta, import.meta.url), "utf8");
  const js = stripTypeScriptTypes(fuente);
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
}

const pasarela = await cargar("../supabase/functions/ia-oficina/pasarela.ts");

test("acepta la respuesta de la PC solo si es JSON propio de la pasarela", () => {
  const json = "application/json; charset=utf-8";
  assert.equal(pasarela.decidirRespaldo(200, json, '{"texto":"ok"}'), false);
  assert.equal(pasarela.decidirRespaldo(429, json, '{"error":"cuota"}'), false, "un rechazo propio no se repite en Claude");
  assert.equal(pasarela.decidirRespaldo(502, json, '{"error":"x"}'), true);
  assert.equal(pasarela.decidirRespaldo(408, json, "{}"), true);
  assert.equal(pasarela.decidirRespaldo(404, json, "{}"), true, "la pasarela no tiene esa función");
  assert.equal(pasarela.decidirRespaldo(200, "text/html", "<html>túnel caído</html>"), true);
  assert.equal(pasarela.decidirRespaldo(200, json, "{cortado"), true);
});

test("la espera de la PC deja tiempo para Claude dentro del límite de Supabase", () => {
  for (const nombre of pasarela.FUNCIONES_IA) assert.ok(pasarela.esperaPara(nombre) <= 55000, nombre);
});

test("en Supabase se usa Claude con la misma forma de respuesta que Ollama", async () => {
  const pedidos = [];
  globalThis.Deno = { env: { get: (k) => ({ ANTHROPIC_API_KEY: "clave-de-prueba" })[k] } };
  globalThis.fetch = async (url, init) => {
    pedidos.push({ url: String(url), cuerpo: JSON.parse(init.body) });
    return Response.json({
      content: [{ type: "thinking", thinking: "" }, { type: "text", text: '{"ok":' }, { type: "text", text: "true}" }],
      stop_reason: "end_turn",
    });
  };
  const ia = await cargar("../supabase/functions/_shared/ollama.ts");
  const esquema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };
  const r = await ia.inferir({
    system: "s", max_tokens: 100, contexto: 2048, output_config: { format: { schema: esquema } },
    messages: [{ role: "user", content: [{ type: "image", source: { data: "/9j/AA" } }] }],
  });
  const datos = await r.json();
  assert.deepEqual(datos, { content: [{ type: "text", text: '{"ok":true}' }], stop_reason: "end_turn" });
  const { url, cuerpo } = pedidos[0];
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal(cuerpo.model, "claude-sonnet-5");
  assert.equal(cuerpo.contexto, undefined, "contexto es solo de Ollama");
  assert.deepEqual(cuerpo.output_config, { format: { type: "json_schema", schema: esquema } });
  assert.deepEqual(cuerpo.messages[0].content[0].source, { type: "base64", media_type: "image/jpeg", data: "/9j/AA" });
});
