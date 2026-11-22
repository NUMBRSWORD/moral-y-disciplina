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
  assert.equal(pasarela.decidirRespaldo(422, json, '{"error":"demasiados efectivos"}'), true, "el modelo local no pudo: lo intenta Claude");
  assert.equal(pasarela.decidirRespaldo(200, json, '{"doble":true,"motorGlm":false,"glm":""}'), true, "doble lectura vacía en la PC");
  assert.equal(pasarela.decidirRespaldo(200, json, '{"doble":true,"motorGlm":true,"glm":"texto"}'), false);
  assert.equal(pasarela.decidirRespaldo(200, "text/html", "<html>túnel caído</html>"), true);
  assert.equal(pasarela.decidirRespaldo(200, json, "{cortado"), true);
});

test("la espera de la PC deja tiempo para Claude dentro del límite de Supabase", () => {
  for (const nombre of pasarela.FUNCIONES_IA) assert.ok(pasarela.esperaPara(nombre) <= 55000, nombre);
});

test("en la PC se pide JSON a qwen, en la tarjeta gráfica y con la respuesta acotada", async () => {
  const pedidos = [];
  globalThis.Deno = { env: { get: (k) => ({ IA_LOCAL: "1" })[k] } };
  globalThis.fetch = async (url, init) => {
    pedidos.push({ url: String(url), cuerpo: JSON.parse(init.body), signal: init.signal });
    return Response.json({ message: { content: '{"ok":true}' }, done_reason: "stop" });
  };
  const ia = await cargar("../supabase/functions/_shared/ollama.ts");
  const r = await ia.inferir({ system: "s", max_tokens: 6000, messages: [{ role: "user", content: "caso ficticio" }] });
  assert.deepEqual(await r.json(), { content: [{ type: "text", text: '{"ok":true}' }], stop_reason: "end_turn" });
  const { url, cuerpo } = pedidos[0];
  assert.equal(url, "http://127.0.0.1:11434/api/chat");
  assert.equal(cuerpo.format, "json");
  assert.equal(cuerpo.think, false);
  assert.equal(cuerpo.keep_alive, "30m");
  assert.deepEqual(cuerpo.options, { temperature: 0, num_predict: 4000, num_ctx: 8192, num_gpu: 99 });

  const esquema = { type: "object" };
  await ia.inferir({ system: "s", max_tokens: 100, output_config: { format: { schema: esquema } },
    messages: [{ role: "user", content: "x".repeat(30000) }] });
  assert.deepEqual(pedidos[1].cuerpo.format, esquema, "un esquema propio no se reemplaza");
  assert.equal(pedidos[1].cuerpo.options.num_ctx, 16384, "un texto largo usa más contexto");
  assert.equal(pedidos[1].cuerpo.options.num_gpu, undefined, "con más contexto Ollama decide dónde cargarlo");

  await assert.rejects(ia.inferir({ system: "s", max_tokens: 100, messages: [{ role: "user", content: "x".repeat(60000) }] }),
    /demasiado largo/, "lo que no cabe se rechaza al instante para que responda Claude");
  assert.equal(pedidos.length, 2);

  const corte = new AbortController();
  await ia.conLimiteLocal(corte.signal, () => ia.inferir({ system: "s", max_tokens: 10, messages: [{ role: "user", content: "y" }] }));
  corte.abort();
  assert.equal(pedidos[2].signal.aborted, true, "la pasarela puede cortar a Ollama cuando Supabase ya no espera");
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
