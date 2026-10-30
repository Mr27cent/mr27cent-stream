/**
 * Mr27cent Stream-Seite – Backend (Google Apps Script)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Liefert alle Daten für stream/index.html als JSON:
 *   Live-Status, Follower, Streamplan, Clips, Emotes, Spiele-Historie,
 *   Highscores (Hangman / Idle-Game), Zuschauzeit-Herde.
 *
 * Warum ein Backend?  Twitch-Abfragen brauchen ein Token. Den Client-Secret
 * darf man nie im Browser ausliefern – deshalb holt dieses Skript die Daten
 * und gibt nur das fertige JSON an die Webseite.
 *
 * Einrichtung: siehe stream/README.md
 *
 * Skript-Eigenschaften (Projekteinstellungen → Skripteigenschaften):
 *   TWITCH_CLIENT_ID      – aus der Twitch Developer Console
 *   TWITCH_CLIENT_SECRET  – aus der Twitch Developer Console
 *   SPREADSHEET_ID        – Google Sheet für Highscores & Spielzeit
 *   SETUP_KEY             – selbst ausgedachtes Passwort für die Einrichtungsseite (?setup=PASSWORT)
 *   HANGMAN_KEY           – Schlüssel, mit dem das Hangman-Overlay Punkte schicken darf
 *                           (derselbe Wert steht oben in streamer-hangman.html)
 *   (TWITCH_REFRESH_TOKEN wird automatisch gesetzt, wenn du ?setup=PASSWORT aufrufst)
 */

// ── Konfiguration ─────────────────────────────────────────────────────────
var STREAMER_LOGIN = "mr27cent";

// Tabellenblätter im Sheet. Spalten jeweils: Name | Punkte | Datum | Info
var HIGHSCORE_SHEETS = {
  hangman: "HANGMAN",
  idle:    "IDLE"
};
var HIGHSCORE_TOP_N = 10;

// Idle-Game (Sammelspiel): Rangliste kommt direkt aus Supabase (öffentliche
// Funktion get_leaderboard). Der Schlüssel ist der öffentliche „publishable key“
// – er darf im Code stehen. Leer lassen = Rangliste aus dem Blatt IDLE.
var IDLE_SUPABASE = {
  url: "https://pgqpgvtscyxpghspnhdw.supabase.co",
  key: "sb_publishable_oTKhGpPBjcy35AM_m_mm_A_-EKfpo_X"
};

// Spielzeit-Log. Spalten: Spiel | Minuten | Zuletzt gespielt | Game-ID
var PLAYTIME_SHEET = "SPIELZEIT";
// Muss zum Zeit-Trigger passen (setupTrigger legt alle 5 Minuten an)
var PLAYTIME_INTERVAL_MIN = 5;

// Zuschauzeit („Herde“). Spalten: Jahr | Login | Name | Minuten | Zuletzt gesehen
var WATCHTIME_SHEET = "ZUSCHAUZEIT";
var HERD_MAX = 1000;           // so viele Zuschauer gehen max. an die Webseite
// Bots und der Kanal selbst sammeln keine Zuschauzeit. Auch Zuschauer, die nicht in
// der Herde erscheinen möchten (Widerspruch laut Datenschutzerklärung), hier klein
// eintragen und ihre Zeilen im Blatt ZUSCHAUZEIT löschen.
// Bots, die nie in die Herde sollen (Kleinschreibung). Wer hier steht, wird nicht
// mehr gezählt UND verschwindet sofort aus Herde, Rangliste und Ruhmeshalle.
var IGNORE_USERS = ["streamelements", "streamlabs", "nightbot", "moobot", "fossabot",
  "wizebot", "soundalerts", "sery_bot", "commanderroot", "streamerbot", "kofistreambot",
  "tangiabot", "frostytools", "streamstickers", "anotherttvviewer", "lurxx", "aliceydra",
  "drapsnatt", "0ax2", "kattah", "pokemoncommunitygame", "botrixoficial", "blerp",
  "streamlootsbot", "own3d", "creatisbot", "deepbot", "coebot", "phantombot", "ankhbot",
  "vivbot", "botisimo", "pretzelrocks", "songlistbot", "restreambot", "playwithviewersbot"];

// Stufen für den Chat-Befehl !gazelle – MUSS zu config.js → herd.stages passen
var HERD_STAGES = [
  [0, "Neugeborenes Kitz"], [1, "Wackelbeinchen"], [3, "Grashalm-Knabberer"], [5, "Kitz"],
  [8, "Neugieriges Kitz"], [12, "Pfützenspringer"], [17, "Halmhüpfer"], [23, "Jährling"],
  [30, "Staubaufwirbler"], [40, "Akazienschatten-Kenner"], [50, "Junggazelle"],
  [65, "Wasserloch-Stammgast"], [80, "Steppenflitzer"], [100, "Morgentau-Sprinter"],
  [125, "Kleine Hörner"], [150, "Savannenspringer"], [185, "Dornbusch-Slalomer"],
  [225, "Herdenmitglied"], [270, "Spurenleser"], [320, "Windschnell"], [380, "Abendrot-Gazelle"],
  [450, "Löwenschreck"], [530, "Graslandwächter"], [620, "Wächter der Herde"],
  [720, "Sternenhimmel-Gazelle"], [850, "Weise der Savanne"], [1000, "Universumsgazelle"]
];
// Lurker-Schutz: Namen erscheinen nur, wenn jemand selbst „!herde“ schreibt.
// Blatt SICHTBAR: Login | seit   (wird automatisch angelegt)
var VISIBLE_SHEET = "SICHTBAR";
var HALL_TOP_N = 3;            // so viele Gazellen pro vergangener Saison in der Ruhmeshalle
var CLIP_CANDIDATES_N = 6;     // Clips zur Wahl beim „Clip des Monats“

// Abstimmung. UMFRAGE: ID | Frage | Antworten (mit | getrennt) | Aktiv (TRUE/FALSE)
//             STIMMEN: ID | Wähler | Antwort | Zeit  (wird automatisch angelegt)
var POLL_SHEET = "UMFRAGE";
var VOTES_SHEET = "STIMMEN";

var TOP_CLIPS_N = 7;           // Clip des Jahres + 6 weitere
var RESPONSE_CACHE_SEC = 60;   // Twitch wird höchstens 1x pro Minute gefragt
var LAST_GOOD_SEC = 21600;     // letzte funktionierende Antwort 6 h als Notreserve

// Zuschauerzahl bei jedem 5-Minuten-Lauf (nur live): Zeit | Zuschauer | Spiel
var VIEWERS_SHEET = "ZUSCHAUER";
var VIEWERS_KEEP_DAYS = 90;
// Twitch „Weg zum Partner“: in den letzten 30 Tagen
var PARTNER_GOAL = { hours: 25, days: 12, viewers: 75 };

// Rätsel (Wort des Tages, Wordle, Emotle) – Serien-Bestenliste
// Die Wortlisten holt sich das Script von der Webseite (raetsel.json),
// damit sie nur an einer Stelle gepflegt werden. Bei eigener Domain hier ändern.
var SITE_URL = "https://mr27cent.pages.dev";
var STREAK_SHEET = "SERIEN";
var STREAK_GAMES = ["hangman", "wordle", "emotle"];
var STREAK_TOP_N = 10;

// Kontaktformular „Für Marken & Partner“: Anfragen kommen per Mail an diese Adresse
// und landen zusätzlich im Blatt ANFRAGEN (wird automatisch angelegt).
var CONTACT_TO = "mr27cent@gmail.com";
var CONTACT_SHEET = "ANFRAGEN";

// ═══════════════════════════════════════════════════════════════════════════
//  Web-App Einstieg
// ═══════════════════════════════════════════════════════════════════════════

