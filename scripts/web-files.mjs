import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// La raíz unificada es la fuente. Solo estos archivos se sincronizan a la web.
export function archivosWeb() {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {encoding:'utf8'}).split('\0').filter(Boolean);
  const roots = new Set(['app.js','index.html','styles.css','config.js','sw.js','manifest.webmanifest','favicon.svg','icon.svg',
    'descargar.html','eliminar-cuenta.html','package.json','package-lock.json','web-contract.json','.gitignore']);
  return [...new Set(files)].filter(f => existsSync(f)).filter(f => roots.has(f)
    || /^(lib|assets|plantillas|descargas|supabase|docs|scripts|tests)\//.test(f)
    || f === '.github/workflows/jekyll-gh-pages.yml');
}

export function archivosPublicos() {
  return archivosWeb().filter(f => /^(lib|assets|plantillas|descargas)\//.test(f) && !/\.test\.[cm]?js$/.test(f)
    || /^(app\.js|index\.html|styles\.css|config\.js|sw\.js|manifest\.webmanifest|favicon\.svg|icon\.svg|descargar\.html|eliminar-cuenta\.html)$/.test(f));
}
