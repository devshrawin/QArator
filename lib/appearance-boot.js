// Sets the Appearance attributes on <html> before first paint, from the copy
// applyAppearance() keeps in localStorage, so pages do not flash the wrong theme.
(() => {
  try {
    const a = JSON.parse(localStorage.getItem('qa-appearance') || '{}');
    const el = document.documentElement;
    const set = (name, v, none) => { if (v && v !== none) el.dataset[name] = v; };
    set('theme', a.theme, 'system');
    set('motion', a.motion, 'system');
    set('font', a.fontSize, 'default');
    set('glow', a.glow, 'strong');
    set('density', a.density, 'comfortable');
  } catch (e) { /* no stored appearance yet */ }
})();
