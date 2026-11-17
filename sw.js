/* Service worker : appli utilisable hors ligne + mises à jour automatiques */
const CACHE = "asdj-v13";
const SHELL = ["./", "index.html", "app.js?v=13", "config.js?v=13", "manifest.webmanifest", "version.json",
  "vendor/supabase.js", "vendor/591.supabase.js", "icons/icon-192.png", "icons/icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const req = e.request; const url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return; // Supabase : réseau direct
  const fresh = req.mode === "navigate" || /\.(html|js|json|webmanifest)$/.test(url.pathname) || url.pathname.endsWith("/");
  if (fresh) {
    // réseau d'abord (pour recevoir les mises à jour), copie locale si pas de réseau
    e.respondWith(fetch(req, { cache: "no-store" }).then(r => { const c = r.clone(); caches.open(CACHE).then(k => k.put(req, c)); return r; })
      .catch(() => caches.match(req).then(r => r || caches.match("index.html"))));
  } else {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(n => { const c = n.clone(); caches.open(CACHE).then(k => k.put(req, c)); return n; })));
  }
});

/* notifications envoyées par le robot (rappels des véhicules) */
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "ASDJ - Tools", { body: d.body || "", icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "asdj-vehicules", renotify: true, data: { url: d.url || "./#/vehicules" } }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./#/vehicules", self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then(ws => {
    for (const w of ws) if (w.url.startsWith(self.registration.scope) && "focus" in w) { if ("navigate" in w) w.navigate(url).catch(() => {}); return w.focus(); }
    return clients.openWindow(url);
  }));
});
