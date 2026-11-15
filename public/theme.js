// Zet de themakeuze (licht/donker) vóór het tekenen. Geen gevoelige gegevens.
try {
  var t = localStorage.getItem('theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
} catch (e) {}