function doGet(e) {
  var p = (e && e.parameter) || {};

  if (p.setup) {
    // Nur mit dem selbst gewählten Schlüssel aus den Skripteigenschaften (SETUP_KEY)
    var key = props_().getProperty("SETUP_KEY");
    if (!key || p.setup !== key) return HtmlService.createHtmlOutput("Nicht erlaubt.");
    return setupPage_();
  }
  if (p.vote)  return json_(JSON.stringify(vote_(p.poll, Number(p.option), p.voter)));
  if (p.clipvote) return json_(JSON.stringify(clipVote_(p.clip, p.voter)));
  if (p.streak)      return json_(JSON.stringify(streakSubmit_(p)));
  if (p.streakname)  return json_(JSON.stringify(streakName_(p.voter, p.name)));
  if (p.streakleave) return json_(JSON.stringify(streakLeave_(p.voter)));
  if (p.contact)     return json_(JSON.stringify(contact_(p)));
  if (p.overlay)  return json_(overlayPayload_());
  if (p.cmd) {
    // Chat-Bots: immer kurze Textantwort (Nightbot erlaubt max. 400 Zeichen)
    var reply = p.cmd === "gazelle" ? gazelleCommand_(p.user, p.query)
      : p.cmd === "herde" ? herdeCommand_(p.user, p.query)
      : "Unbekannter Befehl 🌾";
    return ContentService.createTextOutput(String(reply).slice(0, 390));
  }
  if (p.code)  return oauthCallback_(p.code, p.state);

  var cache = CacheService.getScriptCache();
  var cached = cache.get("payload");
  if (cached) return json_(cached);

  var obj = null;
  try { obj = buildPayload_(); } catch (err) { console.error("Payload: " + err.message); }
  // Twitch nicht erreichbar oder Token abgelaufen → letzte gute Antwort zeigen
  if (!obj || !obj.user) {
    var last = cache.get("lastgood");
    if (last) {
      var old = JSON.parse(last);
      old.stale = true;
      old.errors = (old.errors || []).concat(obj ? obj.errors : ["Daten gerade nicht verfügbar"]);
      return json_(JSON.stringify(old));
    }
    if (!obj) obj = { errors: ["Daten gerade nicht verfügbar"], updatedAt: new Date().toISOString() };
  }
  var payload = JSON.stringify(obj);
  // Große Herden sprengen das 100-KB-Limit des Caches – dann bleibt wenigstens
  // der Twitch-Teil zwischengespeichert (siehe twitchPart_)
  try { cache.put("payload", payload, RESPONSE_CACHE_SEC); } catch (err) { /* > 100 KB */ }
  if (obj.user) { try { cache.put("lastgood", payload, LAST_GOOD_SEC); } catch (err) { /* > 100 KB */ } }
  return json_(payload);
}

// Hangman-Overlay (OBS) meldet Gesamtpunkte: {"key": "...", "scores": {"Name": 42, …}}
function doPost(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || "{}"); }
  catch (err) { return ContentService.createTextOutput("bad json"); }
  var key = props_().getProperty("HANGMAN_KEY");
  if (!key || body.key !== key) return ContentService.createTextOutput("Nicht erlaubt.");
  return ContentService.createTextOutput(storeHangman_(body.scores) ? "ok" : "busy");
}

// Twitch-Namen: Buchstaben, Ziffern, Unterstrich – schützt das Sheet vor Formeln
function validPlayer_(n) {
  return /^[\p{L}\p{N}_]{1,25}$/u.test(String(n || ""));
}

// Punkte eintragen: pro Name eine Zeile, es zählt immer der höchste gemeldete Stand
function storeHangman_(scores) {
  var names = Object.keys(scores || {}).filter(function (n) {
    var v = scores[n];
    return validPlayer_(n) && typeof v === "number" && isFinite(v) && v >= 0 && v < 1e7;
  }).slice(0, 200);
  if (!names.length) return true;

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return false;
  try {
    var sh = sheet_(HIGHSCORE_SHEETS.hangman);
    if (!sh) return true;
    var n = Math.max(sh.getLastRow() - 1, 0);
    var rows = n ? sh.getRange(2, 1, n, 3).getValues() : [];
    var at = {};
    rows.forEach(function (r, i) { if (r[0] !== "") at[String(r[0]).toLowerCase()] = i; });
    var now = new Date(), added = [];
    names.forEach(function (name) {
      var score = Math.round(scores[name]);
      var i = at[name.toLowerCase()];
      if (i === undefined) { added.push([name, score, now]); return; }
      if (score > (Number(rows[i][1]) || 0)) { rows[i][1] = score; rows[i][2] = now; }
    });
    if (n) sh.getRange(2, 1, n, 3).setValues(rows);
    if (added.length) sh.getRange(n + 2, 1, added.length, 3).setValues(added);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function json_(text) {
  return ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.JSON);
}

// Alles, was Twitch fragt: höchstens 1x pro Minute, unabhängig von der Herdengröße
function twitchPart_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get("twitch");
  if (hit) return JSON.parse(hit);

  var out = { errors: [] };
  function safe(key, fn) {
    try { out[key] = fn(); }
    catch (err) { out[key] = null; out.errors.push(key + ": " + err.message); }
  }
  var user = null;
  try { user = getUser_(); } catch (err) { out.errors.push("user: " + err.message); }
  out.user = user;
  if (!user) return out;          // nicht cachen – beim nächsten Aufruf neu versuchen
  var id = user.id;
  safe("stream",      function () { return getStream_(id); });
  safe("followers",   function () { return getFollowers_(id); });
  safe("schedule",    function () { return getSchedule_(id); });
  safe("clips",       function () { return getClips_(id); });
  safe("emotes",      function () { return getEmotes_(id); });
  safe("games",       function () { return getPlaytime_(); });
  safe("clipOfMonth", function () { return getClipOfMonth_(id); });
  try { cache.put("twitch", JSON.stringify(out), RESPONSE_CACHE_SEC); } catch (err) { /* sehr viele Emotes */ }
  return out;
}

function buildPayload_() {
  var out = twitchPart_();
  out.updatedAt = new Date().toISOString();

  function safe(key, fn) {
    try { out[key] = fn(); }
    catch (err) { out[key] = null; out.errors.push(key + ": " + err.message); }
  }
  safe("herd",      function () { return getHerd_(); });
  safe("poll",      function () { return getPoll_(); });
  safe("hall",      function () { return getHallOfFame_(); });
  safe("streaks",   function () { return getStreaks_(); });
  safe("channelStats", function () { return getChannelStats_(); });
  safe("highscores", function () {
    var hs = {};
    Object.keys(HIGHSCORE_SHEETS).forEach(function (k) {
      hs[k] = k === "idle" && IDLE_SUPABASE.url ? readIdleLeaderboard_() : readHighscores_(HIGHSCORE_SHEETS[k]);
    });
    return hs;
  });
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Twitch
// ═══════════════════════════════════════════════════════════════════════════

function props_() { return PropertiesService.getScriptProperties(); }

function appToken_() {
  var cache = CacheService.getScriptCache();
  var t = cache.get("app_token");
  if (t) return t;
  var res = UrlFetchApp.fetch("https://id.twitch.tv/oauth2/token", {
    method: "post",
    payload: {
      client_id: props_().getProperty("TWITCH_CLIENT_ID"),
      client_secret: props_().getProperty("TWITCH_CLIENT_SECRET"),
      grant_type: "client_credentials"
    }
  });
  var data = JSON.parse(res.getContentText());
  // Cache max. 6 h, Token läuft deutlich später ab
  cache.put("app_token", data.access_token, Math.min(data.expires_in - 60, 21600));
  return data.access_token;
}

// Broadcaster-Token (für Follower-Zahl und Zuschauer im Chat). Wird über ?setup=PASSWORT einmalig verbunden.
function userToken_() {
  var refresh = props_().getProperty("TWITCH_REFRESH_TOKEN");
  if (!refresh) return null;
  var cache = CacheService.getScriptCache();
  var t = cache.get("user_token");
  if (t) return t;
  var res = UrlFetchApp.fetch("https://id.twitch.tv/oauth2/token", {
    method: "post",
    muteHttpExceptions: true,
    payload: {
      client_id: props_().getProperty("TWITCH_CLIENT_ID"),
      client_secret: props_().getProperty("TWITCH_CLIENT_SECRET"),
      grant_type: "refresh_token",
      refresh_token: refresh
    }
  });
  if (res.getResponseCode() !== 200) throw new Error("Twitch-Verbindung abgelaufen – ?setup=PASSWORT erneut aufrufen");
  var data = JSON.parse(res.getContentText());
  if (data.refresh_token) props_().setProperty("TWITCH_REFRESH_TOKEN", data.refresh_token);
  cache.put("user_token", data.access_token, Math.min(data.expires_in - 60, 21600));
  return data.access_token;
}

function helix_(path, token) {
  var res = UrlFetchApp.fetch("https://api.twitch.tv/helix/" + path, {
    muteHttpExceptions: true,
    headers: {
      "Client-Id": props_().getProperty("TWITCH_CLIENT_ID"),
      "Authorization": "Bearer " + (token || appToken_())
    }
  });
  var code = res.getResponseCode();
  if (code === 404) return { data: [] };
  if (code !== 200) throw new Error("Helix " + path.split("?")[0] + " → HTTP " + code);
  return JSON.parse(res.getContentText());
}

// Profil ändert sich selten → 6 h zwischenspeichern (spart Twitch-Abfragen)
function getUser_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get("user");
  if (hit) return JSON.parse(hit);
  var u = helix_("users?login=" + encodeURIComponent(STREAMER_LOGIN)).data[0];
  if (!u) throw new Error("Twitch-Nutzer nicht gefunden: " + STREAMER_LOGIN);
  var out = {
    id: u.id,
    login: u.login,
    displayName: u.display_name,
    description: u.description,
    avatar: u.profile_image_url,
    broadcasterType: u.broadcaster_type
  };
  cache.put("user", JSON.stringify(out), 21600);
  return out;
}

