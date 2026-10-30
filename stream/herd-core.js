/* Gemeinsame Herden-Logik für Webseite (app.js) und OBS-Overlay (overlay.js). */
window.HerdCore = function (herd) {
  "use strict";

  function stageFor(hours) {
    var st = herd.stages[0];
    herd.stages.forEach(function (x) { if (hours >= x.hours) st = x; });
    return st;
  }
  function stageNo(hours) {
    return herd.stages.indexOf(stageFor(hours)) + 1;
  }
  function nextStage(hours) {
    return herd.stages.filter(function (x) { return x.hours > hours; })[0] || null;
  }
  // Kitz = 32 % Größe, ausgewachsen = 100 %. Wurzelkurve: am Anfang wächst man sichtbar schneller.
  function herdScale(hours) {
    return 0.32 + 0.68 * Math.sqrt(Math.min(hours, herd.maxHours) / herd.maxHours);
  }
  // Bild-Look der Stufe (config.js → herd.looks), null = gezeichnete Gazelle
  function lookFor(hours) {
    var n = stageNo(hours), look = null;
    (herd.looks || []).forEach(function (l) { if (n >= l.fromStage) look = l; });
    return look && look.img ? look : null;
  }

  return { stageFor: stageFor, stageNo: stageNo, nextStage: nextStage, herdScale: herdScale, lookFor: lookFor };
};
