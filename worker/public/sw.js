// Ürün Takip service worker: telefon/bilgisayar bildirimlerini gösterir.
// Sayfaları önbelleğe almaz; panel her zaman güncel hâliyle açılır.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data?.text() };
  }
  const title = data.title || 'Ürün Takip';
  const options = {
    body: data.body || 'Bildirimler bu cihazda açık.',
    icon: '/icon-192.png',
    badge: '/badge-96.png',
    image: data.image || undefined,
    tag: data.tag || undefined,
    renotify: !!data.tag,
    data: { url: data.url || '/', leave: data.leave || null },
    actions: data.leave
      ? [
          { action: 'open', title: 'Ürüne git' },
          { action: 'leave', title: 'Takibi bırak' },
        ]
      : [],
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const { url, leave } = event.notification.data || {};
  const target = event.action === 'leave' && leave ? leave : url || '/';
  event.waitUntil(self.clients.openWindow(target));
});
