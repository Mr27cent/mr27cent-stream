/* ═══════════════════════════════════════════════════════════════════════════
 *  Herden-Karten – Klänge & Vibration für die Pack-Öffnung (karten.js)
 *  Alle Klänge entstehen live im Browser (Web Audio): mehrschichtig, mit Hall,
 *  ohne Dateien und ohne Lizenzfragen. Eigene Sounddateien lassen sich in
 *  config.js → cards.sounds eintragen (z. B. tear: "sounds/tear.mp3"); dann
 *  wird statt des erzeugten Klangs die Datei abgespielt.
 *  Ein/Aus merkt sich der Browser (localStorage), Standard: an.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var KEY = "cards_sound_v1";
  var FILES = (window.STREAM_CONFIG && window.STREAM_CONFIG.cards && window.STREAM_CONFIG.cards.sounds) || {};
  var ctx = null, master = null, verb = null, buffers = {};

  function enabled() {
    try { return localStorage.getItem(KEY) !== "off"; } catch (e) { return true; }
  }
  function setEnabled(on) {
    try { localStorage.setItem(KEY, on ? "on" : "off"); } catch (e) { /* egal */ }
  }

  // Erst beim ersten Klick anlegen (Browser erlauben Ton nur nach einer Aktion)
  function audio() {
    if (ctx) { if (ctx.state === "suspended") ctx.resume(); return ctx; }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createDynamicsCompressor();
    master.threshold.value = -14; master.ratio.value = 4;
    var out = ctx.createGain(); out.gain.value = 0.8;
    master.connect(out); out.connect(ctx.destination);
    // Hall: kurze, weich abklingende Rausch-Impulsantwort
    verb = ctx.createConvolver();
    var len = Math.floor(ctx.sampleRate * 2.2), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (var ch = 0; ch < 2; ch++) {
      var d = ir.getChannelData(ch);
      for (var i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    verb.buffer = ir;
    var wet = ctx.createGain(); wet.gain.value = 0.28;
    verb.connect(wet); wet.connect(master);
    return ctx;
  }

  function noiseBuffer(sec) {
    var len = Math.floor(ctx.sampleRate * sec), b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }

  // Ziel: trocken + Hallanteil
  function route(node, wet) {
    node.connect(master);
    if (wet) { var g = ctx.createGain(); g.gain.value = wet; node.connect(g); g.connect(verb); }
  }

  function env(g, t, a, peak, d) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  // Glockenartiger Ton aus mehreren Teiltönen (klingt „edel“ statt nach Piepser)
  function bell(t, freq, vol, dur, wet) {
    [[1, 1], [2.01, 0.45], [3.02, 0.22], [4.17, 0.1]].forEach(function (p) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = freq * p[0];
      env(g, t, 0.006, vol * p[1], dur / p[0] + 0.15);
      o.connect(g); route(g, wet);
      o.start(t); o.stop(t + dur + 0.4);
    });
  }

  // Gefiltertes Rauschen mit Hüllkurve (Reißen, Wischen, Funkeln)
  function whoosh(t, dur, f0, f1, vol, q, wet, type) {
    var s = ctx.createBufferSource(); s.buffer = noiseBuffer(dur + 0.1);
    var f = ctx.createBiquadFilter(); f.type = type || "bandpass"; f.Q.value = q || 1.2;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    var g = ctx.createGain(); env(g, t, Math.min(0.03, dur / 4), vol, dur);
    s.connect(f); f.connect(g); route(g, wet);
    s.start(t); s.stop(t + dur + 0.1);
  }

  var SYNTH = {
    // Folie aufreißen: knisternde Rausch-Stöße, die nach oben ziehen
    tear: function (t) {
      for (var i = 0; i < 9; i++) {
        whoosh(t + i * 0.028 + Math.random() * 0.01, 0.05 + Math.random() * 0.03,
          1800 + i * 300, 5200 + i * 400, 0.35, 2.5, 0.05, "bandpass");
      }
      whoosh(t + 0.05, 0.35, 900, 4000, 0.18, 0.7, 0.15, "highpass");
    },
    // Karte umdrehen: kurzes „Fwip“
    flip: function (t) {
      whoosh(t, 0.16, 600, 3200, 0.32, 1.1, 0.08);
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "triangle"; o.frequency.setValueAtTime(320, t + 0.1); o.frequency.exponentialRampToValueAtTime(180, t + 0.18);
      env(g, t + 0.1, 0.004, 0.12, 0.1); o.connect(g); route(g, 0.05); o.start(t + 0.1); o.stop(t + 0.3);
    },
    // Karte wegschieben
    swipe: function (t) { whoosh(t, 0.22, 2400, 500, 0.22, 0.9, 0.06, "bandpass"); },
    // Seltenheits-Klänge beim Aufdecken
    common: function (t) { bell(t, 784, 0.12, 0.5, 0.15); },
    rare: function (t) { bell(t, 659, 0.14, 0.7, 0.3); bell(t + 0.09, 988, 0.12, 0.8, 0.3); },
    epic: function (t) {
      [523, 659, 784, 1047].forEach(function (f, i) { bell(t + i * 0.075, f, 0.13, 1.0, 0.4); });
      whoosh(t, 0.9, 3000, 9000, 0.08, 0.5, 0.5, "highpass");
    },
    legendary: function (t) {
      // Akkord-Fanfare (C-Dur) mit Sägezahn-Schicht + Funkeln
      [261.6, 329.6, 392, 523.3].forEach(function (f, i) {
        var o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
        o.type = "sawtooth"; o.frequency.value = f;
        lp.type = "lowpass"; lp.frequency.setValueAtTime(600, t); lp.frequency.exponentialRampToValueAtTime(3200, t + 0.35);
        env(g, t + i * 0.04, 0.06, 0.07, 1.6);
        o.connect(lp); lp.connect(g); route(g, 0.45); o.start(t); o.stop(t + 2.2);
      });
      [1047, 1319, 1568, 2093].forEach(function (f, i) { bell(t + 0.25 + i * 0.07, f, 0.09, 1.2, 0.5); });
      whoosh(t + 0.2, 1.4, 4000, 11000, 0.1, 0.4, 0.6, "highpass");
    },
    mythic: function (t) {
      SYNTH.legendary(t);
      // Tiefer Einschlag + Chor-artige Fläche
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.6);
      env(g, t, 0.01, 0.55, 0.8); o.connect(g); route(g, 0.2); o.start(t); o.stop(t + 1);
      [392, 493.9, 587.3].forEach(function (f) {
        [-6, 6].forEach(function (det) {
          var v = ctx.createOscillator(), vg = ctx.createGain();
          v.type = "triangle"; v.frequency.value = f; v.detune.value = det;
          env(vg, t + 0.35, 0.4, 0.035, 2.2); v.connect(vg); route(vg, 0.7); v.start(t + 0.3); v.stop(t + 3.2);
        });
      });
    },
    // Shiny: hohes, glitzerndes Arpeggio
    shiny: function (t) {
      for (var i = 0; i < 10; i++) bell(t + i * 0.055, 1568 * Math.pow(2, (i % 5) / 5), 0.06, 0.6, 0.6);
      whoosh(t, 1.0, 6000, 12000, 0.07, 0.6, 0.6, "highpass");
    },
    // 5. Karte leuchtet: leises Anschwellen (Spannung)
    tension: function (t) {
      var o = ctx.createOscillator(), o2 = ctx.createOscillator(), g = ctx.createGain(), lp = ctx.createBiquadFilter();
      o.type = "sawtooth"; o2.type = "sawtooth"; o.frequency.value = 110; o2.frequency.value = 110.7;
      lp.type = "lowpass"; lp.frequency.setValueAtTime(200, t); lp.frequency.exponentialRampToValueAtTime(1400, t + 1.8);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.06, t + 1.6); g.gain.exponentialRampToValueAtTime(0.0001, t + 2.1);
      o.connect(lp); o2.connect(lp); lp.connect(g); route(g, 0.4);
      o.start(t); o2.start(t); o.stop(t + 2.2); o2.stop(t + 2.2);
    }
  };

  // Eigene Datei (falls eingetragen) einmal laden und zwischenspeichern
  function playFile(name) {
    var src = FILES[name];
    if (!src || !/^[\w\-./]+$/.test(src)) return false;
    if (buffers[name] === undefined) {
      buffers[name] = null;
      fetch(src).then(function (r) { return r.arrayBuffer(); })
        .then(function (b) { return ctx.decodeAudioData(b); })
        .then(function (buf) { buffers[name] = buf; play(name); })
        .catch(function () { buffers[name] = false; });
      return true;
    }
    if (!buffers[name]) return buffers[name] === null;   // lädt noch bzw. Fehler → erzeugter Klang
    var s = ctx.createBufferSource(); s.buffer = buffers[name]; s.connect(master); s.start();
    return true;
  }

  function play(name) {
    if (!enabled() || !audio()) return;
    if (playFile(name)) return;
    if (SYNTH[name]) SYNTH[name](ctx.currentTime + 0.01);
  }

  // Vibration (nur Handys, die das können)
  function buzz(pattern) {
    if (!enabled()) return;
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (e) { /* egal */ }
  }

  window.CardsSound = { play: play, buzz: buzz, enabled: enabled, setEnabled: setEnabled };
})();
