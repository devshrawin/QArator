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
    .c{font:13px/1.5 Inter,"Segoe UI",system-ui,-apple-system,sans-serif;width:300px;background:#fff;color:#1B1B19;border:1px solid #E6E5E0;border-radius:12px;box-shadow:0 16px 40px rgba(24,24,22,.16),0 2px 6px rgba(24,24,22,.08);padding:14px 16px}
    .h{font-weight:600;font-size:14px;display:flex;align-items:center;gap:8px;margin:0 0 8px}.d{width:20px;height:20px;border-radius:5px;background:#FF7A3D;display:inline-flex;align-items:center;justify-content:center;flex:none}.d svg{width:14px;height:14px;fill:none;stroke:#16181B;stroke-width:2.2}
    ol{margin:0 0 12px;padding-left:20px;color:#4A4944}li{margin:3px 0}li.on{font-weight:600;color:#1B1B19}
    button{font:inherit;font-weight:600;border:0;border-radius:6px;height:36px;padding:0 12px;background:#C2410C;color:#fff;cursor:pointer;width:100%}
    button:hover:not([disabled]){background:#AD3A0B}button:focus-visible{outline:2px solid #C2410C;outline-offset:2px}
    button[disabled]{background:#EEEDE9;color:#A3A19A;cursor:default}.s{color:#67665F;font-size:12px;margin-top:8px}.x{all:unset;float:right;cursor:pointer;color:#67665F;padding:0 4px;border-radius:4px}.x:hover{background:#EEEDE9}
    @media (prefers-color-scheme:dark){.c{background:#202022;color:#ECECE8;border-color:#2E2E31}ol{color:#B6B5AF}li.on{color:#ECECE8}.s{color:#93928C}button{background:#FF7A3D;color:#1A0B03}button:hover:not([disabled]){background:#FF8F5C}button[disabled]{background:#28282A;color:#5E5D59}.x{color:#93928C}.x:hover{background:#28282A}}
  </style>
  <div class="c" role="dialog" aria-label="QArator key helper"><button class="x" aria-label="Close">×</button>
    <p class="h"><span class="d"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 7V2.5H7 M9 2.5h4.5V7 M2.5 9v4.5H7 M9 9l4.5 4.5"/></svg></span>Getting your free key</p>
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
