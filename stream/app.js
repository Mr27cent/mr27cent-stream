/* ═══════════════════════════════════════════════════════════════════════════
 *  Mr27cent Stream-Seite
 *  Einstellungen: config.js  ·  Backend: apps-script/Code.gs
 * ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var CFG = window.STREAM_CONFIG;
  var CONSENT_KEY = "stream_consent_v1";
  var THEME_KEY = "stream_theme";
  var HOST = window.location.hostname;
  var DEMO = !CFG.apiUrl;

  var state = {
    data: null,
    firstRender: true,
    heroEmbedOpen: false,
    uptimeTimer: null
  };

  // ── Hilfsfunktionen ──────────────────────────────────────────────────────
  function $(id) { return document.getElementById(id); }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function fmtNum(n) {
    return n == null ? "–" : Number(n).toLocaleString("de-DE");
  }

  function fmtDate(iso, opts) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return String(iso);
    return d.toLocaleDateString("de-DE", opts || { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  function fmtTime(iso) {
    return new Date(iso).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  }

  function fmtDuration(ms) {
    var m = Math.max(0, Math.floor(ms / 60000));
    var h = Math.floor(m / 60);
    return h + " h " + String(m % 60).padStart(2, "0") + " min";
  }

  function safeStore(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      if (val === null) localStorage.removeItem(key);
      else localStorage.setItem(key, val);
    } catch (e) { return null; }
  }

  function twitchUrl() { return "https://twitch.tv/" + CFG.streamer; }

  // Twitch-Embeds funktionieren nur auf einer echten Domain (parent=…)
  function canEmbed() { return !!HOST; }

  // ── Einwilligung ─────────────────────────────────────────────────────────
  function consentGiven() { return safeStore(CONSENT_KEY) === "yes"; }

  function initConsent() {
    var choice = safeStore(CONSENT_KEY);
    if (!CFG.discord.inviteUrl && !CFG.discord.serverId) $("discord-card").hidden = true;
    if (!choice) {
      $("consent").hidden = false;
      renderDiscordOffline();   // reiner Link, lädt nichts von Discord
    }

    $("consent-accept").onclick = function () {
      safeStore(CONSENT_KEY, "yes");
      $("consent").hidden = true;
      start();
    };
    $("consent-reject").onclick = function () {
      safeStore(CONSENT_KEY, "no");
      $("consent").hidden = true;
      start();
    };
    $("consent-reset").onclick = function (e) {
      e.preventDefault();
      safeStore(CONSENT_KEY, null);
      window.location.reload();
    };
    return !!choice;
  }

  // ── Tag / Nacht ──────────────────────────────────────────────────────────
  function initTheme() {
    $("theme-toggle").onclick = function () {
      var next = document.documentElement.getAttribute("data-theme") === "night" ? "day" : "night";
      document.documentElement.setAttribute("data-theme", next);
      safeStore(THEME_KEY, next);
      // Chat-Embed passend umfärben
      var chat = document.querySelector(".hero-embed .chat");
      if (chat) chat.src = chatSrc();
    };
  }

  // ── Reiter & Seitenmenü ──────────────────────────────────────────────────
  var SIDEBAR_KEY = "stream_sidebar_collapsed";
  var mobileMq = window.matchMedia("(max-width: 860px)");

  // Frühere Reiter, die jetzt Abschnitte in anderen Reitern sind (alte Links funktionieren weiter)
  var MOVED = { highscores: "play", games: "dashboard", wrapped: "dashboard", schedule: "dashboard",
    milestones: "about", community: "about", emotes: "about" };

  function showTab() {
    // „#karten/@name“ → Reiter „karten“ (der Rest ist für das jeweilige Modul)
    var id = (window.location.hash || "").slice(1).split("/")[0];
    var jumpTo = null;
    if (MOVED[id]) { jumpTo = $(id); id = MOVED[id]; }
    var panel = id && document.querySelector('.tab-panel#' + CSS.escape(id));
    if (!panel || panel.hidden) { id = "dashboard"; panel = $("dashboard"); }
    document.querySelectorAll(".tab-panel").forEach(function (p) { p.classList.toggle("active", p === panel); });
    document.querySelectorAll("#tabs a").forEach(function (a) {
      var on = a.getAttribute("data-tab") === id;
      a.classList.toggle("active", on);
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    // Der Browser springt sonst zum Anker – Reiter beginnen immer oben
    window.scrollTo(0, 0);
    requestAnimationFrame(function () {
      window.scrollTo(0, 0);
    });
    // Alter Link auf einen früheren Reiter: direkt zum Abschnitt springen
    if (jumpTo) setTimeout(function () {
      if (!jumpTo.hidden) window.scrollTo({ top: jumpTo.getBoundingClientRect().top + window.scrollY - 80, behavior: "instant" });
    }, 60);
    setDrawer(false);
  }

  function setDrawer(open) {
    document.body.classList.toggle("sidebar-open", open);
    $("nav-burger").setAttribute("aria-expanded", mobileMq.matches ? String(open) : String(!document.body.classList.contains("sidebar-collapsed")));
  }

  // Dialoge: Fokus in den Dialog, Tab bleibt darin, beim Schließen zurück zum Auslöser
  var modalReturn = null;
  function openModal(m, from) {
    modalReturn = from || document.activeElement;
    m.hidden = false;
    var close = m.querySelector("[data-close]");
    if (close) close.focus();
  }
  function closeModal(m) {
    m.hidden = true;
    if (modalReturn && modalReturn.focus) modalReturn.focus();
    modalReturn = null;
  }
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Tab") return;
    var m = document.querySelector(".modal:not([hidden])");
    if (!m) return;
    var f = m.querySelectorAll('a[href], button, [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  function initUi() {
    if (safeStore(SIDEBAR_KEY) === "1") document.body.classList.add("sidebar-collapsed");
    document.querySelectorAll("#tabs a").forEach(function (a) {
      a.title = a.querySelector(".tab-label").textContent;
    });
    $("nav-burger").onclick = function () {
      if (mobileMq.matches) {
        setDrawer(!document.body.classList.contains("sidebar-open"));
      } else {
        var collapsed = document.body.classList.toggle("sidebar-collapsed");
        safeStore(SIDEBAR_KEY, collapsed ? "1" : "0");
        setDrawer(false);
      }
    };
    $("sidebar-backdrop").onclick = function () { setDrawer(false); };
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    window.addEventListener("hashchange", showTab);
    window.addEventListener("load", function () { window.scrollTo(0, 0); });
    showTab();

    document.addEventListener("click", function (e) {
      var opener = e.target.closest("[data-open]");
      if (opener) { e.preventDefault(); openModal($(opener.getAttribute("data-open")), opener); return; }
      if (e.target.closest("[data-close]") || e.target.classList.contains("modal")) {
        var m = e.target.closest(".modal");
        if (m) closeModal(m);
      }
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      document.querySelectorAll(".modal:not([hidden])").forEach(closeModal);
      setDrawer(false);
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Statische Inhalte (aus config.js, ohne externe Requests)
  // ═══════════════════════════════════════════════════════════════════════
  var ICONS = {
    twitch: '<path d="M11.57 4.71h1.72v5.15h-1.72zm4.72 0H18v5.15h-1.71zM6 0 1.71 4.29v15.42h5.15V24l4.28-4.29h3.43L22.29 12V0zm14.57 11.14-3.43 3.43h-3.43l-3 3v-3H6.86V1.71h13.71z"/>',
    youtube: '<path d="M23.5 6.19a3 3 0 0 0-2.12-2.14C19.5 3.55 12 3.55 12 3.55s-7.5 0-9.38.5A3 3 0 0 0 .5 6.19C0 8.07 0 12 0 12s0 3.93.5 5.81a3 3 0 0 0 2.12 2.14c1.88.5 9.38.5 9.38.5s7.5 0 9.38-.5a3 3 0 0 0 2.12-2.14C24 15.93 24 12 24 12s0-3.93-.5-5.81zM9.55 15.57V8.43L15.82 12z"/>',
    instagram: '<path d="M12 2.2c3.2 0 3.58 0 4.85.07 3.25.15 4.77 1.69 4.92 4.92.06 1.27.07 1.65.07 4.85s0 3.58-.07 4.85c-.15 3.23-1.66 4.77-4.92 4.92-1.27.06-1.65.07-4.85.07s-3.58 0-4.85-.07c-3.26-.15-4.77-1.7-4.92-4.92C2.17 15.58 2.16 15.2 2.16 12s0-3.58.07-4.85C2.38 3.92 3.9 2.38 7.15 2.23 8.42 2.17 8.8 2.16 12 2.16zM12 0C8.74 0 8.33 0 7.05.07 2.7.27.27 2.7.07 7.05 0 8.33 0 8.74 0 12s0 3.67.07 4.95c.2 4.36 2.62 6.78 6.98 6.98C8.33 24 8.74 24 12 24s3.67 0 4.95-.07c4.35-.2 6.78-2.62 6.98-6.98.06-1.28.07-1.69.07-4.95s0-3.67-.07-4.95c-.2-4.35-2.62-6.78-6.98-6.98C15.67 0 15.26 0 12 0zm0 5.84a6.16 6.16 0 1 0 0 12.32 6.16 6.16 0 0 0 0-12.32zM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8zm6.4-11.85a1.44 1.44 0 1 0 0 2.88 1.44 1.44 0 0 0 0-2.88z"/>',
    tiktok: '<path d="M16.6 5.82A4.28 4.28 0 0 1 15.54 3h-3.09v12.4a2.59 2.59 0 0 1-2.59 2.5c-1.42 0-2.6-1.16-2.6-2.6 0-1.72 1.66-3.01 3.37-2.48V9.66c-3.45-.46-6.47 2.22-6.47 5.64 0 3.33 2.76 5.7 5.69 5.7 3.14 0 5.69-2.55 5.69-5.7V9.01a7.35 7.35 0 0 0 4.3 1.38V7.3s-1.88.09-3.24-1.48z"/>',
    x: '<path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.41l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.59l5.24 6.93zm-1.29 19.5h2.04L6.49 3.24H4.3z"/>',
    discord: '<path d="M20.32 4.37a19.8 19.8 0 0 0-4.89-1.52.07.07 0 0 0-.08.04c-.21.38-.44.86-.61 1.25a18.3 18.3 0 0 0-5.49 0 12.6 12.6 0 0 0-.62-1.25.08.08 0 0 0-.08-.04 19.7 19.7 0 0 0-4.89 1.52.07.07 0 0 0-.03.03C.53 9.05-.32 13.58.1 18.06a.08.08 0 0 0 .03.06 19.9 19.9 0 0 0 5.99 3.03.08.08 0 0 0 .08-.03c.46-.63.87-1.3 1.23-1.99a.08.08 0 0 0-.04-.1 13.1 13.1 0 0 1-1.87-.9.08.08 0 0 1 0-.13l.37-.29a.07.07 0 0 1 .08-.01c3.93 1.8 8.18 1.8 12.07 0a.07.07 0 0 1 .08.01l.37.29a.08.08 0 0 1 0 .13c-.6.35-1.22.65-1.87.9a.08.08 0 0 0-.04.1c.36.7.78 1.36 1.22 1.99a.08.08 0 0 0 .08.03 19.8 19.8 0 0 0 6-3.03.08.08 0 0 0 .03-.06c.5-5.18-.84-9.67-3.55-13.66a.06.06 0 0 0-.03-.03zM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42 0-1.33.96-2.42 2.16-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.96 2.42-2.16 2.42zm7.97 0c-1.18 0-2.15-1.08-2.15-2.42 0-1.33.95-2.42 2.15-2.42 1.21 0 2.18 1.1 2.16 2.42 0 1.34-.95 2.42-2.16 2.42z"/>'
  };

  function initBackground() {
    var bg = CFG.backgroundImages || {};
    if (!bg.day && !bg.night) return;
    var land = $("landscape");
    ["day", "night"].forEach(function (t) {
      var src = bg[t] || bg.day || bg.night;
      var el = document.createElement("div");
      el.className = "photo-bg pb-" + t;
      el.style.backgroundImage = 'url("' + encodeURI(src) + '")';
      land.insertBefore(el, land.firstChild);
    });
    land.classList.add("has-photo");
  }

  function renderStatic() {
    document.title = CFG.displayName + " – Stream";
    $("brand-name").textContent = CFG.displayName;
    $("hero-twitch-btn").href = twitchUrl();

    $("about-text").innerHTML = CFG.about.map(function (p) { return "<p>" + esc(p) + "</p>"; }).join("");

    $("setup-list").innerHTML = CFG.setup.map(function (s) {
      return "<dt>" + esc(s.label) + "</dt><dd>" + esc(s.value) + "</dd>";
    }).join("");

    $("faq-list").innerHTML = CFG.faq.map(function (f) {
      return "<details><summary>" + esc(f.q) + "</summary><p>" + esc(f.a) + "</p></details>";
    }).join("");

    $("rules-list").innerHTML = CFG.rules.map(function (r) { return "<li>" + esc(r) + "</li>"; }).join("");

    var socials = CFG.socials.filter(function (s) { return s.url; });
    $("social-list").innerHTML = socials.length ? socials.map(function (s) {
      return '<a class="social" href="' + esc(s.url) + '" target="_blank" rel="noopener">'
        + '<svg viewBox="0 0 24 24" aria-hidden="true">' + (ICONS[s.icon] || "") + "</svg>"
        + esc(s.name) + "</a>";
    }).join("") : '<p class="empty">Links folgen bald.</p>';

    $("tip-text").textContent = CFG.tipText;
    if (CFG.tipUrl) $("tip-btn").href = CFG.tipUrl;
    else $("tip-card").hidden = true;

    $("goal-label").textContent = CFG.followerGoal.label;
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Live-Daten
  // ═══════════════════════════════════════════════════════════════════════
  function loadData() {
    if (DEMO) {
      $("demo-banner").hidden = false;
      return Promise.resolve(demoData());
    }
    return fetch(CFG.apiUrl, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  // Grau schimmernde Platzhalter, bis die ersten Daten da sind
  function renderSkeletons() {
    function sk(n, cls) {
      var h = "";
      for (var i = 0; i < n; i++) h += '<div class="card skeleton ' + (cls || "") + '"></div>';
      return h;
    }
    $("stat-grid").innerHTML = sk(6, "sk-stat");
    $("highscore-grid").innerHTML = sk(2, "sk-tall");
    $("herd-grid").innerHTML = sk(6, "sk-member");
    $("clip-grid").innerHTML = sk(3, "sk-clip");
    $("clip-hero").innerHTML = '<div class="skeleton sk-hero"></div>';
    $("hero-status").textContent = "Lädt …";
  }

  function refresh() {
    return loadData().then(function (d) {
      state.data = d;
      render(d);
    }).catch(function (err) {
      console.error(err);
      if (!state.data) renderUnavailable("Die Live-Daten konnten gerade nicht geladen werden. Bitte später nochmal versuchen.");
    });
  }

  function render(d) {
    var s = d.stream || {};
    renderHero(d, s);
    renderStats(d, s);
    renderGoal(d.followers);
    renderPartnerPath(d.channelStats, d.user);
    renderHighscores(d.highscores || {});
    renderHerd(d.herd);
    renderHall(d.hall);
    renderLiveHerd(s);

    // Diese Bereiche ändern sich selten; beim Auffrischen nicht neu aufbauen,
    // damit ein gerade laufender Clip nicht abbricht.
    if (state.firstRender) {
      renderClips(d.clips);
      renderSchedule(d.schedule);
      renderGames(d.games || []);
      renderEmotes(d.emotes || []);
      if (d.user && d.user.avatar && !DEMO) {
        $("brand-avatar").innerHTML = '<img src="' + esc(d.user.avatar) + '" alt="">';
      }
      state.firstRender = false;
    }

    window.StreamUtil.data = d;
    document.dispatchEvent(new CustomEvent("streamdata", { detail: d }));

    // Twitch gerade nicht erreichbar → Server liefert die letzte gute Version (stale)
    $("footer-updated").textContent = d.stale
      ? "⚠️ Twitch gerade nicht erreichbar – Stand " + fmtTime(d.updatedAt) + " Uhr"
      : "Aktualisiert: " + fmtTime(d.updatedAt || new Date().toISOString()) + " Uhr";
    $("footer-updated").classList.toggle("stale", !!d.stale);
  }

  // ── Hero ─────────────────────────────────────────────────────────────────
  function renderHero(d, s) {
    var status = $("hero-status");
    status.classList.toggle("live", !!s.live);
    $("live-pill").hidden = !s.live;
    $("tab-live").hidden = !s.live;

    if (s.live) {
      status.textContent = "Jetzt live · " + fmtNum(s.viewers) + " Zuschauer";
      // Chat-Befehle wie „!hangman !idle“ gehören nicht in die große Überschrift
      var title = String(s.title || "").replace(/(^|\s)![\w-]+/g, " ").replace(/\s{2,}/g, " ").trim();
      $("hero-title").textContent = title || CFG.displayName + " ist live!";
      $("hero-sub").textContent = s.game ? "🎮 " + s.game : "";
      $("hero-embed-btn").hidden = state.heroEmbedOpen;
    } else {
      status.textContent = "Gerade offline";
      $("hero-title").textContent = CFG.tagline;
      var next = nextSegment(d.schedule);
      $("hero-sub").textContent = next
        ? "Nächster Stream: " + fmtDate(next.start, { weekday: "long", day: "numeric", month: "long" })
          + " um " + fmtTime(next.start) + " Uhr" + (next.game ? " · " + next.game : "")
        : (s.title ? "Zuletzt: " + s.title : "Folge auf Twitch, um keinen Stream zu verpassen.");
      $("hero-embed-btn").hidden = true;
      closeHeroEmbed();
    }
  }

  function chatSrc() {
    var dark = document.documentElement.getAttribute("data-theme") === "night";
    return "https://www.twitch.tv/embed/" + encodeURIComponent(CFG.streamer) + "/chat?parent=" + encodeURIComponent(HOST)
      + (dark ? "&darkpopout" : "");
  }

  function openHeroEmbed() {
    if (!canEmbed()) { window.open(twitchUrl(), "_blank", "noopener"); return; }
    state.heroEmbedOpen = true;
    var box = $("hero-embed");
    box.innerHTML =
      '<iframe class="player" allowfullscreen title="Twitch-Stream" src="https://player.twitch.tv/?channel='
      + encodeURIComponent(CFG.streamer) + "&parent=" + encodeURIComponent(HOST) + '"></iframe>'
      + '<iframe class="chat" title="Twitch-Chat" src="' + esc(chatSrc()) + '"></iframe>';
    box.hidden = false;
    $("hero").classList.add("has-embed");
    $("hero-embed-btn").hidden = true;
  }

  function closeHeroEmbed() {
    if (!state.heroEmbedOpen) return;
    state.heroEmbedOpen = false;
    $("hero-embed").innerHTML = "";
    $("hero-embed").hidden = true;
    $("hero").classList.remove("has-embed");
  }

  function nextSegment(schedule) {
    if (!schedule || !schedule.segments) return null;
    var now = Date.now();
    return schedule.segments.filter(function (x) {
      return !x.canceled && new Date(x.end || x.start).getTime() > now;
    }).sort(function (a, b) { return new Date(a.start) - new Date(b.start); })[0] || null;
  }

  // ── Dashboard-Kacheln ────────────────────────────────────────────────────
  // „seit X Jahren“ ab einem Startmonat (Monat 0 = Januar)
  function sinceText(year, month) {
    var now = new Date(), y = now.getFullYear() - year - (now.getMonth() < month ? 1 : 0);
    return y >= 1 ? "seit " + y + (y === 1 ? " Jahr" : " Jahren") + " in der Savanne" : null;
  }
  function stat(icon, label, valueHtml, hint, small, id) {
    return '<div class="card stat">'
      + '<span class="stat-icon" aria-hidden="true">' + icon + "</span>"
      + '<div class="stat-label">' + esc(label) + "</div>"
      + '<div class="stat-value' + (small ? " small" : "") + '"' + (id ? ' id="' + id + '"' : "") + ">" + valueHtml + "</div>"
      + (hint ? '<div class="stat-hint">' + esc(hint) + "</div>" : "")
      + "</div>";
  }

  function renderStats(d, s) {
    var next = nextSegment(d.schedule);
    var games = d.games || [];

    $("stat-grid").innerHTML = [
      stat("👀", "Zuschauer", s.live ? fmtNum(s.viewers) : "–", s.live ? "gerade dabei" : "wenn live"),
      stat("⏱️", "Live seit", s.live ? fmtDuration(Date.now() - new Date(s.startedAt)) : "–",
        s.live ? "seit " + fmtTime(s.startedAt) + " Uhr" : null, true, "stat-uptime"),
      stat("🐾", "Follower", fmtNum(d.followers), d.followers == null ? "noch nicht verbunden" : null),
      stat("🎮", s.live ? "Kategorie" : "Zuletzt gespielt", esc(s.game || "–"), null, true),
      stat("📅", "Nächster Stream",
        next ? esc(fmtDate(next.start, { weekday: "short", day: "numeric", month: "short" })) : "–",
        next ? fmtTime(next.start) + " Uhr" : "kein fester Plan", true),
      stat("🗓️", "Dabei seit", "Mai 2019", sinceText(2019, 4), true)
    ].join("");

    clearInterval(state.uptimeTimer);
    if (s.live && s.startedAt) {
      state.uptimeTimer = setInterval(function () {
        var el = $("stat-uptime");
        if (el) el.textContent = fmtDuration(Date.now() - new Date(s.startedAt));
      }, 30000);
    }
  }

  // ── Weg zum Twitch-Partner (letzte 30 Tage, nur Summen) ──────────────────
  function renderPartnerPath(cs, user) {
    var box = $("partner-path");
    if (!cs) { box.hidden = true; return; }
    box.hidden = false;
    if (user && user.broadcasterType === "partner") {
      $("pp-grid").innerHTML = '<p class="pp-done">🎉 Geschafft – Mr27cent ist Twitch-Partner! Danke an die ganze Herde. 💜</p>';
      $("pp-note").textContent = "";
      return;
    }
    var g = cs.goal || { hours: 25, days: 12, viewers: 75 };
    var items = [
      ["⏱️", "Streamstunden", cs.hours || 0, g.hours, fmtNum(Math.round((cs.hours || 0) * 10) / 10) + " / " + g.hours + " h"],
      ["📅", "Streamtage", cs.days || 0, g.days, fmtNum(cs.days || 0) + " / " + g.days],
      ["👀", "Ø Zuschauer", cs.avgViewers || 0, g.viewers, (cs.avgViewers != null ? fmtNum(cs.avgViewers) : "–") + " / " + g.viewers]
    ];
    $("pp-grid").innerHTML = items.map(function (it) {
      var pct = Math.min(100, Math.round(it[2] / it[3] * 100));
      var ok = it[2] >= it[3];
      return '<div class="pp-item' + (ok ? " ok" : "") + '">'
        + '<div class="pp-label"><span aria-hidden="true">' + it[0] + "</span> " + esc(it[1])
        + '<span class="pp-val">' + (ok ? "✅ " : "") + esc(it[4]) + "</span></div>"
        + '<div class="bar" role="progressbar" aria-label="' + esc(it[1]) + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + pct + '">'
        + '<span style="width:' + pct + '%"></span></div></div>';
    }).join("");
    $("pp-note").textContent = cs.since
      ? "Gemessen seit " + fmtDate(cs.since) + " · jede Minute, die du live dabei bist, zählt mit! 💜"
      : "Die Messung startet mit dem nächsten Stream – jede Minute, die du dabei bist, zählt mit! 💜";
  }

  // ── Follower-Ziel ────────────────────────────────────────────────────────
  function renderGoal(followers) {
    var target = CFG.followerGoal.target;
    var walker = $("goal-walker");
    if (followers == null) {
      $("goal-value").textContent = "– / " + fmtNum(target);
      $("goal-note").textContent = "Die Follower-Zahl erscheint, sobald Twitch einmalig verbunden ist.";
      return;
    }
    var pct = Math.min(100, (followers / target) * 100);
    $("goal-value").textContent = fmtNum(followers) + " / " + fmtNum(target);
    $("goal-fill").style.width = pct + "%";
    walker.style.left = pct + "%";
    walker.classList.add("walking");
    setTimeout(function () { walker.classList.remove("walking"); }, 1300);
    $("goal-track").setAttribute("aria-valuenow", Math.round(pct));
    $("goal-note").textContent = followers >= target
      ? "🎉 Ziel erreicht! Danke an alle!"
      : "Noch " + fmtNum(target - followers) + " bis zum Akazienbaum 🌳";
  }

  // ── Highscores ───────────────────────────────────────────────────────────
  function renderHighscores(hs) {
    var medals = ["🥇", "🥈", "🥉"];
    $("highscore-grid").innerHTML = CFG.highscoreGames.map(function (g) {
      var list = hs[g.key] || [];
      var body = list.length
        ? '<ol class="score-list">' + list.map(function (e, i) {
            return '<li class="score-row' + (i < 3 ? " top" : "") + '">'
              + '<span class="score-rank">' + (medals[i] || i + 1) + "</span>"
              + '<span class="score-name">' + esc(e.name)
              + (e.info || e.date ? "<small>" + esc([e.info, e.date ? fmtDate(e.date) : null].filter(Boolean).join(" · ")) + "</small>" : "")
              + "</span>"
              + '<span class="score-val">' + fmtNum(e.score) + "</span></li>";
          }).join("") + "</ol>"
        : '<p class="empty">Noch keine Einträge – ' + (g.playUrl ? "sei die erste Gazelle!" : "spiel im Chat mit!") + "</p>";
      var play = g.playUrl
        ? '<p class="score-play"><a class="btn" href="' + esc(g.playUrl) + '" target="_blank" rel="noopener">Jetzt spielen</a></p>'
        : "";
      return '<div class="card">'
        + '<div class="score-head"><span class="icon">' + esc(g.icon) + "</span>"
        + "<div><h2>" + esc(g.title) + "</h2><small>Top 10 · " + esc(g.scoreLabel) + "</small></div></div>"
        + body + play + "</div>";
    }).join("");
  }

  // ── Clips ────────────────────────────────────────────────────────────────
  function clipMedia(c, big) {
    var inner = c.thumbnail && !DEMO
      ? '<img src="' + esc(c.thumbnail) + '" alt="" loading="lazy">'
      : '<span class="placeholder">' + (big ? "🦁" : "🎬") + "</span>";
    return '<button class="clip-media" type="button" data-clip="' + esc(c.id) + '" data-url="' + esc(c.url) + '"'
      + ' aria-label="Clip abspielen: ' + esc(c.title) + '">'
      + inner + '<span class="play"><span>▶</span></span></button>';
  }

  function clipMeta(c) {
    return fmtNum(c.views) + " Aufrufe · " + fmtDate(c.createdAt) + (c.creator ? " · geclippt von " + c.creator : "");
  }

  function renderClips(clips) {
    var items = (clips && clips.items) || [];
    var heading = clips && clips.scope === "allTime" ? "Bester Clip aller Zeiten" : "Clip des Jahres " + (clips ? clips.year : "");
    $("clip-title-text").textContent = heading;

    if (!items.length) {
      $("clip-hero").innerHTML = '<p class="empty">Noch keine Clips – wer clippt den ersten Highlight-Moment? 🎬</p>';
      $("clip-grid").innerHTML = "";
      $("clip-grid").previousElementSibling.hidden = true;
      return;
    }

    var top = items[0];
    $("clip-hero").innerHTML = clipMedia(top, true)
      + '<div><span class="clip-badge">🏆 ' + esc(heading) + "</span>"
      + "<h2>" + esc(top.title) + "</h2>"
      + '<p class="clip-meta">' + esc(clipMeta(top)) + "</p>"
      + '<p><a href="' + esc(top.url) + '" target="_blank" rel="noopener">Auf Twitch öffnen ↗</a></p></div>';

    var rest = items.slice(1);
    $("clip-grid").previousElementSibling.hidden = !rest.length;
    $("clip-grid").innerHTML = rest.map(function (c) {
      return '<div class="card clip-card">' + clipMedia(c, false)
        + "<h3>" + esc(c.title) + "</h3>"
        + '<div class="clip-meta">' + esc(clipMeta(c)) + "</div></div>";
    }).join("");
  }

  function initClipClicks() {
    document.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-clip]");
      if (!btn) return;
      if (!canEmbed() || DEMO) { window.open(btn.getAttribute("data-url"), "_blank", "noopener"); return; }
      var frame = document.createElement("iframe");
      frame.allowFullscreen = true;
      frame.title = "Twitch-Clip";
      frame.src = "https://clips.twitch.tv/embed?clip=" + encodeURIComponent(btn.getAttribute("data-clip"))
        + "&parent=" + encodeURIComponent(HOST) + "&autoplay=true";
      var wrap = document.createElement("div");
      wrap.className = "clip-media";
      wrap.appendChild(frame);
      btn.replaceWith(wrap);
    });
  }

  // ── Streamplan ───────────────────────────────────────────────────────────
  function renderSchedule(schedule) {
    var box = $("schedule-box");
    var segs = (schedule && schedule.segments) || [];
    var vacation = schedule && schedule.vacation
      ? '<div class="vacation">🏝️ Pause vom ' + esc(fmtDate(schedule.vacation.start_time)) + " bis "
        + esc(fmtDate(schedule.vacation.end_time)) + "</div>"
      : "";

    if (!segs.length) {
      box.innerHTML = vacation + '<div class="schedule-empty"><div class="big">🌾</div>'
        + "<p><b>Aktuell gibt es keinen festen Streamplan.</b></p>"
        + '<p class="empty">Folge auf Twitch, dann bekommst du eine Benachrichtigung, sobald es losgeht.</p>'
        + '<p><a class="btn btn-primary" href="' + esc(twitchUrl()) + '" target="_blank" rel="noopener">Auf Twitch folgen</a></p></div>';
      return;
    }

    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var days = [];
    for (var i = 0; i < 7; i++) {
      var day = new Date(today);
      day.setDate(today.getDate() + i);
      days.push(day);
    }

    box.innerHTML = vacation + '<div class="week">' + days.map(function (day, i) {
      var slots = segs.filter(function (s) {
        var d = new Date(s.start);
        return d.getFullYear() === day.getFullYear() && d.getMonth() === day.getMonth() && d.getDate() === day.getDate();
      });
      return '<div class="day' + (i === 0 ? " today" : "") + '">'
        + '<div class="day-name">' + (i === 0 ? "Heute" : day.toLocaleDateString("de-DE", { weekday: "long" })) + "</div>"
        + '<div class="day-date">' + day.toLocaleDateString("de-DE", { day: "numeric", month: "short" }) + "</div>"
        + (slots.length ? slots.map(function (s) {
            return '<div class="slot' + (s.canceled ? " canceled" : "") + '">'
              + "<b>" + fmtTime(s.start) + (s.end ? "–" + fmtTime(s.end) : "") + "</b>"
              + esc(s.title || s.game || "Stream") + "</div>";
          }).join("") : '<div class="day-free">frei</div>')
        + "</div>";
    }).join("") + "</div>";
  }

  // ── Spiele ───────────────────────────────────────────────────────────────
  var GAMES_SHOWN = 10;   // so viele Spiele zuerst, der Rest per Knopf
  function renderGames(games, all) {
    var list = all ? games : games.slice(0, GAMES_SHOWN);
    $("game-grid").innerHTML = games.length ? list.map(function (g) {
      var hours = g.minutes / 60;
      return '<div class="card game">'
        + '<div class="game-cover">' + (g.boxArt && !DEMO ? '<img src="' + esc(g.boxArt) + '" alt="" loading="lazy">' : "🎮") + "</div>"
        + '<div class="game-name">' + esc(g.name) + "</div>"
        + '<div class="game-hours">' + (hours >= 1 ? fmtNum(Math.round(hours * 10) / 10) + " h" : g.minutes + " min") + "</div>"
        + (g.lastPlayed ? '<div class="game-last">zuletzt ' + esc(fmtDate(g.lastPlayed)) + "</div>" : "")
        + "</div>";
    }).join("") + (!all && games.length > GAMES_SHOWN
      ? '<button type="button" class="card game game-more" id="games-more">+ ' + (games.length - GAMES_SHOWN) + " weitere Spiele</button>" : "")
      : '<div class="card"><p class="empty">Die Spielzeit wird ab dem nächsten Stream automatisch mitgeschrieben.</p></div>';
    var more = $("games-more");
    if (more) more.onclick = function () { renderGames(games, true); };
  }

  // ── Emotes ───────────────────────────────────────────────────────────────
  function emoteTier(e) {
    if (e.type === "follower") return "Follower";
    if (e.type === "bitstier") return "Bits";
    if (e.tier) return "Tier " + String(e.tier).charAt(0);
    return "";
  }

  function renderEmotes(emotes) {
    var section = $("emotes");
    if (!emotes.length) { section.hidden = true; return; }
    section.hidden = false;
    $("emote-grid").innerHTML = emotes.map(function (e) {
      return '<div class="emote">'
        + (e.url && !DEMO ? '<img src="' + esc(e.url) + '" alt="' + esc(e.name) + '" loading="lazy">' : '<span class="emote-ph">' + esc(e.ph || "😺") + "</span>")
        + '<span class="emote-name" title="' + esc(e.name) + '">' + esc(e.name) + "</span>"
        + '<span class="emote-tier">' + esc(emoteTier(e)) + "</span></div>";
    }).join("");
  }

  // ── Discord ──────────────────────────────────────────────────────────────
  function renderDiscord() {
    var body = $("discord-body");
    var d = CFG.discord;
    var invite = function (url) {
      return url ? '<a class="btn btn-discord" href="' + esc(url) + '" target="_blank" rel="noopener">Discord beitreten</a>' : "";
    };

    if (!d.serverId) {
      body.innerHTML = d.inviteUrl
        ? "<p>Komm in die Community – quatschen, Clips teilen, Stream-Ankündigungen.</p>" + invite(d.inviteUrl)
        : '<p class="empty">Discord-Link folgt bald.</p>';
      return;
    }

    body.innerHTML = '<p class="empty">Lädt …</p>';
    fetch("https://discord.com/api/guilds/" + encodeURIComponent(d.serverId) + "/widget.json")
      .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
      .then(function (w) {
        var names = (w.members || []).slice(0, 12).map(function (m) { return "<span>" + esc(m.username) + "</span>"; }).join("");
        body.innerHTML = '<div class="discord-online">' + fmtNum(w.presence_count) + " gerade online</div>"
          + (names ? '<div class="discord-members">' + names + "</div>" : "")
          + invite(d.inviteUrl || w.instant_invite);
      })
      .catch(function () {
        body.innerHTML = "<p>Komm in die Community!</p>" + invite(d.inviteUrl);
      });
  }

  // ── Die Herde (Zuschauzeit) ─────────────────────────────────────────────
  var HERD = CFG.herd;

  var HC = window.HerdCore(HERD);
  var stageFor = HC.stageFor, stageNo = HC.stageNo, nextStage = HC.nextStage,
      herdScale = HC.herdScale, lookFor = HC.lookFor;

  function gazelleArt(hours, base) {
    var look = lookFor(hours);
    if (!look) return gazelleSvg(herdScale(hours), base);
    // Fotos sind höher als breit → Höhe festlegen, damit sie in ihren Kasten passen
    var h = Math.round(base * herdScale(hours));
    return '<img class="gz-img" src="' + esc(look.img) + '" alt="" style="height:' + h + 'px;width:auto" loading="lazy">';
  }

  function gazelleSvg(scale, base) {
    var w = Math.round(base * scale), h = Math.round(w * 0.9);
    return '<svg viewBox="0 0 100 90" width="' + w + '" height="' + h + '" aria-hidden="true"><use href="#sym-gazelle"/></svg>';
  }
  function fmtHours(minutes) {
    var h = minutes / 60;
    return (h >= 10 ? fmtNum(Math.round(h)) : fmtNum(Math.round(h * 10) / 10)) + " h";
  }

  function renderStages() {
    $("herd-max-text").textContent = fmtNum(HERD.maxHours) + " Stunden";
    $("stage-row").innerHTML = HERD.stages.map(function (st, i) {
      // In der Übersicht alle Bilder gleich groß, damit man die Unterschiede sieht
      var look = lookFor(st.hours);
      var art = look
        ? '<img class="stage-img" src="' + esc(look.img) + '" alt="" loading="lazy">'
        : gazelleArt(st.hours, 78);
      return '<div class="stage" data-stage="' + i + '">' + art
        + '<span class="stage-no">Stufe ' + (i + 1) + "</span>"
        + '<span class="stage-name">' + esc(st.name) + "</span>"
        + '<span class="stage-hours">ab ' + fmtNum(st.hours) + " h</span></div>";
    }).join("");
    $("stage-count").textContent = HERD.stages.length;
    // Verlauf am rechten Rand zeigt „hier geht's weiter“ – am Ende ausblenden
    var row = $("stage-row");
    if (!row.dataset.fade) {
      row.dataset.fade = "1";
      var upd = function () { row.classList.toggle("at-end", row.scrollLeft + row.clientWidth >= row.scrollWidth - 4); };
      row.addEventListener("scroll", upd, { passive: true });
      window.addEventListener("resize", upd);
      setTimeout(upd, 0);
    }
  }

  // Eigene Stufe in der Stufen-Leiste hervorheben und hinscrollen
  function markStage(i) {
    document.querySelectorAll("#stage-row .stage").forEach(function (el) {
      var on = Number(el.getAttribute("data-stage")) === i;
      el.classList.toggle("current", on);
      if (on) {
        var row = $("stage-row");
        row.scrollTo({ left: el.offsetLeft - row.clientWidth / 2 + el.clientWidth / 2, behavior: "smooth" });
      }
    });
  }

  var HERD_CARDS = 12, HERD_TOP = 100;   // große Karten, danach Liste bis Platz 100

  function memberCard(m, i) {
    var h = m.minutes / 60;
    return '<div class="card herd-member"><span class="pos">' + (i + 1) + "</span>"
      + '<div class="me-stage">' + gazelleArt(h, 100) + "</div>"
      + (m.name
        ? '<div class="name" title="' + esc(m.name) + '">' + esc(m.name) + "</div>"
        : '<div class="name anon">Anonyme Gazelle</div>')
      + '<div class="rank">' + esc(stageFor(h).name) + "</div>"
      + '<div class="hours">Stufe ' + stageNo(h) + " · " + fmtHours(m.minutes) + "</div></div>";
  }

  function renderMe(query) {
    var box = $("herd-me");
    var herd = state.herd;
    var q = String(query || "").trim().toLowerCase();
    if (!q || !herd) { box.innerHTML = ""; markStage(-1); return; }
    var list = state.visible || [];
    var idx = -1;
    // Nur Gazellen mit Namen sind auffindbar – anonyme bleiben anonym
    list.forEach(function (m, i) { if (idx === -1 && m.name && m.name.toLowerCase() === q) idx = i; });
    if (idx === -1) list.forEach(function (m, i) { if (idx === -1 && m.name && m.name.toLowerCase().indexOf(q) === 0) idx = i; });
    if (idx === -1) {
      markStage(-1);
      box.innerHTML = '<p class="empty">Keine Gazelle mit diesem Namen in der Rangliste. Deine Zeit zählt schon mit – '
        + 'schreib <b>!herde</b> im Chat, dann erscheint deine Gazelle mit Namen. 🌱</p>';
      return;
    }
    var m = list[idx], h = m.minutes / 60, st = stageFor(h), nx = nextStage(h);
    markStage(stageNo(h) - 1);
    var stagePct = nx ? Math.round(((h - st.hours) / (nx.hours - st.hours)) * 100) : 100;
    var yearPct = Math.min(100, Math.round((h / HERD.maxHours) * 100));
    box.innerHTML = '<div class="me-card">'
      + '<div class="me-stage">' + gazelleArt(h, 160) + "</div>"
      + "<div>"
      + '<div class="me-name">' + esc(m.name) + "</div>"
      + '<div class="me-rank">' + esc(st.name) + " · Stufe " + stageNo(h) + "/" + HERD.stages.length
      + " · Platz " + (idx + 1) + " von " + fmtNum(list.length) + "</div>"
      + '<div class="me-meta">' + fmtHours(m.minutes) + " zugeschaut in " + herd.year
      + (m.lastSeen ? " · zuletzt dabei am " + esc(fmtDate(m.lastSeen)) : "") + "</div>"
      + (nx
        ? '<div class="bar"><span style="width:' + stagePct + '%"></span></div>'
          + '<div class="bar-label">Noch ' + fmtHours(Math.max(0, (nx.hours - h) * 60)) + " bis „" + esc(nx.name) + "“</div>"
        : '<div class="bar-label">🏆 Ausgewachsen! Mehr geht in dieser Saison nicht.</div>')
      + '<div class="bar"><span style="width:' + yearPct + '%"></span></div>'
      + '<div class="bar-label">' + yearPct + " % bis zur Universumsgazelle (" + fmtNum(HERD.maxHours) + " h)</div>"
      + badgesHtml(m, idx, h)
      + "</div></div>";
  }

  // Abzeichen aus Herde und Highscores
  function badgesHtml(m, idx, hours) {
    var b = [];
    var name = m.name.toLowerCase();
    if (hours >= 1) b.push(["🌱", "Erste Stunde"]);
    if (hours >= 24) b.push(["☀️", "Ein ganzer Tag"]);
    if (hours >= 100) b.push(["🔥", "100 Stunden"]);
    if (hours >= HERD.maxHours) b.push(["👑", "Universumsgazelle"]);
    if (idx < 3) b.push(["🏆", "Top 3 der Herde"]);
    else if (idx < 10) b.push(["⭐", "Top 10 der Herde"]);
    var hs = (state.data && state.data.highscores) || {};
    CFG.highscoreGames.forEach(function (g) {
      (hs[g.key] || []).forEach(function (e, i) {
        if (e.name.toLowerCase() !== name) return;
        b.push([i === 0 ? "🥇" : g.icon, g.title + " Platz " + (i + 1)]);
      });
    });
    if (!b.length) return "";
    return '<div class="badges">' + b.map(function (x) {
      return '<span class="badge" title="' + esc(x[1]) + '">' + x[0] + " " + esc(x[1]) + "</span>";
    }).join("") + "</div>";
  }

  function renderHall(hall) {
    var medals = ["🥇", "🥈", "🥉"];
    $("hall").innerHTML = hall && hall.length
      ? hall.map(function (season) {
          return '<div class="hall-season"><div class="hall-year">Saison ' + season.year + "</div>"
            + '<ol class="hall-list">' + season.top.filter(function (m) { return m.name; }).map(function (m, i) {
                return '<li><span class="hall-medal">' + (medals[i] || i + 1) + "</span>"
                  + '<span class="hall-name' + (m.name ? "" : " anon") + '">' + esc(m.name || "Anonyme Gazelle") + "</span>"
                  + '<span class="hall-hours">' + fmtHours(m.minutes) + "</span></li>";
              }).join("") + "</ol></div>";
        }).join("")
      : '<p class="empty">Die erste Saison läuft noch – am 1. Januar ziehen die größten Gazellen hier für immer ein. 👑</p>';
  }

  function renderHerd(herd) {
    state.herd = herd;
    var all = (herd && herd.members) || [];
    // Rangliste nur mit Gazellen, die per !herde sichtbar sein wollen – die Zeit aller zählt trotzdem
    var members = all.filter(function (m) { return m.name; });
    state.visible = members;
    $("herd-season").textContent = herd ? "Saison " + herd.year : "";
    $("herd-names").innerHTML = members.filter(function (m) { return m.name; }).slice(0, 500)
      .map(function (m) { return '<option value="' + esc(m.name) + '">'; }).join("");
    $("herd-grid").innerHTML = members.length
      ? members.slice(0, HERD_CARDS).map(memberCard).join("")
      : '<div class="card"><p class="empty">' + (all.length
        ? "Noch hat niemand <b>!herde</b> geschrieben – schreib es in den Chat, dann erscheint deine Gazelle hier. Deine Zeit zählt schon jetzt mit! 🌱"
        : "Die Herde wächst ab dem nächsten Stream – jeder Zuschauer wird automatisch als Kitz geboren.") + "</p></div>";
    // Plätze 13–100 als kompakte Liste
    var rest = members.slice(HERD_CARDS, HERD_TOP);
    $("herd-list").hidden = !rest.length;
    $("herd-list").innerHTML = rest.map(function (m, i) {
      var h = m.minutes / 60;
      return '<li class="herd-row"><span class="hr-pos">' + (HERD_CARDS + i + 1) + "</span>"
        + '<span class="hr-art">' + gazelleArt(h, 120) + "</span>"
        + (m.name ? '<span class="hr-name" title="' + esc(m.name) + '">' + esc(m.name) + "</span>"
                  : '<span class="hr-name anon">Anonyme Gazelle</span>')
        + '<span class="hr-stage">' + esc(stageFor(h).name) + " · Stufe " + stageNo(h) + "</span>"
        + '<span class="hr-hours">' + fmtHours(m.minutes) + "</span></li>";
    }).join("");
    $("herd-total").textContent = all.length
      ? fmtNum(herd.total) + " Gazellen in der Herde · " + fmtNum(members.length) + " davon mit Namen in der Rangliste"
      : "";
    renderMe($("herd-search").value);
  }

  // Live-Savanne: so viele Gazellen wie Zuschauer (begrenzt) laufen durchs Bild
  function renderLiveHerd(s) {
    var box = $("live-herd");
    var n = s.live ? Math.min(HERD.liveMax, Math.max(1, Number(s.viewers) || 0)) : 0;
    if (box.childElementCount === n) return;
    var html = "";
    for (var i = 0; i < n; i++) {
      var depth = Math.random();                       // 0 = hinten, 1 = vorne
      var size = Math.round(26 + depth * 34);
      var dur = Math.round(70 - depth * 35 + Math.random() * 15);
      html += '<div class="runner' + (Math.random() < 0.4 ? " rev" : "") + '" style="'
        + "bottom:" + (14 - depth * 12).toFixed(1) + "vh;width:" + size + "px;height:" + Math.round(size * 0.9) + "px;"
        + "animation-duration:" + dur + "s;animation-delay:-" + Math.round(Math.random() * dur) + "s;"
        + "z-index:" + Math.round(depth * 10) + '">'
        + '<svg viewBox="0 0 100 90"><use href="#sym-gazelle"/></svg></div>';
    }
    box.innerHTML = html;
  }

  // ── Ohne Einwilligung / Fehler ───────────────────────────────────────────
  function renderUnavailable(msg) {
    var btn = consentGiven() ? "" : ' <a href="#" id="consent-again">Inhalte laden</a>';
    var html = '<div class="card"><p class="empty">' + esc(msg) + btn + "</p></div>";
    $("hero-status").textContent = "";
    $("hero-title").textContent = CFG.tagline;
    $("hero-sub").textContent = "Schau direkt auf Twitch vorbei!";
    $("stat-grid").innerHTML = html;
    $("highscore-grid").innerHTML = html;
    $("herd-grid").innerHTML = html;
    $("clip-hero").innerHTML = '<p class="empty">' + esc(msg) + "</p>";
    $("clip-grid").innerHTML = "";
    $("clip-grid").previousElementSibling.hidden = true;
    $("schedule-box").innerHTML = '<p class="empty">' + esc(msg) + "</p>";
    $("game-grid").innerHTML = html;
    $("emotes").hidden = true;
    $("hall").innerHTML = '<p class="empty">' + esc(msg) + "</p>";
    $("cotm").innerHTML = '<p class="empty">' + esc(msg) + "</p>";
    $("goal-note").textContent = "";
    $("discord-body").innerHTML = CFG.discord.inviteUrl
      ? '<a class="btn btn-discord" href="' + esc(CFG.discord.inviteUrl) + '" target="_blank" rel="noopener">Discord beitreten</a>'
      : '<p class="empty">Discord-Link folgt bald.</p>';

    var again = $("consent-again");
    if (again) again.onclick = function (e) { e.preventDefault(); $("consent").hidden = false; };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Demo-Daten (solange apiUrl leer ist) – Vorschau: ?demo=offline
  // ═══════════════════════════════════════════════════════════════════════
  function demoData() {
    var now = Date.now();
    var live = new URLSearchParams(window.location.search).get("demo") !== "offline";
    var day = 86400000;
    function at(offsetDays, hour) {
      var d = new Date(now + offsetDays * day);
      d.setHours(hour, 0, 0, 0);
      return d.toISOString();
    }
    return {
      updatedAt: new Date().toISOString(),
      user: { displayName: "Mr27cent", broadcasterType: "affiliate" },
      channelStats: { since: at(-24, 19), samples: 300, avgViewers: 31.4, peakViewers: 58, hours: 25.5,
        days: 9, streams: 9, goal: { hours: 25, days: 12, viewers: 75 } },
      stream: {
        live: live,
        title: live ? "Gemütlicher Abend in der Savanne 🌾 !hangman !idle" : "Gemütlicher Abend in der Savanne 🌾",
        game: "Elden Ring",
        viewers: 42,
        startedAt: new Date(now - 2.3 * 3600000).toISOString()
      },
      followers: 7340,
      schedule: {
        vacation: null,
        segments: [
          { start: at(1, 19), end: at(1, 23), title: "Soulslike-Abend", game: "Elden Ring" },
          { start: at(3, 20), end: at(3, 23), title: "Chat-Games: Hangman", game: "Just Chatting" },
          { start: at(5, 18), end: at(5, 22), title: "Wochenend-Stream", game: "Elden Ring" }
        ]
      },
      clips: {
        scope: "year",
        year: new Date().getFullYear(),
        items: [
          { id: "demo1", url: twitchUrl(), title: "Der Löwe hat mich erwischt 😂", views: 1834, createdAt: at(-60, 20), creator: "Akazienkind" },
          { id: "demo2", url: twitchUrl(), title: "No-Hit gegen Margit!", views: 642, createdAt: at(-30, 21), creator: "SavannenFuchs" },
          { id: "demo3", url: twitchUrl(), title: "Hangman-Wort des Jahres", views: 411, createdAt: at(-12, 19), creator: "Wüstenfuchs" },
          { id: "demo4", url: twitchUrl(), title: "Wenn der Chat besser rät als ich", views: 288, createdAt: at(-90, 22), creator: "Gnu_Gnu" },
          { id: "demo5", url: twitchUrl(), title: "Sammelspiel-Rekord geknackt", views: 197, createdAt: at(-5, 20), creator: "Akazienkind" }
        ]
      },
      emotes: [
        { name: "mr27centHi", tier: "1000", type: "subscriptions", ph: "👋" },
        { name: "mr27centLove", tier: "1000", type: "subscriptions", ph: "🧡" },
        { name: "mr27centGazelle", tier: "1000", type: "subscriptions", ph: "🦌" },
        { name: "mr27centRage", tier: "2000", type: "subscriptions", ph: "😤" },
        { name: "mr27centGG", type: "follower", ph: "🏆" },
        { name: "mr27centLion", tier: "3000", type: "subscriptions", ph: "🦁" }
      ],
      games: [
        { name: "Elden Ring", minutes: 9840, lastPlayed: at(-1, 20) },
        { name: "Just Chatting", minutes: 2310, lastPlayed: at(-3, 20) },
        { name: "Hollow Knight", minutes: 1260, lastPlayed: at(-40, 20) },
        { name: "Stardew Valley", minutes: 890, lastPlayed: at(-75, 20) },
        { name: "Lies of P", minutes: 645, lastPlayed: at(-120, 20) }
      ],
      hall: [
        { year: new Date().getFullYear() - 1, top: [
          { name: "Altmeister", minutes: 61200 }, { name: "Wüstenfuchs", minutes: 47400 }, { name: "Zebrastreifen", minutes: 39000 }
        ] }
      ],
      streaks: {
        hangman: [
          { name: "Akazienkind", best: 23, current: 23 }, { name: "Wüstenfuchs", best: 17, current: 4 },
          { name: "Steppenwolf", best: 9, current: 0 }, { name: "Gnu_Gnu", best: 6, current: 6 }
        ],
        wordle: [
          { name: "Zebrastreifen", best: 31, current: 12 }, { name: "Akazienkind", best: 14, current: 14 },
          { name: "SavannenFuchs", best: 5, current: 0 }
        ],
        emotle: [
          { name: "Wüstenfuchs", best: 8, current: 8 }, { name: "Gnu_Gnu", best: 3, current: 0 }
        ]
      },
      clipOfMonth: {
        month: new Date().toISOString().slice(0, 7),
        candidates: [
          { id: "demo5", url: twitchUrl(), title: "Sammelspiel-Rekord geknackt", views: 197, createdAt: at(-5, 20), creator: "Akazienkind", votes: 12 },
          { id: "demo3", url: twitchUrl(), title: "Hangman-Wort des Jahres", views: 141, createdAt: at(-12, 19), creator: "Wüstenfuchs", votes: 8 },
          { id: "demo6", url: twitchUrl(), title: "Chat rettet mich vor dem Löwen", views: 96, createdAt: at(-2, 21), creator: "Gnu_Gnu", votes: 5 }
        ],
        winner: { month: new Date(now - 31 * day).toISOString().slice(0, 7), votes: 23,
          clip: { id: "demo2", url: twitchUrl(), title: "No-Hit gegen Margit!", views: 642, createdAt: at(-40, 21), creator: "SavannenFuchs" } }
      },
      poll: {
        id: "demo",
        question: "Was soll ich als Nächstes spielen?",
        options: [
          { text: "Hollow Knight: Silksong", votes: 14 },
          { text: "Lies of P – zweiter Durchgang", votes: 9 },
          { text: "Stardew Valley mit Chat", votes: 21 },
          { text: "Überrasch mich!", votes: 5 }
        ]
      },
      herd: {
        year: new Date().getFullYear(),
        total: 23,
        members: [
          ["Zebrastreifen", 1000], ["Wüstenfuchs", 742], ["Akazienkind", 615], ["Steppenwolf", 431],
          ["SavannenFuchs", 318], ["Gnu_Gnu", 204], ["Löwenzahn", 166], ["Nashornkäfer", 97],
          ["Termitenhügel", 61], ["Baobab", 48], ["Wasserloch", 23], ["Flamingo", 12], ["Erdmännchen", 4.5], ["Neuling42", 0.5]
        ].map(function (m, i) {
          var anon = i % 4 === 3;   // Demo: jede vierte Gazelle grast anonym
          return { id: anon ? "anon" + i : m[0].toLowerCase(), name: anon ? null : m[0], minutes: Math.round(m[1] * 60),
            lastSeen: anon ? null : at(-i, 20), present: live && i % 3 !== 2 };
        })
      },
      highscores: {
        hangman: [
          { name: "Akazienkind", score: 128, date: at(-2, 20) },
          { name: "Wüstenfuchs", score: 117, date: at(-6, 20) },
          { name: "Steppenwolf", score: 96, date: at(-1, 20) },
          { name: "SavannenFuchs", score: 71, date: at(-10, 20) },
          { name: "Zebrastreifen", score: 54, date: at(-14, 20) }
        ],
        idle: [
          { name: "Zebrastreifen", score: 12, info: "⭐ 9 · Phase 4" },
          { name: "Wüstenfuchs", score: 7, info: "⭐ 6 · Phase 3" },
          { name: "Akazienkind", score: 3, info: "⭐ 4 · Phase 3" },
          { name: "Gnu_Gnu", score: 0, info: "⭐ 1 · Phase 2" }
        ]
      },
      errors: []
    };
  }

  // ═══════════════════════════════════════════════════════════════════════
  //  Start
  // ═══════════════════════════════════════════════════════════════════════
  // start() läuft beim Laden und nach jeder Einwilligungs-Entscheidung erneut:
  // Wer erst ablehnt und später zustimmt, bekommt dann sofort die Live-Daten.
  var liveStarted = false, discordLive = false;
  function start() {
    // Demo enthält keine externen Inhalte → läuft auch ohne Einwilligung
    if (!consentGiven() && !DEMO) {
      renderUnavailable("Live-Inhalte von Twitch sind deaktiviert.");
      renderDiscordOffline();
      return;
    }
    if (!liveStarted) {
      liveStarted = true;
      if (!DEMO) renderSkeletons();
      refresh();
      setInterval(refresh, Math.max(30, CFG.refreshSeconds) * 1000);
    }
    if (consentGiven() && !discordLive) {
      discordLive = true;
      renderDiscord();
    } else if (!discordLive) {
      renderDiscordOffline();
    }
  }

  function renderDiscordOffline() {
    $("discord-body").innerHTML = CFG.discord.inviteUrl
      ? '<p>Komm in die Community!</p><a class="btn btn-discord" href="' + esc(CFG.discord.inviteUrl) + '" target="_blank" rel="noopener">Discord beitreten</a>'
      : '<p class="empty">Discord-Link folgt bald.</p>';
  }

  // Für extras.js (Mitmachen, Meilensteine, Rückblick, Geräusche)
  window.StreamUtil = {
    CFG: CFG, DEMO: DEMO, data: null,
    $: $, esc: esc, fmtNum: fmtNum, fmtDate: fmtDate, fmtHours: fmtHours,
    consentGiven: consentGiven, stageFor: stageFor, herdScale: herdScale, gazelleSvg: gazelleSvg,
    lookFor: lookFor, clipMedia: clipMedia, clipMeta: clipMeta
  };

  // ── Als App installieren (PWA) ───────────────────────────────────────────
  function initInstall() {
    var btn = $("install-btn"), deferred = null;
    var standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
    if (standalone) return;
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferred = e;
      btn.hidden = false;
    });
    // iPhone/iPad kennen kein Installations-Fenster → Anleitung zeigen
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) btn.hidden = false;
    btn.onclick = function () {
      if (deferred) {
        deferred.prompt();
        deferred.userChoice.then(function () { deferred = null; btn.hidden = true; });
      } else {
        openModal($("install-modal"), btn);
      }
    };
    if ("serviceWorker" in navigator && (location.protocol === "https:" || HOST === "localhost")) {
      navigator.serviceWorker.register("sw.js").catch(function () { /* ohne Offline-Speicher weiter */ });
    }
  }

  initTheme();
  initInstall();
  initBackground();
  initUi();
  initClipClicks();
  renderStatic();
  $("hero-embed-btn").onclick = openHeroEmbed;
  renderStages();
  $("herd-search").addEventListener("input", function () { renderMe(this.value); });
  if (initConsent()) start();
  else if (DEMO) start();
})();
