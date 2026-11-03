// Runs before the page is drawn, so a dark-mode user never sees a white flash.
// Kept as a separate file (not inline) so a strict Content-Security-Policy allows it.
// Must match the storage key and logic in src/theme.ts.
(function () {
  var theme = "system";
  try {
    var stored = localStorage.getItem("theme");
    if (stored === "light" || stored === "dark") theme = stored;
  } catch (e) {}
  var dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
})();