function getStream_(id) {
  var s = helix_("streams?user_id=" + id).data[0];
  var ch = helix_("channels?broadcaster_id=" + id).data[0] || {};
  return {
    live: !!s,
    title: s ? s.title : ch.title,
    game: s ? s.game_name : ch.game_name,
    gameId: s ? s.game_id : ch.game_id,
    viewers: s ? s.viewer_count : null,
    startedAt: s ? s.started_at : null,
    tags: ch.tags || []
  };
}

function getFollowers_(id) {
  var token = userToken_();
  if (!token) return null;
  return helix_("channels/followers?broadcaster_id=" + id + "&first=1", token).total;
}

function getSchedule_(id) {
  var res = helix_("schedule?broadcaster_id=" + id + "&first=14");
  var d = res.data || {};
  return {
    vacation: d.vacation || null,
    segments: (d.segments || []).map(function (s) {
      return {
        start: s.start_time,
        end: s.end_time,
        title: s.title,
        game: s.category ? s.category.name : null,
        canceled: !!s.canceled_until,
        recurring: s.is_recurring
      };
    })
  };
}

function mapClip_(c) {
  return {
    id: c.id,
    url: c.url,
    title: c.title,
    views: c.view_count,
    createdAt: c.created_at,
    creator: c.creator_name,
    thumbnail: c.thumbnail_url,
    duration: c.duration
  };
}

function getClips_(id) {
  var now = new Date();
  var yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1)).toISOString();
  var year = helix_("clips?broadcaster_id=" + id + "&first=" + TOP_CLIPS_N
    + "&started_at=" + yearStart + "&ended_at=" + now.toISOString()).data;
  var scope = "year";
  // Noch keine Clips in diesem Jahr → Allzeit-Bestenliste
  if (!year.length) {
    year = helix_("clips?broadcaster_id=" + id + "&first=" + TOP_CLIPS_N).data;
    scope = "allTime";
  }
  year.sort(function (a, b) { return b.view_count - a.view_count; });
  return { scope: scope, year: now.getUTCFullYear(), items: year.map(mapClip_) };
}

function getEmotes_(id) {
  return helix_("chat/emotes?broadcaster_id=" + id).data.map(function (e) {
    return {
      name: e.name,
      url: e.images.url_2x,
      tier: e.tier || null,
      type: e.emote_type
    };
  });
}

function boxArt_(gameIds, names) {
  var q = gameIds.map(function (i) { return "id=" + encodeURIComponent(i); })
    .concat(names.map(function (n) { return "name=" + encodeURIComponent(n); }));
  if (!q.length) return {};
  var map = {};
  // Helix erlaubt max. 100 Parameter pro Abfrage
  for (var i = 0; i < q.length; i += 100) {
    helix_("games?" + q.slice(i, i + 100).join("&")).data.forEach(function (g) {
      var art = g.box_art_url.replace("{width}", "144").replace("{height}", "192");
      map[g.id] = art;
      map[g.name.toLowerCase()] = art;
    });
  }
  return map;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Google Sheet: Highscores & Spielzeit
// ═══════════════════════════════════════════════════════════════════════════

function sheet_(name) {
  var id = props_().getProperty("SPREADSHEET_ID");
  if (!id) return null;
  return SpreadsheetApp.openById(id).getSheetByName(name);
}

function readHighscores_(name) {
  var sh = sheet_(name);
  if (!sh || sh.getLastRow() < 2) return [];
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
  return rows
    .filter(function (r) { return r[0] !== "" && r[1] !== ""; })
    .map(function (r) {
      return {
        name: String(r[0]),
        score: Number(r[1]) || 0,
        date: r[2] instanceof Date ? r[2].toISOString() : (r[2] ? String(r[2]) : null),
        info: r[3] ? String(r[3]) : null
      };
    })
    .sort(function (a, b) { return b.score - a.score; })
    .slice(0, HIGHSCORE_TOP_N);
}

// Top 10 des Sammelspiels in der Reihenfolge des Spiels (Legenden-Punkte, dann Sterne, Phase)
function readIdleLeaderboard_() {
  var res = UrlFetchApp.fetch(IDLE_SUPABASE.url + "/rest/v1/rpc/get_leaderboard?limit=" + HIGHSCORE_TOP_N, {
    method: "post",
    contentType: "application/json",
    payload: "{}",
    headers: { apikey: IDLE_SUPABASE.key },
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error("Supabase " + res.getResponseCode());
  return JSON.parse(res.getContentText())
    .sort(function (a, b) { return a.rank - b.rank; })
    .slice(0, HIGHSCORE_TOP_N)
    .map(function (r) {
      return {
        name: String(r.name || "Zuschauer"),
        score: Number(r.legend_points) || 0,
        date: null,
        info: "⭐ " + (Number(r.stars) || 0) + " · Phase " + (Number(r.phase) || 1)
      };
    });
}

function getPlaytime_() {
  var sh = sheet_(PLAYTIME_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues()
    .filter(function (r) { return r[0] !== ""; });

  var ids = [], names = [];
  rows.forEach(function (r) { if (r[3]) ids.push(String(r[3])); else names.push(String(r[0])); });
  var art = {};
  try { art = boxArt_(ids, names); } catch (err) { /* Box-Art ist optional */ }

  return rows.map(function (r) {
    return {
      name: String(r[0]),
      minutes: Number(r[1]) || 0,
      lastPlayed: r[2] instanceof Date ? r[2].toISOString() : (r[2] ? String(r[2]) : null),
      boxArt: art[String(r[3])] || art[String(r[0]).toLowerCase()] || null
    };
  }).sort(function (a, b) { return b.minutes - a.minutes; });
}

/**
 * Zeit-Trigger (alle 5 Minuten). Nur wenn live:
 *  - Spielzeit der aktuellen Kategorie im Blatt SPIELZEIT hochzählen
 *  - jedem Zuschauer im Chat 5 Minuten Zuschauzeit im Blatt ZUSCHAUZEIT gutschreiben
 */
function logStream() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    if (props_().getProperty("CLEANED_YEAR") !== String(new Date().getFullYear())) cleanupOldSeasons();
    var user = getUser_();
    var s = helix_("streams?user_id=" + user.id).data[0];
    if (!s) return;
    if (s.game_name) logPlaytime_(s);
    try { logViewers_(s); } catch (err) { console.warn("Zuschauerzahl: " + err.message); }
    try { logWatchtime_(user.id); } catch (err) { console.warn("Zuschauzeit: " + err.message); }
  } finally {
    lock.releaseLock();
  }
}

// ── Zuschauerzahlen & „Weg zum Partner“ ────────────────────────────────────
function viewersSheet_() {
  var sh = sheet_(VIEWERS_SHEET);
  if (!sh) {
    sh = SpreadsheetApp.openById(props_().getProperty("SPREADSHEET_ID")).insertSheet(VIEWERS_SHEET);
    sh.appendRow(["Zeit", "Zuschauer", "Spiel"]);
  }
  return sh;
}

function logViewers_(s) {
  var sh = viewersSheet_();
  sh.appendRow([new Date(), Number(s.viewer_count) || 0, safeCell_(s.game_name || "")]);
  // Ältere Messungen gelegentlich entfernen (Zeilen sind zeitlich sortiert)
  var n = sh.getLastRow() - 1;
  if (n > 2000 && n % 500 === 0) {
    var cutoff = Date.now() - VIEWERS_KEEP_DAYS * 864e5;
    var times = sh.getRange(2, 1, n, 1).getValues();
    var old = 0;
    while (old < times.length && new Date(times[old][0]).getTime() < cutoff) old++;
    if (old) sh.deleteRows(2, old);
  }
}

// Kennzahlen der letzten 30 Tage – nur Summen, keine Personen
function getChannelStats_() {
  var sh = sheet_(VIEWERS_SHEET);
  var empty = { since: null, samples: 0, avgViewers: null, peakViewers: null, hours: 0, days: 0, streams: 0, goal: PARTNER_GOAL };
  if (!sh || sh.getLastRow() < 2) return empty;
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues()
    .filter(function (r) { return r[0] instanceof Date; });
  if (!rows.length) return empty;
  var from = Date.now() - 30 * 864e5;
  var recent = rows.filter(function (r) { return r[0].getTime() >= from; });
  var sum = 0, peak = 0, days = {}, streams = 0, prev = 0;
  recent.forEach(function (r) {
    var v = Number(r[1]) || 0, t = r[0].getTime();
    sum += v; if (v > peak) peak = v;
    days[Utilities.formatDate(r[0], "Europe/Berlin", "yyyy-MM-dd")] = true;
    if (!prev || t - prev > 30 * 60000) streams++;      // > 30 min Pause = neuer Stream
    prev = t;
  });
  return {
    since: rows[0][0].toISOString(),
    samples: recent.length,
    avgViewers: recent.length ? Math.round(sum / recent.length * 10) / 10 : null,
    peakViewers: recent.length ? peak : null,
    hours: Math.round(recent.length * PLAYTIME_INTERVAL_MIN / 60 * 10) / 10,
    days: Object.keys(days).length,
    streams: streams,
    goal: PARTNER_GOAL
  };
}

function logPlaytime_(s) {
  var sh = sheet_(PLAYTIME_SHEET);
  if (!sh) {
    sh = SpreadsheetApp.openById(props_().getProperty("SPREADSHEET_ID")).insertSheet(PLAYTIME_SHEET);
    sh.appendRow(["Spiel", "Minuten", "Zuletzt gespielt", "Game-ID"]);
  }
  var last = sh.getLastRow();
  var rows = last > 1 ? sh.getRange(2, 1, last - 1, 4).getValues() : [];
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][3]) === s.game_id || String(rows[i][0]).toLowerCase() === s.game_name.toLowerCase()) {
      sh.getRange(i + 2, 2, 1, 3).setValues([[(Number(rows[i][1]) || 0) + PLAYTIME_INTERVAL_MIN, new Date(), s.game_id]]);
      return;
    }
  }
  sh.appendRow([s.game_name, PLAYTIME_INTERVAL_MIN, new Date(), s.game_id]);
}

