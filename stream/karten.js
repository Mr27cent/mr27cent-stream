/* ═══════════════════════════════════════════════════════════════════════════
 *  Herden-Karten – Reiter #karten (Album, Packs, Tausch, Ranglisten, Chancen)
 *  Daten: Supabase (config.js → cards). Alle Regeln prüft die Datenbank,
 *  diese Datei zeigt nur an und ruft die Funktionen cards_web_* auf.
 *  Login: „Mit Twitch anmelden“ über Supabase Auth (dasselbe Konto wie beim
 *  Sammelspiel). Direktlink auf ein Album: #karten/@name
 * ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var U = window.StreamUtil;
  var CFG = U.CFG, $ = U.$, esc = U.esc, fmtNum = U.fmtNum;
  var C = CFG.cards;
  if (!C || !C.supabaseUrl || !$("karten")) return;

  var SESSION_KEY = "cards_session_v1";
  var RARITY_NAMES = { C: "Common", U: "Uncommon", R: "Rare", E: "Epic", L: "Legendary", M: "Mythic" };
  var RARITY_ORDER = ["C", "U", "R", "E", "L", "M"];
  var SOURCE_NAMES = { starter: "Starter-Pack", weekly: "Gratis-Pack", sub: "Sub-Pack", points: "Kanalpunkte-Pack",
    admin: "Geschenk-Pack", watch: "Zuschau-Pack" };

  var REASONS = {
    noch_nicht_gestartet: "Das Kartenspiel startet am 1. Januar 2027 – bis dahin ist alles noch gesperrt.",
    schon_abgeholt: "Das hast du schon abgeholt.",
    keine_packs: "Du hast gerade keine ungeöffneten Packs.",
    kein_pack: "Dieses Pack gehört dir nicht (mehr).",
    schon_offen: "Dieses Pack ist schon geöffnet.",
    andere_seltenheit: "Tauschen geht nur mit Karten der gleichen Seltenheit.",
    kein_duplikat_eigen: "Du hast diese Karte nicht doppelt – deine letzte Kopie bleibt immer bei dir.",
    kein_duplikat_partner: "Dein Tauschpartner hat diese Karte nicht doppelt.",
    limit: "Tageslimit erreicht – pro Tag sind 5 Tausche möglich.",
    partner_unbekannt: "Diesen Namen gibt es im Kartenspiel noch nicht.",
    selbst: "Mit dir selbst kannst du nicht tauschen. 😉",
    karte_unbekannt: "Diese Karte gibt es nicht.",
    kein_angebot: "Dieses Angebot gibt es nicht mehr.",
    abgelaufen: "Das Angebot ist leider abgelaufen.",
    erledigt: "Das Angebot wurde schon beantwortet.",
    nicht_mehr_doppelt: "Eine der Karten ist nicht mehr doppelt vorhanden – der Tausch wurde abgebrochen.",
    nicht_im_besitz: "Diese Version der Karte hast du nicht.",
    versteckt: "Dieses Album ist versteckt.",
    unbekannt: "Dieses Album gibt es (noch) nicht – es erscheint, sobald die Person Karten hat."
  };

  var state = {
    session: null,
    info: null,          // cards_public_info
    me: null,            // cards_web_me
    myAlbum: null,
    view: "album",       // album | browse | trade | ranks | odds
    filter: "all",
    other: null,         // fremdes Album (Alben ansehen / Tausch)
    tradePartner: null,  // Album des Tauschpartners
    trades: null,
    oddsStage: null,
    started: false,
    msg: null
  };

  // ── Speicher & Hilfen ──────────────────────────────────────────────────────
  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      if (val === null) localStorage.removeItem(key);
      else localStorage.setItem(key, val);
    } catch (e) { return null; }
  }

  function pad(n) { return String(n).padStart(3, "0"); }
  function hours(min) { return fmtNum(Math.floor((min || 0) / 60)); }
  function pct(v, digits) {
    return Number(v).toLocaleString("de-DE", { maximumFractionDigits: digits == null ? 2 : digits }) + " %";
  }
  function safeImg(src) { return typeof src === "string" && /^[\w\-./]+$/.test(src) && src.indexOf("..") === -1 ? src : ""; }
  function reasonText(r) {
    if (!r) return "Da ist etwas schiefgelaufen. Bitte versuch es gleich noch einmal.";
    if (r.reason === "zu_wenig_zeit") {
      return "Für das Gratis-Pack brauchst du diese Woche " + r.needed + " Minuten Zuschauzeit – du hast " + r.minutes + ".";
    }
    return REASONS[r.reason] || "Das ging nicht (" + esc(r.reason) + ").";
  }

  function flash(text, kind) {
    state.msg = { text: text, kind: kind || "info" };
    var box = $("kt-msg");
    box.className = "kt-msg kt-msg-" + state.msg.kind;
    box.textContent = text;
    box.hidden = false;
    clearTimeout(flash.timer);
    flash.timer = setTimeout(function () { box.hidden = true; }, 7000);
  }

  // ── Login (Supabase Auth, Anbieter Twitch) ─────────────────────────────────
  function readSession() {
    try { return JSON.parse(store(SESSION_KEY) || "null"); } catch (e) { return null; }
  }
  function saveSession(s) {
    state.session = s;
    store(SESSION_KEY, s ? JSON.stringify(s) : null);
  }

  // Nach dem Login hängt Supabase die Tokens an die Adresse (#access_token=…)
  function captureLogin() {
    var h = window.location.hash.slice(1);
    if (h.indexOf("access_token=") === -1 && h.indexOf("error=") === -1) return;
    var p = new URLSearchParams(h);
    if (p.get("access_token")) {
      saveSession({
        access_token: p.get("access_token"),
        refresh_token: p.get("refresh_token"),
        expires_at: Date.now() + Number(p.get("expires_in") || 3600) * 1000
      });
    } else {
      state.msg = { text: "Anmeldung abgebrochen: " + (p.get("error_description") || p.get("error")), kind: "error" };
    }
    history.replaceState(null, "", window.location.pathname + window.location.search + "#karten");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }

  function login() {
    var back = window.location.origin + window.location.pathname;
    window.location.href = C.supabaseUrl + "/auth/v1/authorize?provider=twitch&redirect_to=" + encodeURIComponent(back);
  }

  function logout() {
    var s = state.session;
    saveSession(null);
    state.me = null; state.myAlbum = null; state.trades = null; state.newIds = null; state.seenKeys = null;
    if (s) {
      fetch(C.supabaseUrl + "/auth/v1/logout", {
        method: "POST",
        headers: { apikey: C.supabaseKey, Authorization: "Bearer " + s.access_token }
      }).catch(function () {});
    }
    render();
  }

  function freshToken() {
    var s = state.session;
    if (!s) return Promise.resolve(null);
    if (s.expires_at - Date.now() > 60000) return Promise.resolve(s.access_token);
    return fetch(C.supabaseUrl + "/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      headers: { apikey: C.supabaseKey, "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: s.refresh_token })
    }).then(function (r) {
      if (!r.ok) throw new Error("refresh");
      return r.json();
    }).then(function (j) {
      saveSession({ access_token: j.access_token, refresh_token: j.refresh_token,
        expires_at: Date.now() + Number(j.expires_in || 3600) * 1000 });
      return j.access_token;
    }).catch(function () {
      saveSession(null);
      return null;
    });
  }

  // Aufruf einer Datenbank-Funktion; authed = mit Login
  function rpc(fn, args, authed) {
    return (authed ? freshToken() : Promise.resolve(null)).then(function (token) {
      if (authed && !token) throw { loggedOut: true };
      var headers = { apikey: C.supabaseKey, "Content-Type": "application/json" };
      if (token) headers.Authorization = "Bearer " + token;
      return fetch(C.supabaseUrl + "/rest/v1/rpc/" + fn, {
        method: "POST", headers: headers, body: JSON.stringify(args || {})
      });
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) {
        if (r.ok) return j;
        if (r.status === 401 || (j && j.code === "28000")) { saveSession(null); throw { loggedOut: true }; }
        throw { message: (j && j.message) || ("HTTP " + r.status) };
      });
    });
  }

  function handleError(e) {
    if (e && e.loggedOut) {
      state.me = null;
      flash("Deine Anmeldung ist abgelaufen – bitte melde dich neu an.", "error");
      render();
      return;
    }
    console.error("Herden-Karten:", e);
    flash("Verbindung zum Kartenspiel fehlgeschlagen. Bitte versuch es gleich noch einmal.", "error");
  }

  // ── Laden ──────────────────────────────────────────────────────────────────
  function loadMe() {
    if (!state.session) return Promise.resolve();
    return Promise.all([rpc("cards_web_me", {}, true), rpc("cards_web_album", {}, true)]).then(function (r) {
      state.me = r[0];
      state.myAlbum = r[1] && r[1].ok ? r[1] : null;
      if (state.oddsStage == null && state.me && state.me.stage) state.oddsStage = state.me.stage;
      markNew();
    });
  }

  // „Neu seit letztem Besuch“: der Browser merkt sich, welche Karten (normal / Shiny)
  // man zuletzt hatte. Die Markierung bleibt für diesen Besuch stehen.
  function ownedKeys(album) {
    var keys = {};
    album.cards.forEach(function (c) {
      if (c.qty > 0) keys[c.id] = 1;
      if (c.shiny_qty > 0) keys[c.id + "*"] = 1;
    });
    return keys;
  }
  function markNew() {
    if (!state.myAlbum || !state.me) return;
    var storeKey = "cards_seen_v1:" + state.me.login, now = ownedKeys(state.myAlbum), before = null;
    if (state.seenKeys) before = state.seenKeys;
    else { try { before = JSON.parse(store(storeKey) || "null"); } catch (e) { before = null; } }
    state.newIds = state.newIds || {};
    // Beim allerersten Besuch ist nichts „neu“ – sonst wäre alles markiert
    if (before) Object.keys(now).forEach(function (k) { if (!before[k]) state.newIds[k.replace("*", "")] = 1; });
    state.seenKeys = now;
    store(storeKey, JSON.stringify(now));
  }

  function reloadMe() {
    return loadMe().then(render).catch(handleError);
  }

  // ── Bausteine ──────────────────────────────────────────────────────────────
  function cardTile(c, opts) {
    opts = opts || {};
    var owned = (c.qty || 0) + (c.shiny_qty || 0) > 0 || opts.reveal;
    var shiny = opts.reveal ? !!c.shiny : !!c.show_shiny;
    var img = owned && safeImg(c.image);
    var cls = "kc r-" + c.rarity + (owned ? "" : " missing") + (shiny ? " shiny" : "") + (opts.isNew ? " is-new" : "");
    var count = opts.reveal ? "" : (c.qty > 1 ? '<span class="kc-qty" title="Anzahl normal">×' + c.qty + "</span>" : "");
    var star = !opts.reveal && c.shiny_qty
      ? '<span class="kc-star" title="Shiny ×' + c.shiny_qty + '">★' + (c.shiny_qty > 1 ? c.shiny_qty : "") + "</span>" : "";
    var tag = opts.button ? "button" : "div";
    return "<" + tag + ' class="' + cls + '"'
      + (opts.button ? ' type="button" data-card="' + esc(c.id) + '" data-album="' + (opts.album || "mine") + '"' : "")
      + ' aria-label="' + esc("#" + pad(c.number) + " " + (owned ? c.name : "unbekannt") + ", " + RARITY_NAMES[c.rarity] + (shiny ? ", Shiny" : "")) + '">'
      + '<span class="kc-no">#' + pad(c.number) + "</span>"
      + '<span class="kc-art">' + (img ? '<img src="' + esc(img) + '" alt="" loading="lazy">'
        : '<svg aria-hidden="true"><use href="#sym-gazelle"/></svg>') + "</span>"
      + '<span class="kc-name">' + (owned ? esc(c.name) : "???") + "</span>"
      + '<span class="kc-rar">' + RARITY_NAMES[c.rarity] + (shiny ? " ✨" : "") + "</span>"
      + count + star + (opts.isNew ? '<span class="kc-new">NEU</span>' : "")
      + "</" + tag + ">";
  }

  function stats(album) {
    var have = 0, shinies = 0, dupes = 0;
    album.cards.forEach(function (c) {
      if (c.qty + c.shiny_qty > 0) have++;
      if (c.shiny_qty > 0) shinies++;
      if (c.qty > 1) dupes++;
    });
    return { have: have, shinies: shinies, dupes: dupes, total: album.cards.length };
  }

  function filterChips(own) {
    var newCount = own && state.newIds ? Object.keys(state.newIds).length : 0;
    var opts = [["all", "Alle"]].concat(newCount ? [["new", "✨ Neu (" + newCount + ")"]] : [])
      .concat(RARITY_ORDER.map(function (r) { return [r, RARITY_NAMES[r]]; }))
      .concat([["missing", "Fehlend"], ["dupes", "Doppelt"], ["shiny", "Shiny"]]);
    return '<div class="kt-chips" role="group" aria-label="Filter">' + opts.map(function (o) {
      return '<button type="button" class="kt-chip' + (o[0].length === 1 ? " r-" + o[0] : "")
        + (state.filter === o[0] ? " on" : "") + '" data-filter="' + o[0] + '">' + o[1] + "</button>";
    }).join("") + "</div>";
  }

  function filtered(cards, own) {
    var f = state.filter;
    if (f === "new" && !own) f = "all";
    return cards.filter(function (c) {
      if (f === "all") return true;
      if (f === "new") return !!(state.newIds && state.newIds[c.id]);
      if (f === "missing") return c.qty + c.shiny_qty === 0;
      if (f === "dupes") return c.qty > 1;
      if (f === "shiny") return c.shiny_qty > 0;
      return c.rarity === f;
    });
  }

  function albumGrid(album, own) {
    var s = stats(album);
    var list = filtered(album.cards, own);
    var isNew = function (c) { return own && state.newIds && state.newIds[c.id]; };
    return '<div class="kt-album-head">'
      + '<div class="kt-progress"><b>' + s.have + "</b> / " + s.total + " Karten"
      + '<span class="kt-bar"><span style="width:' + (100 * s.have / s.total).toFixed(1) + '%"></span></span></div>'
      + '<span class="kt-pill">★ ' + s.shinies + " Shinys</span>"
      + '<span class="kt-pill">⇄ ' + s.dupes + " doppelt</span>"
      + "</div>" + filterChips(own)
      + (list.length
        ? '<div class="kt-grid">' + list.map(function (c) {
          // Alle besessenen Karten lassen sich groß ansehen – im eigenen und in fremden Alben
          return cardTile(c, { button: c.qty + c.shiny_qty > 0, album: own ? "mine" : "other", isNew: isNew(c) });
        }).join("") + "</div>"
        : '<p class="empty">Keine Karten für diesen Filter.</p>');
  }

  // ── Kopf & Konto ───────────────────────────────────────────────────────────
  function renderHead() {
    var box = $("kt-head");
    var info = state.info;
    if (!info) { box.innerHTML = ""; return; }
    var launch = new Date(info.launch_at);
    var before = Date.now() < launch.getTime();
    var parts = [];
    if (before) {
      var ms = launch.getTime() - Date.now();
      var d = Math.floor(ms / 864e5), h = Math.floor(ms / 36e5) % 24;
      parts.push('<div class="kt-countdown"><span class="kt-cd-label">Start am 1. Januar 2027</span>'
        + '<span class="kt-cd-value">noch ' + d + " Tage, " + h + " Std.</span></div>");
    }
    parts.push('<p class="kt-intro">' + info.total + " Karten in 6 Seltenheiten – jede gibt es auch als seltenes <b>Shiny</b>. "
      + "Packs gibt es zum Start (3 Starter-Packs), jede Woche gratis"
      + (info.watch_pack_minutes ? ", automatisch alle " + fmtNum(info.watch_pack_minutes / 60) + " Stunden Zuschauzeit" : "")
      + " und für Kanalpunkte. "
      + "Je größer deine <a href=\"#herd\">Gazelle</a>, desto besser deine Chancen auf seltene Karten."
      + (info.collectors ? " Schon <b>" + fmtNum(info.collectors) + "</b> Sammler dabei." : "") + "</p>");
    box.innerHTML = parts.join("");
  }

  function renderAccount() {
    var box = $("kt-account");
    if (!state.session) {
      box.innerHTML = '<div class="kt-login"><div><b>Dein Album</b><br>'
        + "Melde dich mit Twitch an, um Packs zu öffnen, dein Album zu sehen und zu tauschen. "
        + "Es ist dasselbe Konto wie beim Sammelspiel.</div>"
        + '<button class="btn btn-primary kt-twitch" type="button" id="kt-login">Mit Twitch anmelden</button></div>';
      $("kt-login").onclick = login;
      return;
    }
    var m = state.me;
    if (!m) { box.innerHTML = '<p class="empty">Lade dein Konto …</p>'; return; }
    var next = m.next_stage_minutes != null
      ? "nächste Stufe in " + hours(m.next_stage_minutes - m.minutes) + " h" : "höchste Stufe erreicht";
    var packs = m.packs || [];
    var weekOk = m.week_minutes >= m.weekly_min_minutes;
    var btns = [];
    if (packs.length) {
      btns.push('<button class="btn btn-primary" type="button" data-act="open">🎴 Pack öffnen (' + packs.length + ")</button>");
    }
    if (!m.starter_claimed) btns.push('<button class="btn btn-primary" type="button" data-act="starter">🎁 3 Starter-Packs abholen</button>');
    btns.push('<button class="btn btn-ghost" type="button" data-act="weekly"' + (m.weekly_claimed ? " disabled" : "") + ">"
      + (m.weekly_claimed ? "✓ Gratis-Pack diese Woche abgeholt" : "📦 Gratis-Pack abholen") + "</button>");

    box.innerHTML = '<div class="kt-me">'
      + '<div class="kt-me-name"><b>' + esc(m.name) + "</b>"
      + '<span class="kt-stage">Stufe ' + m.stage + " · " + esc(m.stage_name) + " · Bonus ×" + String(m.multiplier).replace(".", ",") + "</span></div>"
      + '<div class="kt-me-stats">'
      + "<span><b>" + hours(m.minutes) + " h</b> Zuschauzeit seit Start · " + next + "</span>"
      + "<span>Diese Woche: <b>" + m.week_minutes + " / " + m.weekly_min_minutes + " min</b>" + (weekOk ? " ✓" : "") + "</span>"
      + (m.next_watch_pack ? "<span>Nächstes Zuschau-Pack in <b>" + m.next_watch_pack + " min</b></span>" : "")
      + "<span><b>" + m.collected + " / " + m.total + "</b> Karten · <b>" + m.shinies + "</b> Shinys</span></div>"
      + (m.open ? '<div class="kt-actions">' + btns.join("") + "</div>"
        : '<p class="kt-note">🔒 Das Spiel startet am 1. Januar 2027. Deine Zuschauzeit für den Gazellen-Bonus zählt ab dann.</p>')
      + '<div class="kt-me-foot">'
      + '<button class="kt-link" type="button" data-act="hide">' + (m.hidden ? "🙈 Album ist versteckt – sichtbar machen" : "👁 Album ist öffentlich – verstecken") + "</button>"
      + '<button class="kt-link" type="button" data-act="logout">Abmelden</button>'
      + "</div>"
      + '<p class="kt-hint">Subs bekommen jede Woche ein 2. Gratis-Pack – das gibt es mit <code>!freepack</code> im Chat.</p>'
      + "</div>";
  }

  function renderNav() {
    var incoming = state.me && state.me.incoming_trades;
    var tabs = [["album", "📖 Mein Album"], ["browse", "🔎 Alben ansehen"],
      ["trade", "⇄ Tauschen" + (incoming ? ' <span class="kt-badge">' + incoming + "</span>" : "")],
      ["ranks", "🏆 Ranglisten"], ["odds", "🎲 Chancen"]];
    $("kt-nav").innerHTML = tabs.map(function (t) {
      return '<button type="button" class="kt-tab' + (state.view === t[0] ? " on" : "") + '" data-view="' + t[0] + '">' + t[1] + "</button>";
    }).join("");
  }

  // ── Ansichten ──────────────────────────────────────────────────────────────
  function renderView() {
    var box = $("kt-view");
    var v = state.view;
    if (v === "album") {
      if (!state.session) { box.innerHTML = '<p class="empty">Melde dich an, um dein Album zu sehen.</p>'; return; }
      if (!state.myAlbum) { box.innerHTML = '<p class="empty">Lade dein Album …</p>'; return; }
      box.innerHTML = '<div class="kt-album-actions"><button class="btn btn-ghost" type="button" data-act="share">📤 Album teilen</button></div>'
        + albumGrid(state.myAlbum, true)
        + '<p class="kt-hint">Tippe auf eine Karte für die Großansicht. Hast du sie auch als Shiny, wählst du dort, welche Version im Album gezeigt wird.</p>';
      return;
    }
    if (v === "browse") return renderBrowse(box);
    if (v === "trade") return renderTrade(box);
    if (v === "ranks") return renderRanks(box);
    if (v === "odds") return renderOdds(box);
  }

  function renderBrowse(box) {
    var o = state.other;
    box.innerHTML = '<form class="kt-search" id="kt-search-form">'
      + '<input id="kt-search" type="search" list="kt-names" placeholder="Twitch-Name eingeben" autocomplete="off" value="'
      + esc(o && o.login ? o.login : "") + '">'
      + '<datalist id="kt-names"></datalist>'
      + '<button class="btn btn-primary" type="submit">Album ansehen</button></form>'
      + '<div id="kt-other">' + (o ? (o.ok ? '<h3 class="kt-other-title">Album von ' + esc(o.name) + "</h3>" + albumGrid(o, false)
        + (state.session && state.me && o.login !== state.me.login
          ? '<p><button class="btn btn-ghost" type="button" data-trade-with="' + esc(o.login) + '">⇄ Mit ' + esc(o.name) + " tauschen</button></p>" : "")
        : '<p class="empty">' + esc(reasonText(o)) + "</p>") : "") + "</div>";
    bindNameSearch($("kt-search"), $("kt-names"));
    $("kt-search-form").onsubmit = function (e) {
      e.preventDefault();
      var name = $("kt-search").value.trim().replace(/^@/, "");
      if (name) window.location.hash = "#karten/@" + encodeURIComponent(name.toLowerCase());
    };
  }

  function loadOther(login) {
    var p = state.session ? rpc("cards_web_album", { p_login: login }, true)
      : rpc("cards_album_public", { p_login: login });
    return p.then(function (a) {
      state.other = a && a.ok ? a : { ok: false, reason: a && a.reason, login: login };
      if (!state.other.login) state.other.login = login;
    });
  }

  function bindNameSearch(input, list) {
    var t = null;
    input.addEventListener("input", function () {
      clearTimeout(t);
      var q = input.value.trim().replace(/^@/, "");
      if (q.length < 2) return;
      t = setTimeout(function () {
        rpc("cards_search_users", { p_query: q }).then(function (rows) {
          list.innerHTML = (rows || []).map(function (r) { return '<option value="' + esc(r.login) + '">' + esc(r.name) + "</option>"; }).join("");
        }).catch(function () {});
      }, 250);
    });
  }

  function tradeRow(t) {
    var pending = t.status === "pending";
    var statusText = { accepted: "✓ getauscht", declined: "abgelehnt", cancelled: "zurückgezogen", expired: "abgelaufen" }[t.status] || "";
    var give = t.incoming ? t.want : t.offer, get = t.incoming ? t.offer : t.want;
    var left = pending ? Math.max(0, new Date(t.expires_at).getTime() - Date.now()) : 0;
    var leftText = left > 36e5 ? "noch " + Math.ceil(left / 36e5) + " Std." : "noch " + Math.ceil(left / 6e4) + " Min.";
    return '<li class="kt-trade' + (pending ? " pending" : "") + '">'
      + '<div class="kt-trade-who">' + (t.incoming ? "von " : "an ") + '<a href="#karten/@' + esc(t.partner_login) + '">' + esc(t.partner) + "</a>"
      + (t.source === "chat" ? ' <span class="kt-pill">Chat</span>' : "") + "</div>"
      + '<div class="kt-trade-cards">'
      + '<span class="kt-mini r-' + give.rarity + '">Du gibst #' + pad(give.number) + " " + esc(give.name) + "</span>"
      + '<span aria-hidden="true">⇄</span>'
      + '<span class="kt-mini r-' + get.rarity + '">Du bekommst #' + pad(get.number) + " " + esc(get.name) + "</span></div>"
      + '<div class="kt-trade-act">' + (pending
        ? (t.incoming
          ? '<button class="btn btn-primary" type="button" data-trade-accept="' + t.id + '">Annehmen</button>'
            + '<button class="btn btn-ghost" type="button" data-trade-decline="' + t.id + '">Ablehnen</button>'
          : '<button class="btn btn-ghost" type="button" data-trade-cancel="' + t.id + '">Zurückziehen</button>')
          + '<span class="kt-left">' + leftText + "</span>"
        : '<span class="kt-left">' + statusText + "</span>") + "</div></li>";
  }

  function renderTrade(box) {
    if (!state.session) { box.innerHTML = '<p class="empty">Melde dich an, um zu tauschen.</p>'; return; }
    if (!state.trades || !state.myAlbum || !state.me) { box.innerHTML = '<p class="empty">Lade Tauschangebote …</p>'; return; }
    var m = state.me;
    var mine = state.myAlbum.cards.filter(function (c) { return c.qty > 1; });
    var partner = state.tradePartner && state.tradePartner.ok ? state.tradePartner : null;
    var giveSel = $("kt-give") ? $("kt-give").value : "";
    var giveCard = mine.filter(function (c) { return c.id === giveSel; })[0];
    var theirs = partner ? partner.cards.filter(function (c) {
      return c.qty > 1 && (!giveCard || c.rarity === giveCard.rarity);
    }) : [];
    function opt(c, mark) {
      return '<option value="' + c.id + '">#' + pad(c.number) + " " + esc(c.name) + " · " + RARITY_NAMES[c.rarity]
        + " (×" + c.qty + ")" + (mark ? " – fehlt dir" : "") + "</option>";
    }
    var myHave = {};
    state.myAlbum.cards.forEach(function (c) { if (c.qty + c.shiny_qty > 0) myHave[c.id] = true; });

    var incoming = state.trades.filter(function (t) { return t.incoming && t.status === "pending"; });
    var outgoing = state.trades.filter(function (t) { return !t.incoming && t.status === "pending"; });
    var done = state.trades.filter(function (t) { return t.status !== "pending"; });

    box.innerHTML = '<p class="kt-hint">Getauscht wird nur <b>doppelt</b> vorhandene Karten der <b>gleichen Seltenheit</b>, Shinys nicht. '
      + "Heute: <b>" + m.trades_today + " / " + m.trades_per_day + "</b> Tausche. Angebote über die Webseite gelten 48 Stunden.</p>"
      + suggestionsHtml()
      + '<div class="kt-trade-new card-inner"><h3>Neues Angebot</h3>'
      + '<label>Tauschpartner<input id="kt-partner" type="search" list="kt-partner-names" placeholder="Twitch-Name" autocomplete="off" value="'
      + esc(state.tradePartner ? state.tradePartner.login : "") + '"></label><datalist id="kt-partner-names"></datalist>'
      + (state.tradePartner && !state.tradePartner.ok ? '<p class="kt-note">' + esc(reasonText(state.tradePartner)) + "</p>" : "")
      + '<label>Ich gebe<select id="kt-give"><option value="">– eine deiner doppelten Karten –</option>' + mine.map(function (c) { return opt(c); }).join("") + "</select></label>"
      + '<label>Ich möchte<select id="kt-want"' + (partner ? "" : " disabled") + '><option value="">'
      + (partner ? (theirs.length ? "– eine doppelte Karte von " + esc(partner.name) + " –" : "– keine passende doppelte Karte –") : "– erst Tauschpartner wählen –")
      + "</option>" + theirs.map(function (c) { return opt(c, !myHave[c.id]); }).join("") + "</select></label>"
      + '<button class="btn btn-primary" type="button" id="kt-offer"' + (mine.length ? "" : " disabled") + ">Angebot schicken</button>"
      + (mine.length ? "" : '<p class="kt-note">Du hast noch keine doppelten Karten.</p>')
      + "</div>"
      + "<h3>Angebote an dich</h3>" + (incoming.length ? '<ul class="kt-trades">' + incoming.map(tradeRow).join("") + "</ul>" : '<p class="empty">Keine offenen Angebote.</p>')
      + "<h3>Deine offenen Angebote</h3>" + (outgoing.length ? '<ul class="kt-trades">' + outgoing.map(tradeRow).join("") + "</ul>" : '<p class="empty">Keine.</p>')
      + (done.length ? "<h3>Letzte 7 Tage</h3><ul class=\"kt-trades\">" + done.map(tradeRow).join("") + "</ul>" : "");

    if (giveSel) $("kt-give").value = giveSel;
    bindNameSearch($("kt-partner"), $("kt-partner-names"));
    $("kt-partner").onchange = function () {
      var name = this.value.trim().replace(/^@/, "").toLowerCase();
      if (!name) { state.tradePartner = null; renderView(); return; }
      rpc("cards_web_album", { p_login: name }, true).then(function (a) {
        state.tradePartner = a && a.ok ? a : { ok: false, reason: a && a.reason, login: name };
        state.tradePartner.login = state.tradePartner.login || name;
        renderView();
      }).catch(handleError);
    };
    $("kt-give").onchange = function () { renderView(); };
    $("kt-offer").onclick = function () {
      var give = $("kt-give").value, want = $("kt-want").value;
      if (!partner) return flash("Wähle zuerst einen Tauschpartner.", "error");
      if (!give || !want) return flash("Wähle beide Karten aus.", "error");
      busy(this, rpc("cards_web_trade_offer", { p_to_login: partner.login, p_offer: give, p_want: want }, true).then(function (r) {
        if (!r.ok) return flash(reasonText(r), "error");
        flash("Angebot an " + r.to + " geschickt. 🦌", "ok");
        return loadTrades();
      }));
    };
  }

  function loadTrades() {
    return Promise.all([rpc("cards_web_trades", {}, true), rpc("cards_web_trade_suggestions", {}, true), loadMe()]).then(function (r) {
      state.trades = r[0] || [];
      state.suggest = r[1] || [];
      render();
    }).catch(handleError);
  }

  // 💡 Vorschläge: wer hat doppelt, was mir fehlt – und braucht, was ich doppelt habe
  function suggestionsHtml() {
    var list = state.suggest || [];
    if (!list.length) {
      return '<div class="kt-suggest card-inner"><h3>💡 Tauschvorschläge</h3><p class="empty">Gerade keine passenden Tausche. '
        + "Sobald jemand doppelt hat, was dir fehlt (und umgekehrt), erscheint das hier.</p></div>";
    }
    return '<div class="kt-suggest card-inner"><h3>💡 Tauschvorschläge</h3>'
      + '<p class="kt-hint">Beide bekommen eine Karte, die ihnen noch fehlt.</p><ul class="kt-trades">'
      + list.map(function (p) {
        return '<li class="kt-trade"><div class="kt-trade-who"><a href="#karten/@' + esc(p.login) + '">' + esc(p.partner) + "</a>"
          + (p.count > p.swaps.length ? ' <span class="kt-pill">' + p.count + " Möglichkeiten</span>" : "") + "</div>"
          + p.swaps.map(function (s) {
            return '<div class="kt-trade-cards">'
              + '<span class="kt-mini r-' + s.give.rarity + '">Du gibst #' + pad(s.give.number) + " " + esc(s.give.name) + "</span>"
              + '<span aria-hidden="true">⇄</span>'
              + '<span class="kt-mini r-' + s.get.rarity + '">Du bekommst #' + pad(s.get.number) + " " + esc(s.get.name) + "</span>"
              + '<button class="btn btn-ghost kt-suggest-btn" type="button" data-suggest="' + esc(p.login + "|" + s.give.id + "|" + s.get.id) + '">Angebot schicken</button>'
              + "</div>";
          }).join("") + "</li>";
      }).join("") + "</ul></div>";
  }

  function renderRanks(box) {
    box.innerHTML = '<div class="kt-ranks" id="kt-ranks"><p class="empty">Lade Ranglisten …</p></div>';
    var kinds = [["complete", "📖 Vollständigkeit", " Karten"], ["shiny", "✨ Shinys", " Shinys"], ["mythic", "🔥 Mythics", " Mythics"]];
    Promise.all(kinds.map(function (k) { return rpc("cards_leaderboard", { p_kind: k[0], p_limit: 25 }); })).then(function (lists) {
      if (state.view !== "ranks") return;
      $("kt-ranks").innerHTML = kinds.map(function (k, i) {
        var rows = lists[i] || [];
        return '<div class="kt-rank card-inner"><h3>' + k[1] + "</h3>" + (rows.length
          ? "<ol>" + rows.map(function (r) {
            return '<li><span class="kt-place">' + r.place + '.</span><a href="#karten/@' + esc(r.login) + '">' + esc(r.name) + "</a>"
              + '<b>' + fmtNum(r.value) + "</b></li>";
          }).join("") + "</ol>"
          : '<p class="empty">Noch niemand – sei die erste Gazelle!</p>') + "</div>";
      }).join("");
    }).catch(handleError);
  }

  function renderOdds(box) {
    var stages = state.info ? state.info.stages : [];
    var sel = state.oddsStage || 1;
    box.innerHTML = '<label class="kt-odds-pick">Gazellen-Stufe <select id="kt-odds-stage">'
      + stages.map(function (s) {
        return '<option value="' + s.stage + '"' + (s.stage === sel ? " selected" : "") + ">" + s.stage + " · " + esc(s.name)
          + " (ab " + fmtNum(s.minutes / 60) + " h)" + (state.me && state.me.stage === s.stage ? " – du" : "") + "</option>";
      }).join("") + "</select></label><div id=\"kt-odds\"><p class=\"empty\">Rechne …</p></div>";
    $("kt-odds-stage").onchange = function () { state.oddsStage = Number(this.value); renderView(); };
    Promise.all([rpc("cards_odds", { p_stage: sel, p_min_rank: 1 }), rpc("cards_odds", { p_stage: sel, p_min_rank: 3 })]).then(function (r) {
      if (state.view !== "odds") return;
      var shinyF = state.info ? Number(state.info.shiny_factor) : 0.01;
      var slot5 = {};
      (r[1] || []).forEach(function (o) { slot5[o.code] = Number(o.chance); });
      var legPlus = 0, myth = 0;
      (r[0] || []).forEach(function (o) {
        if (o.code === "L" || o.code === "M") legPlus += Number(o.chance) / 100;
        if (o.code === "M") myth = Number(o.chance) / 100;
      });
      var pLeg = 1 - Math.pow(1 - legPlus, 4) * (1 - ((slot5.L || 0) + (slot5.M || 0)) / 100);
      var pMyth = 1 - Math.pow(1 - myth, 4) * (1 - (slot5.M || 0) / 100);
      $("kt-odds").innerHTML = '<table class="kt-table"><thead><tr><th>Seltenheit</th><th>Karten 1–4</th><th>Karte 5 (Rare+)</th><th>Shiny (Karte 1–4)</th></tr></thead><tbody>'
        + (r[0] || []).map(function (o) {
          return '<tr><td><span class="kt-dot r-' + o.code + '"></span>' + esc(o.name) + "</td><td>" + pct(o.chance) + "</td><td>"
            + (slot5[o.code] != null ? pct(slot5[o.code]) : "–") + "</td><td>" + pct(Number(o.chance) * shinyF, 4) + "</td></tr>";
        }).join("") + "</tbody></table>"
        + '<p class="kt-hint">Pro Pack: <b>' + pct(pLeg * 100, 1) + "</b> Chance auf mindestens ein Legendary oder Mythic, <b>"
        + pct(pMyth * 100, 1) + "</b> auf mindestens ein Mythic. Jede gezogene Karte ist mit 1 % ein Shiny – also 1 % der jeweiligen Chance.</p>";
    }).catch(handleError);
  }

  // ── Pack öffnen ────────────────────────────────────────────────────────────
  // Ablauf: Pack aufreißen → Karten 1–4 einzeln wegwischen → die 5. (seltenere)
  // Karte liegt verdeckt, leuchtet in ihrer Farbe und dreht sich beim langsamen
  // Wischen mit → Übersicht aller 5 Karten. „Überspringen“ geht direkt zur Übersicht.
  var pack = null;   // { res, step: "pack" | "cards" | "summary", idx, flip, revealed }
  var REDUCED = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Klänge & Vibration aus karten-sound.js (fehlt die Datei, bleibt es still)
  var SND = window.CardsSound || { play: function () {}, buzz: function () {}, enabled: function () { return false; }, setEnabled: function () {} };

  function revealSound(c) {
    var r = RARITY_ORDER.indexOf(c.rarity);
    SND.play(r >= 5 ? "mythic" : r === 4 ? "legendary" : r === 3 ? "epic" : r === 2 ? "rare" : "common");
    if (c.shiny) setTimeout(function () { SND.play("shiny"); }, 120);
    if (r >= 4 || c.shiny) SND.buzz([60, 40, 140]);
    else if (r === 3) SND.buzz(45);
  }

  // Kartenrücken: die Universumsgazelle (ausgewachsene Herden-Gazelle, config.js → herd)
  function backArt() {
    var look = U.lookFor && CFG.herd ? U.lookFor(CFG.herd.maxHours || 1000) : null;
    var src = look && safeImg(look.img);
    return src ? '<img class="kt-back-img" src="' + esc(src) + '" alt="" draggable="false">'
      : '<svg aria-hidden="true"><use href="#sym-gazelle"/></svg>';
  }

  function showPack(res) {
    pack = { res: res, step: REDUCED ? "summary" : "pack", idx: 0, flip: 0, revealed: false };
    $("kt-pack").hidden = false;
    drawPack();
  }

  function bestOf(cards) {
    return cards.reduce(function (b, c) { return Math.max(b, RARITY_ORDER.indexOf(c.rarity) + (c.shiny ? 10 : 0)); }, 0);
  }
  function wowText(best) {
    // best = Index in RARITY_ORDER (E = 3, L = 4, M = 5), +10 bei Shiny
    return best >= 10 ? "✨ SHINY! ✨" : best >= 4 ? "🔥 Was für ein Zug!" : best >= 3 ? "💜 Episch!" : "";
  }

  function drawPack() {
    var res = pack.res, cards = res.cards || [];
    var title = esc(SOURCE_NAMES[res.source] || "Pack");
    var body, hint = "", foot = "";
    if (pack.step === "pack") {
      body = '<div class="kt-foil" id="kt-foil" role="button" tabindex="0" aria-label="Pack aufreißen">'
        + '<span class="kt-foil-top"></span><span class="kt-foil-body">' + backArt()
        + "<b>Herden-Karten</b><small>5 Karten · Serie 1</small></span></div>";
      hint = "Tippen oder wischen, um das Pack aufzureißen";
      foot = '<button class="btn btn-ghost" type="button" data-act="pack-skip">Überspringen</button>';
    } else if (pack.step === "cards") {
      var i = pack.idx, c = cards[i], last = i === cards.length - 1;
      var under = "";
      for (var k = Math.min(cards.length - 1 - i, 3); k >= 1; k--) {
        under += '<div class="kt-stack-card" style="--k:' + k + '"><div class="kt-back">' + backArt() + "</div></div>";
      }
      // Jede Karte liegt verdeckt oben; die 5. leuchtet schon in ihrer Seltenheit
      var big = RARITY_ORDER.indexOf(c.rarity) >= 3 || c.shiny;
      var top = '<div class="kt-top' + (last ? " kt-top-last" : "") + (big ? " big" : "") + " r-" + c.rarity + (c.shiny ? " is-shiny" : "")
          + '" id="kt-top" tabindex="0" aria-label="Verdeckte Karte ' + (i + 1) + " von " + cards.length + ' – antippen zum Umdrehen">'
          + '<div class="kt-face kt-back' + (last ? " glow" : "") + '">' + backArt() + "</div>"
          + '<div class="kt-face kt-front">' + cardTile(c, { reveal: true, isNew: c["new"] }) + "</div></div>";
      body = '<div class="kt-stage">' + under + top + "</div>"
        + '<div class="kt-dots" aria-hidden="true">' + cards.map(function (x, n) {
          return "<span" + (n < i ? ' class="done"' : n === i ? ' class="on"' : "") + "></span>";
        }).join("") + "</div>";
      hint = last ? "Die letzte Karte – antippen oder <b>langsam</b> zur Seite wischen …"
        : "Antippen zum Umdrehen (" + (i + 1) + "/" + cards.length + ")";
      foot = '<button class="btn btn-ghost" type="button" data-act="pack-skip">Überspringen</button>';
    } else {
      var best = bestOf(cards);
      body = '<div class="kt-pack-row">' + cards.map(function (x, n) {
        return '<div class="kt-sum" style="--i:' + n + '">' + cardTile(x, { reveal: true, isNew: x["new"] }) + "</div>";
      }).join("") + "</div>" + (wowText(best) ? '<p class="kt-pack-wow">' + wowText(best) + "</p>" : "");
      foot = (state.me && state.me.packs && state.me.packs.length
        ? '<button class="btn btn-primary" type="button" data-act="open-next">Nächstes Pack öffnen (' + state.me.packs.length + ")</button>" : "")
        + '<button class="btn btn-ghost" type="button" data-act="pack-close">Schließen</button>';
    }
    var snd = SND.enabled();
    $("kt-pack").innerHTML = '<div class="kt-pack-box kt-open-box" role="dialog" aria-modal="true" aria-label="' + title + ' öffnen">'
      + '<button class="kt-snd" type="button" data-act="sound" aria-pressed="' + snd + '" title="Klänge an/aus">' + (snd ? "🔊" : "🔇") + "</button>"
      + "<h2>" + title + "</h2>" + body
      + '<p class="kt-step-hint" id="kt-step-hint">' + hint + "</p>"
      + '<div class="kt-pack-btns">' + foot + "</div></div>";

    if (pack.step === "pack") bindFoil($("kt-foil"));
    else if (pack.step === "cards") {
      bindTop($("kt-top"), pack.idx === cards.length - 1);
      if (pack.idx === cards.length - 1) SND.play("tension");
    }
    var focus = $("kt-foil") || $("kt-top") || $("kt-pack").querySelector("[data-act]");
    if (focus) focus.focus({ preventScroll: true });
  }

  // Ziehen mit Maus, Finger oder Stift; tap = kaum bewegt
  function bindDrag(el, onMove, onEnd) {
    var x0 = null, dx = 0;
    el.addEventListener("pointerdown", function (e) {
      x0 = e.clientX; dx = 0;
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* egal */ }
      el.classList.add("dragging");
    });
    el.addEventListener("pointermove", function (e) {
      if (x0 === null) return;
      dx = e.clientX - x0;
      onMove(dx);
    });
    function end() {
      if (x0 === null) return;
      x0 = null;
      el.classList.remove("dragging");
      onEnd(dx);
    }
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }

  function bindFoil(foil) {
    var done = false;
    function tear() {
      if (done) return;
      done = true;
      foil.classList.add("torn");
      SND.play("tear");
      SND.buzz(25);
      setTimeout(function () { pack.step = "cards"; drawPack(); }, 850);
    }
    bindDrag(foil, function (dx) {
      if (!done) foil.style.setProperty("--pull", Math.min(1, Math.abs(dx) / 120));
      if (Math.abs(dx) > 120) tear();
    }, function () { tear(); });
    foil.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tear(); } });
  }

  function nextCard(el, dir) {
    SND.play("swipe");
    el.style.transition = "transform .38s ease-in, opacity .38s ease-in";
    el.style.transform = "translateX(" + (dir * Math.max(window.innerWidth, 600)) + "px) rotate(" + (dir * 28) + "deg)";
    el.style.opacity = "0";
    setTimeout(function () { pack.idx++; pack.flip = 0; pack.revealed = false; drawPack(); }, 330);
  }

  // Umdrehen: Drehwinkel folgt dem Finger, Rück-/Vorderseite tauschen bei 50 %
  function setFlip(el, p, dx) {
    var back = el.querySelector(".kt-back"), front = el.querySelector(".kt-front");
    back.style.transform = "rotateY(" + (p * 180) + "deg)";
    front.style.transform = "rotateY(" + (p * 180 - 180) + "deg)";
    back.style.opacity = p < 0.5 ? "1" : "0";
    front.style.opacity = p < 0.5 ? "0" : "1";
    el.style.transform = "translateX(" + (dx || 0) * 0.3 + "px) rotate(" + (dx || 0) / 40 + "deg)";
    pack.flip = p;
  }

  function animateFlip(el, to, ms, done) {
    var from = pack.flip, t0 = null;
    function step(t) {
      if (t0 === null) t0 = t;
      // sanft rein und raus: der Moment des Umdrehens (90°) liegt in der Mitte der Zeit
      var k = Math.min(1, (t - t0) / ms), e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      setFlip(el, from + (to - from) * e, 0);
      if (k < 1) requestAnimationFrame(step); else if (done) done();
    }
    requestAnimationFrame(step);
  }

  function reveal(el, last) {
    pack.revealed = true;
    el.classList.add("revealed");
    el.setAttribute("aria-label", el.querySelector(".kt-front .kc").getAttribute("aria-label"));
    var c = pack.res.cards[pack.idx];
    var wow = wowText(RARITY_ORDER.indexOf(c.rarity) + (c.shiny ? 10 : 0));
    $("kt-step-hint").innerHTML = (wow ? "<b>" + wow + "</b> · " : "")
      + (last ? "Tippen für die Übersicht" : "Tippen oder wischen für die nächste Karte");
  }

  // Jede Karte: 1. Antippen dreht sie um (die 5. langsam), danach wischen/tippen = weiter.
  // Umdrehen geht auch per Wischen – bei der 5. Karte mit langem, langsamem Weg.
  function bindTop(el, last) {
    var busyFlip = false;
    var tapMs = last ? 1800 : 550, swipeMs = last ? 1100 : 300;
    var dist = last ? Math.min(320, window.innerWidth * 0.6) : 150;
    function finish(ms) {
      busyFlip = true;
      // „Fwip“ genau, wenn die Karte kippt (Mitte der Animation)
      setTimeout(function () { SND.play("flip"); }, Math.max(0, ms / 2 - 80));
      animateFlip(el, 1, ms, function () {
        busyFlip = false;
        reveal(el, last);
        revealSound(pack.res.cards[pack.idx]);
      });
    }
    function advance(dir) {
      if (last) { pack.step = "summary"; drawPack(); } else nextCard(el, dir);
    }
    setFlip(el, 0, 0);
    bindDrag(el, function (dx) {
      if (busyFlip) return;
      if (pack.revealed) {
        if (last) return;
        el.style.transition = "none";
        el.style.transform = "translateX(" + dx + "px) rotate(" + dx / 18 + "deg)";
        return;
      }
      setFlip(el, Math.min(1, Math.abs(dx) / dist), dx);
    }, function (dx) {
      if (busyFlip) return;
      if (pack.revealed) {
        if (last || Math.abs(dx) > 70 || Math.abs(dx) < 6) return advance(dx > 0 ? 1 : -1);
        el.style.transition = "transform .25s";
        el.style.transform = "";
        return;
      }
      if (Math.abs(dx) < 6) return finish(tapMs);
      if (pack.flip > 0.45) return finish(swipeMs);
      busyFlip = true;
      animateFlip(el, 0, 300, function () { busyFlip = false; });
    });
    el.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " " && e.key !== "ArrowRight") return;
      e.preventDefault();
      if (busyFlip) return;
      if (pack.revealed) advance(-1); else finish(tapMs);
    });
  }

  function openPack(btn) {
    var packs = state.me && state.me.packs;
    if (!packs || !packs.length) return flash(REASONS.keine_packs, "error");
    busy(btn, rpc("cards_web_open", { p_pack_id: packs[0].id }, true).then(function (r) {
      if (!r.ok) return flash(reasonText(r), "error");
      showPack(r);
      return loadMe().then(function () { renderAccount(); renderNav(); if (state.view === "album") renderView(); });
    }));
  }

  // ── Karte antippen: Großansicht (neigt sich mit Maus/Handy, Lichtreflex) ───
  // Im eigenen Album zusätzlich: Normal/Shiny für die Anzeige wählen
  var tiltOff = null;

  function bindTilt(wrap) {
    var inner = wrap.querySelector(".kt-tilt-in");
    function set(px, py) {   // px/py 0…1, Mitte = 0.5
      inner.style.transform = "rotateX(" + ((0.5 - py) * 18).toFixed(2) + "deg) rotateY(" + ((px - 0.5) * 22).toFixed(2) + "deg)";
      inner.style.setProperty("--gx", (px * 100).toFixed(1) + "%");
      inner.style.setProperty("--gy", (py * 100).toFixed(1) + "%");
    }
    function move(e) {
      var r = wrap.getBoundingClientRect();
      set(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)));
    }
    function leave() { inner.style.transform = ""; inner.style.setProperty("--gx", "50%"); inner.style.setProperty("--gy", "30%"); }
    // Handy: Neigung (wo der Browser sie ohne Nachfrage liefert, z. B. Android)
    function orient(e) {
      if (e.beta == null || e.gamma == null) return;
      set(Math.min(1, Math.max(0, 0.5 + e.gamma / 50)), Math.min(1, Math.max(0, 0.5 + (e.beta - 40) / 50)));
    }
    wrap.addEventListener("pointermove", move);
    wrap.addEventListener("pointerleave", leave);
    if (!REDUCED) window.addEventListener("deviceorientation", orient);
    leave();
    return function () { window.removeEventListener("deviceorientation", orient); };
  }

  function closeCard() {
    $("kt-card-modal").hidden = true;
    if (tiltOff) { tiltOff(); tiltOff = null; }
  }

  function showCard(id, which) {
    var mine = which !== "other";
    var album = mine ? state.myAlbum : state.other;
    var c = album && album.cards && album.cards.filter(function (x) { return x.id === id; })[0];
    if (!c || c.qty + c.shiny_qty === 0) return;
    var box = $("kt-card-modal");
    var both = mine && c.qty > 0 && c.shiny_qty > 0;
    box.innerHTML = '<div class="kt-pack-box kt-card-box" role="dialog" aria-modal="true" aria-label="Karte">'
      + '<div class="kt-tilt' + (c.show_shiny ? " is-shiny" : "") + '"><div class="kt-tilt-in">' + cardTile(c)
      + '<span class="kt-glare" aria-hidden="true"></span></div></div>'
      + "<p>" + (mine ? "" : esc(album.name) + " hat · ") + "Normal: <b>×" + c.qty + "</b> · Shiny: <b>×" + c.shiny_qty + "</b>"
      + (mine && c.qty > 1 ? " · tauschbar: " + (c.qty - 1) : "") + "</p>"
      + (both ? '<div class="kt-pack-btns"><button class="btn ' + (c.show_shiny ? "btn-ghost" : "btn-primary") + '" type="button" data-show="normal">Normal zeigen</button>'
        + '<button class="btn ' + (c.show_shiny ? "btn-primary" : "btn-ghost") + '" type="button" data-show="shiny">✨ Shiny zeigen</button></div>' : "")
      + '<div class="kt-pack-btns"><button class="btn btn-ghost" type="button" data-act="card-close">Schließen</button></div></div>';
    box.hidden = false;
    if (tiltOff) tiltOff();
    tiltOff = bindTilt(box.querySelector(".kt-tilt"));
    box.querySelectorAll("[data-show]").forEach(function (b) {
      b.onclick = function () {
        var shiny = b.getAttribute("data-show") === "shiny";
        busy(b, rpc("cards_web_set_display", { p_card: id, p_shiny: shiny }, true).then(function (r) {
          if (!r.ok) return flash(reasonText(r), "error");
          c.show_shiny = shiny;
          closeCard();
          renderView();
        }));
      };
    });
    box.querySelector("[data-act=card-close]").focus();
  }

  // ── Album teilen: Bild 1080×1350 (Instagram-Hochformat) direkt im Browser ──
  function loadImg(src) {
    return new Promise(function (ok) {
      if (!src) return ok(null);
      var im = new Image();
      im.onload = function () { ok(im); };
      im.onerror = function () { ok(null); };
      im.src = src;
    });
  }

  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  function albumImage() {
    var a = state.myAlbum, m = state.me;
    var look = U.lookFor && CFG.herd ? U.lookFor(CFG.herd.maxHours || 1000) : null;
    var fonts = document.fonts && document.fonts.load ? Promise.all([
      document.fonts.load('80px "Lilita One"'), document.fonts.load('700 40px "Nunito"')]).catch(function () {}) : Promise.resolve();
    return Promise.all([loadImg(look && safeImg(look.img)), fonts]).then(function (r) {
      var gaz = r[0], W = 1080, H = 1350, c = document.createElement("canvas");
      c.width = W; c.height = H;
      var g = c.getContext("2d");
      var head = '"Lilita One", system-ui, sans-serif', body = '"Nunito", system-ui, sans-serif';
      // Sternenhimmel
      var bg = g.createRadialGradient(W / 2, H * 0.38, 50, W / 2, H * 0.45, H * 0.8);
      bg.addColorStop(0, "#4a2a7a"); bg.addColorStop(0.55, "#24133f"); bg.addColorStop(1, "#0d0719");
      g.fillStyle = bg; g.fillRect(0, 0, W, H);
      for (var i = 0; i < 160; i++) {
        var sx = (i * 7919) % W, sy = (i * 104729) % H, sr = (i % 7 === 0) ? 2.4 : 1.2;
        g.fillStyle = "rgba(255,255,255," + (0.35 + (i % 5) / 8) + ")";
        g.beginPath(); g.arc(sx, sy, sr, 0, Math.PI * 2); g.fill();
      }
      // Goldrahmen
      g.strokeStyle = "#e7b94c"; g.lineWidth = 10; roundRect(g, 30, 30, W - 60, H - 60, 40); g.stroke();
      g.textAlign = "center"; g.fillStyle = "#ffe39a";
      g.font = "88px " + head; g.fillText("Herden-Karten", W / 2, 150);
      g.fillStyle = "#ffffff"; g.font = "700 46px " + body; g.fillText("Album von " + a.name, W / 2, 220);
      // Gazelle
      if (gaz) {
        var gh = 470, gw = gaz.width / gaz.height * gh;
        g.shadowColor = "rgba(255,220,140,.55)"; g.shadowBlur = 40;
        g.drawImage(gaz, (W - gw) / 2, 255, gw, gh);
        g.shadowBlur = 0;
      }
      // Fortschritt
      var s = stats(a);
      g.fillStyle = "#ffffff"; g.font = "120px " + head;
      g.fillText(s.have + " / " + s.total, W / 2, 860);
      var bx = 140, bw = W - 280, by = 890;
      g.fillStyle = "rgba(255,255,255,.15)"; roundRect(g, bx, by, bw, 34, 17); g.fill();
      var grad = g.createLinearGradient(bx, 0, bx + bw, 0); grad.addColorStop(0, "#b9c25a"); grad.addColorStop(1, "#f4c25a");
      g.fillStyle = grad; roundRect(g, bx, by, Math.max(34, bw * s.have / s.total), 34, 17); g.fill();
      // Seltenheiten
      var colors = { C: "#a99f92", U: "#74c266", R: "#5ea8ef", E: "#b07ee8", L: "#f4c04a", M: "#ff6f88" };
      var per = {};
      RARITY_ORDER.forEach(function (k) { per[k] = [0, 0]; });
      a.cards.forEach(function (x) { per[x.rarity][1]++; if (x.qty + x.shiny_qty > 0) per[x.rarity][0]++; });
      RARITY_ORDER.forEach(function (k, n) {
        var col = n % 3, row = Math.floor(n / 3), x0 = 95 + col * 310, cy = 1010 + row * 92;
        g.fillStyle = colors[k]; g.beginPath(); g.arc(x0 + 12, cy - 11, 12, 0, Math.PI * 2); g.fill();
        g.textAlign = "left"; g.font = "700 31px " + body; g.fillStyle = "#ffffff";
        g.fillText(RARITY_NAMES[k] + " " + per[k][0] + "/" + per[k][1], x0 + 34, cy);
      });
      g.textAlign = "center"; g.fillStyle = "#ffe39a"; g.font = "700 40px " + body;
      g.fillText("★ " + s.shinies + " Shinys  ·  Stufe " + m.stage + " · " + m.stage_name, W / 2, 1225);
      g.fillStyle = "rgba(255,255,255,.75)"; g.font = "700 32px " + body;
      g.fillText(location.host + "/#karten", W / 2, 1285);
      return new Promise(function (ok) { c.toBlob(ok, "image/png"); });
    });
  }

  function shareAlbum(btn) {
    if (!state.myAlbum || !state.me) return;
    busy(btn, albumImage().then(function (blob) {
      if (!blob) return flash("Das Bild konnte nicht erstellt werden.", "error");
      var name = "herden-karten-" + state.me.login + ".png";
      var file = typeof File === "function" ? new File([blob], name, { type: "image/png" }) : null;
      var url = URL.createObjectURL(blob);
      var box = $("kt-card-modal");
      var canShare = file && navigator.canShare && navigator.canShare({ files: [file] });
      box.innerHTML = '<div class="kt-pack-box kt-card-box" role="dialog" aria-modal="true" aria-label="Album teilen">'
        + "<h2>📤 Dein Album</h2>"
        + '<img class="kt-share-img" src="' + url + '" alt="Bild deines Albums">'
        + '<div class="kt-pack-btns">'
        + (canShare ? '<button class="btn btn-primary" type="button" id="kt-share-now">Teilen</button>' : "")
        + '<a class="btn ' + (canShare ? "btn-ghost" : "btn-primary") + '" href="' + url + '" download="' + esc(name) + '">Bild speichern</a>'
        + '<button class="btn btn-ghost" type="button" data-act="card-close">Schließen</button></div></div>';
      box.hidden = false;
      if (canShare) {
        $("kt-share-now").onclick = function () {
          navigator.share({ files: [file], text: "Mein Herden-Karten-Album 🦌 " + location.origin + "/#karten/@" + state.me.login })
            .catch(function () { /* abgebrochen */ });
        };
      }
    }));
  }

  function busy(btn, p) {
    if (btn) btn.disabled = true;
    return p.catch(handleError).then(function () { if (btn && document.body.contains(btn)) btn.disabled = false; });
  }

  // ── Klicks ─────────────────────────────────────────────────────────────────
  function onClick(e) {
    var t = e.target.closest("button, [data-act]");
    if (!t || !$("karten").contains(t)) return;
    var act = t.getAttribute("data-act");
    if (t.hasAttribute("data-view")) {
      state.view = t.getAttribute("data-view");
      if (state.view === "trade" && state.session) { render(); loadTrades(); return; }
      render();
      return;
    }
    if (t.hasAttribute("data-filter")) { state.filter = t.getAttribute("data-filter"); renderView(); return; }
    if (t.hasAttribute("data-card")) { showCard(t.getAttribute("data-card"), t.getAttribute("data-album")); return; }
    if (t.hasAttribute("data-suggest")) {
      var sp = t.getAttribute("data-suggest").split("|");
      busy(t, rpc("cards_web_trade_offer", { p_to_login: sp[0], p_offer: sp[1], p_want: sp[2] }, true).then(function (r) {
        if (!r.ok) return flash(reasonText(r), "error");
        flash("Angebot an " + r.to + " geschickt. 🦌", "ok");
        return loadTrades();
      }));
      return;
    }
    if (t.hasAttribute("data-trade-with")) {
      var login = t.getAttribute("data-trade-with");
      state.view = "trade";
      rpc("cards_web_album", { p_login: login }, true).then(function (a) {
        state.tradePartner = a && a.ok ? a : { ok: false, reason: a && a.reason, login: login };
        return loadTrades();
      }).catch(handleError);
      return;
    }
    ["accept", "decline", "cancel"].forEach(function (k) {
      var id = t.getAttribute("data-trade-" + k);
      if (!id) return;
      var call = k === "cancel" ? rpc("cards_web_trade_cancel", { p_trade_id: Number(id) }, true)
        : rpc("cards_web_trade_respond", { p_trade_id: Number(id), p_accept: k === "accept" }, true);
      busy(t, call.then(function (r) {
        if (!r.ok) flash(reasonText(r), "error");
        else flash(k === "accept" ? "Getauscht! 🦌 Die Karte ist jetzt in deinem Album." : k === "decline" ? "Angebot abgelehnt." : "Angebot zurückgezogen.", "ok");
        return loadTrades();
      }));
    });
    if (act === "open" || act === "open-next") {
      if (act === "open-next") $("kt-pack").hidden = true;
      openPack(t);
    } else if (act === "share") {
      shareAlbum(t);
    } else if (act === "sound") {
      var on = !SND.enabled();
      SND.setEnabled(on);
      t.textContent = on ? "🔊" : "🔇";
      t.setAttribute("aria-pressed", String(on));
      if (on) SND.play("common");
    } else if (act === "pack-skip") {
      pack.step = "summary";
      drawPack();
    } else if (act === "pack-close") {
      $("kt-pack").hidden = true;
    } else if (act === "card-close") {
      closeCard();
    } else if (act === "starter") {
      busy(t, rpc("cards_web_claim_starter", {}, true).then(function (r) {
        if (!r.ok) return flash(reasonText(r), "error");
        flash("3 Starter-Packs abgeholt – viel Glück! 🎁", "ok");
        return reloadMe();
      }));
    } else if (act === "weekly") {
      busy(t, rpc("cards_web_claim_weekly", {}, true).then(function (r) {
        if (!r.ok) return flash(reasonText(r), "error");
        flash("Gratis-Pack abgeholt! 📦", "ok");
        return reloadMe();
      }));
    } else if (act === "hide") {
      var hide = !(state.me && state.me.hidden);
      busy(t, rpc("cards_web_set_hidden", { p_hidden: hide }, true).then(function (r) {
        if (!r.ok) return flash(reasonText(r), "error");
        flash(hide ? "Dein Album ist jetzt versteckt – auch in den Ranglisten." : "Dein Album ist wieder öffentlich.", "ok");
        return reloadMe();
      }));
    } else if (act === "logout") {
      logout();
    }
  }

  // ── Gesamt ─────────────────────────────────────────────────────────────────
  function render() {
    if (!U.consentGiven()) {
      $("kt-head").innerHTML = "";
      $("kt-nav").innerHTML = "";
      $("kt-view").innerHTML = "";
      $("kt-account").innerHTML = '<p class="kt-note">Das Kartenspiel lädt seine Daten von <b>Supabase</b>. '
        + 'Erlaube dafür „Inhalte laden“. <button class="kt-link" type="button" id="kt-consent">Inhalte laden …</button></p>';
      $("kt-consent").onclick = function () { $("consent").hidden = false; };
      return;
    }
    renderHead();
    renderAccount();
    renderNav();
    renderView();
  }

  // #karten/@name öffnet ein fremdes Album
  function route() {
    var h = window.location.hash.slice(1);
    if (h.split("/")[0] !== "karten") return;
    start();
    var m = h.match(/^karten\/@([\w]+)/);
    if (m) {
      state.view = "browse";
      loadOther(decodeURIComponent(m[1]).toLowerCase()).then(render).catch(handleError);
    }
  }

  function start() {
    if (state.started || !U.consentGiven()) { render(); return; }
    state.started = true;
    render();
    Promise.all([rpc("cards_public_info"), loadMe()]).then(function (r) {
      state.info = r[0];
      render();
      if (state.msg) flash(state.msg.text, state.msg.kind);
    }).catch(handleError);
  }

  state.session = readSession();
  captureLogin();
  $("karten").addEventListener("click", onClick);
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    $("kt-pack").hidden = true;
    closeCard();
  });
  $("consent-accept").addEventListener("click", function () { setTimeout(route, 0); });
  window.addEventListener("hashchange", route);
  route();
})();
