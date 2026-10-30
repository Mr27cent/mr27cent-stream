/* Tag/Nacht vor dem ersten Zeichnen setzen, damit nichts flackert (eigene Datei wegen Content-Security-Policy) */
(function () {
  var t = null;
  try { t = localStorage.getItem("stream_theme"); } catch (e) {}
  if (t !== "day" && t !== "night") {
    var h = new Date().getHours();
    t = (h >= 7 && h < 19) ? "day" : "night";
  }
  document.documentElement.setAttribute("data-theme", t);
})();
