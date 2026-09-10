// Verificación de sintaxis de todos los archivos JS del proyecto.
// Corre en CI (npm test) antes de los tests, para que un error de sintaxis en
// app.js -- que los tests de lib/ no detectan -- no llegue a producción.
import { readdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const candidatos = [
  "app.js",
  "config.js",
  "sw.js",
  "devserver.cjs",
  ...readdirSync("lib").filter((f) => f.endsWith(".js")).map((f) => `lib/${f}`),
];
const files = candidatos.filter((f) => existsSync(f));

let fallos = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  } catch (e) {
    fallos++;
    console.error(`✗ ${f}\n${(e.stderr && e.stderr.toString()) || e.message}`);
  }
}

if (fallos) {
  console.error(`\n${fallos} archivo(s) con error de sintaxis.`);
  process.exit(1);
}
console.log(`✓ ${files.length} archivos JS revisados, sin errores de sintaxis.`);
