import { cp, mkdir, realpath, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { archivosWeb } from './web-files.mjs';

// Uso: npm run sync:web -- app/build/upstream-github [--check]
// No toca ramas ni publica. --check solo compara bytes y no escribe.
const targetArg = process.argv[2];
if (!targetArg) throw new Error('Indique el checkout web de destino dentro de app/build.');
const root = await realpath('.');
const destination = await realpath(targetArg);
if (!destination.startsWith(path.join(root,'app','build') + path.sep)) throw new Error('Destino fuera del área de integración.');
const remote = execFileSync('git',['-C',destination,'remote','get-url','origin'],{encoding:'utf8'}).trim();
if (!/^https:\/\/github\.com\/NUMBRSWORD\/moral-y-disciplina(?:\.git)?$/.test(remote)) throw new Error('El destino no es el repositorio web esperado.');
const check = process.argv.includes('--check');
const changed = [];
for (const file of archivosWeb()) {
  const target = path.join(destination,file);
  const source = await readFile(file);
  const previous = await readFile(target).catch(e => {if(e.code==='ENOENT') return null;throw e;});
  if (previous?.equals(source)) continue;
  changed.push(file);
  if (!check) { await mkdir(path.dirname(target),{recursive:true}); await cp(file,target); }
}
console.log(`${check?'Diferencias':'Sincronizados'}: ${changed.length} archivos.`);
if (check && changed.length) { console.error(changed.join('\n')); process.exitCode=1; }
