// Service worker de la PWA. Hace dos cosas:
//  1. Cachea el "app shell" para que la app abra rápido y tolere una
//     conexión intermitente (los datos siguen viniendo de Supabase en línea).
//  2. Muestra las notificaciones push cuando estén configuradas (VAPID +
//     Edge Function). Sin push configurado, este bloque simplemente no se usa.
const CACHE = "moral-y-disciplina-v43";
const APP_SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./config.js",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./icon.svg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Red primero; si falla (sin señal), se responde con la copia en caché.
// Nunca se cachean las llamadas a la API de Supabase.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // deja pasar Supabase, esm.sh, etc.
  // cache: "no-cache" = revalidar con el servidor en cada carga (petición
  // condicional: si no cambió responde 304 y casi no cuesta). Sin esto el
  // navegador reutilizaba archivos de la caché HTTP hasta 10 minutos (GitHub
  // Pages los sirve con max-age=600), así que tras publicar un arreglo se
  // seguía viendo la versión anterior de app.js / styles.css.
  event.respondWith(
    fetch(event.request, { cache: "no-cache" })
      .then((resp) => {
        if (resp.ok) {
          const copia = resp.clone();
          caches.open(CACHE).then((cache) => cache.put(event.request, copia)).catch(() => {});
        }
        return resp;
      })
      .catch(() => caches.match(event.request).then((c) => c || caches.match("./index.html")))
  );
});

self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; }
  catch (_) { data = { body: event.data ? event.data.text() : "Tiene una tarea pendiente." }; }
  event.waitUntil(
    self.registration.showNotification(data.title || "Moral y Disciplina — CPNP Ventanilla", {
      body: data.body || "Tiene un expediente pendiente de revisión.",
      icon: "icon.svg",
      badge: "icon.svg",
      tag: data.tag || "expediente-pendiente",
      renotify: true,
      data: { url: data.url || "./" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = (event.notification.data && event.notification.data.url) || "./";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientes) => {
      const abierto = clientes.find((c) => c.url.includes(self.location.origin));
      if (abierto) return abierto.focus();
      return self.clients.openWindow(destino);
    })
  );
});