// Alle eingeloggten Zuschauer im Chat (braucht den Broadcaster-Token aus ?setup=PASSWORT)
function getChatters_(id) {
  var token = userToken_();
  if (!token) throw new Error("Twitch nicht verbunden – ?setup=PASSWORT aufrufen");
  var out = [], cursor = "";
  do {
    var res = helix_("chat/chatters?broadcaster_id=" + id + "&moderator_id=" + id + "&first=1000"
      + (cursor ? "&after=" + encodeURIComponent(cursor) : ""), token);
    out = out.concat(res.data || []);
    cursor = res.pagination && res.pagination.cursor;
  } while (cursor);
  return out;
}

function logWatchtime_(id) {
  var chatters = getChatters_(id).filter(function (c) {
    var login = String(c.user_login).toLowerCase();
    return login !== STREAMER_LOGIN.toLowerCase() && IGNORE_USERS.indexOf(login) === -1;
  });
  if (!chatters.length) return;

  var sh = sheet_(WATCHTIME_SHEET);
  if (!sh) {
    sh = SpreadsheetApp.openById(props_().getProperty("SPREADSHEET_ID")).insertSheet(WATCHTIME_SHEET);
    sh.appendRow(["Jahr", "Login", "Name", "Minuten", "Zuletzt gesehen"]);
  }
  var year = new Date().getFullYear();
  var now = new Date();
  var last = sh.getLastRow();
  var rows = last > 1 ? sh.getRange(2, 1, last - 1, 5).getValues() : [];

  var index = {};
  rows.forEach(function (r, i) { if (Number(r[0]) === year) index[String(r[1]).toLowerCase()] = i; });

  var appended = [];
  var first = -1, last = -1;
  chatters.forEach(function (c) {
    var login = String(c.user_login).toLowerCase();
    var i = index[login];
    if (i === undefined) {
      appended.push([year, login, c.user_name, PLAYTIME_INTERVAL_MIN, now]);
    } else {
      rows[i][2] = c.user_name;
      rows[i][3] = (Number(rows[i][3]) || 0) + PLAYTIME_INTERVAL_MIN;
      rows[i][4] = now;
      if (first === -1 || i < first) first = i;
      if (i > last) last = i;
    }
  });
  // Nur den Block mit geänderten Zeilen schreiben – alte Saisons bleiben unberührt
  if (first !== -1) sh.getRange(first + 2, 1, last - first + 1, 5).setValues(rows.slice(first, last + 1));
  if (appended.length) sh.getRange(sh.getLastRow() + 1, 1, appended.length, 5).setValues(appended);
}

function watchtimeRows_() {
  var sh = sheet_(WATCHTIME_SHEET);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues().filter(function (r) { return r[1] !== ""; });
}

// Logins, die mit Namen sichtbar sein wollen (per !herde)
function visibleSet_() {
  var set = {};
  var sh = sheet_(VISIBLE_SHEET);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().forEach(function (r) {
      if (r[0] !== "") set[String(r[0]).toLowerCase()] = true;
    });
  }
  return set;
}

// Stabile, nicht umkehrbare Kennung für anonyme Gazellen (damit sie im Overlay
// nicht bei jeder Aktualisierung neu erscheinen) – ohne Name oder Login preiszugeben
function anonId_(login) {
  var salt = props_().getProperty("ANON_SALT");
  if (!salt) { salt = Utilities.getUuid(); props_().setProperty("ANON_SALT", salt); }
  return Utilities.computeHmacSha256Signature(login, salt).slice(0, 6).map(function (b) {
    return ("0" + (b & 0xff).toString(16)).slice(-2);
  }).join("");
}

// Öffentliche Sicht auf ein Mitglied: Name nur, wenn sichtbar
function publicMember_(m, vis) {
  var shown = !!vis[m.login];
  return {
    id: anonId_(m.login),       // bleibt gleich, auch wenn jemand sichtbar wird
    name: shown ? m.name : null,
    minutes: m.minutes,
    lastSeen: shown ? m.lastSeen : null,
    present: m.present
  };
}

