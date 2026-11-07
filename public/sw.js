// Tax Doctor team app service worker: tiny offline shell + payload-less web push.
const CACHE = "td-shell-v1";
self.addEventListener("install", (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/logo-taxdoctor.png"]).catch(() => {}))); });
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.pathname.startsWith("/api/") || u.pathname.startsWith("/portal/")) return; // never cache data or customer pages
  e.respondWith(fetch(e.request).then((r) => { if (r.ok && u.origin === location.origin) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); } return r; }).catch(() => caches.match(e.request).then((m) => m || caches.match("/"))));
});
self.addEventListener("push", (e) => {
  e.waitUntil((async () => {
    let items = [];
    try { const r = await fetch("/api/push/latest", { credentials: "same-origin" }); items = (await r.json()).items || []; } catch {}
    if (!items.length) items = [{ title: "Tax Doctor", body: "You have a new notification", link: "/" }];
    for (const n of items) await self.registration.showNotification(n.title, { body: n.body || "", icon: "/icon-192.png", badge: "/icon-192.png", data: { link: n.link || "/" }, tag: "td-" + (n.id || Date.now()) });
  })());
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const link = (e.notification.data && e.notification.data.link) || "/";
  e.waitUntil(self.clients.matchAll({ type: "window" }).then((cs) => { for (const c of cs) if ("focus" in c) { c.navigate(link); return c.focus(); } return self.clients.openWindow(link); }));
});
