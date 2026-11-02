/* Service worker لبوابة الحضور: يجعل الصفحة تفتح فوراً وبلا اتصال.
   لا يلمس أي طلب لغير ملفات البوابة نفسها (لا Google ولا /api): الحركات تمرّ مباشرة دائماً. */
const VERSION = 'gate-v4';
const SHELL = [
  './', 'gate.css', 'gate.js', 'jsqr.js', 'manifest.webmanifest',
  'fonts/alexandria-arabic.woff2', 'fonts/alexandria-latin.woff2',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin || !url.pathname.startsWith('/gate/')) return;
  // ملاحظة: نخزّن الصفحة تحت './' (أي /gate/) لا /gate/index.html، لأن Cloudflare يعيد توجيه الثاني والاستجابة المُعاد توجيهها لا تصلح لطلبات التنقّل.
  // الصفحة نفسها: الشبكة أولاً (لالتقاط التحديثات) وإلا النسخة المخزّنة؛ الباقي: المخزّن أولاً ثم تحديثه بالخلفية.
  const isPage = req.mode === 'navigate';
  e.respondWith(
    isPage
      ? fetch(req).then((r) => { if (r.ok) caches.open(VERSION).then((c) => c.put('./', r.clone())); return r; })
          .catch(() => caches.match('./'))
      : caches.match(req).then((hit) => {
          const net = fetch(req).then((r) => { if (r.ok) caches.open(VERSION).then((c) => c.put(req, r.clone())); return r; });
          return hit || net;
        }),
  );
});
