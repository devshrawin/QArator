// First-run setup: AI key (tested on the spot), team format, then how to capture. Every answer is
// saved as it is given, so closing the tab half way loses nothing.
import { loadSettings, saveSettings, importFormat, PROVIDERS } from '../lib/settings.js';
import { listModels, rankModels, describeError, AUTO } from '../lib/ai.js';
import { esc, icon, beam, orb, markSvg, applyTheme, watchTheme, toast } from '../lib/ui.js';

const $ = (s, r = document) => r.querySelector(s);
const STEPS = ['intro', 'key', 'team', 'try'];
let S, step = 0, keyState = null; // null | 'busy' | {ok, text}
const KEY_LINKS = {
  gemini: ['https://aistudio.google.com/app/apikey', 'Get a free key in Google AI Studio'],
  anthropic: ['https://console.anthropic.com/settings/keys', 'Create a key in the Anthropic Console'],
  openai: ['https://platform.openai.com/api-keys', 'Create a key on the OpenAI platform']
};

async function save() { await saveSettings(S); }

function dots() {
  $('#dots').innerHTML = STEPS.map((s, i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('');
}

const nav = (next = 'Next', { back = true, skip = '' } = {}) => `<div class="foot">
  ${back && step > 0 ? `<button type="button" class="btn b-ghost" data-go="back">${icon.back}Back</button>` : ''}
  <span class="grow"></span>
  ${skip ? `<button type="button" class="btn b-ghost" data-go="next">${skip}</button>` : ''}
  <button type="button" class="btn b-pri" data-go="${step === STEPS.length - 1 ? 'done' : 'next'}" id="next">${next}</button></div>`;

function intro() {
  return `<div class="card">
    <h1>Log bugs in Zoho in under a minute</h1>
    <ul>
      <li>Capture the screen you're testing, mark the problem, type one line.</li>
      <li>AI writes the full bug report in your team's format.</li>
      <li>One click fills the Zoho Submit Issue form. You review and press Submit.</li>
    </ul>
    <p class="hint">Setup takes about two minutes: an AI key, your project code and your Zoho address.</p>
    ${nav('Start', { back: false })}</div>`;
}

function keyStep() {
  const p = S.ai.provider, link = KEY_LINKS[p];
  const st = keyState;
  return `<div class="card">
    <h1>Connect an AI provider</h1>
    <p>QArator sends your screenshot and note to this provider when you press Write. The key stays in this browser.</p>
    <div class="g2">
      <div><label class="lbl" for="prov">Provider</label>
        <select id="prov" class="field">${Object.entries(PROVIDERS).map(([k, v]) => `<option value="${k}" ${k === p ? 'selected' : ''}>${esc(v.label)}${k === 'gemini' ? ' (free tier)' : ''}</option>`).join('')}</select></div>
      <div><label class="lbl" for="key">API key</label>${beam(`<input id="key" class="field mono" type="password" autocomplete="off" spellcheck="false" value="${esc(S.ai.apiKey)}" placeholder="${esc(PROVIDERS[p].keyHint)}">`)}</div>
      ${PROVIDERS[p].needsBase ? `<div style="grid-column:1/-1"><label class="lbl" for="base">Endpoint base address</label>${beam(`<input id="base" class="field mono" value="${esc(S.ai.baseUrl)}" placeholder="http://localhost:11434/v1">`)}</div>` : ''}
    </div>
    ${link ? `<a href="${link[0]}" target="_blank" rel="noopener" class="hint" style="color:var(--ink)">${esc(link[1])} ${icon.external}</a>` : ''}
    <div class="row"><button type="button" class="btn b-sec" data-go="test" ${st === 'busy' ? 'aria-disabled="true"' : ''}>${st === 'busy' ? orb('connecting', 20) + 'Testing…' : 'Test key'}</button>
      <span role="status" aria-live="polite" id="key-status">${st && st !== 'busy' ? `<span class="status ${st.ok ? 'ok' : 'bad'}">${st.ok ? icon.check : icon.alert}${esc(st.text)}</span>` : ''}</span></div>
    ${nav('Next', { skip: st && st.ok ? '' : 'Do this later' })}</div>`;
}

function team() {
  return `<div class="card">
    <h1>Your team's format</h1>
    <p>If a teammate shared a QArator format file, import it and you're done. Otherwise set the two basics; the rest has team defaults you can change in settings.</p>
    <div><button type="button" class="btn b-sec" data-go="import">${icon.upload}Import format file</button></div>
    <div class="g2">
      <div><label class="lbl" for="proj">Project code</label>${beam(`<input id="proj" class="field" value="${esc(S.title.project)}" placeholder="UR">`)}
        <div class="hint" style="margin-top:4px">First part of every bug title.</div></div>
      <div><label class="lbl" for="zdom">Zoho Projects address</label>${beam(`<input id="zdom" class="field mono" value="${esc(S.zoho.domain)}" placeholder="projects.zoho.in">`)}
        <div class="hint" style="margin-top:4px"><button type="button" class="btn b-ghost b-sm" data-go="detect" style="margin-left:-8px;height:auto;padding:0 8px">Find it from an open Zoho tab</button></div></div>
    </div>
    <p class="hint">Module and page names are read from the site you test (breadcrumb, highlighted menu, heading) and from its address, so you don't need URL rules to start.</p>
    ${nav()}</div>`;
}

function tryIt() {
  return `<div class="card">
    <h1>You're ready</h1>
    <ul>
      <li>Pin QArator: puzzle-piece menu in the toolbar › pin.</li>
      <li><span class="kbd">Alt+Shift+Q</span> opens the panel, <span class="kbd">Alt+Shift+S</span> captures the tab you're on.</li>
      <li>Type what's wrong and press <span class="kbd">Ctrl+Enter</span> to write the report.</li>
      <li>Open Zoho's Submit Issue form, then <span class="kbd">Ctrl+Enter</span> again to fill it.</li>
      <li>Tabs that were open before you installed QArator need one reload to collect page errors.</li>
    </ul>
    <div class="row"><button type="button" class="btn b-sec" data-go="panel">Open the panel now</button></div>
    ${nav('Finish')}</div>`;
}

function render() {
  dots();
  $('#step').innerHTML = [intro, keyStep, team, tryIt][step]();
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

async function detectZoho() {
  const tabs = await chrome.tabs.query({});
  const z = tabs.map((t) => { try { return new URL(t.url).hostname; } catch (e) { return ''; } }).find((h) => /(^|\.)projects\.zoho\./.test(h) || /zoho/.test(h));
  if (!z) { toast('No Zoho tab is open. Open Zoho Projects in a tab, then try again.', 3200); return; }
  S.zoho.domain = z; await save(); render(); toast(`Found ${z}`);
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-go]');
  if (!b || b.getAttribute('aria-disabled') === 'true') return;
  const go = b.dataset.go;
  if (step === 1) readKeyFields();
  if (go === 'test') return testKey();
  if (go === 'detect') return detectZoho();
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
  if (t.id === 'proj') { S.title.project = t.value.trim(); await save(); }
  if (t.id === 'zdom') { S.zoho.domain = t.value.trim().replace(/^https?:\/\//, '').split('/')[0]; await save(); }
  if (t.id === 'key' || t.id === 'base') { readKeyFields(); keyState = null; await save(); }
  if (t.id === 'import-file') {
    const f = t.files[0]; t.value = '';
    if (!f) return;
    try { S = importFormat(S, JSON.parse(await f.text())); await save(); toast('Format imported'); render(); }
    catch (err) { toast(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message, 3500); }
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.id === 'key') { e.preventDefault(); testKey(); }
});

(async function start() {
  $('#mark').innerHTML = markSvg(24);
  S = await loadSettings();
  watchTheme();
  render();
})();
