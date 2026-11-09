// Tax Doctor team app service worker: fast shell (hashed build files come from cache first), offline fallback, and push alerts.
const CACHE = "td-shell-v4";
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/icon-192.png"]).catch(() => {}))); });
self.addEventListener("activate", (e) => e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())));

self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin) return;
  if (u.pathname.startsWith("/api/") || u.pathname.startsWith("/portal/") || u.pathname.startsWith("/reset")) return; // never cache data or customer pages
  // build files have a content hash in their name, so a cached copy is always correct -> instant start
  if (u.pathname.startsWith("/assets/")) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; })));
    return;
  }
  // pages and icons: network first, cached copy when offline
  e.respondWith(fetch(e.request).then((r) => { if (r.ok) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; }).catch(() => caches.match(e.request).then((m) => m || caches.match("/"))));
});

// Payload-less web push: the push only says "something happened"; we ask the server what to show.
self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    let items = [];
    try { const r = await fetch("/api/push/latest", { credentials: "same-origin" }); items = (await r.json()).items || []; } catch {}
    if (!items.length) items = [{ title: "Tax Doctor", body: "You have a new notification", link: "/" }];
    for (const n of items) {
      await self.registration.showNotification(n.title, {
        body: n.body || "",
        icon: "/icon-192.png",
        badge: "/badge-96.png",
        data: { link: n.link || "/" },
        tag: "td-" + (n.id || Date.now()),
        renotify: true,
      });
    }
  })());
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    for (const c of cs) if ("focus" in c) { c.navigate(link).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(link);
  }));
});
