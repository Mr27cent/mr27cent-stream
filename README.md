# Mr27cent – Stream-Seite 🌾

> **Veröffentlichen:** Dieses Repo ist mit Cloudflare Pages verbunden (Projekt `mr27cent`,
> Ausgabeordner `stream`). Jeder Push auf `main` geht automatisch live.
> `apps-script/` und `hangman/` werden nicht veröffentlicht.
>
> | Ordner | Inhalt |
> |---|---|
> | `stream/` | die Webseite (wird veröffentlicht) |
> | `apps-script/` | `Code.gs` fürs Google Apps Script |
> | `hangman/` | Hangman-Overlay für OBS (Schlüssel nur in deiner lokalen Kopie) |

Eigene Stream-Webseite im Savannen-Look mit Live-Dashboard, Clip des Jahres,
Highscores (Hangman & Idle-Game), Streamplan, Spiele-Historie, Emotes,
Über mich / Setup / FAQ / Regeln, Socials, Discord und Tipp-Link –
und **Die Herde**: Jeder Zuschauer wächst mit seiner Zuschauzeit vom Kitz zur Leitgazelle.
Tag/Nacht-Ansicht über den ☀️/🌙-Knopf oben rechts.

Bereiche als Reiter im Seitenmenü links (am Computer über ☰ einklappbar, am Handy aufklappbar).

## Ordner – wichtig beim Hochladen
- **HOCHLADEN** – genau diesen Ordner zu Cloudflare ziehen. Darin ist nur die Webseite.
- **NICHT HOCHLADEN** – diese Anleitung und das Apps Script (`Code.gs`). Gehört nicht ins
  Internet, sonst kann jeder den Aufbau der Seite nachlesen.

## Für Marken & Partner (Media Kit)
Unter `…/#partner` gibt es eine eigene Seite für Sponsoren (nicht im Menü, verlinkt unten
in der Fußzeile und unter „Community“). Texte, Angebote und E-Mail stehen in `config.js`
unter `partner`. Follower und Zuschauerzahl kommen live. `avgViewers` nur ehrlich eintragen.

## Besucherstatistik
Cloudflare Web Analytics (ohne Cookies). Einschalten im Cloudflare-Dashboard:
Workers & Pages → Projekt → *Metriken* → *Web Analytics aktivieren*. Die Sicherheits-Header
in `_headers` erlauben das Messskript bereits.

## Dateien

| Datei | Zweck |
|---|---|
| `config.js` | **Alles, was du selbst anpasst:** Texte, Links, Follower-Ziel, Tipp-Link, Discord |
| `index.html` / `style.css` / `app.js` | Die Seite selbst |
| `apps-script/Code.gs` | Backend (Google Apps Script), holt die Twitch-Daten |
| `overlay.html` | OBS-Overlay: Aufstiegs-Meldungen (nur für `!herde`-Teilnehmer) |
| `savanna.js` / `savanna.css` / `herd-core.js` | Gazellen-Animation (Webseite) & Stufen-Logik (Webseite + Overlay) |
| `manifest.webmanifest` / `sw.js` | Installierbare App & schnelles Laden |

Solange in `config.js` kein `apiUrl` eingetragen ist, zeigt die Seite **Demo-Daten**.
Mit `?demo=offline` hinter der Adresse siehst du die Offline-Ansicht.

## Einrichtung (einmalig, ca. 15 Minuten)

### 1. Twitch-App
1. <https://dev.twitch.tv/console/apps> → Anwendung registrieren (oder die vorhandene vom Boss-Tracker nehmen).
2. **Client-ID** und ein **Client-Secret** notieren.

