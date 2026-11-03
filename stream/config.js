/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EINSTELLUNGEN – hier kannst du alles anpassen, ohne den Code zu berühren.
 *  Felder mit "TODO" sind Platzhalter, die noch ausgefüllt werden müssen.
 * ═══════════════════════════════════════════════════════════════════════════
 */
window.STREAM_CONFIG = {

  streamer: "mr27cent",
  displayName: "Mr27cent",
  tagline: "Willkommen in der Savanne!",

  // URL der Apps-Script-Web-App (siehe README.md).
  // Leer lassen = Demo-Modus mit Beispieldaten.
  apiUrl: "https://script.google.com/macros/s/AKfycbysZsOJ8Uk_01aqrhaje84PEMDjHCKsxsarFInhH3PDn9HqP2XS367OWrdwl5sR9dr4hg/exec",

  // Realistische Hintergrundbilder (Tag / Nacht). Leer = gezeichnete Landschaft.
  // Bilder in den Ordner stream/img/ legen, z. B. "img/savanne-tag.jpg"
  backgroundImages: {
    day: "img/savanne-tag.jpg",
    night: "img/savanne-nacht.jpg"
  },

  // Wie oft die Live-Daten neu geladen werden (Sekunden)
  refreshSeconds: 60,

  // Follower-Ziel für den Fortschrittsbalken
  followerGoal: {
    target: 10000,
    label: "Follower-Ziel"
  },

  // Die Herde: Jeder Zuschauer startet als Kitz und wächst mit seiner
  // Zuschauzeit. maxHours = ausgewachsen. Jedes Jahr beginnt eine neue Saison.
  herd: {
    maxHours: 1000,
    // Beliebig viele Stufen möglich – einfach Zeilen ergänzen/ändern.
    // WICHTIG: Der Chat-Befehl !gazelle hat dieselbe Liste in apps-script/Code.gs
    // (HERD_STAGES) – bei Änderungen dort genauso anpassen.
    stages: [
      { hours: 0,    name: "Neugeborenes Kitz" },
      { hours: 1,    name: "Wackelbeinchen" },
      { hours: 3,    name: "Grashalm-Knabberer" },
      { hours: 5,    name: "Kitz" },
      { hours: 8,    name: "Neugieriges Kitz" },
      { hours: 12,   name: "Pfützenspringer" },
      { hours: 17,   name: "Halmhüpfer" },
      { hours: 23,   name: "Jährling" },
      { hours: 30,   name: "Staubaufwirbler" },
      { hours: 40,   name: "Akazienschatten-Kenner" },
      { hours: 50,   name: "Junggazelle" },
      { hours: 65,   name: "Wasserloch-Stammgast" },
      { hours: 80,   name: "Steppenflitzer" },
      { hours: 100,  name: "Morgentau-Sprinter" },
      { hours: 125,  name: "Kleine Hörner" },
      { hours: 150,  name: "Savannenspringer" },
      { hours: 185,  name: "Dornbusch-Slalomer" },
      { hours: 225,  name: "Herdenmitglied" },
      { hours: 270,  name: "Spurenleser" },
      { hours: 320,  name: "Windschnell" },
      { hours: 380,  name: "Abendrot-Gazelle" },
      { hours: 450,  name: "Löwenschreck" },
      { hours: 530,  name: "Graslandwächter" },
      { hours: 620,  name: "Wächter der Herde" },
      { hours: 720,  name: "Sternenhimmel-Gazelle" },
      { hours: 850,  name: "Weise der Savanne" },
      { hours: 1000, name: "Universumsgazelle" }
    ],
    // Aussehen der Gazellen: jede Stufe hat ein eigenes Bild (freigestellt,
    // Blick nach rechts). Fehlt eins, gilt das Bild der letzten Stufe davor.
    looks: [
      { fromStage: 1,   img: "img/gazelle/stage-01.webp" },
      { fromStage: 2,   img: "img/gazelle/stage-02.webp" },
      { fromStage: 3,   img: "img/gazelle/stage-03.webp" },
      { fromStage: 4,   img: "img/gazelle/stage-04.webp" },
      { fromStage: 5,   img: "img/gazelle/stage-05.webp" },
      { fromStage: 6,   img: "img/gazelle/stage-06.webp" },
      { fromStage: 7,   img: "img/gazelle/stage-07.webp" },
      { fromStage: 8,   img: "img/gazelle/stage-08.webp" },
      { fromStage: 9,   img: "img/gazelle/stage-09.webp" },
      { fromStage: 10,  img: "img/gazelle/stage-10.webp" },
      { fromStage: 11,  img: "img/gazelle/stage-11.webp" },
      { fromStage: 12,  img: "img/gazelle/stage-12.webp" },
      { fromStage: 13,  img: "img/gazelle/stage-13.webp" },
      { fromStage: 14,  img: "img/gazelle/stage-14.webp" },
      { fromStage: 15,  img: "img/gazelle/stage-15.webp" },
      { fromStage: 16,  img: "img/gazelle/stage-16.webp" },
      { fromStage: 17,  img: "img/gazelle/stage-17.webp" },
      { fromStage: 18,  img: "img/gazelle/stage-18.webp" },
      { fromStage: 19,  img: "img/gazelle/stage-19.webp" },
      { fromStage: 20,  img: "img/gazelle/stage-20.webp" },
      { fromStage: 21,  img: "img/gazelle/stage-21.webp" },
      { fromStage: 22,  img: "img/gazelle/stage-22.webp" },
      { fromStage: 23,  img: "img/gazelle/stage-23.webp" },
      { fromStage: 24,  img: "img/gazelle/stage-24.webp" },
      { fromStage: 25,  img: "img/gazelle/stage-25.webp" },
      { fromStage: 26,  img: "img/gazelle/stage-26.webp" },
      { fromStage: 27,  img: "img/gazelle/stage-27.webp" }
    ],
    // Hintergrund der animierten Savanne (ohne Tiere). Leer = normaler Hintergrund.
    sceneImages: {
      day: "img/savanne-leer-tag.jpg",
      night: ""        // TODO: leeres Nachtbild fehlt noch
    },
    // Live-Savanne: max. so viele Gazellen laufen beim Stream durchs Bild
    liveMax: 24
  },

  // Meilensteine (neueste unten), icon = Emoji
  // Datum als JJJJ-MM-TT oder nur JJJJ-MM (dann „Mai 2019“). Ohne Datum = „Demnächst“.
  milestones: [
    { date: "2014-08-05", icon: "🌱", title: "Der allererste Stream",
      text: "Der Startschuss – noch ganz klein, aber mit viel Neugier." },
    { date: "2019-05",    icon: "🚀", title: "Offizieller Start",
      text: "Ab jetzt regelmäßig live – die Savanne nimmt Form an." },
    { date: "2019-07",    icon: "🤝", title: "Twitch-Affiliate",
      text: "Nur zwei Monate später: Affiliate! Danke an alle, die von Anfang an dabei waren." },
    { date: "",           icon: "💜", title: "Twitch-Partner",
      text: "Coming soon – gemeinsam schaffen wir das! 🦌" }
  ],

  // Abstimmungen: Frage & Antworten stehen im Google Sheet (Blatt UMFRAGE, siehe README)

  // Highscore-Spiele: Schlüssel muss zu HIGHSCORE_SHEETS im Apps Script passen
  highscoreGames: [
    { key: "hangman", title: "Hangman",   icon: "🔤", scoreLabel: "Punkte" },
    { key: "idle",    title: "Sammelspiel", icon: "🦁", scoreLabel: "Legenden-Punkte",
      playUrl: "https://leafy-sunflower-179513.netlify.app" }
  ],

  // ── Für Marken & Partner (Media Kit) – erreichbar unter …/#partner ────
  // Diesen Link kannst du in Sponsoren-Mails mitschicken. Follower und Herde
  // kommen live von Twitch, alles andere steht hier.
  partner: {
    email: "mr27cent@gmail.com",          // TODO: später z. B. kontakt@mr27cent.de
    headline: "Rocket League & Elden Ring. Eigene Show-Formate. Eine Community, die mitspielt.",
    intro: "Ich bin Mr27cent und streame seit Mai 2019 regelmäßig auf Twitch – auf Deutsch, chillig, kreativ und mit trockenem Humor. Meine Hauptspiele: Rocket League und Elden Ring – dazu selbst entwickelte Event-Formate mit anderen Streamern und eine Community, die über Spiele, Rätsel und die Herde direkt Teil des Kanals ist.",
    // Ø Zuschauer werden automatisch gemessen (Blatt ZUSCHAUER) und nach 2 Wochen angezeigt.
    // Nur falls du vorher schon einen Wert zeigen willst (z. B. aus TwitchTracker), hier eintragen.
    avgViewers: "",
    facts: [
      { icon: "🗓️", label: "Regelmäßig live seit", value: "Mai 2019", hint: "erster Stream 2014 · Affiliate seit Juli 2019" },
      { icon: "🇩🇪", label: "Sprache", value: "Deutsch", hint: "Zielgruppe DACH" },
      // auto: "streams" → wird nach 2 Wochen Messung durch die echten Werte ersetzt
      { icon: "📆", label: "Streams", value: "ca. 4× / Woche", hint: "sonntags lange Streams", auto: "streams" }
    ],
    highlights: [
      { icon: "🎮", title: "Rocket League & Elden Ring",
        text: "Meine Hauptspiele: Rocket League mit Ranked, Community-Matches und Turnieren – und Elden Ring mit Bosskämpfen, bei denen der Chat mitfiebert." },
      { icon: "🏆", title: "Turniere & eSports",
        text: "Eigene Rocket-League-Community-Turniere und mit Team BOPFARMY im DFB eSports Rival Rush." },
      { icon: "🎭", title: "Eigene Show-Formate",
        text: "Selbst entwickelte Multi-Streamer-Events wie „Der Dümmste fliegt“, „Impostor“ oder „Schätz ärgere dich nicht“." },
      { icon: "🦌", title: "Interaktive Community",
        text: "Die Herde, das Sammelspiel und tägliche Rätsel: Zuschauer sammeln, spielen und wachsen mit dem Kanal." }
    ],
    offers: [
      "Turnier „powered by“ deiner Marke – mit Logo im Overlay und auf dieser Seite",
      "Ehrlicher Praxistest im Stream, z. B. Peripherie oder Setup",
      "Gewinnspiele und Aktionen mit der Community",
      "Integration in eigene Show-Formate und Overlays",
      "Kurzvideos auf TikTok und YouTube Shorts"
    ],
    contactText: "Du hast eine Idee für eine Zusammenarbeit? Schreib mir – ich melde mich in der Regel innerhalb von zwei Tagen."
  },

  // Tipp-Link
  tipUrl: "https://www.tipeeestream.com/mr27cent1/donation",
  tipText: "Wenn dir der Stream gefällt, freue ich mich riesig über einen kleinen Tipp. Jeder Beitrag fließt direkt in den Stream – danke! 🧡",

  // Discord – beides leer = Discord-Karte ausgeblendet. Zum Aktivieren:
  // inviteUrl (Einladungslink, „Läuft nie ab“) und optional serverId
  // (Servereinstellungen → Widget → „Server-Widget aktivieren“). Mit serverId
  // außerdem in _headers „https://discord.com“ bei connect-src ergänzen
  // und Discord in Einwilligungstext und Datenschutzerklärung (index.html) nennen.
  discord: {
    serverId: "",
    inviteUrl: ""
  },

  // Social Links – leere URLs werden ausgeblendet
  socials: [
    { name: "Twitch",    url: "https://www.twitch.tv/mr27cent",        icon: "twitch" },
    { name: "YouTube",   url: "https://www.youtube.com/@Mr27centoitver", icon: "youtube" },
    { name: "Instagram", url: "https://www.instagram.com/mr27cent",    icon: "instagram" },
    { name: "TikTok",    url: "https://www.tiktok.com/@mr27cent",      icon: "tiktok" }
  ],

  // ── Texte ─────────────────────────────────────────────────────────────
  about: [
    "Hey, ich bin Mr27cent – 36 Jahre jung und seit 2014 mit Herzblut auf Twitch unterwegs.",
    "Am liebsten streame ich Events – die Momente, in denen der Chat mitfiebert und wir gemeinsam etwas erleben.",
    "Mein Ziel? Die Herde wachsen lassen und gemeinsam Schritt für Schritt größer werden – bis hin zum Twitch-Partner. Schön, dass du da bist: Schnapp dir einen Platz im Gras! 🦌"
  ],

  setup: [
    { label: "Prozessor",   value: "AMD Ryzen 7 5800X" },
    { label: "Grafikkarte", value: "Gigabyte RTX 3070 Vision OC (8 GB)" },
    { label: "Mainboard",   value: "ASUS ROG Strix B550-F Gaming" },
    { label: "Arbeitsspeicher", value: "HyperX 2 × 16 GB DDR4-3200" },
    { label: "SSDs",        value: "Crucial P5 1 TB (NVMe) · Samsung 870 QVO 1 TB" },
    { label: "Kühlung",     value: "be quiet! Pure Loop 240 mm" },
    { label: "Netzteil",    value: "be quiet! Pure Power 11, 600 W" },
    { label: "Gehäuse",     value: "Thermaltake V200 TG RGB" }
  ],

  faq: [
    { q: "Wann streamst du?",            a: "Schau in den Streamplan – oder folge auf Twitch, dann bekommst du eine Benachrichtigung." },
    { q: "Was ist die Herde?",           a: "Jeder Zuschauer ist eine Gazelle, die mit der Zuschauzeit wächst – vom Kitz bis zur ausgewachsenen Gazelle bei 1.000 Stunden. Jedes Jahr startet die Herde neu." },
    { q: "Werde ich angezeigt, wenn ich nur lurke?", a: "Nein. Deine Gazelle bleibt anonym, bis du im Chat !herde schreibst. Mit !herde aus wirst du wieder unsichtbar." },
    { q: "Wie sehe ich meine Gazelle?",  a: "Schreib !gazelle im Chat – dann siehst du deine Stufe und die Zeit bis zum nächsten Aufstieg." },
    { q: "Wie funktioniert Hangman?",    a: "Im Stream wird ein Wort gesucht. Mit !e rätst du den Buchstaben E, mit !wort HAUS das ganze Wort. Jeder richtige Buchstabe bringt Punkte, wer das Wort löst, bekommt einen Bonus – je früher, desto mehr. Nach einem Fehler hast du 10 Sekunden Pause." },
    { q: "Wie funktioniert das Sammelspiel?", a: "Melde dich auf der Spielseite mit Twitch an. Während du den Stream schaust, sammelst du automatisch Punkte, kaufst Gebäude und schaltest neue Phasen frei – für Sterne steigst du in der Rangliste auf." },
    { q: "Was sind die Herden-Karten?", a: "Ab dem 1. Januar 2027 sammelst du 150 Karten in 6 Seltenheiten – jede auch als seltenes Shiny. Zum Start gibt es 3 Starter-Packs, jede Woche ein Gratis-Pack (Subs zwei), alle 2 Stunden Zuschauzeit automatisch ein Zuschau-Pack und Packs für Kanalpunkte. Je größer deine Gazelle, desto besser deine Chancen. Doppelte Karten kannst du tauschen." }
  ],

  // Herden-Karten (#karten, karten.js): Supabase-Projekt des Kartenspiels.
  // Der „publishable“ Schlüssel ist für den Browser gedacht – was erlaubt ist,
  // entscheidet die Datenbank (Login mit Twitch über Supabase Auth).
  cards: {
    supabaseUrl: "https://pgqpgvtscyxpghspnhdw.supabase.co",
    supabaseKey: "sb_publishable_oTKhGpPBjcy35AM_m_mm_A_-EKfpo_X"
  },

  rules: [
    "Sei nett zueinander – Respekt geht vor.",
    "Kein Spam, keine Werbung ohne Erlaubnis.",
    "Keine Spoiler ohne Nachfrage.",
    "Kein Backseating, außer es ist ausdrücklich erwünscht.",
    "Die Mods haben das letzte Wort."
  ]
};
