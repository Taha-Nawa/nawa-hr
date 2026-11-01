/* Service worker للنظام الرئيسي: يجعل الواجهة تفتح بلا اتصال وتُثبَّت كتطبيق.
   - لا يلمس /api ولا /gate (للبوابة service worker خاص بها) ولا أي نطاق آخر: البيانات تُجلب دائماً من الخادم مباشرة.
   - الشبكة أولاً ثم النسخة المخزّنة، فلا تبقى واجهة قديمة بعد أي نشر جديد. */
const VERSION = 'app-v1';
const SHELL = [
  '/', '/css/app.css', '/css/print.css', '/js/main.js', '/js/dom.js', '/js/api.js', '/js/auth.js', '/js/pwa.js',
  '/img/icons.svg', '/img/band.svg', '/logo.png', '/manifest.webmanifest',
  '/fonts/alexandria-arabic.woff2', '/fonts/alexandria-latin.woff2', '/icons/icon-192.png',
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
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/gate/') || url.pathname.startsWith('/cdn-cgi/')) return;
  const key = req.mode === 'navigate' ? '/' : req;
  e.respondWith(
    fetch(req)
      .then((r) => {
        if (r.ok && !r.redirected) caches.open(VERSION).then((c) => c.put(key, r.clone()));
        return r;
      })
      .catch(() => caches.match(key).then((hit) => hit || Response.error())),
  );
});
