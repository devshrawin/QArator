// QArator side panel. One small state object, re-rendered per view; typing
// updates state without re-rendering so focus and caret stay put.
import { loadSettings, onSettingsChanged, PROVIDERS } from '../lib/settings.js';
import { generate, parseJson, describeError, AIError } from '../lib/ai.js';
import { buildPrompt, buildReport, buildTitle, descriptionText, descriptionHtml, rewritePrompt, rewriteResult, applyUrlRules, isText, stepsText } from '../lib/report.js';
import { detectEnv, fileToDataUrl, forAi, thumb } from '../lib/env.js';
import { esc, icon, orb, beam, markSvg, applyTheme, watchTheme, toast, copyText, downloadDataUrl, fmtTime, uid } from '../lib/ui.js';
import { openMarkup } from './markup.js';

const $ = (s, r = document) => r.querySelector(s);
const main = $('#main'), dock = $('#dock');
let S = null;
let ctrl = null, tick = null;

const fresh = () => ({
  view: 'capture',        // capture | writing | review | filled | history
  shots: [],              // {id, dataUrl, original, marks, thumb, name}
  noShot: false,
  page: null,             // {url, title, capturedAt, viewport, errors|null, errorsIncluded}
  note: '', steps: '', stepsOpen: false,
  report: null,
  fill: null,             // {results, tabId}
  error: null,            // {kind, title, body, detail, retryAt}
  writing: null,          // {phase}
  zoho: null,             // banner when filling is not possible
  busy: null,             // 'fill' | 'rewrite:<id>' | 'models'
  back: 'capture'
});
let st = fresh();
let env = { browser: '', os: '' };

// ---------- persistence ----------
let saveTimer = 0;
function saveDraft() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const d = { ...st, view: st.view === 'writing' ? 'capture' : st.view === 'history' ? st.back : st.view, writing: null, busy: null, zoho: null, error: st.error && st.error.kind === 'ratelimit' ? st.error : null };
    chrome.storage.local.set({ draft: d }).catch(() => {});
  }, 300);
}
async function loadDraft() {
  const { draft } = await chrome.storage.local.get('draft');
  if (draft && typeof draft === 'object') st = { ...fresh(), ...draft };
}
async function history() { return (await chrome.storage.local.get('history')).history || []; }
async function saveHistory(status) {
  if (!st.report) return;
  const list = await history();
  const id = st.report.createdAt;
  const entry = { id, title: buildTitle(st.report, S), status, at: Date.now(), report: st.report, page: st.page && { ...st.page, errors: [] } };
  const next = [entry, ...list.filter((h) => h.id !== id)].slice(0, 20);
  await chrome.storage.local.set({ history: next });
}

// ---------- helpers ----------
const providerName = () => (PROVIDERS[S.ai.provider] || {}).label || 'your AI provider';
const portalLabel = () => {
  const p = st.report?.segments.portal || (st.page && applyUrlRules(st.page.url, S.urlRules).portal) || '';
  return [S.title.project, p].filter(Boolean).join(' · ');
};
const isZohoUrl = (url) => {
  try { const h = new URL(url).hostname; return h.includes('zoho') || (S.zoho.domain && h === S.zoho.domain.replace(/^https?:\/\//, '').split('/')[0]); }
  catch (e) { return false; }
};
async function activeTab() {
  const win = await chrome.windows.getCurrent();
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
  return { tab, win };
}
async function pageInfo(tab) {
  try {
    const info = await chrome.tabs.sendMessage(tab.id, { type: 'qarator:pageInfo' });
    if (info) return { ...info, errorsIncluded: info.errors.length > 0 };
  } catch (e) { /* content script not in this tab yet */ }
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ url: location.href, title: document.title, viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio || 1 } }) });
    return { ...r.result, errors: null, errorsIncluded: false };
  } catch (e) {
    return { url: tab.url || '', title: tab.title || '', viewport: null, errors: null, errorsIncluded: false };
  }
}
const cap = () => ({ note: st.note, steps: st.steps, page: st.page, env, shotNames: st.shots.map((s) => s.name) });
const stamp = (d = new Date()) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
// One name per screenshot, used in the report text, the Zoho attachment and Save screenshots.
const shotName = () => `qarator_${stamp()}_${st.shots.length + 1}.png`;

// ---------- shots ----------
async function addShot(dataUrl, name) {
  const t = await thumb(dataUrl).catch(() => dataUrl);
  st.shots.push({ id: uid(), dataUrl, original: dataUrl, marks: [], thumb: t, name: name || shotName() });
  st.error = st.error && st.error.kind === 'nokey' ? st.error : null;
  if (st.view === 'history' || st.view === 'filled') st.view = 'capture';
  saveDraft(); render();
}
async function captureTab() {
  const { tab, win } = await activeTab();
  if (!tab || !/^(https?|file):/.test(tab.url || '')) {
    toast("Can't capture this tab. Switch to the site you're testing and try again.", 3200);
    return;
  }
  let dataUrl;
  try { dataUrl = await chrome.tabs.captureVisibleTab(win.id, { format: 'png' }); }
  catch (e) { toast('Capture failed. Click the page once, then try again.', 3200); return; }
  const info = await pageInfo(tab);
  st.page = { ...info, capturedAt: Date.now() };
  if (st.view !== 'review') st.view = 'capture';
  await addShot(dataUrl);
}
async function addFiles(files) {
  const imgs = [...files].filter((f) => f.type.startsWith('image/'));
  if (!imgs.length) { toast('That file is not an image.'); return; }
  if (!st.page) {
    const { tab } = await activeTab();
    if (tab && /^(https?|file):/.test(tab.url || '')) st.page = { ...(await pageInfo(tab)), capturedAt: Date.now() };
  }
  for (const f of imgs) await addShot(await fileToDataUrl(f));
}

