/* ═══════════════════════════════════════════════════════════════════════════
 *  Rätsel im Reiter „Mitmachen“: Wort des Tages (Hangman), Wordle und Emotle
 *  plus Serien-Bestenliste.
 *
 *  - Jeden Tag für alle dasselbe Rätsel (Wortlisten in raetsel.json).
 *  - Spielstand & Statistik liegen im Browser (localStorage).
 *  - Wer einen Namen einträgt, meldet seine Ergebnisse ans Apps Script.
 *    Das Script prüft selbst nach, ob das Rätsel wirklich gelöst wurde, und
 *    zählt die Serie – Zahlen kann man also nicht einfach behaupten.
 *  Nutzt die Helfer aus app.js (window.StreamUtil).
 * ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var U = window.StreamUtil;
  var CFG = U.CFG, $ = U.$, esc = U.esc;

  function store(key, val) {
    try {
      if (val === undefined) return JSON.parse(localStorage.getItem(key) || "null");
      localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { return null; }
  }

  function dayNumber(d) {
    // Tage seit 1.1.2026 (lokales Datum) → Rätsel-Nummer
    return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(2026, 0, 1)) / 86400000);
  }
  var TODAY = dayNumber(new Date());

  // Gleiche Auswahl-Formel wie im Apps Script (Code.gs) – bitte nur gemeinsam ändern
  function pick(list, day, mul, add) {
    var n = list.length;
    return list[((day * mul + add) % n + n) % n];
  }
  function byName(a, b) {
    a = a.toLowerCase(); b = b.toLowerCase();
    return a < b ? -1 : a > b ? 1 : 0;
  }
  function siteLink() { return location.href.split("#")[0] + "#play"; }

  function copyText(btn, text, label) {
    var done = function () {
      btn.textContent = "✅ Kopiert!";
      setTimeout(function () { btn.textContent = label; }, 2000);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () { window.prompt("Kopieren:", text); });
    else window.prompt("Kopieren:", text);
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Gemeinsames: Spielauswahl, Statistik, Serien
  // ═══════════════════════════════════════════════════════════════════════
  var GAMES = {
    hangman: { title: "Wort des Tages", icon: "🔤", statsKey: "stream_wotd_stats_v1" },
    wordle:  { title: "Wordle",         icon: "🟩", statsKey: "stream_wordle_stats_v1" },
    emotle:  { title: "Emotle",         icon: "😺", statsKey: "stream_emotle_stats_v1" }
  };
  var GAME_KEY = "stream_game_v1";
  var active = "hangman";

  function stats(game) {
    return store(GAMES[game].statsKey) || { played: 0, won: 0, streak: 0, best: 0, lastDay: null };
  }
  // Serie zählt nur, wenn gestern oder heute gewonnen wurde
  function liveStreak(st) {
    return st && st.lastDay != null && st.lastDay >= TODAY - 1 ? st.streak : 0;
  }
  function recordResult(game, won, extra) {
    var st = stats(game);
    if (st.lastDay === TODAY) return st;
    st.played++;
    if (won) {
      st.won++;
      st.streak = st.lastDay === TODAY - 1 ? st.streak + 1 : 1;
      st.best = Math.max(st.best, st.streak);
    } else {
      st.streak = 0;
    }
    if (extra) extra(st);
    st.lastDay = TODAY;
    store(GAMES[game].statsKey, st);
    return st;
  }
  function renderStats(game) {
    var st = stats(game), s = liveStreak(st);
    $(game + "-streak").textContent = s ? "🔥 " + s : "";
    $(game + "-stats").textContent = st.played
      ? "Gespielt: " + st.played + " · Gewonnen: " + Math.round(st.won / st.played * 100) + " % · Beste Serie: " + st.best
      : "";
  }

  // Wird von jedem Spiel aufgerufen, sobald es heute vorbei ist
  function finish(game, won, result, extra) {
    recordResult(game, won, extra);
    renderStats(game);
    renderSwitch();
    queueSubmit(game, result);
  }

  function renderSwitch() {
    document.querySelectorAll("#game-switch [data-game]").forEach(function (b) {
      var g = b.getAttribute("data-game"), on = g === active;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
      var done = b.querySelector(".gs-done");
      if (done) done.hidden = stats(g).lastDay !== TODAY;
    });
    document.querySelectorAll("[data-game-panel]").forEach(function (p) {
      p.hidden = p.getAttribute("data-game-panel") !== active;
    });
  }

  function setGame(g) {
    if (!GAMES[g]) return;
    active = g;
    store(GAME_KEY, g);
    renderSwitch();
    renderBoard();
    if (g === "emotle") drawEmote();
  }

  function initSwitch() {
    var saved = store(GAME_KEY);
    if (GAMES[saved]) active = saved;
    var bar = $("game-switch");
    bar.addEventListener("click", function (e) {
      var b = e.target.closest("[data-game]");
      if (b) setGame(b.getAttribute("data-game"));
    });
    // Pfeiltasten wechseln zwischen den Spielen (Tablist-Verhalten)
    bar.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      var keys = Object.keys(GAMES), i = keys.indexOf(active);
      i = (i + (e.key === "ArrowRight" ? 1 : keys.length - 1)) % keys.length;
      setGame(keys[i]);
      bar.querySelector('[data-game="' + keys[i] + '"]').focus();
      e.preventDefault();
    });
    renderSwitch();
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  1) Wort des Tages – Hangman mit Löwen-Jagd
  // ═══════════════════════════════════════════════════════════════════════
  var MAX_WRONG = 8;
  var LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ".split("");
  var WOTD_KEY = "stream_wotd_v1";
  var wotd = { word: "", guessed: [], done: false };

  function wrongCount() {
    return wotd.guessed.filter(function (l) { return wotd.word.indexOf(l) === -1; }).length;
  }
  function isSolved() {
    return wotd.word.split("").every(function (l) { return wotd.guessed.indexOf(l) !== -1; });
  }

  function initHangman(words) {
    wotd.word = pick(words, TODAY, 37, 11);
    var saved = store(WOTD_KEY);
    if (saved && saved.day === TODAY) { wotd.guessed = saved.guessed || []; wotd.done = !!saved.done; }

    $("hangman-no").textContent = "#" + (TODAY + 1);
    $("keyboard").innerHTML = LETTERS.map(function (l) {
      return '<button type="button" class="key" data-key="' + l + '">' + l + "</button>";
    }).join("");
    $("keyboard").addEventListener("click", function (e) {
      var k = e.target.closest("[data-key]");
      if (k) guessHangman(k.getAttribute("data-key"));
    });
    $("hangman-share").onclick = function () {
      var wrong = wrongCount(), trail = "";
      for (var i = 0; i < MAX_WRONG; i++) trail += i < wrong ? "🟧" : "🟩";
      copyText(this, CFG.displayName + " – Wort des Tages #" + (TODAY + 1) + "\n"
        + (isSolved() ? "🦌 gerettet" : "🦁 erwischt") + " " + trail + "\n" + siteLink(), "📋 Ergebnis kopieren");
    };
    renderHangman();
  }

  function guessHangman(l) {
    if (!wotd.word || wotd.done || wotd.guessed.indexOf(l) !== -1) return;
    wotd.guessed.push(l);
    var won = isSolved(), lost = wrongCount() >= MAX_WRONG;
    if (won || lost) wotd.done = true;
    store(WOTD_KEY, { day: TODAY, guessed: wotd.guessed, done: wotd.done });
    if (wotd.done) finish("hangman", won, wotd.guessed.join(""));
    renderHangman();
  }

  function renderHangman() {
    var wrong = wrongCount(), won = isSolved(), lost = wrong >= MAX_WRONG;
    // Ganzes Wort in einer Zeile – bei langen Wörtern werden die Felder schmaler
    $("wotd-word").style.setProperty("--n", wotd.word.length);
    $("wotd-word").innerHTML = wotd.word.split("").map(function (l) {
      var show = wotd.guessed.indexOf(l) !== -1 || lost;
      return '<span class="slot-l' + (show ? " shown" : "") + (lost && wotd.guessed.indexOf(l) === -1 ? " missed" : "") + '">'
        + (show ? l : "") + "</span>";
    }).join("");

    document.querySelectorAll("#keyboard .key").forEach(function (k) {
      var l = k.getAttribute("data-key");
      var used = wotd.guessed.indexOf(l) !== -1;
      k.disabled = used || wotd.done;
      k.classList.toggle("hit", used && wotd.word.indexOf(l) !== -1);
      k.classList.toggle("miss", used && wotd.word.indexOf(l) === -1);
    });

    // Der Löwe schleicht sich an
    $("chase-lion").style.left = (wrong / MAX_WRONG) * 78 + "%";
    $("chase").classList.toggle("won", won);
    $("chase").classList.toggle("lost", lost);

    var msg = $("wotd-msg");
    if (won) msg.textContent = "🎉 Geschafft! Die Gazelle springt davon – mit " + wrong + " Fehler" + (wrong === 1 ? "" : "n") + ".";
    else if (lost) msg.textContent = "🦁 Der Löwe war schneller! Morgen gibt es ein neues Wort.";
    else msg.textContent = "Noch " + (MAX_WRONG - wrong) + " Versuche";
    $("hangman-share").hidden = !wotd.done;
    renderStats("hangman");
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  2) Wordle – 5 Buchstaben, 6 Versuche
  // ═══════════════════════════════════════════════════════════════════════
  var WORDLE_KEY = "stream_wordle_v1";
  var KB_ROWS = ["QWERTZUIOPÜ", "ASDFGHJKLÖÄ", "+YXCVBNM-"];
  var VALID = null;
  var wd = { answer: "", guesses: [], cur: "", done: false, won: false, unknown: null, note: "" };

  // Wertung wie im Original: erst die exakten Treffer, dann die übrigen Buchstaben
  function scoreWord(guess, answer) {
    var res = [], rest = {}, i;
    for (i = 0; i < 5; i++) {
      if (guess[i] === answer[i]) res[i] = "c";
      else rest[answer[i]] = (rest[answer[i]] || 0) + 1;
    }
    for (i = 0; i < 5; i++) {
      if (res[i]) continue;
      if (rest[guess[i]]) { res[i] = "p"; rest[guess[i]]--; }
      else res[i] = "a";
    }
    return res;
  }

  function initWordle(answers, valid) {
    VALID = {};
    valid.concat(answers).forEach(function (w) { VALID[w] = true; });
    wd.answer = pick(answers, TODAY, 97, 13);
    var saved = store(WORDLE_KEY);
    if (saved && saved.day === TODAY && saved.answer === wd.answer) {
      wd.guesses = saved.guesses || [];
      wd.done = !!saved.done;
      wd.won = wd.guesses[wd.guesses.length - 1] === wd.answer;
    }
    $("wordle-no").textContent = "#" + (TODAY + 1);

    var grid = "";
    for (var r = 0; r < 6; r++) {
      grid += '<div class="wordle-row" role="row">';
      for (var c = 0; c < 5; c++) grid += '<span class="tile" role="gridcell"></span>';
      grid += "</div>";
    }
    $("wordle-grid").innerHTML = grid;

    $("wordle-kb").innerHTML = KB_ROWS.map(function (row) {
      return '<div class="wkb-row">' + row.split("").map(function (k) {
        if (k === "+") return '<button type="button" class="wkey wide" data-wkey="ENTER" aria-label="Eingabe">⏎</button>';
        if (k === "-") return '<button type="button" class="wkey wide" data-wkey="BACK" aria-label="Löschen">⌫</button>';
        return '<button type="button" class="wkey" data-wkey="' + k + '">' + k + "</button>";
      }).join("") + "</div>";
    }).join("");
    $("wordle-kb").addEventListener("click", function (e) {
      var b = e.target.closest("[data-wkey]");
      if (b) { wordleKey(b.getAttribute("data-wkey")); b.blur(); }
    });
    $("wordle-share").onclick = function () {
      var rows = wd.guesses.map(function (g) {
        return scoreWord(g, wd.answer).map(function (s) { return s === "c" ? "🟩" : s === "p" ? "🟨" : "⬛"; }).join("");
      });
      copyText(this, CFG.displayName + " – Wordle #" + (TODAY + 1) + " " + (wd.won ? wd.guesses.length : "X") + "/6\n"
        + rows.join("\n") + "\n" + siteLink(), "📋 Ergebnis kopieren");
    };
    renderWordle();
  }

  function wordleKey(k) {
    if (!wd.answer || wd.done) return;
    if (k === "ENTER") return submitWordle();
    if (k === "BACK") {
      wd.cur = wd.cur.slice(0, -1);
      wd.unknown = null; wd.note = "";
      return renderWordle();
    }
    if (wd.cur.length < 5 && /^[A-ZÄÖÜ]$/.test(k)) {
      wd.cur += k;
      wd.unknown = null; wd.note = "";
      renderWordle();
    }
  }

  function shakeRow() {
    var row = $("wordle-grid").children[wd.guesses.length];
    if (!row) return;
    row.classList.remove("shake");
    void row.offsetWidth;
    row.classList.add("shake");
  }

  function submitWordle() {
    if (wd.cur.length < 5) { wd.note = "Zu kurz – das Wort hat 5 Buchstaben."; shakeRow(); return renderWordle(); }
    // Unbekannte Wörter nicht stur ablehnen: zweimal ⏎ nimmt sie trotzdem
    if (!VALID[wd.cur] && wd.unknown !== wd.cur) {
      wd.unknown = wd.cur;
      wd.note = "„" + wd.cur + "“ kenne ich nicht. Nochmal ⏎, um es trotzdem zu nehmen.";
      shakeRow();
      return renderWordle();
    }
    wd.guesses.push(wd.cur);
    wd.cur = ""; wd.unknown = null; wd.note = "";
    wd.won = wd.guesses[wd.guesses.length - 1] === wd.answer;
    if (wd.won || wd.guesses.length >= 6) wd.done = true;
    store(WORDLE_KEY, { day: TODAY, answer: wd.answer, guesses: wd.guesses, done: wd.done });
    if (wd.done) {
      finish("wordle", wd.won, wd.guesses.join(","), function (st) {
        st.dist = st.dist || [0, 0, 0, 0, 0, 0];
        if (wd.won) st.dist[wd.guesses.length - 1]++;
      });
    }
    renderWordle(true);
  }

  function renderWordle(reveal) {
    var rows = $("wordle-grid").children, keyState = {};
    var rank = { a: 1, p: 2, c: 3 };
    for (var r = 0; r < 6; r++) {
      var tiles = rows[r].children, g = wd.guesses[r];
      var sc = g ? scoreWord(g, wd.answer) : null;
      var text = g || (r === wd.guesses.length ? wd.cur : "");
      for (var c = 0; c < 5; c++) {
        var t = tiles[c], l = text[c] || "";
        t.textContent = l;
        t.className = "tile" + (l ? " filled" : "") + (sc ? " " + sc[c] : "")
          + (sc && reveal && r === wd.guesses.length - 1 ? " flip" : "");
        if (sc && reveal && r === wd.guesses.length - 1) t.style.animationDelay = c * 0.12 + "s";
        else t.style.animationDelay = "";
        if (sc && (!keyState[l] || rank[sc[c]] > rank[keyState[l]])) keyState[l] = sc[c];
      }
      rows[r].setAttribute("aria-label", g ? "Versuch " + (r + 1) + ": " + g + " – "
        + sc.map(function (s, i) { return g[i] + (s === "c" ? " richtig" : s === "p" ? " andere Stelle" : " nicht drin"); }).join(", ") : "");
    }
    document.querySelectorAll("#wordle-kb [data-wkey]").forEach(function (b) {
      var k = b.getAttribute("data-wkey");
      b.classList.remove("c", "p", "a");
      if (keyState[k]) b.classList.add(keyState[k]);
      b.disabled = wd.done;
    });

    var msg = $("wordle-msg");
    if (wd.won) msg.textContent = "🎉 Gelöst in " + wd.guesses.length + "/6!" + (wd.guesses.length <= 2 ? " Unglaublich!" : "");
    else if (wd.done) msg.textContent = "🦁 Das Wort war " + wd.answer + ". Morgen gibt es ein neues!";
    else msg.textContent = wd.note || "Versuch " + (wd.guesses.length + 1) + " von 6";
    msg.classList.toggle("warn", !!wd.note && !wd.done);
    $("wordle-share").hidden = !wd.done;

    var st = stats("wordle"), dist = st.dist || [0, 0, 0, 0, 0, 0];
    var max = Math.max.apply(null, dist.concat([1]));
    $("wordle-dist").innerHTML = st.won ? '<p class="dist-title">Gelöst nach … Versuchen</p>' + dist.map(function (n, i) {
      var mine = wd.won && wd.guesses.length === i + 1;
      return '<div class="dist-row"><span>' + (i + 1) + '</span><span class="dist-bar' + (mine ? " mine" : "")
        + '" style="width:' + Math.max(8, n / max * 100) + '%">' + n + "</span></div>";
    }).join("") : "";
    renderStats("wordle");
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  3) Emotle – welches Kanal-Emote ist das?
  // ═══════════════════════════════════════════════════════════════════════
  var EMOTLE_KEY = "stream_emotle_v1";
  var EM_MAX = 6;
  var PIX = [5, 8, 12, 18, 28];   // Bildpunkte pro Seite nach 0, 1, 2 … falschen Tipps
  var EMOTES = null, emImg = null, emPrefix = "";
  var em = { answer: null, guesses: [], done: false, won: false };

  function commonPrefix(names) {
    if (names.length < 2) return "";
    var p = names[0];
    names.forEach(function (n) { while (p && n.indexOf(p) !== 0) p = p.slice(0, -1); });
    return p;
  }
  function shortName(n) { var s = n.slice(emPrefix.length); return s || n; }
  function emoteByName(n) {
    for (var i = 0; i < EMOTES.length; i++) if (EMOTES[i].name === n) return EMOTES[i];
    return null;
  }

  function emotleUnavailable(text) {
    $("emotle-body").hidden = true;
    var p = $("emotle-empty");
    p.hidden = false;
    p.textContent = text;
  }

  function setEmotes(list) {
    if (EMOTES) return;   // Rätsel des Tages nicht mitten im Spiel austauschen
    list = (list || []).filter(function (e) { return e && e.name; });
    if (list.length < 4) {
      emotleUnavailable("Für Emotle braucht der Kanal mindestens 4 Emotes – bald geht's los!");
      return;
    }
    EMOTES = list.slice().sort(function (a, b) { return byName(a.name, b.name); });
    emPrefix = commonPrefix(EMOTES.map(function (e) { return e.name; }));
    em.answer = pick(EMOTES, TODAY, 53, 7).name;

    var saved = store(EMOTLE_KEY);
    if (saved && saved.day === TODAY && emoteByName(saved.answer)) {
      em.answer = saved.answer;
      em.guesses = (saved.guesses || []).filter(emoteByName);
      em.won = em.guesses[em.guesses.length - 1] === em.answer;
      em.done = em.won || em.guesses.length >= EM_MAX;
    }

    $("emotle-empty").hidden = true;
    $("emotle-body").hidden = false;
    $("emotle-options").innerHTML = EMOTES.slice().sort(function (a, b) { return byName(shortName(a.name), shortName(b.name)); })
      .map(function (e) {
        return '<button type="button" class="em-opt" data-emote="' + esc(e.name) + '" title="' + esc(e.name) + '">' + esc(shortName(e.name)) + "</button>";
      }).join("");

    var e = emoteByName(em.answer);
    if (e.url && !U.DEMO) {
      emImg = new Image();
      emImg.onload = drawEmote;
      emImg.src = e.url;
    }
    renderEmotle();
  }

  function guessEmote(name) {
    if (!EMOTES || em.done || em.guesses.indexOf(name) !== -1) return;
    em.guesses.push(name);
    em.won = name === em.answer;
    if (em.won || em.guesses.length >= EM_MAX) em.done = true;
    store(EMOTLE_KEY, { day: TODAY, answer: em.answer, guesses: em.guesses });
    if (em.done) finish("emotle", em.won, em.guesses.join(","));
    renderEmotle();
  }

  function drawEmote() {
    var c = $("emotle-canvas");
    if (!c || !EMOTES) return;
    var ctx = c.getContext("2d"), S = c.width;
    var level = em.done ? PIX.length : Math.min(em.guesses.length, PIX.length);
    var n = level >= PIX.length ? S : PIX[level];
    var tmp = document.createElement("canvas");
    tmp.width = tmp.height = n;
    var t = tmp.getContext("2d");
    if (emImg && emImg.complete && emImg.naturalWidth) {
      t.drawImage(emImg, 0, 0, n, n);
    } else {
      // Demo / Bild noch nicht geladen: Platzhalter-Emoji zeichnen
      var e = emoteByName(em.answer);
      t.font = Math.round(n * 0.8) + "px serif";
      t.textAlign = "center"; t.textBaseline = "middle";
      t.fillText((e && e.ph) || "😺", n / 2, n / 2 + n * 0.05);
    }
    ctx.clearRect(0, 0, S, S);
    ctx.imageSmoothingEnabled = n >= S;
    ctx.drawImage(tmp, 0, 0, S, S);
    // Die ersten zwei Versuche ohne Farbe – sonst ist es zu leicht
    c.classList.toggle("gray", !em.done && level < 2);
  }

  function renderEmotle() {
    if (!EMOTES) return;
    $("emotle-no").textContent = "#" + (TODAY + 1);
    document.querySelectorAll("#emotle-options [data-emote]").forEach(function (b) {
      var n = b.getAttribute("data-emote"), tried = em.guesses.indexOf(n) !== -1;
      b.classList.toggle("wrong", tried && n !== em.answer);
      b.classList.toggle("right", (tried || em.done) && n === em.answer);
      b.disabled = tried || em.done;
    });
    var dots = "";
    for (var i = 0; i < EM_MAX; i++) {
      var g = em.guesses[i];
      dots += '<span class="em-dot' + (g ? (g === em.answer ? " right" : " wrong") : "") + '"></span>';
    }
    $("emotle-tries").innerHTML = dots;

    var msg = $("emotle-msg");
    if (em.won) msg.textContent = "🎉 Richtig, es ist " + em.answer + "! (" + em.guesses.length + "/" + EM_MAX + ")";
    else if (em.done) msg.textContent = "🦁 Leider nicht – gesucht war " + em.answer + ".";
    else msg.textContent = em.guesses.length ? "Noch " + (EM_MAX - em.guesses.length) + " Versuche – das Bild wird schärfer." : "Tippe auf den Namen des Emotes.";
    $("emotle-share").hidden = !em.done;
    drawEmote();
    renderStats("emotle");
  }

  function initEmotle() {
    $("emotle-options").addEventListener("click", function (e) {
      var b = e.target.closest("[data-emote]");
      if (b) guessEmote(b.getAttribute("data-emote"));
    });
    $("emotle-share").onclick = function () {
      var row = em.guesses.map(function (g) { return g === em.answer ? "🟩" : "🟥"; }).join("");
      copyText(this, CFG.displayName + " – Emotle #" + (TODAY + 1) + " " + (em.won ? em.guesses.length : "X") + "/" + EM_MAX + "\n"
        + row + "\n" + siteLink(), "📋 Ergebnis kopieren");
    };
    if (!U.DEMO && !U.consentGiven()) {
      emotleUnavailable("Emotle zeigt die Emotes direkt von Twitch. Erlaube dafür unten auf der Seite „Inhalte laden“.");
    }
    renderStats("emotle");
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Serien-Bestenliste
  // ═══════════════════════════════════════════════════════════════════════
  var VOTER_KEY = "stream_voter_id";            // dieselbe Geräte-Kennung wie bei Abstimmungen
  var NAME_KEY = "stream_streak_name_v1";
  var PENDING_KEY = "stream_streak_pending_v1";
  var boards = null, renaming = false, busy = false, meNote = "";

  function voterId() {
    var id = store(VOTER_KEY);
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();
      store(VOTER_KEY, id);
    }
    return id;
  }
  function myName() { return store(NAME_KEY); }
  function canOnline() { return !U.DEMO && U.consentGiven() && CFG.apiUrl; }

  function api(query) {
    var url = CFG.apiUrl + (CFG.apiUrl.indexOf("?") === -1 ? "?" : "&") + query + "&voter=" + encodeURIComponent(voterId());
    return fetch(url).then(function (r) { return r.json(); });
  }

  // Ergebnis von heute (für Nachmeldung, wenn der Name erst später eingetragen wird)
  function todayResult(game) {
    if (stats(game).lastDay !== TODAY) return null;
    if (game === "hangman") return wotd.done ? wotd.guessed.join("") : null;
    if (game === "wordle") return wd.done ? wd.guesses.join(",") : null;
    if (game === "emotle") return em.done ? em.guesses.join(",") : null;
    return null;
  }

  function queueSubmit(game, result) {
    if (!myName()) return;
    if (U.DEMO) { demoBoard(game); return; }
    var q = (store(PENDING_KEY) || []).filter(function (x) { return !(x.game === game && x.day === TODAY); });
    q.push({ game: game, day: TODAY, r: result });
    store(PENDING_KEY, q.slice(-10));
    flush();
  }

  // Wartende Ergebnisse nacheinander senden; ohne Netz bleiben sie liegen
  function flush() {
    if (busy || !canOnline() || !myName()) return;
    var q = (store(PENDING_KEY) || []).filter(function (x) { return x.day >= TODAY - 1; });
    store(PENDING_KEY, q);
    if (!q.length) return;
    var item = q[0];
    busy = true;
    api("streak=1&game=" + encodeURIComponent(item.game) + "&day=" + item.day + "&r=" + encodeURIComponent(item.r))
      .then(function (res) {
        busy = false;
        store(PENDING_KEY, (store(PENDING_KEY) || []).filter(function (x) { return !(x.game === item.game && x.day === item.day); }));
        if (res && res.boards) boards = res.boards;
        if (res && res.error) {
          meNote = res.error;
          if (res.noName) store(NAME_KEY, null);
        }
        renderBoard();
        flush();
      })
      .catch(function () { busy = false; });
  }

  // Demo-Modus: eigenes Ergebnis lokal in die Beispiel-Liste einsortieren
  function demoBoard(game) {
    boards = boards || {};
    var list = (boards[game] || []).filter(function (x) { return !x.me; });
    var st = stats(game), name = myName();
    if (name && st.best) list.push({ name: name, best: st.best, current: liveStreak(st), me: true });
    list.sort(function (a, b) { return b.best - a.best || b.current - a.current; });
    boards[game] = list.slice(0, 10);
    renderBoard();
  }

  function renderBoard() {
    var g = GAMES[active];
    $("streak-game").textContent = g.icon + " " + g.title;
    var box = $("streak-list"), name = (myName() || "").toLowerCase();
    if (!U.DEMO && !U.consentGiven()) {
      box.innerHTML = '<li class="empty">Die Bestenliste braucht deine Einwilligung für externe Inhalte.</li>';
    } else if (!boards) {
      box.innerHTML = '<li class="empty">Lädt …</li>';
    } else {
      var list = boards[active] || [];
      box.innerHTML = list.length ? list.map(function (x, i) {
        var mine = name && x.name.toLowerCase() === name;
        return '<li class="streak-row' + (mine ? " mine" : "") + '">'
          + '<span class="streak-rank">' + (["🥇", "🥈", "🥉"][i] || i + 1) + "</span>"
          + '<span class="streak-name">' + esc(x.name) + "</span>"
          // Läuft die Rekord-Serie gerade noch, nur einmal mit 🔥 anzeigen statt „🔥 23 23 Tage“
          + '<span class="streak-now" title="Aktuelle Serie">' + (x.current && x.current !== x.best ? "🔥 " + x.current + " aktuell" : "") + "</span>"
          + '<span class="streak-best" title="Längste Serie">' + (x.current && x.current === x.best ? "🔥 " : "")
          + x.best + " " + (x.best === 1 ? "Tag" : "Tage") + "</span></li>";
      }).join("") : '<li class="empty">Noch niemand dabei – hol dir Platz 1! 🦌</li>';
    }
    renderMe();
  }

  function renderMe() {
    var box = $("streak-me"), name = myName();
    if (!U.DEMO && !U.consentGiven()) { box.innerHTML = ""; return; }
    var note = meNote ? '<p class="vote-error" role="alert">' + esc(meNote) + "</p>" : "";
    if (name && !renaming) {
      var waiting = (store(PENDING_KEY) || []).length && !U.DEMO;
      box.innerHTML = '<p class="streak-who">Du spielst als <b>' + esc(name) + "</b>"
        + (waiting ? " · <span class=\"muted\">wird übertragen …</span>" : "") + "</p>"
        + '<p class="streak-links"><button type="button" class="link-btn" data-act="rename">Namen ändern</button> · '
        + '<button type="button" class="link-btn" data-act="leave">Aus der Liste austragen</button></p>' + note;
      return;
    }
    box.innerHTML = '<form class="streak-form" id="streak-form" novalidate>'
      + '<label for="streak-name">' + (renaming ? "Neuer Name" : "Mit deinem Twitch-Namen in die Bestenliste") + "</label>"
      + '<div class="streak-form-row"><input id="streak-name" type="text" maxlength="25" autocomplete="nickname" spellcheck="false" placeholder="Twitch-Name" value="' + esc(renaming ? name || "" : "") + '">'
      + '<button class="btn btn-primary" type="submit">' + (renaming ? "Speichern" : "Eintragen") + "</button></div>"
      + (renaming ? '<button type="button" class="link-btn" data-act="cancel">Abbrechen</button>' : '<p class="streak-note">Deine Serien zählen ab heute. Ein Name pro Gerät.</p>')
      + note + "</form>";
  }

  function saveName(raw) {
    var name = String(raw || "").trim().replace(/^@/, "");
    if (!/^[A-Za-z0-9_]{2,25}$/.test(name)) {
      meNote = "So sehen Twitch-Namen aus: Buchstaben, Zahlen und _ (2–25 Zeichen).";
      return renderMe();
    }
    meNote = "";
    function done() {
      store(NAME_KEY, name);
      renaming = false;
      // Heute schon gespielte Rätsel nachmelden
      Object.keys(GAMES).forEach(function (g) {
        var r = todayResult(g);
        if (r != null) queueSubmit(g, r);
      });
      if (U.DEMO) Object.keys(GAMES).forEach(demoBoard);
      renderBoard();
    }
    if (U.DEMO) return done();
    if (!canOnline()) { meNote = "Gerade keine Verbindung – bitte später nochmal."; return renderMe(); }
    var form = $("streak-form");
    if (form) form.classList.add("is-voting");
    api("streakname=1&name=" + encodeURIComponent(name)).then(function (res) {
      if (res && res.ok) {
        if (res.boards) boards = res.boards;
        return done();
      }
      meNote = (res && res.error) || "Das hat nicht geklappt – bitte nochmal versuchen.";
      renderMe();
    }).catch(function () {
      meNote = "Das hat nicht geklappt – bitte nochmal versuchen.";
      renderMe();
    });
  }

  function leave() {
    if (!window.confirm("Wirklich austragen? Dein Name und deine Serien werden aus der Bestenliste gelöscht.")) return;
    function done() {
      store(NAME_KEY, null);
      store(PENDING_KEY, []);
      meNote = "";
      if (U.DEMO) Object.keys(GAMES).forEach(demoBoard);
      renderBoard();
    }
    if (U.DEMO) return done();
    api("streakleave=1").then(function (res) {
      if (res && res.boards) boards = res.boards;
      if (res && res.ok) return done();
      meNote = (res && res.error) || "Das hat nicht geklappt – bitte nochmal versuchen.";
      renderMe();
    }).catch(function () { meNote = "Das hat nicht geklappt – bitte nochmal versuchen."; renderMe(); });
  }

  function initBoard() {
    var me = $("streak-me");
    me.addEventListener("submit", function (e) {
      e.preventDefault();
      saveName($("streak-name").value);
    });
    me.addEventListener("click", function (e) {
      var b = e.target.closest("[data-act]");
      if (!b) return;
      var act = b.getAttribute("data-act");
      if (act === "rename") { renaming = true; meNote = ""; renderMe(); $("streak-name").focus(); }
      else if (act === "cancel") { renaming = false; meNote = ""; renderMe(); }
      else if (act === "leave") leave();
    });
    renderBoard();
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Start
  // ═══════════════════════════════════════════════════════════════════════
  function onKey(e) {
    if (!$("play").classList.contains("active") || e.ctrlKey || e.metaKey || e.altKey) return;
    var tag = e.target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (active === "hangman") {
      var l = e.key.toUpperCase();
      if (LETTERS.indexOf(l) !== -1) guessHangman(l);
    } else if (active === "wordle") {
      if (e.key === "Enter") { e.preventDefault(); wordleKey("ENTER"); }
      else if (e.key === "Backspace") { e.preventDefault(); wordleKey("BACK"); }
      else if (e.key.length === 1) wordleKey(e.key.toUpperCase());
    }
  }

  function onData(d) {
    if (d.streaks) boards = d.streaks;
    else if (!boards) boards = {};
    if (U.DEMO) Object.keys(GAMES).forEach(function (g) { if (myName()) demoBoard(g); });
    setEmotes(d.emotes);
    renderBoard();
    flush();
  }

  function getJSON(url) {
    return fetch(url).then(function (r) { if (!r.ok) throw new Error(url); return r.json(); });
  }

  initSwitch();
  initEmotle();
  initBoard();
  document.addEventListener("keydown", onKey);

  Promise.all([getJSON("raetsel.json"), getJSON("wordle-woerter.json").catch(function () { return []; })])
    .then(function (r) {
      initHangman(r[0].wotd);
      initWordle(r[0].wordle, r[1]);
      renderSwitch();
      flush();
    })
    .catch(function () {
      ["wotd-msg", "wordle-msg"].forEach(function (id) {
        $(id).textContent = "Die Rätsel konnten nicht geladen werden – bitte Seite neu laden.";
      });
    });

  document.addEventListener("streamdata", function (e) { onData(e.detail); });
  if (U.data) onData(U.data);
})();
