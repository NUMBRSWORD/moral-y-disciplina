import { mkdir, mkdtemp, cp, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { archivosPublicos } from './web-files.mjs';

// Cada compilación va a una carpeta nueva: no borra ni arrastra archivos previos.
await mkdir('build', {recursive:true});
const directory = await mkdtemp(path.resolve('build/pages-'));
for (const file of archivosPublicos()) {
  const target = path.join(directory, file);
  await mkdir(path.dirname(target), {recursive:true});
  await cp(file, target);
}
console.log(`Web pública preparada en ${directory}`);
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `directory=${directory}\n`);
