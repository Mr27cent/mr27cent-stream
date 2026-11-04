/* Service Worker: macht die Seite installierbar und schnell.
 *  - Seiten, Skripte, Styles: zuerst aus dem Netz (immer aktuell), offline aus dem Zwischenspeicher
 *  - Bilder & Schriften: sofort aus dem Zwischenspeicher, im Hintergrund aktualisiert
 * Nur eigene Dateien – Twitch-, Google- und Discord-Daten werden nie zwischengespeichert. */
var VERSION = "stream-v32";
var CORE = [
  "./", "index.html", "theme.js", "style.css", "savanna.css", "config.js", "herd-core.js", "app.js",
  "extras.js", "savanna.js", "raetsel.js", "partner.js", "karten.js", "karten-sound.js", "karten.css", "raetsel.json", "wordle-woerter.json", "favicon.svg", "fonts/lilita-one-400.woff2", "fonts/nunito-var.woff2"
];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function isAsset(url) {
  return /\.(png|jpe?g|webp|svg|gif|woff2?)$/i.test(url.pathname);
}

self.addEventListener("fetch", function (e) {
  var req = e.request;
  var url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  e.respondWith(caches.open(VERSION).then(function (cache) {
    var network = fetch(req).then(function (res) {
      if (res.ok) cache.put(req, res.clone());
      return res;
    });

    if (isAsset(url)) {
      // Bilder & Schriften: Zwischenspeicher zuerst
      return cache.match(req).then(function (hit) {
        if (hit) { network.catch(function () {}); return hit; }
        return network.catch(function () { return Response.error(); });
      });
    }
    // Code & Seiten: Netz zuerst, offline den gespeicherten Stand
    return network.catch(function () {
      return cache.match(req, { ignoreSearch: true }).then(function (hit) {
        if (hit) return hit;
        // Offline und nicht gespeichert: bei Seitenaufrufen die Startseite zeigen
        return req.mode === "navigate" ? cache.match("index.html") : undefined;
      }).then(function (res) { return res || Response.error(); });
    });
  }));
});
