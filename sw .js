/* Modo sin señal: guarda la app en el celular. La página se busca primero en internet
   (así siempre llega la última versión) y, si no hay señal, se usa la copia guardada. */
const VERSION = 'cdg-2026-11-08-3';
const ARCHIVOS = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  './vendor/supabase.js', './vendor/591.supabase.js', './vendor/qrcode.js', './vendor/html2canvas.min.js', './vendor/jspdf.umd.min.js'];
self.addEventListener('install', e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(ARCHIVOS)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if(e.request.method !== 'GET' || u.origin !== location.origin) return;
  if(e.request.mode === 'navigate'){
    e.respondWith(fetch(e.request).then(r => { if(r.ok){ const cp = r.clone(); caches.open(VERSION).then(c => c.put('./index.html', cp)); } return r; }).catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { if(res.ok){ const cp = res.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); } return res; })));
});
