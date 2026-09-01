/* Shared theme switch.
 *
 * Orbit shipped its own dark/light toggle keyed on `nova-theme`; every other
 * page was locked to whatever palette its comp happened to use. This reads the
 * same key so a choice made anywhere follows you everywhere, and gives the
 * pages that have no toggle of their own the same control in the same place.
 *
 * Load this in <head> WITHOUT defer: it has to set the class before first
 * paint, or a light-theme user gets a dark flash on every navigation.
 */
(() => {
  const KEY = 'nova-theme';

  let theme = 'dark';
  try { theme = localStorage.getItem(KEY) || 'dark'; } catch (e) {}

  /* <html> is the only element that exists this early. Orbit's own toggle
     writes the class to <body>, so mirror it there too once <body> lands —
     theme.css honours either. */
  function apply(t) {
    document.documentElement.classList.toggle('light', t === 'light');
    if (document.body) document.body.classList.toggle('light', t === 'light');
  }
  apply(theme);

  function setTheme(t) {
    theme = t;
    apply(t);
    try { localStorage.setItem(KEY, t); } catch (e) {}
  }

  function init() {
    apply(theme);

    // Orbit draws its own button and swaps two whole screens behind it; don't
    // add a second control on top of it.
    if (document.getElementById('themeBtn')) return;

    const b = document.createElement('button');
    b.id = 'themeBtn';
    b.type = 'button';
    b.textContent = 'THEME';
    b.setAttribute('aria-label', 'Switch between the dark and light theme');
    b.onclick = () => setTheme(
      document.documentElement.classList.contains('light') ? 'dark' : 'light');
    document.body.appendChild(b);
  }

  if (document.readyState === 'loading')
    document.addEventListener('DOMContentLoaded', init);
  else
    init();

  // A toggle in one tab should reach the others.
  window.addEventListener('storage', e => {
    if (e.key === KEY && e.newValue) apply(e.newValue);
  });
})();