function herdMembers_(rows, year) {
  return rows
    .filter(function (r) { return Number(r[0]) === year && IGNORE_USERS.indexOf(String(r[1]).toLowerCase()) === -1; })
    .map(function (r) {
      var seen = r[4] instanceof Date ? r[4] : null;
      return {
        name: String(r[2] || r[1]),
        login: String(r[1]).toLowerCase(),        // nur intern (Chat-Befehl), nicht veröffentlicht
        minutes: Number(r[3]) || 0,
        lastSeen: seen ? Utilities.formatDate(seen, "Europe/Berlin", "yyyy-MM-dd") : null,
        // Beim letzten 5-Minuten-Durchlauf im Chat → gerade dabei
        present: !!seen && (Date.now() - seen.getTime()) < (PLAYTIME_INTERVAL_MIN * 2 + 2) * 60000
      };
    })
    .sort(function (a, b) { return b.minutes - a.minutes; });
}

function getHerd_() {
  var year = new Date().getFullYear();
  var members = herdMembers_(watchtimeRows_(), year);
  var totalMinutes = members.reduce(function (sum, m) { return sum + m.minutes; }, 0);
  return {
    year: year,
    total: members.length,
    totalMinutes: totalMinutes,
    members: (function (vis) {
      return members.slice(0, HERD_MAX).map(function (m) { return publicMember_(m, vis); });
    })(visibleSet_())
  };
}

// Ruhmeshalle: die größten Gazellen jeder vergangenen Saison
function getHallOfFame_() {
  var rows = watchtimeRows_();
  var vis = visibleSet_();
  var thisYear = new Date().getFullYear();
  var years = {};
  rows.forEach(function (r) { var y = Number(r[0]); if (y && y < thisYear) years[y] = true; });
  return Object.keys(years).map(Number).sort(function (a, b) { return b - a; }).map(function (y) {
    return {
      year: y,
      // Nur wer per !herde mit Namen dabei sein will, kommt in die Ruhmeshalle
      top: herdMembers_(rows, y).filter(function (m) { return vis[m.login]; }).slice(0, HALL_TOP_N)
        .map(function (m) { return { name: m.name, minutes: m.minutes }; })
    };
  });
}

// Schlanke Daten fürs OBS-Overlay (alle 60 s abgefragt): nur sichtbare Zuschauer im Chat
function overlayPayload_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get("overlay");
  if (hit) return hit;
  try { return overlayFresh_(cache); }
  catch (err) { console.warn("Overlay: " + err.message); return JSON.stringify({ live: false, members: [] }); }
}

function overlayFresh_(cache) {
  var user = getUser_();
  var live = !!helix_("streams?user_id=" + user.id).data[0];
  var vis = visibleSet_();
  var members = live ? herdMembers_(watchtimeRows_(), new Date().getFullYear())
    // Overlay zeigt nur Aufstiege von Zuschauern, die per !herde sichtbar sein wollen
    .filter(function (m) { return m.present && vis[m.login]; })
    .map(function (m) { var p = publicMember_(m, vis); return { id: p.id, name: p.name, minutes: p.minutes }; }) : [];
  var out = JSON.stringify({ live: live, members: members });
  cache.put("overlay", out, 30);
  return out;
}

function cleanLogin_(v) {
  return String(v || "").replace(/^@/, "").trim().split(/\s+/)[0].toLowerCase();
}

// Bots übergeben teils den Anzeigenamen statt des Logins → beides akzeptieren
function findMember_(members, who) {
  for (var i = 0; i < members.length; i++) {
    if (members[i].login === who || members[i].name.toLowerCase() === who) return i;
  }
  return -1;
}

// Chat-Befehl !gazelle [name] – Antwort als Text für Nightbot/Streamer.bot.
// Gibt nur über Gazellen Auskunft, die per !herde sichtbar sind (Lurker-Schutz).
function gazelleCommand_(user, query) {
  var self = cleanLogin_(user), other = cleanLogin_(query);
  var who = other || self;
  if (!who) return "Schreib !gazelle oder !gazelle Name 🦌";
  var vis = visibleSet_();
  var members = herdMembers_(watchtimeRows_(), new Date().getFullYear());
  var idx = findMember_(members, who);
  if (idx === -1 || !vis[members[idx].login]) {
    if (idx === -1 && !other) return "Du bist noch nicht in der Herde – bleib ein paar Minuten im Chat, dann wirst du als Kitz geboren 🌱";
    return other && other !== self
      ? "Zu " + other + " gibt's keine sichtbare Gazelle 🌾"
      : "Du grast als anonyme Gazelle mit 🌾 Schreib !herde, um mit Namen in der Herde zu erscheinen.";
  }

  var m = members[idx], h = m.minutes / 60;
  var cur = 0;
  HERD_STAGES.forEach(function (st, i) { if (h >= st[0]) cur = i; });
  var next = HERD_STAGES[cur + 1];
  function fmt(x) { return String(x >= 10 ? Math.round(x) : Math.round(x * 10) / 10).replace(".", ","); }
  var text = "🦌 " + m.name + " ist Stufe " + (cur + 1) + "/" + HERD_STAGES.length + " „" + HERD_STAGES[cur][1] + "“ mit "
    + fmt(h) + " h (Platz " + (idx + 1) + " von " + members.length + ")";
  if (next) text += " – noch " + fmt(Math.max(0, next[0] - h)) + " h bis „" + next[1] + "“";
  else text += " – ausgewachsen! 👑";
  return text;
}

// Chat-Befehl !herde (mit Namen sichtbar werden) / !herde aus (wieder anonym)
function herdeCommand_(user, arg) {
  var who = cleanLogin_(user);
  if (!who || who.length > 40 || /^[=+\-@]/.test(who)) return "Das hat nicht geklappt 🌾";
  var off = /^(aus|off|weg|stop|anonym)$/i.test(String(arg || "").trim());
  var members = herdMembers_(watchtimeRows_(), new Date().getFullYear());
  var idx = findMember_(members, who);
  var login = idx === -1 ? who : members[idx].login;
  if (!/^[a-z0-9_]{1,25}$/.test(login)) return "Das hat nicht geklappt 🌾";
  // Sichtbar machen nur, wer gerade wirklich im Chat ist – so kann niemand
  // über die Adresse fremde Namen einblenden, ohne dass die Person dabei ist
  if (!off && (idx === -1 || !members[idx].present)) {
    return "🌱 Du wirst gleich als Kitz geboren – schreib in ein paar Minuten nochmal !herde.";
  }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return "Die Savanne ist gerade beschäftigt – versuch's gleich nochmal 🌾";
  try {
    var sh = sheet_(VISIBLE_SHEET);
    if (!sh) {
      sh = SpreadsheetApp.openById(props_().getProperty("SPREADSHEET_ID")).insertSheet(VISIBLE_SHEET);
      sh.appendRow(["Login", "seit"]);
    }
    var rows = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues() : [];
    var at = -1;
    rows.forEach(function (r, i) { if (String(r[0]).toLowerCase() === login) at = i; });
    if (off) {
      if (at !== -1) sh.deleteRow(at + 2);
    } else if (at === -1) {
      sh.appendRow([login, new Date()]);
    }
  } finally {
    lock.releaseLock();
  }
  CacheService.getScriptCache().removeAll(["payload", "overlay"]);
  return off
    ? "🌾 Alles klar – deine Gazelle grast ab jetzt anonym weiter."
    : "🦌 Willkommen in der Herde, " + members[idx].name + "! Deine Gazelle ist jetzt mit Namen sichtbar (Webseite & Stream). Mit „!herde aus“ wirst du wieder anonym.";
}

// ═══════════════════════════════════════════════════════════════════════════
//  Abstimmung
// ═══════════════════════════════════════════════════════════════════════════

// Geräte-Kennung der Webseite (zufällige UUID). Alles andere wird abgelehnt –
// so landen auch keine Formeln (=…) im Sheet.
function validVoter_(v) {
  return /^[A-Za-z0-9-]{8,64}$/.test(String(v || ""));
}

