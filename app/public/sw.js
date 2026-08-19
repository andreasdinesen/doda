'use strict';
/* doda - service worker.
 *
 * VERSION stemples af build_rune.py, praecis som ?v= i index.html. De to SKAL
 * folges ad: bumpes cache-navnet ikke, hober hver udgivelse sig op i
 * browserens cache, og SW'en kan servere en gammel app.js i det uendelige
 * (RUNE-ERFARINGER §5). */

const VERSION = 36;
const CACHE = `doda-v${VERSION}`;

// Praecis de samme URL'er som index.html henter - ellers ligger der to
// kopier, og den precachede bliver aldrig brugt.
const SKAL = [
  './',
  `./style.css?v=${VERSION}`,
  `./app.js?v=${VERSION}`,
  './manifest.webmanifest',
  './icon-192.png',
  './icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // addAll fejler samlet, hvis ét svar er daarligt. Hellere hver for sig:
    // en manglende fil ma ikke forhindre installationen.
    await Promise.all(SKAL.map((u) => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const navn of await caches.keys()) {
      if (navn.startsWith('doda-') && navn !== CACHE) await caches.delete(navn);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'ryd') caches.keys().then((n) => n.forEach((x) => caches.delete(x)));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  // Skrivninger rores ALDRIG. Fangst offline haandteres af appens egen koe -
  // en service worker, der gemmer POST'er, ville sende dem i tilfaeldig
  // raekkefolge og uden at kunne vise brugeren hvad der skete.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Protokol-endepunkter er ikke appen og ma aldrig serveres fra cachen:
  // et OAuth-samtykke eller et .well-known-dokument skal ALTID komme fra
  // serveren, og de er meningsloese offline.
  if (url.pathname === '/mcp' || url.pathname.startsWith('/oauth/')
      || url.pathname.startsWith('/.well-known/')) return;

  // Selve siden: net foerst, sa en ny udgivelse altid opdages, men skallen
  // findes offline.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const svar = await fetch(req);
        // KUN app-skallen gemmes under './'. Ellers kunne en hvilken som
        // helst anden navigation ende med at vaere det, brugeren far at se,
        // naeste gang han abner doda uden net.
        if (url.pathname === '/') (await caches.open(CACHE)).put('./', svar.clone());
        return svar;
      } catch {
        return (await caches.match('./')) || new Response('Offline', { status: 503 });
      }
    })());
    return;
  }

  // Data: net foerst, men gem hvert godt svar, sa listerne kan laeses uden net.
  if (url.pathname.startsWith('/api/v1/')) {
    e.respondWith((async () => {
      try {
        const svar = await fetch(req);
        if (svar.ok) (await caches.open(CACHE)).put(req, svar.clone());
        return svar;
      } catch {
        const gemt = await caches.match(req);
        if (gemt) {
          // Marker svaret, sa appen kan sige aerligt, at tallene er gamle.
          const h = new Headers(gemt.headers);
          h.set('X-Doda-Offline', '1');
          return new Response(await gemt.blob(), { status: 200, headers: h });
        }
        return new Response(JSON.stringify({ error: 'offline', message: 'You are offline and this has not been loaded before.' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } });
      }
    })());
    return;
  }

  // Statiske filer er versionerede -> cache foerst er sikkert og hurtigt.
  e.respondWith((async () => {
    const gemt = await caches.match(req);
    if (gemt) return gemt;
    try {
      const svar = await fetch(req);
      if (svar.ok) (await caches.open(CACHE)).put(req, svar.clone());
      return svar;
    } catch {
      return new Response('', { status: 504 });
    }
  })());
});

/* --------------------------------------------------------------- push
 *
 * Pushen er TOM. Den vaekker kun denne worker, som selv henter fra serveren,
 * hvad den skal vise - saa faar Apples og Googles push-tjenester aldrig at
 * vide, hvad opgaverne hedder.
 *
 * En push SKAL ende i en synlig notifikation. Goer den ikke det, viser
 * browseren sin egen "dette websted er opdateret i baggrunden", og den er
 * baade forvirrende og umulig at slippe af med. Derfor har hver gren her et
 * showNotification til sidst - ogsaa naar hentningen fejler. */
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let items = [];
    try {
      // fetch i en service worker sender selv cookies til samme oprindelse.
      const r = await fetch('./api/v1/due-now', { credentials: 'same-origin' });
      if (r.ok) items = (await r.json()).items || [];
    } catch { /* uden svar viser vi det generelle */ }

    if (items.length === 1) {
      const it = items[0];
      return self.registration.showNotification(it.title, {
        body: it.due_time ? `Due at ${it.due_time}` : 'Due now',
        tag: `doda-${it.id}`, icon: './icon-192.png', badge: './icon-192.png',
        data: { url: './' },
      });
    }
    if (items.length > 1) {
      return self.registration.showNotification(`${items.length} tasks are due`, {
        body: items.map((i) => i.title).join(' · ').slice(0, 120),
        tag: 'doda-many', icon: './icon-192.png', badge: './icon-192.png',
        data: { url: './' },
      });
    }
    return self.registration.showNotification('doda', {
      body: 'Something is due — open doda to see it.',
      tag: 'doda-generisk', icon: './icon-192.png', data: { url: './' },
    });
  })());
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil((async () => {
    // Er doda allerede aaben et sted, skal den frem - ikke aabnes igen.
    const vinduer = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const v of vinduer) {
      if (v.url.includes(self.registration.scope) && 'focus' in v) return v.focus();
    }
    return clients.openWindow('./');
  })());
});
