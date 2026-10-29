// Офлайн-режим: приложение сохраняется на телефоне и открывается без интернета.
// Файлы приложения сначала берём из сети, чтобы новая версия была видна сразу,
// а если сети нет или она медленная — из сохранённой копии.
// Номер в CACHE увеличивает deploy_github.sh: по нему телефоны узнают об обновлении.
const CACHE = 'tonus-v16';
const ASSETS = ['./', './index.html', './products.js', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png'];
const WAIT_MS = 3000; // столько ждём сеть, потом открываем сохранённую копию

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    // удаляем только свои старые копии: у тестовой версии на том же сайте кэш с другим названием
    const mine = k => k.replace(/\d+$/, '') === CACHE.replace(/\d+$/, '');
    const old = (await caches.keys()).filter(k => k !== CACHE && mine(k));
    await Promise.all(old.map(k => caches.delete(k)));
    await self.clients.claim();
    // Обновление: окна, открытые со старой версией, один раз перезагружаем
    if (old.length) {
      const wins = await self.clients.matchAll({ type: 'window' });
      wins.forEach(w => { if (w.navigate) w.navigate(w.url).catch(() => {}); });
    }
  })());
});

// Папка test/ — отдельная тестовая версия со своим офлайн-режимом: её запросы не трогаем
const TEST_DIR = new URL('test/', self.registration.scope).pathname;

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET') return;
  if (url.origin !== self.location.origin) { e.respondWith(savedFirst(req)); return; }
  if (url.pathname.startsWith(TEST_DIR)) return;
  e.respondWith(networkFirst(req, req.mode === 'navigate' ? './index.html' : req));
});

// Шрифты и прочее с чужих сайтов: сначала сохранённая копия
function savedFirst(req) {
  return caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok || res.type === 'opaque') {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
    }
    return res;
  }));
}

// Свои файлы: сначала сеть (с проверкой свежести), через WAIT_MS или без сети — сохранённая копия
function networkFirst(req, key) {
  const net = fetch(req.url, { cache: 'no-cache' }).then(unredirect).then(res => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(key, copy));
    }
    return res;
  });
  const saved = caches.open(CACHE).then(c => c.match(key, { ignoreSearch: true }));
  return new Promise(resolve => {
    let done = false;
    const use = r => { if (!done && r) { done = true; resolve(r); } };
    net.then(use, () => saved.then(r => use(r || Response.error())));
    setTimeout(() => saved.then(use), WAIT_MS);
  });
}

// Браузер не принимает ответ с переадресацией на открытие страницы — пересобираем его без неё
function unredirect(res) {
  if (!res.redirected) return res;
  return res.blob().then(b => new Response(b, { status: res.status, statusText: res.statusText, headers: res.headers }));
}
