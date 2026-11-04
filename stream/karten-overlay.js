/* ═══════════════════════════════════════════════════════════════════════════
 *  Herden-Karten – OBS-Overlay
 *  Fragt alle 3 Sekunden die Supabase-Funktion cards_overlay_feed ab (nur
 *  Legendary, Mythic und Shiny) und zeigt jeden Treffer nacheinander groß an.
 *  ?demo=1 → Beispiel-Meldungen, ?sound=0 → ohne Klänge
 * ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var CFG = window.STREAM_CONFIG, C = CFG.cards;
  var params = new URLSearchParams(window.location.search);
  var DEMO = params.get("demo") === "1";
  var SOUND = params.get("sound") !== "0";
  var POLL_MS = 3000, SHOW_MS = 7500;
  var RARITY_NAMES = { C: "Common", U: "Uncommon", R: "Rare", E: "Epic", L: "Legendary", M: "Mythic" };
  var stage = document.getElementById("ko-stage");
  var queue = [], busy = false, last = null;
  var HC = window.HerdCore ? window.HerdCore(CFG.herd) : null;

  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function pad(n) { return String(n).padStart(3, "0"); }
  // Eigene Bilder (relativer Pfad) oder Twitch-Profilbilder (Personen-Karten)
  function safeImg(src) {
    if (typeof src !== "string" || src.indexOf("..") !== -1) return "";
    if (/^[\w\-./]+$/.test(src)) return src;
    return /^https:\/\/static-cdn\.jtvnw\.net\/[\w\-./]+$/.test(src) ? src : "";
  }

  function backArt() {
    var look = HC ? HC.lookFor(CFG.herd.maxHours || 1000) : null;
    var src = look && safeImg(look.img);
    return src ? '<img class="kt-back-img" src="' + esc(src) + '" alt="">' : '<svg><use href="#sym-gazelle"/></svg>';
  }

  function cardFace(c) {
    var img = safeImg(c.image);
    return '<div class="kc r-' + c.rarity + (c.shiny ? " shiny" : "") + (c.kind === "person" ? " person" : "") + '">'
      + '<span class="kc-no">#' + pad(c.number) + "</span>"
      + '<span class="kc-art">' + (img ? '<img src="' + esc(img) + '" alt="">' : '<svg><use href="#sym-gazelle"/></svg>') + "</span>"
      + '<span class="kc-name">' + esc(c.name) + "</span>"
      + '<span class="kc-rar">' + RARITY_NAMES[c.rarity] + (c.shiny ? " ✨" : "") + "</span></div>";
  }

  function sound(c) {
    var S = window.CardsSound;
    if (!SOUND || !S) return;
    S.play("tension");
    setTimeout(function () {
      S.play(c.rarity === "M" ? "mythic" : c.rarity === "L" ? "legendary" : c.rarity === "E" ? "epic" : "rare");
      if (c.shiny) setTimeout(function () { S.play("shiny"); }, 150);
    }, 1800);
  }

  function show(ev) {
    var c = ev.card;
    var banner = c.shiny ? "✨ SHINY! ✨" : c.rarity === "M" ? "🔥 MYTHIC! 🔥" : "⭐ LEGENDARY! ⭐";
    stage.innerHTML = '<div class="ko-alert r-' + c.rarity + (c.shiny ? " shiny" : "") + '">'
      + '<div class="ko-title"><b>' + esc(ev.name) + "</b> hat gezogen:</div>"
      + '<div class="ko-card"><div class="kt-face kt-back glow">' + backArt() + "</div>"
      + '<div class="kt-face kt-front">' + cardFace(c) + "</div></div>"
      + '<div class="ko-banner">' + banner + "</div></div>";
    sound(c);
    setTimeout(function () {
      var a = stage.querySelector(".ko-alert");
      if (a) a.classList.add("out");
      setTimeout(function () { stage.innerHTML = ""; busy = false; next(); }, 650);
    }, SHOW_MS);
  }

  function next() {
    if (busy || !queue.length) return;
    busy = true;
    show(queue.shift());
  }

  function poll() {
    fetch(C.supabaseUrl + "/rest/v1/rpc/cards_overlay_feed", {
      method: "POST",
      headers: { apikey: C.supabaseKey, "Content-Type": "application/json" },
      body: JSON.stringify({ p_after: last })
    }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j) return;
      if (last !== null) (j.events || []).forEach(function (e) { queue.push(e); });
      last = j.last;
      next();
    }).catch(function () { /* nächster Versuch in 3 s */ }).then(function () {
      setTimeout(poll, POLL_MS);
    });
  }

  if (DEMO) {
    var samples = [
      { name: "FlyingLinkachu", card: { number: 141, name: "Platzhalter #141", rarity: "L", shiny: false } },
      { name: "in_luce", card: { number: 148, name: "Platzhalter #148", rarity: "M", shiny: false } },
      { name: "Mr27cent", card: { number: 20, name: "Platzhalter #020", rarity: "C", shiny: true } }
    ];
    var n = 0;
    (function loop() { queue.push(samples[n++ % samples.length]); next(); setTimeout(loop, SHOW_MS + 2500); })();
  } else {
    poll();
  }
})();
