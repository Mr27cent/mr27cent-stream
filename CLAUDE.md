# Hinweise für Claude

- **Immer auf Deutsch antworten.** Nutzer: Mr27cent (Twitch-Streamer, keine Programmierkenntnisse).
  Schritte einfach erklären, Seiten, die er besuchen muss, direkt verlinken. Keine Fakten über ihn erfinden.
- **Veröffentlichen:** Push auf `main` → Cloudflare Pages (Projekt `mr27cent`, Ausgabeordner `stream`)
  geht automatisch live: https://mr27cent.pages.dev/
- **Cache-Busting:** Bei Änderungen an CSS/JS die Versionsnummer `?v=N` in `stream/index.html`
  und `stream/overlay.html` **und** `VERSION` in `stream/sw.js` gemeinsam erhöhen.
- **Backend:** `apps-script/Code.gs` (Google Apps Script + Google Sheet). Änderungen dort muss der
  Nutzer selbst ins Apps Script kopieren und unter „Bereitstellen → Bereitstellungen verwalten“ neu
  bereitstellen – ihm danach genau sagen, was zu tun ist.
- **Sicherheit:** Niemals Schlüssel/Tokens/Passwörter ins Repo oder in den Chat holen
  (Twitch Client-Secret, SETUP_KEY, HANGMAN_KEY). `SYNC_KEY` in `hangman/` bleibt im Repo leer.
- **Lurker-Schutz:** Namen erscheinen nur bei Zuschauern, die im Chat `!herde` geschrieben haben
  (Rangliste, Savanne, Ruhmeshalle, Overlay). Zuschauzeit aller wird trotzdem gespeichert.
- **Sammelspiel** (Idle-Game): Rangliste kommt per Supabase-RPC `get_leaderboard`
  (Projekt `pgqpgvtscyxpghspnhdw`, Frankfurt). Datenschutz-Abschnitt 8 erwähnt das.
- **Aufbau Webseite:** Reiter dashboard / herd / karten / play / clips / about (alte Hash-Links in `MOVED`
  in `app.js` umgeleitet). Texte & Links zentral in `stream/config.js`. Media Kit unter `#partner`.
- **Herden-Karten** (Sammelkarten, Start 01.01.2027): Reiter `#karten` = `stream/karten.js` + `karten.css`,
  Direktlink `#karten/@name`. Alles läuft über Supabase-RPCs `cards_*` im selben Projekt wie das
  Sammelspiel (Login mit Twitch über Supabase Auth, Redirect-URL `https://mr27cent.pages.dev/**`
  ist eingetragen). Regeln stehen nur in der Datenbank. Zuschauzeit + Kanalpunkte: Edge Function
  `cards-tick` (eigener Cron, `twitch-tick` des Sammelspiels bleibt unberührt). Konzept, Stand und
  Migrationen liegen beim Nutzer unter `Desktop\Mal schauen` (`Kartenspiel-Konzept.md`).
  Lurker-Schutz: Ein Album ist erst öffentlich, wenn die Person Karten hat; Datenschutz-Abschnitt 9.
  Weitere Dateien: `karten-sound.js` (Klänge per Web Audio, eigene Dateien über `config.js → cards.sounds`),
  OBS-Overlay `karten-overlay.html/.js/.css` (Legendary/Mythic/Shiny, RPC `cards_overlay_feed`, `?demo=1`).
  Datenbank-Migrationen + Edge Function `cards-tick` liegen unter `supabase/` (nur Backup, Supabase-Projekt
  `pgqpgvtscyxpghspnhdw`; Änderungen dort per Migration einspielen und hier ablegen).
  Karten-Modell (seit 04.11.2026): keine Platzhalter mehr – die Kartenzahl wächst mit der Herde (Stand 09.11.: 94 = 34 Herde + 20 Tiere + 40 Setup), **jede Karte in allen 6 Seltenheiten + Shiny**; Seltenheit steht an der
  gezogenen Version (`S1-017-L`), nicht im Katalog. Album = 1 Platz pro Karte, zeigt seltenste oder ausgerüstete Version.
  Karten sind `person` (Twitch-Profilbild, nur mit Zustimmung der Person; `cards-tick` holt es) oder `item`.
  **Album-Nummer ≠ Karten-ID:** `number` (Album-Platz) ist frei verschiebbar, die ID `S1-xxx` bleibt fest (Fremdschlüssel!).
  Eintragen/ändern: `cards_admin_set_card(nr, kind, name, login, image, flavor)` (sucht nach Album-Nummer). Spalte `category`
  (herd/animal/setup/event) steuert Errungenschaften. Belegung: #001 Mr27cent, danach alle `!herde`-Sichtbaren nach
  Zuschauzeit (Liste aus `herd.members` der Apps-Script-API, Feld `name`), **immer vor allen Items**, dann 20 Tiere, dann 40 Setup.
  **Neue Herdenmitglieder:** Wenn der Nutzer sagt „aktualisieren“, neue `!herde`-Leute per `cards_admin_add_person(login, name)`
  hinzufügen – sie kommen hinter die letzte Herden-Karte, alle Items rücken eins nach hinten. Event-Karten liegen ab #901 (`kind = 'event'`, nicht in Packs, eigenes Event-Album, zählen nicht zur Sammlung;
  tauschbar als Einzelstück mit Tausch-Zähler in `cards_event_copies`, nicht hochstufbar),
  Events in `cards_events` (z. B. `stream1-2027`: 30 min im 1. Stream 2027 → Karte mit zufälliger Seltenheit; `cards-tick` v4 gibt die Stream-ID mit).
  Tauschen: jede Version (auch die letzte), gleiche Seltenheit, keine Shinys. Migration `20261105_cards_events_trades.sql`.
  **Ende Dezember 2026 neu sortieren** (Zuschauzeit Jahresende, neue `!herde`-Leute dazu) – vor dem Start.
  Hochstufen: 3 gleiche Versionen → 1 eine Seltenheit höher (2 werden verbraucht, 1 bleibt), RPC `cards_upgrade`/`cards_web_upgrade`.
  Errungenschaften (Steam-artig, mit % der Sammler): Tabellen `cards_achievements` + `cards_achievement_unlocks`,
  Zahlen aus `cards_player_stats`, freischalten per `cards_ach_sync`. „Deine Karte wurde gezogen“: `cards_card_stats`.
  Common-Farbe = Sandbraun. Migration `supabase/migrations/20261104_cards_upgrade_achievements.sql`.
  Testphase: Tester `mr27cent` wurde am 09.11.2026 auf 0 gesetzt (Migration `20261109_cards_herd_first.sql`) – vor dem 01.01.2027 alle Karten/Packs/Zuschauzeit sowie `cards_upgrades` + `cards_achievement_unlocks` zurücksetzen.
- **Hauptspiele:** Rocket League & Elden Ring.

## Offen
- Impressum füllt der Nutzer selbst (Text ggf. einfügen, wenn er ihn schickt).
- „ca. 4× / Woche“ im Media Kit wird nach 2 Wochen Messung automatisch ersetzt.

## Ideen (noch nicht beauftragt)
Rocket-League-Rang live (Supabase-Edge-Function `rl-ranks` existiert), „Die Große Wanderung“,
Event-Seiten, Kalender-Abo, Löwenalarm, Orakel, Gazellen-Garderobe.
