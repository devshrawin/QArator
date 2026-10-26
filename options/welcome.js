// First-run setup: one thing to do (paste an AI key, tested as it is pasted), then how to capture.
// The team format ships as the default; changing it lives in Settings. Every answer is saved as it is given.
import { loadSettings, saveSettings, normalize, importFormat, PROVIDERS } from '../lib/settings.js';
import { listModels, rankModels, describeError, AUTO } from '../lib/ai.js';
import { esc, icon, beam, orb, markSvg, applyTheme, applyAppearance, watchTheme, toast } from '../lib/ui.js';

const $ = (s, r = document) => r.querySelector(s);
const STEPS = ['key', 'try'];
let S, step = 0, keyState = null, keyTimer = 0; // keyState: null | 'busy' | {ok, text}
const KEY_LINKS = {
  gemini: ['https://aistudio.google.com/app/apikey', 'Get a free key in Google AI Studio'],
  anthropic: ['https://console.anthropic.com/settings/keys', 'Create a key in the Anthropic Console'],
  openai: ['https://platform.openai.com/api-keys', 'Create a key on the OpenAI platform']
};

// Writes only what this page asks for, on top of the settings as stored now, so a change made in the
// settings page (or anywhere else) while setup is open is never overwritten by this page's older copy.
async function save() {
  const cur = await loadSettings();
  S = { ...cur, ai: { ...cur.ai, ...S.ai }, title: { ...cur.title, project: S.title.project }, zoho: { ...cur.zoho, domain: S.zoho.domain } };
  await saveSettings(S);
}

