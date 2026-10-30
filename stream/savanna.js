/* ═══════════════════════════════════════════════════════════════════════════
 *  Animierte Savanne im Reiter „Die Herde“.
 *  Jede Gazelle läuft, grast und schaut sich um; ihre Größe folgt der Stufe.
 *  sync(list) gleicht die Herde fließend ab: Neue laufen ins Bild, Gegangene
 *  verschwinden, bei einem Stufenaufstieg wächst die Gazelle sichtbar.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function rand(a, b) { return a + Math.random() * (b - a); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;")
      .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  /**
   * @param box   Element, in das die Gazellen gesetzt werden
   * @param opts  { herd: config.herd, isActive: () => bool (Animation pausieren, wenn false),
   *               size: Grundgröße in px (Standard 90) }
   */
  window.SavannaScene = function (box, opts) {
    var HC = window.HerdCore(opts.herd);
    var isActive = opts.isActive || function () { return true; };
    var base = opts.size || 90;
    var herd = {};          // name (klein) → Gazelle
    var query = "";

    // Anonyme Gazellen haben keinen Namen, aber eine feste Kennung vom Server
    function memberKey(m) { return String(m.id || m.name || "").toLowerCase(); }

    function fit() {
      // Auf schmalen Szenen kleinere Gazellen, damit es nicht überfüllt wirkt
      return Math.max(0.5, Math.min(1, (box.clientWidth || window.innerWidth) / 1000));
    }

    function applySize(g) {
      var h = g.minutes / 60;
      var look = HC.lookFor(h);
      var st = HC.stageFor(h);
      var width = Math.round(base * HC.herdScale(h) * (0.55 + g.depth * 0.45) * fit() * (look ? 1.25 : 1));
      var el = g.el;
      el.style.width = width + "px";
      el.style.height = look ? "" : Math.round(width * 0.9) + "px";
      el.classList.toggle("photo", !!look);
      el.setAttribute("aria-label", g.name + ", " + st.name);
      var art = look
        ? '<img class="gz" src="' + esc(look.img) + '" alt="" draggable="false">'
        : '<svg class="gz" viewBox="0 0 100 90" aria-hidden="true"><use href="#sym-gazelle"/></svg>';
      el.innerHTML = art + '<span class="sg-name' + (g.name ? "" : " anon") + '">' + esc(g.name || "Anonyme Gazelle")
        + "<small>" + esc(st.name) + " · Stufe " + HC.stageNo(h) + "</small></span>";
      g.stage = HC.stageNo(h);
    }

    function create(m, fromEdge) {
      var el = document.createElement("button");
      el.type = "button";
      el.className = "sg";
      var g = {
        el: el, key: memberKey(m), name: m.name, minutes: m.minutes,
        depth: Math.random(),                                   // 0 = hinten, 1 = vorne
        x: fromEdge ? (Math.random() < 0.5 ? -6 : 106) : rand(3, 92),
        alive: true
      };
      g.speed = rand(5, 9) * (0.7 + HC.herdScale(m.minutes / 60) * 0.5);
      applySize(g);
      el.style.bottom = (3 + (1 - g.depth) * 19).toFixed(1) + "%";   // nur im Gras, nicht am Himmel
      el.style.zIndex = String(10 + Math.round(g.depth * 50));
      el.style.left = g.x + "%";
      if (g.x > 50 || Math.random() < 0.5) el.classList.add("left");
      edges(g);
      box.appendChild(el);
      herd[g.key] = g;
      markMe(g);

      if (fromEdge) walkTo(g, rand(10, 88), function () { schedule(g, rand(500, 2000)); });
      else schedule(g, rand(0, 3000));
      return g;
    }

    function schedule(g, ms) {
      if (reduceMotion) return;
      setTimeout(function () { step(g); }, ms);
    }

    function walkTo(g, target, done) {
      var el = g.el;
      var secs = Math.max(1.2, Math.abs(target - g.x) / g.speed);
      el.classList.remove("grazing");
      el.classList.toggle("left", target < g.x);
      el.style.transition = "left " + secs.toFixed(2) + "s linear, opacity 1s";
      el.classList.add("walking");
      void el.offsetWidth;                                 // Übergang sicher starten
      el.style.left = target + "%";
      g.x = target;
      edges(g);
      setTimeout(function () { el.classList.remove("walking"); if (done) done(); }, secs * 1000);
    }

    // Ein Schritt im Leben einer Gazelle: laufen, grasen oder umschauen
    function step(g) {
      if (!g.alive) return;
      if (!isActive() || document.hidden) { schedule(g, 2000); return; }
      var el = g.el;
      el.classList.remove("walking", "grazing");
      var r = Math.random();
      if (r < 0.5) {
        walkTo(g, Math.max(2, Math.min(93, g.x + rand(-28, 28))), function () { step(g); });
      } else if (r < 0.85) {
        el.classList.add("grazing");
        schedule(g, rand(2500, 6500));
      } else {
        if (Math.random() < 0.5) el.classList.toggle("left");
        schedule(g, rand(1200, 3500));
      }
    }

    // Namensschild am Rand nach innen klappen, damit es nicht abgeschnitten wird
    function edges(g) {
      g.el.classList.toggle("edge-l", g.x < 22);
      g.el.classList.toggle("edge-r", g.x > 78);
    }

    function remove(g) {
      g.alive = false;
      delete herd[g.key];
      g.el.classList.add("leaving");
      setTimeout(function () { g.el.remove(); }, 1200);
    }

    function markMe(g) {
      if (!g.name) { g.el.classList.remove("me"); return; }
      var n = g.name.toLowerCase();
      g.el.classList.toggle("me", !!query && (n === query || (query.length >= 3 && n.indexOf(query) === 0)));
    }

    /**
     * Herde abgleichen. Gibt Ereignisse zurück: [{type: "join"|"levelup", name, stage, stageName}]
     * animateJoin: neue Gazellen laufen vom Rand herein (sonst stehen sie gleich da)
     */
    function sync(list, animateJoin) {
      var events = [];
      var seen = {};
      list.forEach(function (m) {
        var key = memberKey(m);
        seen[key] = true;
        var g = herd[key];
        if (!g) {
          g = create(m, animateJoin && !reduceMotion);
          if (animateJoin) events.push({ type: "join", name: m.name, minutes: m.minutes, stage: g.stage });
          return;
        }
        var before = g.stage;
        var renamed = g.name !== m.name;      // z. B. per !herde sichtbar geworden
        g.minutes = m.minutes;
        g.name = m.name;
        if (renamed) { applySize(g); markMe(g); }
        if (HC.stageNo(m.minutes / 60) !== before) {
          applySize(g);
          g.el.classList.remove("grow");
          void g.el.offsetWidth;
          g.el.classList.add("grow");
          if (g.stage > before) {
            events.push({ type: "levelup", name: m.name, stage: g.stage, stageName: HC.stageFor(m.minutes / 60).name });
          }
        }
      });
      Object.keys(herd).forEach(function (k) { if (!seen[k]) remove(herd[k]); });
      return events;
    }

    function highlight(q) {
      query = String(q || "").trim().toLowerCase();
      Object.keys(herd).forEach(function (k) { markMe(herd[k]); });
    }

    function clear() {
      Object.keys(herd).forEach(function (k) { herd[k].alive = false; });
      herd = {};
      box.innerHTML = "";
    }

    // Antippen zeigt Name & Stufe
    box.addEventListener("click", function (e) {
      var el = e.target.closest(".sg");
      var wasOpen = el && el.classList.contains("show-name");
      box.querySelectorAll(".sg.show-name").forEach(function (x) { x.classList.remove("show-name"); });
      if (el && !wasOpen) el.classList.add("show-name");
    });

    return { sync: sync, highlight: highlight, clear: clear, core: HC };
  };

  // ═══════════════════════════════════════════════════════════════════════
  //  Einbindung im Reiter „Die Herde“ (nur auf der Webseite)
  // ═══════════════════════════════════════════════════════════════════════
  var U = window.StreamUtil;
  if (!U || !document.getElementById("scene")) return;
  var CFG = U.CFG, $ = U.$, fmtNum = U.fmtNum;
  var MAX_IN_SCENE = 40;
  var lastMode = null;

  var scene = window.SavannaScene($("scene-gazelles"), {
    herd: CFG.herd,
    isActive: function () { return $("herd").classList.contains("active"); }
  });

  function setBackground() {
    var sc = CFG.herd.sceneImages || {};
    var bg = (sc.day || sc.night) ? sc : (CFG.backgroundImages || {});
    var night = document.documentElement.getAttribute("data-theme") === "night";
    var src = night ? (bg.night || bg.day) : (bg.day || bg.night);
    $("scene").style.backgroundImage = src ? 'url("' + encodeURI(src) + '")' : "";
  }

  function render(d) {
    // Nur wer per !herde mit Namen dabei sein will, läuft durch die Savanne
    var members = ((d.herd && d.herd.members) || []).filter(function (m) { return m.name; });
    var live = !!(d.stream && d.stream.live);
    var list = live ? members.filter(function (m) { return m.present; }) : members;

    $("scene-title").innerHTML = live ? '<span class="scene-live">●</span> Live-Savanne' : "🌾 Die Savanne";
    $("scene-sub").textContent = live
      ? fmtNum(list.length) + (list.length === 1 ? " Gazelle der Herde schaut" : " Gazellen der Herde schauen") + " gerade zu"
      : "Offline – die Herde der Saison grast in Ruhe";
    var empty = $("scene-empty");
    empty.hidden = list.length > 0;
    empty.textContent = live
      ? "Noch keine Gazelle unterwegs – schreib !herde in den Chat, dann läufst du in ein paar Minuten hier mit."
      : "Noch ist die Savanne leer – schreib im Stream !herde in den Chat, dann läuft deine Gazelle hier mit. 🌱";

    // Wechsel live ↔ offline: ganze Herde austauschen; sonst fließend abgleichen
    var mode = live ? "live" : "off";
    if (mode !== lastMode) scene.clear();
    scene.sync(list.slice(0, MAX_IN_SCENE), lastMode === mode);
    lastMode = mode;
    scene.highlight($("herd-search").value);
  }

  $("herd-search").addEventListener("input", function () { scene.highlight(this.value); });
  $("theme-toggle").addEventListener("click", function () { setTimeout(setBackground, 0); });

  setBackground();
  document.addEventListener("streamdata", function (e) { render(e.detail); });
  if (U.data) render(U.data);
})();