// ---------- AI ----------
async function write() {
  if (st.view === 'writing') return;
  if (!st.shots.length && !st.note.trim()) { toast('Capture a screenshot or describe the problem first.'); $('#note')?.focus(); return; }
  st.error = null;
  st.view = 'writing'; st.writing = { phase: 0 }; render();
  ctrl = new AbortController();
  try {
    if (!S.ai.apiKey && S.ai.provider !== 'compatible') throw new AIError('nokey', 'no key');
    const images = [];
    for (const s of st.shots) images.push(await forAi(s.dataUrl));
    setPhase(1);
    const { system, text, rule } = buildPrompt(S, cap());
    const p = generate(S.ai, { system, text, images, json: true, maxTokens: 4096 }, ctrl.signal);
    setTimeout(() => st.view === 'writing' && st.writing.phase === 1 && setPhase(2), 700);
    const out = await p;
    setPhase(3);
    const ans = parseJson(out);
    st.report = buildReport(S, cap(), ans, rule);
    st.view = 'review'; st.writing = null; st.zoho = null;
    saveDraft(); render(); $('#main').scrollTop = 0;
  } catch (e) {
    st.writing = null;
    st.view = 'capture';
    if (e.kind !== 'cancelled') showError(e);
    render();
  }
}
function setPhase(n) { if (st.writing) { st.writing.phase = n; if (st.view === 'writing') render(); } }
function showError(e) {
  const d = describeError(e);
  st.error = { kind: e.kind || 'provider', ...d, detail: e.detail || e.message || '', retryAt: e.kind === 'ratelimit' ? Date.now() + (e.retryAfter || 30) * 1000 : 0 };
  saveDraft();
}
async function rewrite(id) {
  if (st.busy) return;
  st.busy = 'rewrite:' + id; render();
  try {
    const images = [];
    for (const s of st.shots) images.push(await forAi(s.dataUrl));
    const { system, text } = rewritePrompt(S, cap(), st.report, id);
    const out = await generate(S.ai, { system, text, images, json: true, maxTokens: 1500 });
    const sec = st.report.sections.find((s) => s.id === id);
    const t = rewriteResult(parseJson(out), sec.layout);
    if (t) sec.text = t;
    saveDraft();
  } catch (e) {
    const d = describeError(e); toast(`${d.title}. ${e.kind === 'ratelimit' ? 'Try again in a moment.' : ''}`, 3500);
  }
  st.busy = null; render();
}
function blankReport() {
  const rule = st.page ? applyUrlRules(st.page.url, S.urlRules) : {};
  st.report = buildReport(S, cap(), { sections: {} }, { portal: rule.portal || '', module: rule.module || '', page: rule.page || '' });
  st.report.aiChosen = {};
  st.error = null; st.view = 'review'; saveDraft(); render();
}