// Stimme speichern; false, wenn das Sheet gerade gesperrt ist (Zuschauzeit wird geschrieben)
function storeVote_(pollId, voter, option) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return false;
  try {
    var sh = votesSheet_();
    var dup = sh.getLastRow() > 1 && sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues().some(function (r) {
      return String(r[0]) === pollId && String(r[1]) === voter;
    });
    if (!dup) sh.appendRow([pollId, voter, option, new Date()]);
    return true;
  } finally {
    lock.releaseLock();
  }
}

function activePoll_() {
  var sh = sheet_(POLL_SHEET);
  if (!sh || sh.getLastRow() < 2) return null;
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 4).getValues();
  for (var i = rows.length - 1; i >= 0; i--) {
    var r = rows[i];
    if (r[0] !== "" && (r[3] === true || String(r[3]).toUpperCase() === "TRUE")) {
      return {
        id: String(r[0]),
        question: String(r[1]),
        options: String(r[2]).split("|").map(function (t) { return t.trim(); }).filter(String)
      };
    }
  }
  return null;
}

function votesSheet_() {
  var sh = sheet_(VOTES_SHEET);
  if (!sh) {
    sh = SpreadsheetApp.openById(props_().getProperty("SPREADSHEET_ID")).insertSheet(VOTES_SHEET);
    sh.appendRow(["ID", "Wähler", "Antwort", "Zeit"]);
  }
  return sh;
}

function pollResult_(poll) {
  var counts = poll.options.map(function () { return 0; });
  var sh = sheet_(VOTES_SHEET);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r) {
      var o = Number(r[2]);
      if (String(r[0]) === poll.id && o >= 0 && o < counts.length) counts[o]++;
    });
  }
  return {
    id: poll.id,
    question: poll.question,
    options: poll.options.map(function (t, i) { return { text: t, votes: counts[i] }; })
  };
}

function getPoll_() {
  var poll = activePoll_();
  return poll ? pollResult_(poll) : null;
}

function vote_(pollId, option, voter) {
  var poll = activePoll_();
  if (!poll || poll.id !== String(pollId) || !(option >= 0 && option < poll.options.length) || !validVoter_(voter)) {
    return { error: "Ungültige Stimme" };
  }
  if (!storeVote_(poll.id, String(voter), option)) return { error: "Gerade beschäftigt – bitte gleich nochmal versuchen" };
  CacheService.getScriptCache().remove("payload");
  return pollResult_(poll);
}


// ═══════════════════════════════════════════════════════════════════════════
//  Kontaktformular (Media Kit)
// ═══════════════════════════════════════════════════════════════════════════

// Text so speichern, dass das Sheet ihn nie als Formel ausführt
function safeCell_(v) {
  v = String(v || "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "").trim();
  return /^[=+\-@]/.test(v) ? "'" + v : v;
}

function contact_(p) {
  var name = String(p.name || "").trim(), mail = String(p.email || "").trim();
  var company = String(p.company || "").trim(), msg = String(p.message || "").trim();
  var voter = String(p.voter || "");
  if (p.website) return { ok: true };                       // Spam-Falle: Feld ist für Menschen unsichtbar
  if (!validVoter_(voter)) return { error: "Bitte Seite neu laden und nochmal versuchen." };
  if (name.length < 2 || name.length > 80) return { error: "Bitte gib deinen Namen an." };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(mail) || mail.length > 120) return { error: "Bitte prüfe die E-Mail-Adresse." };
  if (company.length > 100) return { error: "Der Firmenname ist zu lang." };
  if (msg.length < 10 || msg.length > 2000) return { error: "Die Nachricht sollte zwischen 10 und 2.000 Zeichen lang sein." };

  // Schutz vor Massen-Spam: pro Gerät 1 Anfrage in 10 Minuten, insgesamt max. 20 pro Stunde
  var cache = CacheService.getScriptCache();
  if (cache.get("contact-" + voter)) return { error: "Deine Anfrage ist schon angekommen – bitte ein paar Minuten warten." };
  var hourKey = "contact-hour-" + Utilities.formatDate(new Date(), "Europe/Berlin", "yyyyMMddHH");
  var count = Number(cache.get(hourKey) || 0);
  if (count >= 20) return { error: "Gerade kommen sehr viele Anfragen – bitte später nochmal versuchen." };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { error: "Gerade beschäftigt – bitte gleich nochmal versuchen" };
  try {
    var sh = sheet_(CONTACT_SHEET);
    if (!sh) {
      sh = SpreadsheetApp.openById(props_().getProperty("SPREADSHEET_ID")).insertSheet(CONTACT_SHEET);
      sh.appendRow(["Zeit", "Name", "Firma", "E-Mail", "Nachricht", "Erledigt"]);
    }
    sh.appendRow([new Date(), safeCell_(name), safeCell_(company), safeCell_(mail), safeCell_(msg), false]);
  } finally {
    lock.releaseLock();
  }
  MailApp.sendEmail({
    to: CONTACT_TO,
    replyTo: mail,
    name: "mr27cent.pages.dev",
    subject: "🤝 Kooperationsanfrage" + (company ? " von " + company : "") + " (" + name + ")",
    body: "Neue Anfrage über das Media Kit auf deiner Webseite:\n\n"
      + "Name: " + name + "\nFirma/Marke: " + (company || "–") + "\nE-Mail: " + mail + "\n\n"
      + msg + "\n\n— Einfach auf diese Mail antworten, die Antwort geht direkt an " + mail + "."
  });
  cache.put("contact-" + voter, "1", 600);
  cache.put(hourKey, String(count + 1), 3600);
  return { ok: true };
}

// Einmal im Editor ausführen (▶ testKontakt): erteilt die Berechtigung „E-Mails senden“
// und schickt dir eine Test-Mail.
function testKontakt() {
  MailApp.sendEmail(CONTACT_TO, "✅ Test: Kontaktformular funktioniert",
    "Wenn du diese Mail bekommst, kommen Anfragen aus dem Media Kit ab jetzt bei dir an.");
  Logger.log("Test-Mail an " + CONTACT_TO + " geschickt. Noch übrige Mails heute: " + MailApp.getRemainingDailyQuota());
}

// ═══════════════════════════════════════════════════════════════════════════
//  Rätsel-Serien: Wort des Tages, Wordle, Emotle
//  Die Webseite schickt nur die Tipps – ob das Rätsel gelöst wurde und wie
//  lang die Serie ist, rechnet das Script selbst aus.
//  Blatt SERIEN: Gerät | Name | Spiel | Serie | Beste | Letzter Tag | Ergebnis | Aktualisiert
// ═══════════════════════════════════════════════════════════════════════════

// Rätsel-Nummer = Tage seit 1.1.2026 nach deutscher Zeit (wie auf der Webseite)
function puzzleDay_() {
  var s = Utilities.formatDate(new Date(), "Europe/Berlin", "yyyy-MM-dd").split("-");
  return Math.floor((Date.UTC(+s[0], +s[1] - 1, +s[2]) - Date.UTC(2026, 0, 1)) / 86400000);
}

// Gleiche Auswahl-Formel wie in raetsel.js
function pickPuzzle_(list, day, mul, add) {
  var n = list.length;
  return list[((day * mul + add) % n + n) % n];
}