### 2. Apps Script anlegen
1. Im Google Sheet: *Erweiterungen → Apps Script* (oder ein neues Projekt auf <https://script.google.com>).
2. Inhalt von `apps-script/Code.gs` hineinkopieren.
3. *Projekteinstellungen → Skripteigenschaften* hinzufügen:
   - `TWITCH_CLIENT_ID`
   - `TWITCH_CLIENT_SECRET`
   - `SPREADSHEET_ID` (die lange ID aus der Sheet-URL)
   - `SETUP_KEY` (ein selbst ausgedachtes, langes Passwort – schützt die Einrichtungsseite)
4. *Bereitstellen → Neue Bereitstellung → Web-App*: „Ausführen als: Ich“, „Zugriff: Jeder“.
5. Die Web-App-URL (endet auf `/exec`) in `config.js` bei `apiUrl` eintragen.

### 3. Twitch-Konto verbinden (Follower-Zahl & Herde)
Twitch gibt die Follower-Zahl und die Liste der Zuschauer im Chat nur mit dem Konto des Streamers heraus:
1. Die Web-App-URL mit `?setup=DEIN-SETUP_KEY` am Ende öffnen.
2. Die dort angezeigte Redirect-URL in der Twitch Developer Console bei *OAuth Redirect URLs* eintragen.
3. Auf „Bei Twitch anmelden“ klicken und mit **mr27cent** anmelden. Fertig.

### 4. Spielzeit & Zuschauzeit automatisch mitschreiben
Im Apps-Script-Editor die Funktion `setupTrigger` einmal ausführen. Ab dann läuft alle
5 Minuten während eines Streams `logStream`:
- Spielzeit pro Kategorie → Blatt `SPIELZEIT`
- Zuschauzeit pro Zuschauer und Jahr → Blatt `ZUSCHAUZEIT`
  (*Jahr | Login | Name | Minuten | Zuletzt gesehen*; Bots stehen in `IGNORE_USERS`)

Gezählt wird, wer eingeloggt im Chat ist – auch stille Mitleser. Möchte jemand nicht
erfasst werden, den Namen in `IGNORE_USERS` (Code.gs) eintragen und die Zeilen im Blatt löschen. Am 1. Januar beginnt
automatisch eine neue Saison. Stufen und Maximum (1.000 h) stehen in `config.js` unter `herd`. Ältere Spiele kannst du dort von Hand nachtragen
(Spalten: *Spiel | Minuten | Zuletzt gespielt | Game-ID* – die ID darf leer bleiben).

### 5. Highscores
Die Seite liest die Blätter `HANGMAN` und `IDLE` (Zeile 1 = Überschrift):

| Name | Punkte | Datum | Info (optional, z. B. „Level 48“) |
|---|---|---|---|

Sortiert wird automatisch, angezeigt werden die Top 10.
*Wie die Spiele ihre Punkte dorthin schreiben, hängt davon ab, wo Hangman und das
Idle-Game laufen – das klären wir noch.*

### 6. Abstimmung
Blatt `UMFRAGE` anlegen (Zeile 1 = Überschrift):

| ID | Frage | Antworten | Aktiv |
|---|---|---|---|
| naechstes-spiel | Was soll ich als Nächstes spielen? | Silksong \| Lies of P \| Stardew Valley | TRUE |

Angezeigt wird die unterste Zeile mit `Aktiv = TRUE`. Für eine neue Umfrage einfach
eine neue Zeile mit neuer ID anlegen. Die Stimmen landen automatisch im Blatt `STIMMEN`
(eine Stimme pro Gerät).

### 7. Aufstiege im Stream (OBS-Overlay)
In OBS eine **Browserquelle** hinzufügen:
- URL: `https://mr27cent.pages.dev/overlay.html`
- Breite × Höhe: `1920 × 300`, oben ins Bild (oder mit `?pos=bottom` unten)
- Hintergrund ist durchsichtig; zwischen den Meldungen ist nichts zu sehen.

Es laufen **keine Gazellen** durchs Bild. Eingeblendet wird nur „🎉 Name ist aufgestiegen!“ –
und zwar **nur für Zuschauer, die per `!herde` sichtbar sein wollen**. Lurker erscheinen nie.
Mit `?demo=1` gibt es eine Vorschau mit Beispiel-Meldungen.

### 8. Chat-Befehle `!herde` und `!gazelle`
**Lurker-Schutz:** Alle Zuschauer grasen erst einmal **anonym** mit (namenlose Gazelle).
Mit Namen erscheint nur, wer selbst `!herde` schreibt (`!herde aus` = wieder anonym).
Die Liste steht im Blatt `SICHTBAR` (wird automatisch angelegt).

**Nightbot** (`URL` = deine Web-App-URL):
```
!addcom !herde $(urlfetch URL?cmd=herde&user=$(user)&query=$(querystring))
```

#### `!gazelle`
Antwortet z. B. „🦌 Wüstenfuchs ist Stufe 21/27 „Abendrot-Gazelle“ mit 380 h …“.
`!gazelle Name` zeigt die Gazelle von jemand anderem – aber nur, wenn diese Person per
`!herde` sichtbar ist. Über anonyme Gazellen gibt der Befehl nichts preis.

**Nightbot** (im Chat als Mod eingeben, `URL` = deine Web-App-URL):
```
!addcom !gazelle $(urlfetch URL?cmd=gazelle&user=$(user)&query=$(querystring))
```
**Streamer.bot:** Aktion mit Sub-Action *Fetch URL* auf
`URL?cmd=gazelle&user=%user%&query=%rawInput%`, Ergebnis per *Send Message* in den Chat.

Die Stufen-Namen stehen für den Befehl zusätzlich in `apps-script/Code.gs`
(`HERD_STAGES`) – bei Änderungen in `config.js` dort mit anpassen.

### 9. Link-Vorschau & App
- Die Link-Vorschau zeigt auf `https://mr27cent.pages.dev`. Bei einer eigenen Domain
  in `index.html` bei `og:url` und `og:image` die neue Adresse eintragen.
- Die Seite lässt sich als App installieren (Knopf unten im Seitenmenü). Nach größeren
  Änderungen in `sw.js` die `VERSION` erhöhen und in `index.html` / `overlay.html` die Endung `?v=…` hinter den CSS- und JS-Dateien auf dieselbe Zahl setzen – sonst zeigen Browser noch die alte Gestaltung zum neuen Inhalt.

## Weitere Bereiche
- **Rätsel** (Reiter „Mitmachen“): drei tägliche Rätsel, für alle dieselben –
  **Wort des Tages** (Hangman mit Löwen-Jagd), **Wordle** (5 Buchstaben, 6 Versuche) und
  **Emotle** (verpixeltes Kanal-Emote erraten). Code in `raetsel.js`, Wortlisten in
  `raetsel.json` (Hangman: `wotd`, Wordle-Lösungen: `wordle`). `wordle-woerter.json` sind
  die erlaubten Rate-Wörter – unbekannte Wörter nimmt das Spiel nach zweimal ⏎ trotzdem.
  Emotle nimmt automatisch alle Kanal-Emotes (mindestens 4). Listen am besten nachts
  ändern: Jede Änderung kann das Rätsel des laufenden Tages austauschen.
- **Serien-Bestenliste**: Wer seinen Twitch-Namen einträgt, kommt in die Liste der längsten
  Serien pro Rätsel (Blatt `SERIEN`, wird automatisch angelegt). Die Seite schickt nur die
  Tipps, das Apps Script prüft selbst, ob das Rätsel gelöst wurde, und zählt die Serie.
  Einen Namen bekommt das Gerät, das ihn zuerst einträgt. Unpassende Namen: Zeile im Blatt löschen.
  Nach dem Einspielen der neuen `Code.gs`: im Editor einmal `testRaetsel` ausführen
  (Berechtigung „externe Anfragen“ erlauben), dann *Bereitstellen → Bereitstellungen verwalten →
  Bearbeiten → Version: Neue Version*. Die Web-App-URL bleibt dabei gleich.
  Bei eigener Domain in `Code.gs` `SITE_URL` anpassen.
- **Meilensteine**: in `config.js` unter `milestones` eintragen.
- **Jahresrückblick**: wird automatisch aus Herde, Clips, Spielen und Highscores
  berechnet; per Knopf entsteht ein Story-Bild (1080 × 1920) zum Teilen.
- **Ruhmeshalle** (Reiter „Die Herde“): die Top 3 jeder vergangenen Saison, automatisch.
- **Clip des Monats** (Reiter „Clips“): Abstimmung über die Top-Clips des laufenden
  Monats; der Gewinner des Vormonats wird oben gezeigt (Stimmen im Blatt `STIMMEN`).
- **Savannen-Geräusche** (🔇/🔊 oben rechts): werden live im Browser erzeugt –
  tagsüber Wind und Vögel, nachts Wind und Grillen.

## Impressum
In `index.html` stehen im Impressum noch Platzhalter in eckigen Klammern –
bitte eigene Angaben eintragen, bevor die Seite öffentlich geht.

## Sicherheit & Datenschutz
- `_headers` setzt bei Cloudflare strenge Sicherheits-Header (u. a. Content-Security-Policy:
  nur eigene Skripte, Daten nur von Google, Bilder & Videos nur von Twitch).
- Nach Saisonende werden die Zuschauer-Daten des Vorjahres automatisch gelöscht –
  nur die Top 3 bleiben für die Ruhmeshalle (`cleanupOldSeasons`).
- Das Google Sheet **nicht öffentlich freigeben**; Client-Secret und Token liegen nur in
  den Skripteigenschaften.

## Datenschutz (Einwilligung)
Ohne Einwilligung lädt die Seite nichts von Twitch oder Google.
Twitch-Player, Chat und Clip-Videos laden zusätzlich erst nach einem Klick.
Schriften sind lokal eingebunden.
