/* ═══════════════════════════════════════════════════════════════════════════
 *  „Für Marken & Partner“ (Media Kit) – Reiter #partner, nicht im Menü.
 *  Texte aus config.js → partner, Follower & Herde live aus den Twitch-Daten.
 * ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var U = window.StreamUtil;
  var CFG = U.CFG, $ = U.$, esc = U.esc, fmtNum = U.fmtNum;
  var P = CFG.partner;
  if (!P || !$("partner")) return;

  function stat(icon, label, value, hint) {
    return '<div class="card stat"><span class="stat-icon" aria-hidden="true">' + icon + "</span>"
      + '<div class="stat-label">' + esc(label) + "</div>"
      + '<div class="stat-value small">' + esc(value) + "</div>"
      + (hint ? '<div class="stat-hint">' + esc(hint) + "</div>" : "") + "</div>";
  }

  function mailLink() {
    return "mailto:" + P.email + "?subject=" + encodeURIComponent("Kooperationsanfrage für " + CFG.displayName);
  }

  function renderStats(d) {
    var live = [];
    var followers = d && d.followers != null ? fmtNum(d.followers) : "–";
    live.push(stat("🐾", "Follower auf Twitch", followers, d && d.followers != null ? "live von Twitch" : null));
    // Echte Zahlen der letzten 30 Tage – erst zeigen, wenn mindestens 2 Wochen gemessen wurde
    var cs = d && d.channelStats;
    var measured = cs && cs.since && cs.samples && (Date.now() - new Date(cs.since).getTime()) >= 14 * 864e5;
    if (measured && cs.avgViewers != null) {
      live.push(stat("👀", "Ø Zuschauer", fmtNum(cs.avgViewers), "letzte 30 Tage · Spitze " + fmtNum(cs.peakViewers)));
    } else if (P.avgViewers) {
      live.push(stat("👀", "Ø Zuschauer", String(P.avgViewers), "pro Stream"));
    }
    var facts = (P.facts || []).map(function (f) {
      // „Streams pro Woche“ aus den echten Daten, sobald genug gemessen wurde
      if (f.auto === "streams" && measured && cs.streams) {
        return stat(f.icon, f.label, "ca. " + fmtNum(Math.max(1, Math.round(cs.streams / 30 * 7))) + "× / Woche",
          fmtNum(Math.round(cs.hours)) + " Stunden live in den letzten 30 Tagen");
      }
      return stat(f.icon, f.label, f.value, f.hint);
    });
    $("partner-stats").innerHTML = live.concat(facts).join("");
  }

  function renderStatic() {
    $("partner-headline").textContent = P.headline;
    $("partner-intro").textContent = P.intro;
    $("partner-contact-text").textContent = P.contactText;
    $("partner-mail-text").textContent = P.email;
    $("partner-to-form").onclick = function () {
      $("partner-contact").scrollIntoView({ behavior: "smooth", block: "start" });
      setTimeout(function () { $("partner-form").elements.name.focus({ preventScroll: true }); }, 400);
    };
    $("partner-copy").onclick = function () {
      var btn = this;
      var done = function () { btn.textContent = "✅ Kopiert!"; setTimeout(function () { btn.textContent = "Adresse kopieren"; }, 2000); };
      if (navigator.clipboard) navigator.clipboard.writeText(P.email).then(done, function () { window.prompt("Kopieren:", P.email); });
      else window.prompt("Kopieren:", P.email);
    };
    $("partner-tracker").href = "https://twitchtracker.com/" + encodeURIComponent(CFG.streamer);

    $("partner-highlights").innerHTML = (P.highlights || []).map(function (h) {
      return '<div class="card partner-card"><span class="partner-icon" aria-hidden="true">' + esc(h.icon) + "</span>"
        + "<h3>" + esc(h.title) + "</h3><p>" + esc(h.text) + "</p></div>";
    }).join("");

    $("partner-offers").innerHTML = (P.offers || []).map(function (o) {
      return "<li>" + esc(o) + "</li>";
    }).join("");

    $("partner-socials").innerHTML = (CFG.socials || []).filter(function (s) { return s.url; }).map(function (s) {
      return '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.name) + "</a>";
    }).join(" · ");

    renderStats(U.data);
  }

  // ── Kontaktformular → Apps Script (Mail an Mr27cent + Zeile im Blatt ANFRAGEN) ──
  function voterId() {
    var id = null;
    try { id = JSON.parse(localStorage.getItem("stream_voter_id") || "null"); } catch (e) {}
    if (!id) {
      id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();
      try { localStorage.setItem("stream_voter_id", JSON.stringify(id)); } catch (e) {}
    }
    return id;
  }

  function initForm() {
    var form = $("partner-form"), status = $("partner-status"), busy = false;
    function show(msg, ok) {
      status.textContent = msg;
      status.className = "pf-status" + (ok ? " ok" : " err");
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (busy) return;
      var f = form.elements;
      var data = { name: f.name.value.trim(), company: f.company.value.trim(), email: f.email.value.trim(),
                   message: f.message.value.trim(), website: f.website.value };
      if (data.name.length < 2) return show("Bitte gib deinen Namen an.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(data.email)) return show("Bitte prüfe die E-Mail-Adresse.");
      if (data.message.length < 10) return show("Erzähl kurz, worum es geht (mindestens 10 Zeichen).");
      function success() {
        form.reset();
        form.classList.add("sent");
        show("✅ Danke! Deine Anfrage ist angekommen – ich melde mich so schnell wie möglich.", true);
      }
      if (U.DEMO || !CFG.apiUrl) return success();
      busy = true;
      form.classList.add("is-voting");
      var q = Object.keys(data).map(function (k) { return k + "=" + encodeURIComponent(data[k]); }).join("&");
      var url = CFG.apiUrl + (CFG.apiUrl.indexOf("?") === -1 ? "?" : "&") + "contact=1&" + q + "&voter=" + encodeURIComponent(voterId());
      fetch(url).then(function (r) { return r.json(); }).then(function (res) {
        busy = false;
        form.classList.remove("is-voting");
        if (res && res.ok) success();
        else show((res && res.error) || "Das hat leider nicht geklappt. Schreib mir gern direkt an " + P.email + ".");
      }).catch(function () {
        busy = false;
        form.classList.remove("is-voting");
        show("Das hat leider nicht geklappt. Schreib mir gern direkt an " + P.email + ".");
      });
    });
  }

  renderStatic();
  initForm();
  document.addEventListener("streamdata", function (e) { renderStats(e.detail); });
})();
