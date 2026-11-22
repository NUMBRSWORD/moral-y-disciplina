const encoder = new TextEncoder();
async function datos(id, ruta, token, cuerpo) {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", cuerpo));
  return encoder.encode(JSON.stringify([id,ruta,token,Array.from(hash)]));
}
async function llave(secreto) {
  return crypto.subtle.importKey("raw",encoder.encode(secreto),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);
}
export async function emitirReserva(secreto,ruta,token,cuerpo) {
  const id = Date.now()+"."+crypto.randomUUID();
  const mac = await crypto.subtle.sign("HMAC",await llave(secreto),await datos(id,ruta,token,cuerpo));
  return id+"."+Array.from(new Uint8Array(mac),x=>x.toString(16).padStart(2,"0")).join("");
}
export async function comprobarReserva(valor,secreto,ruta,token,cuerpo,usadas) {
  if (!/^\d{13}\.[\da-f-]{36}\.[\da-f]{64}$/.test(valor)) return false;
  const [fecha,nonce,hex] = valor.split(".");
  const ahora = Date.now();
  if (Number(fecha) < ahora-90000 || Number(fecha) > ahora+5000) return false;
  const id = fecha+"."+nonce;
  const firma = Uint8Array.from(hex.match(/../g),p=>parseInt(p,16));
  const ok = await crypto.subtle.verify("HMAC",await llave(secreto),firma,await datos(id,ruta,token,cuerpo));
  if (!ok) return false;
  for (const [k,fin] of usadas) if (fin < ahora) usadas.delete(k);
  if (usadas.has(id)) return false;
  usadas.set(id,Number(fecha)+90000);
  return true;
}
