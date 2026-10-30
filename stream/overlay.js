/* OBS-Overlay „Die Herde“: kündigt nur Aufstiege an – und nur von Zuschauern,
 * die per „!herde“ mit Namen sichtbar sein wollen. Es laufen keine Gazellen
 * durchs Bild, Lurker erscheinen nie. Optionen siehe overlay.html. */
(function () {
  "use strict";

  var CFG = window.STREAM_CONFIG;
  var HC = window.HerdCore(CFG.herd);
  var params = new URLSearchParams(location.search);
  var DEMO = params.get("demo") === "1" || !CFG.apiUrl;
  var REFRESH_MS = 60000;

  if (params.get("pos") === "bottom") document.body.classList.add("bottom");

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  // ── Meldungen (nacheinander, je 7 Sekunden) ─────────────────────────────
  var queue = [], showing = false;
  function nextToast() {
    var t = queue.shift();
    if (!t) { showing = false; return; }
    showing = true;
    var el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = t;
    document.getElementById("toasts").appendChild(el);
    setTimeout(function () {
      el.classList.add("out");
      setTimeout(function () { el.remove(); nextToast(); }, 600);
    }, 7000);
  }

  function announceLevelUp(name, minutes) {
    var h = minutes / 60;
    var no = HC.stageNo(h);
    var st = HC.stageFor(h);
    var look = HC.lookFor(h);
    var top = no === CFG.herd.stages.length;
    queue.push(
      (look ? '<img class="t-gazelle" src="' + esc(look.img) + '" alt="">' : '<span class="t-icon">' + (top ? "👑" : "🎉") + "</span>")
      + "<span><b>" + esc(name) + "</b> ist aufgestiegen!"
      + "<small>" + (top ? "👑 " : "") + "Stufe " + no + " · " + esc(st.name) + "</small></span>");
    if (!showing) nextToast();
  }

  // ── Aufstiege erkennen: Stufe jedes sichtbaren Zuschauers merken ─────────
  var known = {};      // id → Stufe
  var first = true;
  function apply(d) {
    (d.live ? d.members || [] : []).forEach(function (m) {
      if (!m.name) return;                                  // anonym → nie anzeigen
      var stage = HC.stageNo(m.minutes / 60);
      var key = m.id || m.name;
      if (!first && known[key] && stage > known[key]) announceLevelUp(m.name, m.minutes);
      known[key] = stage;
    });
    first = false;
  }

  function load() {
    var url = CFG.apiUrl + (CFG.apiUrl.indexOf("?") === -1 ? "?" : "&") + "overlay=1";
    fetch(url, { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(apply)
      .catch(function (err) { console.warn("Overlay: Daten nicht geladen", err); });
  }

  // ── Demo: alle paar Sekunden steigt jemand auf ──────────────────────────
  if (DEMO) {
    var demo = { live: true, members: [
      ["Zebrastreifen", 849], ["Wüstenfuchs", 448], ["Akazienkind", 318], ["Steppenwolf", 149], ["Löwenzahn", 22]
    ].map(function (m) { return { id: m[0].toLowerCase(), name: m[0], minutes: Math.round(m[1] * 60) }; }) };
    apply(demo);
    setInterval(function () {
      var m = demo.members[Math.floor(Math.random() * demo.members.length)];
      var nx = HC.nextStage(m.minutes / 60);
      if (nx) m.minutes = Math.ceil(nx.hours * 60);
      apply(demo);
    }, 5000);
  } else {
    load();
    setInterval(load, REFRESH_MS);
  }
})();