function dots() {
  $('#dots').innerHTML = STEPS.map((s, i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('');
}

const nav = (next = 'Next', { back = true, skip = '' } = {}) => `<div class="foot">
  ${back && step > 0 ? `<button type="button" class="btn b-ghost" data-go="back">${icon.back}Back</button>` : ''}
  <span class="grow"></span>
  ${skip ? `<button type="button" class="btn b-ghost" data-go="next">${skip}</button>` : ''}
  <button type="button" class="btn b-pri" data-go="${step === STEPS.length - 1 ? 'done' : 'next'}" id="next">${next}</button></div>`;

function keyStep() {
  const p = S.ai.provider, link = KEY_LINKS[p];
  const st = keyState;
  return `<div class="card">
    <h1>Paste your AI key and you're ready</h1>
    <p>QArator captures the screen you test, writes the bug report in your team's format and fills the Zoho Submit Issue form. The only thing to set up is an AI key. It stays in this browser and is sent only to the provider you pick.</p>
    <div class="g2">
      <div><label class="lbl" for="prov">Provider</label>
        <select id="prov" class="field">${Object.entries(PROVIDERS).map(([k, v]) => `<option value="${k}" ${k === p ? 'selected' : ''}>${esc(v.label)}${k === 'gemini' ? ' (free tier)' : ''}</option>`).join('')}</select></div>
      <div><label class="lbl" for="key">API key</label>${beam(`<input id="key" class="field mono" type="password" autocomplete="off" spellcheck="false" value="${esc(S.ai.apiKey)}" placeholder="${esc(PROVIDERS[p].keyHint)}">`)}</div>
      ${PROVIDERS[p].needsBase ? `<div style="grid-column:1/-1"><label class="lbl" for="base">Endpoint base address</label>${beam(`<input id="base" class="field mono" value="${esc(S.ai.baseUrl)}" placeholder="http://localhost:11434/v1">`)}</div>` : ''}
    </div>
    ${link ? `<a href="${link[0]}" target="_blank" rel="noopener" class="hint" style="color:var(--ink)">${esc(link[1])} ${icon.external}</a>` : ''}
    <div class="row"><button type="button" class="btn b-sec" data-go="test" ${st === 'busy' ? 'aria-disabled="true"' : ''}>${st === 'busy' ? orb('connecting', 20) + 'Testing…' : 'Test key'}</button>
      <span role="status" aria-live="polite" id="key-status">${st && st !== 'busy' ? `<span class="status ${st.ok ? 'ok' : 'bad'}">${st.ok ? icon.check : icon.alert}${esc(st.text)}</span>` : ''}</span></div>
    <div class="hint">Got a team format file? <button type="button" class="btn b-ghost b-sm" data-go="import" style="height:auto;padding:0 6px">Import it</button> Otherwise the team defaults are already in place.</div>
    ${nav('Next', { skip: st && st.ok ? '' : 'Do this later' })}</div>`;
}

function tryIt() {
  return `<div class="card">
    <h1>You're ready</h1>
    <ul>
      <li>Change the project code, Zoho address, tags or title format any time in Settings › Team format and Zoho.</li>
      <li>Pin QArator: puzzle-piece menu in the toolbar › pin.</li>
      <li><span class="kbd">Alt+Shift+Q</span> opens the panel, <span class="kbd">Alt+Shift+S</span> captures the tab you're on.</li>
      <li><span class="kbd">Alt+Shift+R</span> starts and stops <strong>Record screen</strong>: pick a screen, window or tab, and the mouse pointer is recorded too.</li>
      <li>No AI needed? <strong>Export to Word</strong> saves the URL, screenshots, note and steps in a Word file.</li>
      <li>Type what's wrong and press <span class="kbd">Ctrl+Enter</span> to write the report.</li>
      <li>Open Zoho's Submit Issue form, then <span class="kbd">Ctrl+Enter</span> again to fill it.</li>
    </ul>
    <div class="row"><button type="button" class="btn b-sec" data-go="panel">Open the panel now</button></div>
    ${nav('Finish')}</div>`;
}

function render() {
  dots();
  $('#step').innerHTML = [keyStep, tryIt][step]();
  applyTheme();
  $('#step input, #step select, #next')?.focus();
}

async function testKey() {
  readKeyFields();
  keyState = 'busy'; render();
  try {
    const models = await listModels(S.ai);
    const order = rankModels(S.ai.provider, models);
    S.ai.models = models;
    S.ai.model = AUTO;
    await save();
    keyState = order.length
      ? { ok: true, text: `Key works. Auto will use ${order[0]}${order[1] ? `, then ${order.slice(1, 3).join(', ')}` : ''}.` }
      : { ok: false, text: 'Key works, but no image-capable model was found. Pick one in settings.' };
  } catch (e) {
    keyState = { ok: false, text: e.kind === 'nokey' ? 'Paste a key first.' : `${describeError(e).title}.${e.status ? ` (HTTP ${e.status})` : ''}` };
  }
  render();
}

function readKeyFields() {
  if ($('#key')) S.ai.apiKey = $('#key').value.trim();
  if ($('#base')) S.ai.baseUrl = $('#base').value.trim();
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-go]');
  if (!b || b.getAttribute('aria-disabled') === 'true') return;
  const go = b.dataset.go;
  if (step === 0) readKeyFields();
  if (go === 'test') return testKey();
  if (go === 'import') return $('#import-file').click();
  if (go === 'panel') {
    const win = await chrome.windows.getCurrent();
    return chrome.sidePanel.open({ windowId: win.id }).catch(() => toast('Click the QArator icon in the toolbar to open the panel.', 3200));
  }
  await save();
  if (go === 'back') step = Math.max(0, step - 1);
  if (go === 'next') step = Math.min(STEPS.length - 1, step + 1);
  if (go === 'done') {
    await chrome.storage.local.set({ onboarded: Date.now() });
    $('#step').innerHTML = `<div class="card"><h1>All set</h1><p>You can change anything later in settings.</p>
      <div class="foot"><a class="btn b-sec" href="options.html">Open settings</a><span class="grow"></span><button type="button" class="btn b-pri" id="close">Close this tab</button></div></div>`;
    $('#close').onclick = () => window.close();
    return;
  }
  render();
});

document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.id === 'prov') { readKeyFields(); S.ai.provider = t.value; S.ai.models = []; S.ai.model = AUTO; keyState = null; await save(); render(); }
  if (t.id === 'key' || t.id === 'base') { readKeyFields(); keyState = null; await save(); }
  if (t.id === 'import-file') {
    const f = t.files[0]; t.value = '';
    if (!f) return;
    try { S = importFormat(await loadSettings(), JSON.parse(await f.text())); await saveSettings(S); toast('Format imported'); render(); }
    catch (err) { toast(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message, 3500); }
  }
});
// A pasted key is tested on its own after a short pause; no need to find the button.
document.addEventListener('input', (e) => {
  if (e.target.id !== 'key' && e.target.id !== 'base') return;
  clearTimeout(keyTimer);
  readKeyFields();
  const ready = S.ai.provider === 'compatible' ? /^https?:\/\/.+/.test(S.ai.baseUrl) : S.ai.apiKey.length >= 20;
  if (ready) keyTimer = setTimeout(testKey, 900);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'key') { e.preventDefault(); testKey(); }
});

(async function start() {
  $('#mark').innerHTML = markSvg(24);
  S = await loadSettings();
  applyAppearance(S);
  chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.settings) applyAppearance(normalize(c.settings.newValue)); });
  watchTheme();
  render();
})();
