/* ═══════════════════════════════════════════════════════════════════════════
 *  Zusatzfunktionen: Abstimmung, Clip des Monats, Meilensteine,
 *  Jahresrückblick (mit Teilen-Bild) und Savannen-Geräusche.
 *  Nutzt die Helfer aus app.js (window.StreamUtil).
 * ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var U = window.StreamUtil;
  var CFG = U.CFG, $ = U.$, esc = U.esc, fmtNum = U.fmtNum, fmtDate = U.fmtDate;

  function store(key, val) {
    try {
      if (val === undefined) return JSON.parse(localStorage.getItem(key) || "null");
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { return null; }
  }

  // Wort des Tages, Wordle & Emotle: siehe raetsel.js

  // ═══════════════════════════════════════════════════════════════════════
  //  Abstimmung (Frage im Google Sheet, Stimmen über das Apps Script)
  // ═══════════════════════════════════════════════════════════════════════
  var VOTER_KEY = "stream_voter_id";
  var VOTES_KEY = "stream_votes_v1";
  var poll = null;

  function voterId() {
    var id = store(VOTER_KEY);
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();
      store(VOTER_KEY, id);
    }
    return id;
  }

  function renderPoll(p) {
    var body = $("poll-body");
    if (!p || !p.options || !p.options.length) {
      body.innerHTML = '<p class="empty">Gerade läuft keine Abstimmung. Schau bald wieder vorbei!</p>';
      return;
    }
    poll = p;
    var mine = (store(VOTES_KEY) || {})[p.id];
    var total = p.options.reduce(function (s, o) { return s + (o.votes || 0); }, 0);
    var voted = mine != null;

    body.innerHTML = '<p class="poll-q">' + esc(p.question) + "</p>"
      + '<div class="poll-options">' + p.options.map(function (o, i) {
          var pct = total ? Math.round((o.votes || 0) / total * 100) : 0;
          return '<button type="button" class="poll-opt' + (voted ? " shown" : "") + (mine === i ? " mine" : "") + '" data-opt="' + i + '"'
            + (voted ? " disabled" : "") + ">"
            + '<span class="poll-fill" style="width:' + (voted ? pct : 0) + '%"></span>'
            + '<span class="poll-text">' + (mine === i ? "✔ " : "") + esc(o.text) + "</span>"
            + (voted ? '<span class="poll-pct">' + pct + " %</span>" : "")
            + "</button>";
        }).join("") + "</div>"
      + '<p class="poll-foot">' + (voted ? fmtNum(total) + " Stimmen · Danke fürs Abstimmen!" : "Tippe auf deine Antwort – eine Stimme pro Gerät.") + "</p>";
  }

  // Stimme ans Apps Script senden. Erst wenn der Server sie bestätigt, gilt sie
  // auf diesem Gerät als abgegeben – sonst kann man es nochmal versuchen.
  var voting = false;
  function sendVote(query, box, done) {
    if (voting) return;
    voting = true;
    box.classList.add("is-voting");
    var url = CFG.apiUrl + (CFG.apiUrl.indexOf("?") === -1 ? "?" : "&") + query + "&voter=" + encodeURIComponent(voterId());
    function fail(msg) {
      voting = false;
      box.classList.remove("is-voting");
      var old = box.querySelector(".vote-error");
      if (old) old.remove();
      var p = document.createElement("p");
      p.className = "vote-error";
      p.setAttribute("role", "alert");
      p.textContent = msg || "Deine Stimme konnte gerade nicht gespeichert werden – bitte nochmal versuchen.";
      box.appendChild(p);
    }
    fetch(url).then(function (r) { return r.json(); }).then(function (res) {
      if (!res || res.error) return fail(res && res.error);
      voting = false;
      box.classList.remove("is-voting");
      done(res);
    }).catch(function () { fail(); });
  }

  function remember(pollId, choice) {
    var votes = store(VOTES_KEY) || {};
    votes[pollId] = choice;
    store(VOTES_KEY, votes);
  }

  function vote(i) {
    if (!poll || (store(VOTES_KEY) || {})[poll.id] != null) return;
    if (U.DEMO) {
      remember(poll.id, i);
      poll.options[i].votes = (poll.options[i].votes || 0) + 1;
      renderPoll(poll);
      return;
    }
    var id = poll.id;
    sendVote("vote=1&poll=" + encodeURIComponent(id) + "&option=" + i, $("poll-body"), function (p) {
      remember(id, i);
      renderPoll(p);
    });
  }

  function initPoll() {
    $("poll-body").addEventListener("click", function (e) {
      var b = e.target.closest("[data-opt]");
      if (b) vote(Number(b.getAttribute("data-opt")));
    });
    $("poll-body").innerHTML = '<p class="empty">' + (U.consentGiven() || U.DEMO
      ? "Lädt …" : "Die Abstimmung braucht deine Einwilligung für externe Inhalte.") + "</p>";
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Clip des Monats (Stimmen über das Apps Script, eine pro Gerät)
  // ═══════════════════════════════════════════════════════════════════════
  var cotm = null;

  function monthName(key) {
    var p = String(key).split("-");
    return new Date(Number(p[0]), Number(p[1]) - 1, 1).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  }

  function renderCotm(c) {
    var box = $("cotm");
    if (!c) { box.innerHTML = '<p class="empty">Der Clip des Monats startet, sobald die Live-Daten geladen sind.</p>'; return; }
    cotm = c;
    var html = "";
    if (c.winner && c.winner.clip) {
      var w = c.winner.clip;
      html += '<div class="cotm-winner">' + U.clipMedia(w, false)
        + '<div><span class="clip-badge">🏆 Clip des Monats ' + esc(monthName(c.winner.month)) + "</span>"
        + "<h3>" + esc(w.title) + "</h3>"
        + '<div class="clip-meta">' + esc(c.winner.votes ? fmtNum(c.winner.votes) + " Stimmen · " : "") + esc(U.clipMeta(w)) + "</div></div></div>";
    }

    var cands = c.candidates || [];
    var pollId = "clip-" + c.month;
    var mine = (store(VOTES_KEY) || {})[pollId];
    var voted = mine != null;
    var total = cands.reduce(function (s, x) { return s + (x.votes || 0); }, 0);

    html += '<p class="cotm-q">Welcher Clip aus dem <b>' + esc(monthName(c.month)) + "</b> ist der beste?</p>";
    html += cands.length
      ? '<div class="cotm-grid">' + cands.map(function (x) {
          var pct = total ? Math.round((x.votes || 0) / total * 100) : 0;
          return '<div class="cotm-item' + (mine === x.id ? " mine" : "") + '">' + U.clipMedia(x, false)
            + '<div class="cotm-title">' + esc(x.title) + "</div>"
            + (voted
              ? '<div class="bar"><span style="width:' + pct + '%"></span></div><div class="bar-label">' + pct + " % · " + fmtNum(x.votes || 0) + " Stimmen" + (mine === x.id ? " · deine Wahl ✔" : "") + "</div>"
              : '<button class="btn btn-ghost cotm-vote" type="button" data-clipvote="' + esc(x.id) + '">Dafür stimmen</button>')
            + "</div>";
        }).join("") + "</div>"
      : '<p class="empty">In diesem Monat gibt es noch keine Clips – clippt fleißig! 🎬</p>';
    box.innerHTML = html;
  }

  function voteClip(id) {
    if (!cotm) return;
    var pollId = "clip-" + cotm.month;
    if ((store(VOTES_KEY) || {})[pollId] != null) return;
    if (U.DEMO) {
      remember(pollId, id);
      cotm.candidates.forEach(function (x) { if (x.id === id) x.votes = (x.votes || 0) + 1; });
      renderCotm(cotm);
      return;
    }
    sendVote("clipvote=1&clip=" + encodeURIComponent(id), $("cotm"), function (c) {
      remember(pollId, id);
      renderCotm(c);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Meilensteine
  // ═══════════════════════════════════════════════════════════════════════
  function renderMilestones(d) {
    var all = CFG.milestones || [];
    // Erreichte Meilensteine nach Datum, „Demnächst“-Einträge (ohne Datum) ans Ende
    var list = all.filter(function (m) { return m.date; }).sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    var upcoming = all.filter(function (m) { return !m.date; });
    var goal = CFG.followerGoal;
    var followers = d && d.followers;
    function msDate(v) {
      // „2019-05“ → „Mai 2019“, „2014-08-05“ → „5. August 2014“
      return /^\d{4}-\d{2}$/.test(v)
        ? fmtDate(v + "-01", { month: "long", year: "numeric" })
        : fmtDate(v, { day: "numeric", month: "long", year: "numeric" });
    }
    var items = list.map(function (m) {
      return '<li class="ms done"><span class="ms-dot">' + esc(m.icon || "⭐") + "</span>"
        + '<div class="ms-body"><div class="ms-date">' + esc(msDate(m.date)) + "</div>"
        + '<div class="ms-title">' + esc(m.title) + "</div>"
        + (m.text ? '<div class="ms-text">' + esc(m.text) + "</div>" : "") + "</div></li>";
    });
    upcoming.forEach(function (m) {
      items.push('<li class="ms next"><span class="ms-dot">' + esc(m.icon || "⭐") + "</span>"
        + '<div class="ms-body"><div class="ms-date">Demnächst</div>'
        + '<div class="ms-title">' + esc(m.title) + "</div>"
        + (m.text ? '<div class="ms-text">' + esc(m.text) + "</div>" : "") + "</div></li>");
    });
    items.push('<li class="ms next"><span class="ms-dot"><svg class="ms-gazelle"><use href="#sym-gazelle"/></svg></span>'
      + '<div class="ms-body"><div class="ms-date">Als Nächstes</div>'
      + '<div class="ms-title">' + fmtNum(goal.target) + " Follower</div>"
      + '<div class="ms-text">' + (followers != null ? "Noch " + fmtNum(Math.max(0, goal.target - followers)) + " – wir laufen gemeinsam hin! 🌳" : "Wir laufen gemeinsam hin! 🌳")
      + "</div></div></li>");
    $("timeline").innerHTML = items.join("");
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Jahresrückblick
  // ═══════════════════════════════════════════════════════════════════════
  function wrappedStats(d) {
    var year = (d.herd && d.herd.year) || new Date().getFullYear();
    var herd = (d.herd && d.herd.members) || [];
    var herdMinutes = (d.herd && d.herd.totalMinutes != null) ? d.herd.totalMinutes
      : herd.reduce(function (s, m) { return s + m.minutes; }, 0);
    var clip = d.clips && d.clips.items && d.clips.items[0];
    var game = d.games && d.games[0];
    var hs = d.highscores || {};
    var out = [];
    out.push({ icon: "⏱️", big: fmtNum(Math.round(herdMinutes / 60)) + " h", label: "habt ihr zusammen zugeschaut" });
    out.push({ icon: "🦌", big: fmtNum((d.herd && d.herd.total) || herd.length), label: "Gazellen in der Herde" });
    if (herd[0]) out.push({ icon: "👑", big: herd[0].name || "Eine anonyme Gazelle", label: "Leitgazelle des Jahres · " + U.fmtHours(herd[0].minutes) });
    if (d.followers != null) out.push({ icon: "🐾", big: fmtNum(d.followers), label: "Follower" });
    if (game) out.push({ icon: "🎮", big: game.name, label: "meistgespieltes Spiel · " + U.fmtHours(game.minutes) });
    if (clip && d.clips.scope === "year") out.push({ icon: "🎬", big: clip.title, label: "Clip des Jahres · " + fmtNum(clip.views) + " Aufrufe" });
    CFG.highscoreGames.forEach(function (g) {
      var top = hs[g.key] && hs[g.key][0];
      if (top) out.push({ icon: g.icon, big: top.name, label: g.title + "-Champion · " + fmtNum(top.score) + " " + g.scoreLabel });
    });
    return { year: year, items: out };
  }

  function renderWrapped(d) {
    var w = wrappedStats(d);
    $("wrapped-title").textContent = "Jahresrückblick " + w.year;
    $("wrapped-grid").innerHTML = w.items.map(function (x, i) {
      return '<div class="card wrap-card" style="animation-delay:' + (i * 60) + 'ms">'
        + '<div class="wrap-icon">' + x.icon + "</div>"
        + '<div class="wrap-big">' + esc(x.big) + "</div>"
        + '<div class="wrap-label">' + esc(x.label) + "</div></div>";
    }).join("");
  }

  function loadImage(src) {
    return new Promise(function (res) {
      if (!src) return res(null);
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { res(null); };
      img.src = src;
    });
  }

  function wrapText(ctx, text, maxW) {
    var words = String(text).split(" "), lines = [], line = "";
    words.forEach(function (w) {
      var t = line ? line + " " + w : w;
      if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; } else line = t;
    });
    if (line) lines.push(line);
    return lines.slice(0, 2);
  }

  var shareUrl = null;
  function buildShareImage() {
    var d = U.data;
    if (!d) return;
    var w = wrappedStats(d);
    var btn = $("wrapped-btn");
    btn.disabled = true;
    btn.textContent = "Wird erstellt …";

    var bg = (CFG.backgroundImages && (CFG.backgroundImages.night || CFG.backgroundImages.day)) || "";
    function reset() { btn.disabled = false; btn.textContent = "Bild erstellen"; }
    if (shareUrl) { URL.revokeObjectURL(shareUrl); shareUrl = null; }
    Promise.all([
      loadImage(bg),
      document.fonts ? document.fonts.load('80px "Lilita One"').then(function () { return document.fonts.load('40px "Nunito"'); }) : null
    ]).then(function (r) {
      var img = r[0];
      var c = document.createElement("canvas");
      c.width = 1080; c.height = 1920;
      var ctx = c.getContext("2d");

      ctx.fillStyle = "#130e26";
      ctx.fillRect(0, 0, 1080, 1920);
      if (img) {
        // Foto füllt die untere Hälfte, oben weich in den Nachthimmel überblendet
        var ph = 1100, pw = ph * img.width / img.height, top = 1920 - ph;
        ctx.drawImage(img, (1080 - pw) / 2, top, pw, ph);
        var fade = ctx.createLinearGradient(0, top, 0, top + 520);
        fade.addColorStop(0, "#130e26");
        fade.addColorStop(1, "rgba(19,14,38,0)");
        ctx.fillStyle = fade;
        ctx.fillRect(0, top, 1080, 520);
        ctx.fillStyle = "rgba(19,14,38,.25)";
        ctx.fillRect(0, top + 520, 1080, ph - 520);
      } else {
        var g = ctx.createLinearGradient(0, 0, 0, 1920);
        g.addColorStop(0, "#120d24"); g.addColorStop(.55, "#3c1d3f"); g.addColorStop(1, "#b34a2a");
        ctx.fillStyle = g; ctx.fillRect(0, 0, 1080, 1920);
      }

      ctx.textAlign = "center";
      ctx.fillStyle = "#f29a3a";
      ctx.font = '800 40px "Nunito", sans-serif';
      ctx.fillText(CFG.displayName.toUpperCase() + " · TWITCH", 540, 150);
      ctx.fillStyle = "#f6e6cf";
      ctx.font = '110px "Lilita One", sans-serif';
      ctx.fillText("Mein Jahr", 540, 280);
      ctx.fillText("in der Savanne", 540, 395);
      ctx.fillStyle = "#f4c25a";
      ctx.font = '130px "Lilita One", sans-serif';
      ctx.fillText(String(w.year), 540, 540);

      var y = 640;
      w.items.slice(0, 6).forEach(function (x) {
        ctx.fillStyle = "rgba(34,20,26,.78)";
        roundRect(ctx, 90, y, 900, 170, 28); ctx.fill();
        ctx.textAlign = "left";
        ctx.font = '64px sans-serif';
        ctx.fillText(x.icon, 125, y + 108);
        ctx.fillStyle = "#f6e6cf";
        ctx.font = '54px "Lilita One", sans-serif';
        var lines = wrapText(ctx, x.big, 720);
        ctx.fillText(lines[0] + (lines.length > 1 ? " …" : ""), 230, y + 82);
        ctx.fillStyle = "#c9a98a";
        ctx.font = '600 32px "Nunito", sans-serif';
        ctx.fillText(wrapText(ctx, x.label, 720)[0], 230, y + 132);
        ctx.textAlign = "center";
        y += 195;
      });

      ctx.fillStyle = "#f29a3a";
      ctx.font = '800 38px "Nunito", sans-serif';
      ctx.fillText("twitch.tv/" + CFG.streamer, 540, 1860);

      c.toBlob(function (blob) {
        reset();
        if (!blob) return;
        var url = shareUrl = URL.createObjectURL(blob);
        var file = window.File ? new File([blob], "savanne-" + w.year + ".png", { type: "image/png" }) : null;
        var canShare = file && navigator.canShare && navigator.canShare({ files: [file] });
        $("wrapped-preview").innerHTML = '<img src="' + url + '" alt="Jahresrückblick als Bild">'
          + '<div class="wrapped-actions">'
          + '<a class="btn btn-primary" href="' + url + '" download="savanne-' + w.year + '.png">⬇ Herunterladen</a>'
          + (canShare ? '<button class="btn btn-ghost" type="button" id="wrapped-share">📲 Teilen</button>' : "")
          + "</div>";
        if (canShare) $("wrapped-share").onclick = function () {
          navigator.share({ files: [file], title: "Mein Jahr in der Savanne" }).catch(function () {});
        };
      }, "image/png");
    }).catch(function (err) {
      console.error("Teilen-Bild:", err);
      reset();
      $("wrapped-preview").innerHTML = '<p class="empty">Das Bild konnte gerade nicht erstellt werden – bitte nochmal versuchen.</p>';
    });
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Savannen-Geräusche (live erzeugt, keine Audiodateien)
  //  Tag: Wind + Vogelzwitschern · Nacht: Wind + Grillen
  // ═══════════════════════════════════════════════════════════════════════
  var audio = null;

  function startSound() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    var ctx = new AC();
    var master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    master.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 2);

    // Wind: gefiltertes Rauschen, das langsam an- und abschwillt
    var len = ctx.sampleRate * 4, buf = ctx.createBuffer(1, len, ctx.sampleRate), ch = buf.getChannelData(0), last = 0;
    for (var i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; ch[i] = last * 3.5; }
    var noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
    var filter = ctx.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = 500;
    var windGain = ctx.createGain(); windGain.gain.value = 0.25;
    var lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    var lfoGain = ctx.createGain(); lfoGain.gain.value = 0.15;
    lfo.connect(lfoGain); lfoGain.connect(windGain.gain);
    noise.connect(filter); filter.connect(windGain); windGain.connect(master);
    noise.start(); lfo.start();

    function chirp(t, f1, f2, dur, vol) {
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(f1, t);
      o.frequency.exponentialRampToValueAtTime(f2, t + dur);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol, t + dur * 0.2);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.02);
    }

    var timer = setInterval(function () {
      var t = ctx.currentTime + 0.05;
      var night = document.documentElement.getAttribute("data-theme") === "night";
      if (night) {
        // Grillen: kurze, hohe Pulse in Gruppen
        if (Math.random() < 0.8) {
          var f = 4200 + Math.random() * 600;
          for (var k = 0; k < 3; k++) chirp(t + k * 0.045, f, f * 1.01, 0.03, 0.018);
        }
      } else if (Math.random() < 0.35) {
        // Vogel: 2–4 Pfiffe
        var base = 2200 + Math.random() * 1600, n = 2 + Math.floor(Math.random() * 3);
        for (var j = 0; j < n; j++) chirp(t + j * 0.13, base, base * (1.15 + Math.random() * 0.3), 0.09, 0.035);
      }
    }, 600);

    audio = { ctx: ctx, master: master, timer: timer };
    return true;
  }

  function stopSound() {
    if (!audio) return;
    var a = audio;
    audio = null;
    clearInterval(a.timer);
    a.master.gain.linearRampToValueAtTime(0, a.ctx.currentTime + 0.6);
    setTimeout(function () { a.ctx.close(); }, 700);
  }

  function initSound() {
    var btn = $("sound-toggle");
    btn.onclick = function () {
      if (audio) stopSound(); else if (!startSound()) return;
      btn.textContent = audio ? "🔊" : "🔇";
      btn.setAttribute("aria-pressed", audio ? "true" : "false");
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Start
  // ═══════════════════════════════════════════════════════════════════════
  var wrappedRendered = false;
  function onData(d) {
    renderPoll(d.poll);
    renderCotm(d.clipOfMonth);
    renderMilestones(d);
    renderWrapped(d);
    wrappedRendered = true;
  }

  initPoll();
  $("cotm").addEventListener("click", function (e) {
    var b = e.target.closest("[data-clipvote]");
    if (b) voteClip(b.getAttribute("data-clipvote"));
  });
  initSound();
  renderMilestones(null);
  $("wrapped-btn").onclick = buildShareImage;
  document.addEventListener("streamdata", function (e) { onData(e.detail); });
  if (U.data) onData(U.data);
  if (!wrappedRendered) {
    $("wrapped-grid").innerHTML = '<div class="card"><p class="empty">Der Rückblick erscheint, sobald die Live-Daten geladen sind.</p></div>';
  }
})();