function puzzleLists_(fresh) {
  var cache = CacheService.getScriptCache();
  if (!fresh) {
    var hit = cache.get("puzzles");
    if (hit) return JSON.parse(hit);
  }
  var res = UrlFetchApp.fetch(SITE_URL + "/raetsel.json?t=" + Date.now(), { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error("raetsel.json nicht erreichbar");
  var d = JSON.parse(res.getContentText("UTF-8"));
  var out = { wotd: d.wotd || [], wordle: d.wordle || [] };
  try { cache.put("puzzles", JSON.stringify(out), 1800); } catch (err) { /* zu groß */ }
  return out;
}

function emotleAnswer_(day) {
  var names = ((twitchPart_().emotes) || []).map(function (e) { return e.name; });
  if (names.length < 4) return null;
  names.sort(function (a, b) {
    a = a.toLowerCase(); b = b.toLowerCase();
    return a < b ? -1 : a > b ? 1 : 0;
  });
  return pickPuzzle_(names, day, 53, 7);
}

// "W" = gelöst, "L" = verloren, null = passt nicht zum Rätsel / nicht fertig
function judgePuzzle_(game, day, r, lists) {
  r = String(r || "");
  if (game === "hangman") {
    var word = pickPuzzle_(lists.wotd, day, 37, 11);
    var letters = r.toUpperCase().split("");
    if (!word || letters.length > 40) return null;
    var wrong = letters.filter(function (l) { return word.indexOf(l) === -1; }).length;
    var solved = word.split("").every(function (l) { return letters.indexOf(l) !== -1; });
    if (solved && wrong < 8) return "W";
    return wrong >= 8 ? "L" : null;
  }
  var tips = r.split(",").filter(String);
  if (!tips.length || tips.length > 6) return null;
  var answer = game === "wordle" ? pickPuzzle_(lists.wordle, day, 97, 13) : emotleAnswer_(day);
  if (!answer) return null;
  if (game === "wordle") {
    tips = tips.map(function (t) { return t.toUpperCase(); });
    if (tips.some(function (t) { return t.length !== 5; })) return null;
  }
  var hit = tips.indexOf(answer);
  if (hit === tips.length - 1) return "W";
  return hit === -1 && tips.length === 6 ? "L" : null;
}

function streakSheet_() {
  var sh = sheet_(STREAK_SHEET);
  if (!sh) {
    sh = SpreadsheetApp.openById(props_().getProperty("SPREADSHEET_ID")).insertSheet(STREAK_SHEET);
    sh.appendRow(["Gerät", "Name", "Spiel", "Serie", "Beste", "Letzter Tag", "Ergebnis", "Aktualisiert"]);
  }
  return sh;
}

function streakRows_(sh) {
  var n = Math.max(sh.getLastRow() - 1, 0);
  return n ? sh.getRange(2, 1, n, 8).getValues() : [];
}

// Top 10 pro Rätsel, sortiert nach längster Serie
function getStreaks_() {
  var sh = sheet_(STREAK_SHEET);
  var out = {};
  STREAK_GAMES.forEach(function (g) { out[g] = []; });
  if (!sh) return out;
  var today = puzzleDay_();
  streakRows_(sh).forEach(function (r) {
    var g = String(r[2]), best = Number(r[4]) || 0;
    if (!out[g] || best < 1 || !r[1]) return;
    var last = Number(r[5]);
    out[g].push({
      name: String(r[1]),
      best: best,
      current: last >= today - 1 && r[6] === "W" ? Number(r[3]) || 0 : 0,
      t: r[7] instanceof Date ? r[7].getTime() : 0
    });
  });
  STREAK_GAMES.forEach(function (g) {
    out[g] = out[g].sort(function (a, b) { return b.best - a.best || b.current - a.current || a.t - b.t; })
      .slice(0, STREAK_TOP_N)
      .map(function (x) { return { name: x.name, best: x.best, current: x.current }; });
  });
  return out;
}

function validStreakName_(n) {
  return /^[A-Za-z0-9_]{2,25}$/.test(String(n || ""));
}

// Namen festlegen oder ändern. Ein Name gehört dem Gerät, das ihn zuerst nimmt.
function streakName_(voter, name) {
  voter = String(voter || ""); name = String(name || "");
  if (!validVoter_(voter)) return { error: "Ungültiges Gerät" };
  if (!validStreakName_(name)) return { error: "Bitte nur Buchstaben, Zahlen und _ (2–25 Zeichen)." };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { error: "Gerade beschäftigt – bitte gleich nochmal versuchen" };
  try {
    var sh = streakSheet_(), rows = streakRows_(sh), low = name.toLowerCase();
    var taken = rows.some(function (r) { return String(r[0]) !== voter && String(r[1]).toLowerCase() === low; });
    if (taken) return { error: "Der Name ist schon vergeben. Bist du das? Dann schreib Mr27cent kurz an." };
    var have = {};
    rows.forEach(function (r, i) {
      if (String(r[0]) === voter) { rows[i][1] = name; have[String(r[2])] = true; }
    });
    if (rows.length) sh.getRange(2, 1, rows.length, 8).setValues(rows);
    var add = STREAK_GAMES.filter(function (g) { return !have[g]; }).map(function (g) {
      return [voter, name, g, 0, 0, -1, "", new Date()];
    });
    if (add.length) sh.getRange(rows.length + 2, 1, add.length, 8).setValues(add);
  } finally {
    lock.releaseLock();
  }
  CacheService.getScriptCache().remove("payload");
  return { ok: true, name: name, boards: getStreaks_() };
}

function streakLeave_(voter) {
  voter = String(voter || "");
  if (!validVoter_(voter)) return { error: "Ungültiges Gerät" };
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { error: "Gerade beschäftigt – bitte gleich nochmal versuchen" };
  try {
    var sh = sheet_(STREAK_SHEET);
    if (sh) {
      var rows = streakRows_(sh);
      for (var i = rows.length - 1; i >= 0; i--) {
        if (String(rows[i][0]) === voter) sh.deleteRow(i + 2);
      }
    }
  } finally {
    lock.releaseLock();
  }
  CacheService.getScriptCache().remove("payload");
  return { ok: true, boards: getStreaks_() };
}

// Einmal im Editor ausführen (▶ testRaetsel): erteilt die Berechtigung für
// „externe Anfragen“ und zeigt im Protokoll die heutigen Lösungen.
function testRaetsel() {
  var day = puzzleDay_(), lists = puzzleLists_(true);
  Logger.log("Rätsel #" + (day + 1) + ": Wort des Tages = " + pickPuzzle_(lists.wotd, day, 37, 11)
    + ", Wordle = " + pickPuzzle_(lists.wordle, day, 97, 13) + ", Emotle = " + emotleAnswer_(day));
}

// Ergebnis eines Rätsels melden: ?streak=1&game=wordle&day=289&r=TIPPS&voter=…
function streakSubmit_(p) {
  var game = String(p.game || ""), voter = String(p.voter || ""), day = Number(p.day);
  if (STREAK_GAMES.indexOf(game) === -1 || !validVoter_(voter) || day !== Math.floor(day)) return { error: "Ungültiges Ergebnis" };
  var today = puzzleDay_();
  if (day < today - 1 || day > today + 1) return { error: "Dieses Rätsel ist nicht mehr aktuell." };

  // Erst mit der zwischengespeicherten Liste prüfen, bei Abweichung frisch laden
  var res = judgePuzzle_(game, day, p.r, puzzleLists_(false));
  if (!res) res = judgePuzzle_(game, day, p.r, puzzleLists_(true));
  if (!res) return { error: "Das Ergebnis passt nicht zum heutigen Rätsel." };

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return { error: "Gerade beschäftigt – bitte gleich nochmal versuchen" };
  var row;
  try {
    var sh = sheet_(STREAK_SHEET), rows = sh ? streakRows_(sh) : [], at = -1;
    rows.forEach(function (r, i) { if (String(r[0]) === voter && String(r[2]) === game) at = i; });
    if (at === -1) return { error: "Bitte trag zuerst deinen Namen ein.", noName: true };
    row = rows[at];
    var last = Number(row[5]);
    if (day > last) {
      var cur = Number(row[3]) || 0;
      if (res === "W") cur = (last === day - 1 && row[6] === "W") ? cur + 1 : 1;
      else cur = 0;
      row[3] = cur;
      row[4] = Math.max(Number(row[4]) || 0, cur);
      row[5] = day;
      row[6] = res;
      row[7] = new Date();
      sh.getRange(at + 2, 1, 1, 8).setValues([row]);
    }
  } finally {
    lock.releaseLock();
  }
  CacheService.getScriptCache().remove("payload");
  return { ok: true, game: game, result: res, current: Number(row[3]) || 0, best: Number(row[4]) || 0, boards: getStreaks_() };
}


// ═══════════════════════════════════════════════════════════════════════════
//  Clip des Monats: Community wählt aus den Top-Clips des laufenden Monats
// ═══════════════════════════════════════════════════════════════════════════

function monthKey_(d) {
  return d.getUTCFullYear() + "-" + ("0" + (d.getUTCMonth() + 1)).slice(-2);
}

function monthClips_(id, start, end, n) {
  return helix_("clips?broadcaster_id=" + id + "&first=" + n
    + "&started_at=" + start.toISOString() + "&ended_at=" + end.toISOString()).data.map(mapClip_);
}

function clipVotes_(pollId) {
  var counts = {};
  var sh = sheet_(VOTES_SHEET);
  if (sh && sh.getLastRow() > 1) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 3).getValues().forEach(function (r) {
      if (String(r[0]) === pollId) counts[String(r[2])] = (counts[String(r[2])] || 0) + 1;
    });
  }
  return counts;
}