// ---------- Zoho ----------
async function fillZoho() {
  if (st.busy) return;
  const { tab, win } = await activeTab();
  if (!tab || !isZohoUrl(tab.url || '')) {
    const tabs = await chrome.tabs.query({ windowId: win.id });
    const z = tabs.find((t) => isZohoUrl(t.url || ''));
    st.zoho = { kind: 'notzoho', zohoTabId: z ? z.id : null, active: tab ? tab.title : '' };
    render(); return;
  }
  st.busy = 'fill'; st.zoho = null; render();
  const report = st.report;
  const labels = (s) => String(s || '').split('|').map((x) => x.trim()).filter(Boolean);
  const payload = {
    title: { labels: labels(S.zoho.titleLabel), value: buildTitle(report, S) },
    description: { labels: labels(S.zoho.descriptionLabel), html: descriptionHtml(report), text: descriptionText(report), sections: report.sections.filter((s) => s.text.trim()).length },
    fields: S.fields.map((f) => ({ name: f.name, labels: labels(f.zohoLabel || f.name), value: report.fields[f.id] || '' })),
    tags: { labels: labels(S.zoho.tagsLabel), values: report.tags.filter((t) => t.on).map((t) => t.name) },
    attachments: { labels: labels(S.zoho.attachLabel), files: st.shots.map((s) => ({ name: s.name, dataUrl: s.dataUrl })) },
    steps: { enabled: !!S.zoho.stepsField, labels: labels(S.zoho.stepsLabel || 'Steps to Reproduce'), text: stepsText(report) },
    options: { looseMatch: S.zoho.looseMatch, scrollToFirst: S.zoho.scrollToFirst, emptyOnly: S.zoho.emptyOnly, uploadScreenshots: S.zoho.uploadScreenshots }
  };
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content/zoho-fill.js'] });
    const res = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: (p) => (window.__qaratorFill ? window.__qaratorFill(p) : { ok: false, reason: 'noscript' }),
      args: [payload]
    });
    const good = res.map((r) => r.result).filter((r) => r && r.ok).sort((a, b) => b.results.filter((x) => x.status === 'filled').length - a.results.filter((x) => x.status === 'filled').length);
    st.busy = null;
    if (!good.length) { st.zoho = { kind: 'noform' }; render(); return; }
    st.fill = { results: good[0].results, tabId: tab.id };
    st.view = 'filled';
    await saveHistory('Filled in Zoho');
    saveDraft(); render(); $('#main').scrollTop = 0;
  } catch (e) {
    st.busy = null;
    st.zoho = { kind: 'blocked', detail: String(e.message || e) };
    render();
  }
}
async function gotoField(name) {
  if (!st.fill) return;
  try {
    await chrome.tabs.update(st.fill.tabId, { active: true });
    await chrome.scripting.executeScript({ target: { tabId: st.fill.tabId, allFrames: true }, func: (n) => window.__qaratorGoto && window.__qaratorGoto(n), args: [name] });
  } catch (e) { toast('The Zoho tab was closed or reloaded. Fill the form again.', 3200); }
}
async function openZoho() {
  if (st.zoho && st.zoho.zohoTabId) { await chrome.tabs.update(st.zoho.zohoTabId, { active: true }); st.zoho = null; render(); return; }
  const dom = (S.zoho.domain || 'projects.zoho.in').replace(/^https?:\/\//, '');
  const url = S.zoho.submitUrl || `https://${dom}/`;
  await chrome.tabs.create({ url });
  st.zoho = null; render();
}

// ---------- views ----------
function setProj() { $('#proj').textContent = portalLabel(); }

function render() {
  setProj();
  main.className = '';
  const v = st.view;
  if (v === 'history') return renderHistory();
  if (v === 'writing') return renderWriting();
  if (v === 'review' && st.report) return renderReview();
  if (v === 'filled' && st.fill) return renderFilled();
  if (st.error && st.error.kind === 'nokey' || st.error && st.error.kind === 'nobase') return renderNoKey();
  if (!st.shots.length && !st.noShot) return renderEmpty();
  return renderCaptured();
}
const after = () => { applyTheme(); };

async function renderEmpty() {
  const recent = (await history()).slice(0, 3);
  if (st.view !== 'capture' || st.shots.length || st.noShot) return; // state changed while loading
  const { tab } = await activeTab().catch(() => ({}));
  main.innerHTML = `
  <div><h1 class="h1">Capture what's wrong</h1>
  <p class="hint" style="margin:4px 0 0">QArator saves the visible part of the tab with its URL, browser details and page errors.</p></div>
  <div class="stack">
    <button type="button" class="btn b-acc wide" data-action="capture" style="height:44px;font-size:14px">${icon.capture} Capture visible area <span class="kbd" style="margin-left:4px">Alt+Shift+S</span></button>
    <button type="button" class="btn b-sec wide" data-action="file">${icon.image} Add image from file</button>
  </div>
  <div class="drop-hint">${icon.paste}
    <div style="color:var(--ink)">Paste a screenshot with <span class="kbd">Ctrl</span> + <span class="kbd">V</span></div>
    <div class="hint">or drop an image file anywhere in this panel</div>
  </div>
  ${tab && /^https?:/.test(tab.url || '') ? `<div><div class="lbl">Current tab</div>
    <div style="display:flex;gap:8px;align-items:flex-start"><span style="color:var(--ink3);flex:none">${icon.globe}</span>
    <div style="min-width:0"><div class="mono url">${esc(tab.url)}</div><div class="hint" style="margin-top:2px">${esc(tab.title || '')}</div></div></div></div>` : ''}
  <div><button type="button" class="btn b-ghost b-sm" data-action="noshot" style="margin-left:-8px">Describe a bug without a screenshot</button></div>
  ${recent.length ? `<hr class="sep-line"><div>
    <div class="lbl between">Recent reports <button type="button" class="btn b-ghost b-sm" data-action="history" style="margin-right:-8px">See all</button></div>
    ${recent.map((h) => `<div class="hist-item"><div style="flex:1;min-width:0"><div class="t">${esc(h.title)}</div><div class="hint">${esc(h.status)} · ${fmtTime(h.at)}</div></div></div>`).join('')}
  </div>` : ''}`;
  dock.innerHTML = `<div class="hint" style="display:flex;flex-wrap:wrap;gap:6px 14px">
    <span><span class="kbd">Alt+Shift+Q</span> open panel</span><span><span class="kbd">Ctrl+V</span> paste image</span><span><span class="kbd">Ctrl+,</span> settings</span></div>`;
  after();
}

function errorBanner() {
  const e = st.error;
  if (!e) return '';
  const wait = e.retryAt ? Math.max(0, Math.ceil((e.retryAt - Date.now()) / 1000)) : 0;
  const mmss = `${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, '0')}`;
  return `<div class="alert" role="alert">
    <span class="alert-icon">${icon.alert}</span>
    <div style="min-width:0;flex:1">
      <h2>${esc(e.title)}</h2><p>${esc(e.body)}</p>
      <div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap">
        <button type="button" class="btn b-pri b-sm" data-action="write" id="retry" ${wait ? 'aria-disabled="true"' : ''}>${wait ? `${orb('breathing', 20, '', true)}Try again in <span id="retry-t">${mmss}</span>` : 'Try again'}</button>
        <button type="button" class="btn b-sec b-sm" data-action="settings">${e.kind === 'ratelimit' || e.kind === 'model' ? 'Change model' : 'Open settings'}</button>
        <button type="button" class="btn b-ghost b-sm" data-action="dismiss-error">Dismiss</button>
      </div>
      ${e.detail ? `<details style="margin-top:10px"><summary>Error details</summary><div class="mono" style="margin-top:6px;color:var(--ink2);font-size:11.5px;white-space:pre-wrap;word-break:break-word">${esc(e.detail)}</div></details>` : ''}
    </div></div>`;
}

function renderNoKey() {
  const e = st.error;
  main.className = 'center';
  main.innerHTML = `
  <div style="width:44px;height:44px;border-radius:22px;background:var(--surface);display:flex;align-items:center;justify-content:center;color:var(--ink2)">${icon.key}</div>
  <div role="alert"><h1 class="h1">${esc(e.title)}</h1><p style="margin:6px 0 0;color:var(--ink2)">${esc(e.body)}</p></div>
  <div class="stack">
    <button type="button" class="btn b-pri wide" data-action="settings">Open settings</button>
    <button type="button" class="btn b-sec wide" data-action="blank">Fill the sections myself</button>
    <button type="button" class="btn b-ghost wide" data-action="dismiss-error">Back</button>
  </div>
  <div class="hint">Your ${st.shots.length} screenshot${st.shots.length === 1 ? '' : 's'} and note are kept while you do this.</div>`;
  dock.innerHTML = '';
  after();
}

function errorsBlock() {
  const p = st.page;
  if (!p) return '';
  let chip = '';
  if (p.errors === null || p.errors === undefined) chip = `<span class="chip" title="Reload the tab once so QArator can collect errors">Page errors unavailable</span>`;
  else if (!p.errors.length) chip = `<span class="chip">No page errors</span>`;
  else chip = `<button type="button" class="chip" data-action="toggle-errors" aria-pressed="${p.errorsIncluded}">${p.errorsIncluded ? icon.check.replace('width="16" height="16"', 'width="12" height="12"') : ''}${p.errors.length} page error${p.errors.length === 1 ? '' : 's'} captured</button>`;
  const vp = p.viewport ? `<span class="chip">Viewport ${p.viewport.w} × ${p.viewport.h}</span>` : '';
  const list = p.errors && p.errors.length && p.errorsIncluded
    ? `<div class="errlist mono">${p.errors.slice(0, 5).map((e) => `<div>${esc(e.message)}${e.source ? ' · ' + esc(e.source) : ''}${e.count > 1 ? ` (×${e.count})` : ''}</div>`).join('')}${p.errors.length > 5 ? `<div class="hint">and ${p.errors.length - 5} more</div>` : ''}</div>`
    : p.errors && p.errors.length ? `<div class="hint" style="margin-top:8px">Page errors won't be sent or added to the report.</div>` : '';
  return `<div class="chips">${env.browser ? `<span class="chip">${esc(env.browser)}</span>` : ''}${env.os ? `<span class="chip">${esc(env.os)}</span>` : ''}${vp}${chip}</div>${list}`;
}

function renderCaptured() {
  const n = st.shots.length;
  main.innerHTML = `
  ${errorBanner()}
  <div>
    <div class="lbl between" style="margin-bottom:8px"><span>Screenshots <span style="font-weight:400;color:var(--ink3)">${n}</span></span>
      <span style="display:flex;gap:2px;margin-right:-8px">
        <button type="button" class="btn b-ghost b-sm" data-action="capture" title="Capture visible area (Alt+Shift+S)">${icon.capture}Capture</button>
        <button type="button" class="btn b-ghost b-sm" data-action="file">${icon.plus}Add</button>
      </span></div>
    ${n ? `<div class="shots">${st.shots.map((s, i) => `<div>
      <div class="shot-img"><img src="${s.thumb}" alt="Screenshot ${i + 1}">${s.marks.length ? '<span class="badge">Marked up</span>' : ''}</div>
      <div class="shot-actions">
        <button type="button" class="btn b-ghost b-sm" data-action="markup" data-id="${s.id}" aria-label="Mark up screenshot ${i + 1}">${icon.pen}Mark up</button>
        <button type="button" class="btn b-ghost b-sm" data-action="remove" data-id="${s.id}" aria-label="Remove screenshot ${i + 1}">${icon.trash}Remove</button>
      </div></div>`).join('')}</div>`
      : `<div class="drop-hint"><div class="hint">No screenshot. Paste one with Ctrl+V, or describe the bug below.</div></div>`}
  </div>
  ${st.page ? `<div>
    <div class="lbl">Page</div>
    <div class="mono url">${esc(st.page.url)}</div>
    <div class="hint" style="margin-top:2px">${st.page.capturedAt ? 'Captured ' + fmtTime(st.page.capturedAt) + ' · ' : ''}${esc(st.page.title || '')}</div>
    ${errorsBlock()}
  </div>` : ''}
  <div>
    <label class="lbl" for="note">What's wrong?</label>
    ${beam(`<textarea id="note" class="field" rows="2" data-bind="note" placeholder="One line, e.g. Dark mode leaves the dashboard canvas white">${esc(st.note)}</textarea>`)}
    <div class="hint" style="margin-top:4px">One line is enough. QArator reads the screenshots for the rest.</div>
  </div>
  <div>
    <button type="button" class="btn b-ghost b-sm" data-action="toggle-steps" aria-expanded="${st.stepsOpen}" style="margin-left:-8px;color:var(--ink2)">
      <span style="display:inline-flex;transform:${st.stepsOpen ? 'rotate(90deg)' : 'none'}">${icon.chevron}</span>Add your steps <span style="color:var(--ink3)">optional</span></button>
    ${st.stepsOpen ? `<label class="hint" for="steps" style="display:block;margin:6px 0 4px">One step per line. QArator keeps your wording.</label>
    ${beam(`<textarea id="steps" class="field" rows="4" data-bind="steps" placeholder="Open SEVI Dashboard&#10;Turn on dark mode">${esc(st.steps)}</textarea>`)}` : ''}
  </div>
  ${n || st.note ? '' : ''}
  <div><button type="button" class="btn b-ghost b-sm" data-action="reset" style="margin-left:-8px">Start over</button></div>`;
  dock.innerHTML = `
  <button type="button" class="btn b-pri wide" data-action="write" style="height:40px">Write bug report <span class="kbd" style="margin-left:4px">Ctrl+Enter</span></button>
  <div class="hint" style="text-align:center">Sends ${n ? `${n} screenshot${n === 1 ? '' : 's'}, ` : ''}your note${st.page?.errorsIncluded ? ' and page errors' : ''} to ${esc(providerName())}.</div>`;
  after();
  startRetryTimer();
}

function startRetryTimer() {
  clearInterval(tick);
  if (!st.error || !st.error.retryAt) return;
  tick = setInterval(() => {
    const left = Math.ceil((st.error?.retryAt - Date.now()) / 1000);
    if (!st.error || left <= 0) { clearInterval(tick); if (st.error) { st.error.retryAt = 0; if (st.view === 'capture') render(); } return; }
    const t = $('#retry-t'); if (t) t.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  }, 1000);
}

function renderWriting() {
  const ph = st.writing ? st.writing.phase : 0;
  const n = st.shots.length;
  const steps = [
    `Prepare ${n ? `${n} screenshot${n === 1 ? '' : 's'}` : 'your note'}`,
    `Send to ${providerName()}${S.ai.model ? ' · ' + S.ai.model : ''}`,
    n ? 'Read the screenshots and write sections in your house format' : 'Write sections in your house format',
    'Choose title, fields and tags'
  ];
  const stepHtml = steps.map((t, i) => {
    const done = i < ph, cur = i === ph;
    return `<div class="step"><span class="dot">${done ? icon.check : cur ? orb(i === 2 ? 'searching' : 'working', 20) : '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>'}</span>
      <span style="${cur ? 'font-weight:600' : done ? 'color:var(--ink2)' : 'color:var(--ink3)'}">${esc(t)}</span></div>`;
  }).join('');
  main.innerHTML = `
  ${n || st.note ? `<div style="display:flex;gap:12px;align-items:flex-start">
    <div class="thumbs" style="flex:none">${st.shots.slice(0, 3).map((s, i) => `<img src="${s.thumb}" alt="Screenshot ${i + 1}">`).join('')}</div>
    <div style="font-size:12px;color:var(--ink2);min-width:0">${st.note ? `“${esc(st.note)}”` : ''}</div></div>` : ''}
  <div role="status" aria-live="polite" style="display:flex;gap:14px;align-items:center">
    ${orb('composing', 64, 'Writing')}
    <div><h1 class="h1">Writing your bug report</h1><p class="hint" style="margin:4px 0 0">You can keep testing in the tab. The report opens here when it's ready.</p></div>
  </div>
  <div>${stepHtml}</div>
  <div class="skel" aria-hidden="true">
    <div><div class="lbl">Title</div><div class="bar" style="width:92%"></div><div class="bar" style="width:64%;margin-top:8px"></div></div>
    <div><div class="lbl">Summary</div><div class="bar"></div><div class="bar" style="width:96%;margin-top:8px"></div><div class="bar" style="width:58%;margin-top:8px"></div></div>
    <div><div class="lbl">Steps to reproduce</div><div class="bar" style="width:74%"></div><div class="bar" style="width:62%;margin-top:8px"></div><div class="bar" style="width:80%;margin-top:8px"></div></div>
  </div>`;
  dock.innerHTML = `<button type="button" class="btn b-sec wide" data-action="cancel">Cancel <span class="kbd" style="margin-left:4px">Esc</span></button>
  <div class="hint" style="text-align:center">Your screenshots and note stay here if you cancel.</div>`;
  after();
}

function titleHtml() {
  const segs = S.title.segments.map((k) => String(st.report.segments[k] || '').trim()).filter(Boolean);
  return segs.map(esc).join(`<span class="sep" style="white-space:pre">${esc(S.title.separator ?? ' | ')}</span>`);
}
function countHtml() {
  const len = buildTitle(st.report, S).length, max = S.title.maxLength || 150;
  return len > max ? `<span class="over">${len} / ${max} · ${len - max} over</span>` : `${len} / ${max}`;
}
function updateTitlePreview() {
  const p = $('#title-preview'); if (p) p.innerHTML = titleHtml();
  const c = $('#title-count'); if (c) c.innerHTML = countHtml();
  setProj();
}

function renderReview() {
  const r = st.report;
  const segLabel = { project: 'Project', portal: 'Portal', module: 'Module', page: 'Page', summary: 'Summary' };
  const segInputs = S.title.segments.map((k) => `<div class="${k === 'summary' ? 'span2' : ''}"><label class="slbl" for="seg-${k}">${segLabel[k]}</label>
    ${beam(`<input id="seg-${k}" class="field" data-seg="${k}" value="${esc(r.segments[k])}">`)}</div>`).join('');
  const sections = r.sections.map((s) => {
    const rows = Math.min(12, Math.max(s.layout === 'inline' ? 2 : isText(s.layout) ? 3 : 4, Math.ceil(s.text.length / 48) + s.text.split('\n').length - 1));
    const busy = st.busy === 'rewrite:' + s.id;
    return `<div><div class="lbl between"><label for="sec-${s.id}">${esc(s.name)}</label>
      ${!isText(s.layout) ? `<span class="hint" style="font-weight:400;margin-left:auto">One per line</span>` : ''}
      <button type="button" class="btn b-ghost b-sm" data-action="rewrite" data-id="${s.id}" aria-label="Rewrite ${esc(s.name)}" style="margin-right:-8px" ${st.busy ? 'disabled' : ''}>${busy ? orb('composing', 20) + 'Rewriting…' : 'Rewrite'}</button></div>
      ${beam(`<textarea id="sec-${s.id}" class="field" rows="${rows}" data-sec="${s.id}">${esc(s.text)}</textarea>`)}</div>`;
  }).join('');
  const fields = S.fields.map((f) => {
    const val = r.fields[f.id] || '';
    const opts = f.options.includes(val) || !val ? f.options : [val, ...f.options];
    return `<div><label class="slbl" for="fld-${f.id}">${esc(f.name)}${r.aiChosen[f.id] ? '<span class="ai-tag" title="Chosen by AI">AI</span>' : ''}</label>
      <select id="fld-${f.id}" class="field" data-field="${f.id}">${opts.map((o) => `<option${o === val ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
  }).join('');
  const tags = r.tags.map((t, i) => `<label class="tagc"><input type="checkbox" data-tag="${i}" ${t.on ? 'checked' : ''}>${esc(t.name)}</label>`).join('');
  main.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin:-8px -8px -8px -8px">
    <button type="button" class="btn b-ghost b-sm" data-action="back-capture">${icon.back}Back to capture</button>
    <span class="hint" style="margin-right:8px">Draft · not submitted</span></div>
  <section aria-labelledby="h-title">
    <div class="row-between"><h2 class="h2" id="h-title">Title</h2><span class="hint" id="title-count">${countHtml()}</span></div>
    <div class="grid2" style="margin-top:10px">${segInputs}</div>
    <div class="preview">
      <div class="row-between" style="align-items:center"><span class="lab">Preview</span>
        <button type="button" class="ib" data-action="copy-title" aria-label="Copy title" style="width:28px;height:28px">${icon.copy}</button></div>
      <div class="preview-text" id="title-preview" aria-live="polite">${titleHtml()}</div>
    </div>
  </section>
  <section aria-labelledby="h-desc" style="display:flex;flex-direction:column;gap:18px">
    <h2 class="h2" id="h-desc" style="margin-bottom:-6px">Description</h2>${sections}
  </section>
  <section aria-labelledby="h-fld">
    <div class="row-between"><h2 class="h2" id="h-fld">Issue fields</h2><span class="hint"><span class="ai-tag">AI</span> chosen by AI</span></div>
    <div class="grid2" style="margin-top:10px;gap:12px 10px">${fields}</div>
  </section>
  <section aria-labelledby="h-tag">
    <h2 class="h2" id="h-tag">Tags</h2>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:10px">${tags || '<span class="hint">No tags suggested.</span>'}</div>
    <div style="margin-top:8px;max-width:240px">${beam(`<input class="field" id="new-tag" aria-label="Add a tag" placeholder="Add a tag and press Enter" list="tag-list">`)}
      <datalist id="tag-list">${S.tags.list.map((t) => `<option value="${esc(t)}">`).join('')}</datalist></div>
  </section>
  ${st.shots.length ? `<section aria-labelledby="h-att"><h2 class="h2" id="h-att">Attachments</h2>
    <div class="thumbs" style="margin-top:10px">${st.shots.map((s, i) => `<img src="${s.thumb}" alt="Screenshot ${i + 1}">`).join('')}
    <span class="hint">${st.shots.length} screenshot${st.shots.length === 1 ? '' : 's'}${S.zoho.uploadScreenshots ? ', uploaded when you fill the form' : ''}</span></div></section>` : ''}`;
  const z = st.zoho;
  const banner = !z ? '' : z.kind === 'notzoho'
    ? `<div class="alert" role="alert"><span class="alert-icon">${icon.alert}</span><div><h2>Open the Zoho Submit Issue form first</h2>
       <p>The active tab is ${esc(z.active || 'not Zoho')}. ${z.zohoTabId ? 'Switch to your Zoho Projects tab' : 'Open Zoho Projects'}, go to Issues › Submit Issue, then press Fill Zoho form again.</p></div></div>`
    : z.kind === 'noform'
      ? `<div class="alert" role="alert"><span class="alert-icon">${icon.alert}</span><div><h2>No Submit Issue form found on this tab</h2>
       <p>Open Issues › Submit Issue in Zoho so the form is on screen, then press Fill Zoho form again. If the form is open, check the title label in settings › Zoho fill options.</p></div></div>`
      : `<div class="alert" role="alert"><span class="alert-icon">${icon.alert}</span><div><h2>Chrome blocked access to this tab</h2>
       <p>Reload the Zoho tab and try again.</p><div class="mono" style="font-size:11px;margin-top:4px">${esc(z.detail || '')}</div></div></div>`;
  const filling = st.busy === 'fill';
  dock.innerHTML = `${banner}
  ${z && z.kind === 'notzoho' ? `<button type="button" class="btn b-sec wide" data-action="open-zoho">${z.zohoTabId ? 'Switch to Zoho tab' : 'Open Zoho Projects'} ${icon.external}</button>` : ''}
  ${`<button type="button" class="btn b-pri wide" data-action="fill" style="height:40px" ${filling ? 'aria-disabled="true"' : ''}>${filling ? orb('working', 20, '', true) + 'Filling Zoho form…' : 'Fill Zoho form <span class="kbd" style="margin-left:4px">Ctrl+Enter</span>'}</button>`}
  <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px">
    <button type="button" class="btn b-sec b-sm" data-action="copy-title">${icon.copy}Copy title</button>
    <button type="button" class="btn b-sec b-sm" data-action="copy-desc">${icon.copy}Copy description</button>
    <button type="button" class="btn b-sec b-sm" data-action="save-shots" ${st.shots.length ? '' : 'disabled'}>${icon.download}Save screenshots</button>
  </div>`;
  after();
}

function renderFilled() {
  const res = st.fill.results;
  const checks = res.filter((r) => r.status === 'check');
  const filled = res.filter((r) => r.status === 'filled');
  const kept = res.filter((r) => r.status === 'kept');
  main.innerHTML = `
  <div role="status"><h1 class="h1">${checks.length ? `Form filled. Check ${checks.length} field${checks.length === 1 ? '' : 's'} before you submit.` : 'Form filled. Review it, then submit in Zoho.'}</h1>
  <p class="hint" style="margin:4px 0 0">Review the form in the Zoho tab, then press Submit there. QArator never submits for you.</p></div>
  ${checks.length ? `<section><div class="lbl" style="color:var(--acc-text)">Needs a manual check · ${checks.length}</div>
    ${checks.map((c) => `<div class="check-item"><span class="alert-icon" style="margin-top:2px">${icon.alert}</span>
      <div style="flex:1;min-width:0"><div style="font-weight:600">${esc(c.field)}${c.value ? `: <span style="font-weight:400">${esc(c.value)}</span>` : ''}</div>
      <div style="font-size:12px;color:var(--ink2);margin-top:2px">${esc(c.reason || '')}</div></div>
      ${c.missing ? '' : `<button type="button" class="btn b-sec b-sm" data-action="goto" data-name="${esc(c.field)}" aria-label="Go to ${esc(c.field)} in Zoho" style="flex:none">Go to field</button>`}</div>`).join('')}</section>` : ''}
  <section><div class="lbl">Filled · ${filled.length}</div>
    ${filled.map((d) => `<div class="res-row"><span role="img" aria-label="Filled" style="color:var(--ink2);display:inline-flex">${icon.check}</span><span class="name">${esc(d.field)}</span><span class="hint val" title="${esc(d.value || '')}">${esc(d.value || '')}</span></div>`).join('') || '<div class="hint">Nothing was filled.</div>'}
  </section>
  ${kept.length ? `<section><div class="lbl">Left as is · ${kept.length}</div>
    ${kept.map((d) => `<div class="res-row"><span aria-hidden="true" style="color:var(--ink3);display:inline-flex">–</span><span class="name">${esc(d.field)}</span><span class="hint val">${esc(d.reason || d.value || '')}</span></div>`).join('')}</section>` : ''}`;
  dock.innerHTML = `
  <button type="button" class="btn b-pri wide" data-action="next" style="height:40px">Start next bug <span class="kbd" style="margin-left:4px">Alt+Shift+S</span></button>
  <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px">
    <button type="button" class="btn b-sec b-sm" data-action="fill">Fill again</button>
    <button type="button" class="btn b-sec b-sm" data-action="back-review">Back to report</button>
  </div>`;
  after();
}

async function renderHistory() {
  const list = await history();
  main.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin:-8px">
    <button type="button" class="btn b-ghost b-sm" data-action="history-back">${icon.back}Back</button>
    ${list.length ? '<button type="button" class="btn b-ghost b-sm" data-action="history-clear">Clear list</button>' : ''}</div>
  <h1 class="h1">Recent reports</h1>
  <div>${list.length ? list.map((h) => `<div class="hist-item"><div style="flex:1;min-width:0"><div class="t">${esc(h.title)}</div><div class="hint">${esc(h.status)} · ${new Date(h.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</div></div>
    <button type="button" class="btn b-ghost b-sm" data-action="history-copy" data-id="${h.id}" aria-label="Copy title">${icon.copy}</button>
    <button type="button" class="btn b-sec b-sm" data-action="history-open" data-id="${h.id}">Open</button></div>`).join('')
    : '<p class="hint">Reports you fill or copy appear here. Screenshots are not kept.</p>'}</div>`;
  dock.innerHTML = '';
  after();
}

// ---------- events ----------
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-action]');
  if (!b || b.getAttribute('aria-disabled') === 'true' || b.disabled) return;
  const a = b.dataset.action, id = b.dataset.id;
  switch (a) {
    case 'capture': return captureTab();
    case 'file': return $('#file').click();
    case 'settings': return chrome.runtime.openOptionsPage();
    case 'noshot': st.noShot = true; render(); return $('#note')?.focus();
    case 'toggle-errors': st.page.errorsIncluded = !st.page.errorsIncluded; saveDraft(); return render();
    case 'toggle-steps': st.stepsOpen = !st.stepsOpen; render(); if (st.stepsOpen) $('#steps')?.focus(); return;
    case 'remove': st.shots = st.shots.filter((s) => s.id !== id); saveDraft(); return render();
    case 'markup': {
      const i = st.shots.findIndex((s) => s.id === id);
      const shot = st.shots[i];
      return openMarkup(shot, i, st.shots.length, {
        onApply: async ({ dataUrl, marks, original }) => { Object.assign(shot, { dataUrl, marks, original, thumb: await thumb(dataUrl) }); saveDraft(); render(); }
      });
    }
    case 'write': return write();
    case 'cancel': ctrl && ctrl.abort(); return;
    case 'dismiss-error': st.error = null; saveDraft(); return render();
    case 'blank': return blankReport();
    case 'reset': if (confirm('Clear the screenshots and note?')) { st = fresh(); saveDraft(); render(); } return;
    case 'back-capture': st.view = 'capture'; st.zoho = null; saveDraft(); return render();
    case 'back-review': st.view = 'review'; saveDraft(); return render();
    case 'rewrite': return rewrite(id);
    case 'copy-title': await copyText(buildTitle(st.report, S), 'Title copied'); return saveHistory('Copied, not filled');
    case 'copy-desc': await copyText(descriptionText(st.report), 'Description copied'); return saveHistory('Copied, not filled');
    case 'save-shots': st.shots.forEach((s) => downloadDataUrl(s.dataUrl, s.name)); return;
    case 'fill': return fillZoho();
    case 'open-zoho': return openZoho();
    case 'goto': return gotoField(b.dataset.name);
    case 'next': st = fresh(); saveDraft(); return render();
    case 'history': st.back = st.view === 'history' ? st.back : st.view; st.view = 'history'; return render();
    case 'history-back': st.view = st.back || 'capture'; return render();
    case 'history-clear': await chrome.storage.local.set({ history: [] }); return render();
    case 'history-copy': { const h = (await history()).find((x) => String(x.id) === id); if (h) copyText(h.title, 'Title copied'); return; }
    case 'history-open': {
      const h = (await history()).find((x) => String(x.id) === id);
      if (!h) return;
      st = { ...fresh(), report: h.report, page: h.page, view: 'review' };
      saveDraft(); return render();
    }
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.bind) { st[t.dataset.bind] = t.value; saveDraft(); return; }
  if (t.dataset.seg) { st.report.segments[t.dataset.seg] = t.value; updateTitlePreview(); saveDraft(); return; }
  if (t.dataset.sec) { const s = st.report.sections.find((x) => x.id === t.dataset.sec); if (s) s.text = t.value; saveDraft(); }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.field) {
    st.report.fields[t.dataset.field] = t.value; st.report.aiChosen[t.dataset.field] = false; saveDraft();
    const tag = document.querySelector(`label[for="fld-${t.dataset.field}"] .ai-tag`); if (tag) tag.remove();
  }
  if (t.dataset.tag !== undefined) { st.report.tags[Number(t.dataset.tag)].on = t.checked; saveDraft(); }
  if (t.id === 'file') { addFiles(t.files); t.value = ''; }
});
document.addEventListener('keydown', (e) => {
  if ($('#overlay').firstChild) return; // markup editor handles its own keys
  if (e.target.id === 'new-tag' && e.key === 'Enter') {
    e.preventDefault();
    const v = e.target.value.trim().toLowerCase();
    if (v && !st.report.tags.some((t) => t.name === v)) { st.report.tags.push({ name: v, on: true }); saveDraft(); render(); $('#new-tag')?.focus(); }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    if (st.view === 'capture') write(); else if (st.view === 'review') fillZoho();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); chrome.runtime.openOptionsPage(); return; }
  if (e.key === 'Escape' && st.view === 'writing') { ctrl && ctrl.abort(); }
});
document.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (!files.length || st.view === 'writing') return;
  e.preventDefault();
  addFiles(files);
});
let dragDepth = 0;
addEventListener('dragenter', (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { dragDepth++; $('#drop').hidden = false; } });
addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#drop').hidden = true; });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => { e.preventDefault(); dragDepth = 0; $('#drop').hidden = true; if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files); });

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (!st.zoho || st.view !== 'review') return;
  try { const t = await chrome.tabs.get(tabId); if (isZohoUrl(t.url || '')) { st.zoho = null; render(); } } catch (e) { /* ignore */ }
});
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'qarator:capture') { chrome.storage.session.remove('pendingCapture').catch(() => {}); captureTab(); }
});

// ---------- start ----------
(async function start() {
  $('#mark').innerHTML = markSvg(20);
  $('#btn-history').innerHTML = icon.clock;
  $('#btn-settings').innerHTML = icon.settings;
  S = await loadSettings();
  onSettingsChanged((s) => {
    S = s;
    if (st.error && (st.error.kind === 'nokey' || st.error.kind === 'nobase') && (S.ai.apiKey || S.ai.provider === 'compatible')) st.error = null;
    if (st.view !== 'writing') render();
  });
  env = await detectEnv();
  await loadDraft();
  watchTheme();
  render();
  try {
    const { pendingCapture } = await chrome.storage.session.get('pendingCapture');
    if (pendingCapture && Date.now() - pendingCapture < 5000) { await chrome.storage.session.remove('pendingCapture'); captureTab(); }
  } catch (e) { /* ignore */ }
})();
