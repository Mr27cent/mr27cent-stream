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
- **Hauptspiele:** Rocket League & Elden Ring.

## Offen
- Impressum füllt der Nutzer selbst (Text ggf. einfügen, wenn er ihn schickt).
- „ca. 4× / Woche“ im Media Kit wird nach 2 Wochen Messung automatisch ersetzt.

## Ideen (noch nicht beauftragt)
Rocket-League-Rang live (Supabase-Edge-Function `rl-ranks` existiert), „Die Große Wanderung“,
Event-Seiten, Kalender-Abo, Löwenalarm, Orakel, Gazellen-Garderobe.
