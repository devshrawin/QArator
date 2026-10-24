// Isolated-world side: keeps the last 50 page errors and answers the panel.
(() => {
  if (window.__qaratorBridge) return;
  window.__qaratorBridge = true;
  const errors = [];
  window.addEventListener('qarator:pageerror', (ev) => {
    let e;
    try { e = JSON.parse(ev.detail); } catch (x) { return; }
    if (!e || !e.message) return;
    const last = errors[errors.length - 1];
    if (last && last.message === e.message && last.source === e.source) { last.count = (last.count || 1) + 1; return; }
    errors.push({ kind: e.kind, message: e.message, source: e.source || '', at: e.at, count: 1 });
    if (errors.length > 50) errors.shift();
  });
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (!msg || msg.type !== 'qarator:pageInfo') return;
    reply({
      url: location.href,
      title: document.title,
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio || 1 },
      errors: errors.slice(),
      hints: globalThis.__qaratorHints ? globalThis.__qaratorHints() : null
    });
  });
})();