function clipCandidates_(id) {
  var cache = CacheService.getScriptCache();
  var now = new Date();
  var key = "clip_candidates_" + monthKey_(now);
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);
  var start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  var list = monthClips_(id, start, now, CLIP_CANDIDATES_N);
  cache.put(key, JSON.stringify(list), 600);
  return list;
}

function getClipOfMonth_(id) {
  var now = new Date();
  var month = monthKey_(now);
  var votes = clipVotes_("clip-" + month);
  var candidates = clipCandidates_(id).map(function (c) { c.votes = votes[c.id] || 0; return c; });

  // Gewinner des Vormonats: meiste Stimmen, sonst meiste Aufrufe
  var prevStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  var prevEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  var prevMonth = monthKey_(prevStart);
  var prevVotes = clipVotes_("clip-" + prevMonth);
  var best = null, bestVotes = 0;
  Object.keys(prevVotes).forEach(function (cid) { if (prevVotes[cid] > bestVotes) { best = cid; bestVotes = prevVotes[cid]; } });
  var winner = null;
  if (best) {
    var c = helix_("clips?id=" + encodeURIComponent(best)).data[0];
    if (c) winner = mapClip_(c);
  }
  if (!winner) winner = monthClips_(id, prevStart, prevEnd, 1)[0] || null;

  return {
    month: month,
    candidates: candidates,
    winner: winner ? { month: prevMonth, clip: winner, votes: bestVotes } : null
  };
}

function clipVote_(clipId, voter) {
  if (!clipId || !validVoter_(voter)) return { error: "Ungültige Stimme" };
  var user = getUser_();
  var ok = clipCandidates_(user.id).some(function (c) { return c.id === String(clipId); });
  if (!ok) return { error: "Dieser Clip steht nicht zur Wahl" };
  if (!storeVote_("clip-" + monthKey_(new Date()), String(voter), String(clipId))) {
    return { error: "Gerade beschäftigt – bitte gleich nochmal versuchen" };
  }
  CacheService.getScriptCache().removeAll(["payload", "twitch"]);
  return getClipOfMonth_(user.id);
}

/**
 * Datensparsamkeit: Nach Saisonende bleiben nur die Top 3 jeder vergangenen Saison
 * (Ruhmeshalle) – alle anderen Zuschauer-Zeilen früherer Jahre werden gelöscht.
 * Läuft automatisch einmal pro Jahr (aus logStream), kann aber auch manuell laufen.
 */
function cleanupOldSeasons() {
  var sh = sheet_(WATCHTIME_SHEET);
  if (!sh || sh.getLastRow() < 2) return;
  var year = new Date().getFullYear();
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
  var vis = visibleSet_();
  var keep = {};
  var byYear = {};
  rows.forEach(function (r, i) {
    var y = Number(r[0]);
    // Ruhmeshalle zeigt nur sichtbare Gazellen → nur deren Bestwerte aufheben
    if (y && y < year && vis[cleanLogin_(r[1])]) (byYear[y] = byYear[y] || []).push({ i: i, minutes: Number(r[3]) || 0 });
  });
  Object.keys(byYear).forEach(function (y) {
    byYear[y].sort(function (a, b) { return b.minutes - a.minutes; })
      .slice(0, HALL_TOP_N).forEach(function (x) { keep[x.i] = true; });
  });
  var kept = rows
    .filter(function (r, i) { var y = Number(r[0]); return !(y && y < year) || keep[i]; })
    // „Zuletzt gesehen“ ist für die Ruhmeshalle nicht mehr nötig
    .map(function (r) { return Number(r[0]) < year ? [r[0], r[1], r[2], r[3], ""] : r; });
  props_().setProperty("CLEANED_YEAR", String(year));
  if (kept.length === rows.length && !rows.some(function (r) { return Number(r[0]) < year && r[4] !== ""; })) return;
  sh.getRange(2, 1, rows.length, 5).clearContent();
  if (kept.length) sh.getRange(2, 1, kept.length, 5).setValues(kept);
}

/** Einmal manuell im Editor ausführen: legt den 5-Minuten-Trigger an. */
function setupTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === "logStream" || fn === "logPlaytime") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("logStream").timeBased().everyMinutes(PLAYTIME_INTERVAL_MIN).create();
}

// ═══════════════════════════════════════════════════════════════════════════
//  Einmalige Twitch-Verbindung (für die Follower-Zahl)
// ═══════════════════════════════════════════════════════════════════════════

function redirectUri_() { return ScriptApp.getService().getUrl(); }

function setupPage_() {
  var state = Utilities.getUuid();
  CacheService.getScriptCache().put("oauth_state", state, 600);
  var url = "https://id.twitch.tv/oauth2/authorize"
    + "?client_id=" + encodeURIComponent(props_().getProperty("TWITCH_CLIENT_ID"))
    + "&redirect_uri=" + encodeURIComponent(redirectUri_())
    + "&response_type=code"
    + "&scope=" + encodeURIComponent("moderator:read:followers moderator:read:chatters")
    + "&state=" + state;
  return HtmlService.createHtmlOutput(
    '<p style="font-family:sans-serif">Mit dem Twitch-Konto <b>' + STREAMER_LOGIN + '</b> verbinden:</p>'
    + '<p><a target="_top" href="' + url + '">Bei Twitch anmelden</a></p>'
    + '<p style="font-family:sans-serif;color:#666">Redirect-URL für die Twitch Developer Console:<br><code>'
    + redirectUri_() + '</code></p>');
}

function oauthCallback_(code, state) {
  var expected = CacheService.getScriptCache().get("oauth_state");
  if (!expected || state !== expected) return HtmlService.createHtmlOutput("Ungültige oder abgelaufene Anfrage. Bitte ?setup=PASSWORT erneut öffnen.");

  var res = UrlFetchApp.fetch("https://id.twitch.tv/oauth2/token", {
    method: "post",
    muteHttpExceptions: true,
    payload: {
      client_id: props_().getProperty("TWITCH_CLIENT_ID"),
      client_secret: props_().getProperty("TWITCH_CLIENT_SECRET"),
      code: code,
      grant_type: "authorization_code",
      redirect_uri: redirectUri_()
    }
  });
  if (res.getResponseCode() !== 200) return HtmlService.createHtmlOutput("Twitch hat die Anmeldung abgelehnt: " + res.getContentText());
  var data = JSON.parse(res.getContentText());

  // Nur das Konto des Streamers darf verbunden werden
  var who = JSON.parse(UrlFetchApp.fetch("https://id.twitch.tv/oauth2/validate", {
    headers: { Authorization: "OAuth " + data.access_token }
  }).getContentText());
  if (String(who.login).toLowerCase() !== STREAMER_LOGIN.toLowerCase()) {
    return HtmlService.createHtmlOutput("Bitte mit dem Konto " + STREAMER_LOGIN + " anmelden (angemeldet war: " + who.login + ").");
  }

  props_().setProperty("TWITCH_REFRESH_TOKEN", data.refresh_token);
  CacheService.getScriptCache().removeAll(["user_token", "payload", "oauth_state"]);
  return HtmlService.createHtmlOutput('<p style="font-family:sans-serif">✅ Verbunden! Die Follower-Zahl erscheint ab jetzt auf der Seite.</p>');
}
