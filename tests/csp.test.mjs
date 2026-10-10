// La política de seguridad (CSP) de index.html debe autorizar exactamente lo que la
// web usa: sus scripts en línea (por huella sha256), los módulos de esm.sh y el
// Supabase de config.js. Si se edita un script en línea sin recalcular su huella,
// el navegador lo bloquearía en silencio; esta prueba lo detecta antes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const raiz = new URL("../", import.meta.url);
// Se comparan huellas de lo que RECIBE EL NAVEGADOR, y el sitio sirve el archivo tal
// como está en Git: con saltos de línea LF. En Windows la copia de trabajo sale con
// CRLF, que cambia la huella de cualquier script de varias líneas. Sin normalizar,
// esta prueba fallaría en Windows y pasaría en CI, siendo correcta la política.
const html = (await readFile(new URL("index.html", raiz), "utf8")).replace(/\r\n/g, "\n");
const politica = html.match(/m\.content = "([^"]+)";/)?.[1];

test("index.html declara su política de seguridad, salvo dentro de Android", () => {
  assert.ok(politica, "falta la política en index.html");
  assert.match(html, /if \(window\.__faltosConfig\) return;/);
  for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'self'"]) assert.ok(politica.includes(d), d);
  assert.ok(!/'unsafe-eval'/.test(politica), "no debe permitir eval");
  assert.ok(!/script-src[^;]*'unsafe-inline'/.test(politica), "no debe permitir scripts en línea sin huella");
});

test("cada script en línea (salvo el que fija la política) está autorizado por su huella", () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const otros = scripts.filter((c) => !c.includes("Content-Security-Policy"));
  assert.ok(otros.length > 0);
  for (const contenido of otros) {
    const huella = `'sha256-${createHash("sha256").update(contenido, "utf8").digest("base64")}'`;
    assert.ok(politica.includes(huella), `script en línea sin autorizar: ${contenido.trim().slice(0, 60)}…`);
  }
});

test("autoriza el Supabase de config.js y los módulos de esm.sh que se importan", async () => {
  const config = await readFile(new URL("config.js", raiz), "utf8");
  const host = new URL(config.match(/SUPABASE_URL = "([^"]+)"/)[1]).host;
  assert.ok(politica.includes(`https://${host}`) && politica.includes(`wss://${host}`));
  const js = (await readFile(new URL("app.js", raiz), "utf8")) + (await readFile(new URL("lib/docxDeps.js", raiz), "utf8"));
  const hosts = new Set([...js.matchAll(/["'](https:\/\/[^/"']+)\//g)].map((m) => m[1]));
  for (const h of hosts) {
    if (h.includes("supabase.co")) continue;
    assert.ok(politica.includes(h), `módulo de ${h} no autorizado en la política`);
  }
});
