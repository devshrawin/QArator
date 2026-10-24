// Runs in the page's own JavaScript world at document_start and reports
// errors to the isolated QArator script. It never changes page behaviour:
// every hook calls the original and swallows its own failures.
(() => {
  if (window.__qaratorErrorsHooked) return;
  Object.defineProperty(window, '__qaratorErrorsHooked', { value: true });

  const send = (e) => {
    try { window.dispatchEvent(new CustomEvent('qarator:pageerror', { detail: JSON.stringify({ ...e, at: Date.now() }) })); } catch (x) { /* ignore */ }
  };
  const fmt = (v) => {
    try {
      if (v instanceof Error) return `${v.name}: ${v.message}`;
      if (typeof v === 'string') return v;
      // never walk a large page object: name and a few keys are enough for a bug report
      if (v && typeof v === 'object') return `${(v.constructor && v.constructor.name) || 'Object'} {${Object.keys(v).slice(0, 8).join(', ')}}`;
      return String(v);
    } catch (x) { return String(v); }
  };
  const srcOf = (stack) => {
    const m = /\(?((?:https?|blob|chrome-extension):[^\s)]+?):(\d+):(\d+)\)?/.exec(String(stack || ''));
    if (!m) return '';
    const file = m[1].split('/').pop().split('?')[0];
    return `${file}:${m[2]}`;
  };

  const origError = console.error;
  console.error = function (...args) {
    try { send({ kind: 'console', message: args.map(fmt).join(' ').slice(0, 500), source: srcOf(new Error().stack.split('\n').slice(2).join('\n')) }); } catch (x) { /* ignore */ }
    return origError.apply(this, args);
  };

  window.addEventListener('error', (ev) => {
    const t = ev.target;
    if (t && t !== window && (t.src || t.href)) {
      send({ kind: 'resource', message: `Failed to load ${t.tagName.toLowerCase()}: ${t.src || t.href}` });
      return;
    }
    const file = ev.filename ? `${ev.filename.split('/').pop().split('?')[0]}:${ev.lineno}` : srcOf(ev.error && ev.error.stack);
    send({ kind: 'error', message: ev.error ? fmt(ev.error) : String(ev.message || 'Script error'), source: file });
  }, true);

  window.addEventListener('unhandledrejection', (ev) => {
    send({ kind: 'promise', message: `Uncaught (in promise) ${fmt(ev.reason)}`, source: srcOf(ev.reason && ev.reason.stack) });
  });

  // HTTP failures from fetch and XHR (status 400 and above, or network failure)
  const origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input, init) {
      const method = (init && init.method) || (input && input.method) || 'GET';
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      return origFetch.apply(this, arguments).then((res) => {
        try { if (res && res.status >= 400) send({ kind: 'http', message: `${method.toUpperCase()} ${url} ${res.status}${res.statusText ? ' (' + res.statusText + ')' : ''}` }); } catch (x) { /* ignore */ }
        return res;
      }, (err) => {
        try { send({ kind: 'http', message: `${method.toUpperCase()} ${url} failed: ${fmt(err)}` }); } catch (x) { /* ignore */ }
        throw err;
      });
    };
  }
  const XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { try { this.__qa = { m, u }; } catch (x) { /* ignore */ } return XO.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    try {
      this.addEventListener('loadend', () => {
        const i = this.__qa || {};
        if (this.status >= 400) send({ kind: 'http', message: `${String(i.m || 'GET').toUpperCase()} ${i.u} ${this.status}${this.statusText ? ' (' + this.statusText + ')' : ''}` });
        else if (this.status === 0 && this.readyState === 4) send({ kind: 'http', message: `${String(i.m || 'GET').toUpperCase()} ${i.u} failed (network)` });
      });
    } catch (x) { /* ignore */ }
    return XS.apply(this, arguments);
  };
})();
