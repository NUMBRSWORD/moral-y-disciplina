import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {archivosPublicos} from '../scripts/web-files.mjs';

test('la web publica solo archivos públicos, nunca Android, SQL, claves ni pruebas',()=>{
  const files=archivosPublicos();
  assert.ok(files.includes('app.js') && files.includes('lib/loteExpedientes.js'));
  assert.ok(files.every(f=>!/^app\/|^supabase\/|^tests\/|^\.private\/|\.test\./.test(f)));
});
test('descarga, APK y metadatos tienen una sola versión y un hash verificable',async()=>{
  const version=JSON.parse(await readFile(new URL('../descargas/version.json',import.meta.url)));
  assert.match(version.apk,/^faltos-[\d.]+\.apk$/);
  const apk=await readFile(new URL('../descargas/'+version.apk,import.meta.url));
  assert.equal(createHash('sha256').update(apk).digest('hex'),version.sha256);
  const page=await readFile(new URL('../descargar.html',import.meta.url),'utf8');
  assert.ok(page.includes(`descargas/${version.apk}`));
  assert.ok(page.includes(`Versión ${version.versionName}.`));
  const gradle=new URL('../app/build.gradle.kts',import.meta.url);
  if(existsSync(gradle)){
    const source=await readFile(gradle,'utf8');
    // Lo publicado para descargar NUNCA puede ser más nuevo que lo que se compila:
    // eso anunciaría un APK que no existe. Al revés sí vale, y es lo normal
    // mientras una versión está en desarrollo y todavía no se ha publicado.
    const compilado=Number(source.match(/versionCode = (\d+)/)[1]);
    assert.ok(compilado>=version.versionCode,
      `Se anuncia la versión ${version.versionCode} y solo hay compilada la ${compilado}`);
  }
});
