/* Sinner · service worker: solo para notificaciones (no guarda copias de la app). */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { title: "Sinner", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Sinner Construcciones", {
    body: d.body || "",
    icon: "icon-192.png",
    badge: "icon-192.png",
    tag: d.tag || undefined,
    data: { url: d.url || "./#agenda" },
  }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./#agenda", self.registration.scope).href;
  e.waitUntil((async () => {
    const L = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of L) { if (c.url.startsWith(self.registration.scope)) { await c.focus(); c.navigate(url); return; } }
    await self.clients.openWindow(url);
  })());
});
