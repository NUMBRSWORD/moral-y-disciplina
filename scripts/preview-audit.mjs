// Previsualización de la web real contra un transporte de SOLO LECTURA ficticio.
// No usa credenciales reales ni conecta con Supabase. Puerto exclusivo de auditoría.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve('.');
const mock=new URL('../tests/fixtures/supabase-preview.mjs',import.meta.url);
http.createServer(async(req,res)=>{
  try {
    const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname);
    if(req.method!=='GET')throw new Error('Solo lectura');
    if(pathname==='/qa-supabase.js'){
      res.setHeader('Content-Type','application/javascript');res.end(await readFile(mock));return;
    }
    const nombre=pathname==='/'?'index.html':pathname.slice(1);
    if(!/^(index\.html|app\.js|styles\.css|config\.js|sw\.js|manifest\.webmanifest|favicon\.svg|icon\.svg|lib\/[\w.-]+\.js|assets\/[\w/.-]+)$/.test(nombre))throw new Error('Fuera de la previsualización');
    const archivo=path.resolve(root,nombre);
    if(!archivo.startsWith(root+path.sep))throw new Error('Ruta inválida');
    let data=await readFile(archivo);
    if(nombre==='app.js')data=Buffer.from(data.toString()
      .replace('from "https://esm.sh/@supabase/supabase-js@2.116.0"','from "./qa-supabase.js"')
      .replaceAll('"serviceWorker" in navigator','false')
      .replace('void prepararAlertasMovil();','/* Alertas reales desactivadas en QA. */'));
    if(nombre==='config.js')data=Buffer.from('export const SUPABASE_URL="https://qa.invalid", SUPABASE_ANON_KEY="ficticio", VAPID_PUBLIC_KEY="";');
    const tipos={'.html':'text/html','.css':'text/css','.js':'application/javascript','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
    res.setHeader('Content-Type',tipos[path.extname(nombre)]||'application/octet-stream');
    res.setHeader('Cache-Control','no-store');res.end(data);
  }catch(_){res.writeHead(404);res.end('No disponible en QA');}
}).listen(4179,'127.0.0.1',()=>console.log('QA ficticia: http://127.0.0.1:4179 (sin Supabase real)'));
