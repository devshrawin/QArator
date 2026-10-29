// On Google AI Studio's key page, only while the setup asked for it (QArator opened the page itself within the
// last half hour): a small card that says what to click, and once a key is on the page, a button that hands it
// to QArator, so nothing has to be copied or pasted. It reads the page only for text shaped like a Gemini key.
(async () => {
  if (!/^aistudio\.google\.com$/.test(location.hostname)) return;
  let wanted = false;
  try { const { keyHelper } = await chrome.storage.local.get('keyHelper'); wanted = !!(keyHelper && keyHelper.until > Date.now()); } catch (e) { return; }
  if (!wanted) return;

  const KEY = /AIza[0-9A-Za-z_-]{35}/;
  const host = document.createElement('div');
  host.id = 'qarator-key-helper';
  host.style.cssText = 'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>
    .c{font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;width:300px;background:#fff;color:#1a1a1a;border:1px solid #d6d6d6;border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.22);padding:14px 16px}
    .h{font-weight:700;display:flex;align-items:center;gap:8px;margin:0 0 8px}.d{width:10px;height:10px;border-radius:3px;background:#e8532a}
    ol{margin:0 0 10px;padding-left:20px}li{margin:2px 0}li.on{font-weight:700}
    button{font:inherit;font-weight:600;border:0;border-radius:8px;padding:8px 12px;background:#1a1a1a;color:#fff;cursor:pointer;width:100%}
    button[disabled]{background:#e6e6e6;color:#8a8a8a;cursor:default}.s{color:#555;font-size:12px;margin-top:8px}.x{all:unset;float:right;cursor:pointer;color:#777;padding:0 2px}
    @media (prefers-color-scheme:dark){.c{background:#1c1d1f;color:#f1f1f1;border-color:#3a3b3e}.s{color:#aaa}button{background:#f1f1f1;color:#1a1a1a}button[disabled]{background:#3a3b3e;color:#888}}
  </style>
  <div class="c" role="dialog" aria-label="QArator key helper"><button class="x" aria-label="Close">×</button>
    <p class="h"><span class="d"></span>QArator · getting your free key</p>
    <ol><li id="s1" class="on">Click <b>Create API key</b> (if asked: <b>Create API key in new project</b>).</li>
    <li id="s2">When your key appears on this page, press the button below.</li></ol>
    <button id="use" disabled>Waiting for your key…</button>
    <div class="s" id="note">Nothing leaves your browser except to Google.</div></div>`;
  document.documentElement.appendChild(host);
  root.querySelector('.x').onclick = () => host.remove();

  const use = root.getElementById('use'), note = root.getElementById('note');
  let key = '';
  const find = () => {
    const bits = [document.body ? document.body.innerText : ''];
    document.querySelectorAll('input,textarea').forEach((el) => bits.push(el.value || ''));
    const m = KEY.exec(bits.join('\n'));
    return m ? m[0] : '';
  };
  const scan = () => {
    const k = find();
    if (k === key) return;
    key = k;
    root.getElementById('s1').className = key ? '' : 'on';
    root.getElementById('s2').className = key ? 'on' : '';
    use.disabled = !key;
    use.textContent = key ? 'Use this key in QArator' : 'Waiting for your key…';
  };
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  setInterval(scan, 1500);
  scan();

  use.onclick = async () => {
    if (!key) return;
    use.disabled = true; use.textContent = 'Sending…';
    try {
      const r = await chrome.runtime.sendMessage({ type: 'qarator-set-key', key });
      if (r && r.ok) { use.textContent = 'Sent ✓'; note.textContent = 'Go back to the QArator tab. You can close this one.'; }
      else throw new Error('not saved');
    } catch (e) { use.disabled = false; use.textContent = 'Use this key in QArator'; note.textContent = 'Could not send it. Copy the key and paste it into QArator.'; }
  };
})();
