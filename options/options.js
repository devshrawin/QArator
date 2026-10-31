// QArator settings page. Edits a copy of the settings and autosaves.
import { loadSettings, saveSettings, normalize, exportFormat, DEFAULTS, PROVIDERS, LAYOUTS, SEGMENTS, APPEARANCE, slug } from '../lib/settings.js';
import { listProjects, switchProject, addProject, newProject, renameProject, deleteProject } from '../lib/projects.js';
import { buildGuide } from '../lib/guide.js';
import { cleanKey, detectProvider, openKeyPage } from '../lib/keys.js';
import { listModels, describeError, rankModels, cooldowns, parseSlot, AUTO } from '../lib/ai.js';
import { summarize, parsePrices, rowCost, rupees, nextQuotaReset, istClock, usedToday, limitFor, parseLimits } from '../lib/usage.js';
import { buildTitle } from '../lib/report.js';
import { esc, icon, beam, orb, markSvg, applyTheme, applyAppearance, watchTheme, toast, fmtTime, askConfirm, askText } from '../lib/ui.js';

const $ = (s, r = document) => r.querySelector(s);
const main = $('#main');
let S, P = [], importNotes = null;
let keyShown = false, modelStatus = null, keyTimer = 0;
let U = { usage: {}, learnedLimits: {}, cool: {} }, usageDays = 1;

// ---------- navigation: one page at a time, with an icon for each ----------
const IC = {
  folder: 'M2 4.5h4l1.3 1.5H14v7H2z', key: 'M5.5 10.5a3 3 0 1 0 0-6a3 3 0 1 0 0 6 M8.3 7.5h5.2v2 M11.5 7.5v1.5', gauge: 'M2.8 11.5a5.5 5.5 0 1 1 10.4 0 M8 9l2.2-2.2',
  sun: 'M8 10.5a2.5 2.5 0 1 0 0-5a2.5 2.5 0 1 0 0 5 M8 1.5v1.5 M8 13v1.5 M1.5 8H3 M13 8h1.5 M3.4 3.4l1 1 M11.6 11.6l1 1 M3.4 12.6l1-1 M11.6 4.4l1-1',
  title: 'M3 4h10 M3 8h7 M3 12h4', sections: 'M3 3.5h10 M3 6.5h10 M3 9.5h10 M3 12.5h6', fields: 'M2.5 4h11v3.5h-11z M2.5 9.5h11V13h-11z M11 5.5l.7.7.7-.7',
  tag: 'M2.5 2.5h5.3l5.7 5.7-5.3 5.3-5.7-5.7z M5.5 5.5h.01', style: 'M3 13.5c2-1 2.5-3 4-4.5l4.5-6 1.5 1.5-6 4.5C5.5 10.5 4 11 3 13.5z',
  link: 'M6.5 9.5l3-3 M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1 M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1',
  globe: 'M8 14a6 6 0 1 0 0-12a6 6 0 1 0 0 12 M2 8h12 M8 2c1.7 1.8 2.5 3.8 2.5 6S9.7 12.2 8 14C6.3 12.2 5.5 10.2 5.5 8S6.3 3.8 8 2',
  search: 'M7 12a5 5 0 1 0 0-10a5 5 0 1 0 0 10 M10.6 10.6L14 14', chevDown: 'M4 6l4 4 4-4', chevRight: 'M6 4l4 4-4 4'
};
const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 16 16" aria-hidden="true"><path d="${IC[n]}"></path></svg>`;
// [section id, label, icon, the sections shown on that page]
const MAIN_NAV = [['projects', 'Projects', 'folder', ['projects']], ['ai', 'AI and key', 'key', ['ai', 'length']], ['usage', 'Usage', 'gauge', ['usage']], ['appearance', 'Appearance', 'sun', ['appearance']]];
const FMT_NAV = [['scopes', 'Sites and portals', 'globe', ['scopes']], ['title', 'Title format', 'title', ['title']], ['sections', 'Description sections', 'sections', ['sections']], ['fields', 'Fields', 'fields', ['fields']], ['tags', 'Tags', 'tag', ['tags']], ['style', 'Style example', 'style', ['style']], ['zoho', 'Zoho labels', 'link', ['zoho']]];
const ALL_NAV = [...MAIN_NAV, ...FMT_NAV];
const INDEX = [
  ['Main key', 'AI and key', 'ai', 'key'], ['Backup key', 'AI and key', 'ai', 'key'], ['Model', 'AI and key', 'ai', 'key'], ['Writing length', 'AI and key', 'ai', 'key'], ['Page errors', 'AI and key', 'length', 'key'],
  ['Requests left per key', 'Usage', 'usage', 'gauge'], ['Theme', 'Appearance', 'appearance', 'sun'], ['Text size', 'Appearance', 'appearance', 'sun'], ['Reduce motion', 'Appearance', 'appearance', 'sun'],
  ['Import a project file', 'Projects', 'projects', 'folder'], ['Export this project', 'Projects', 'projects', 'folder'], ['Download setup guide', 'Projects', 'projects', 'folder'], ['Set up a new project', 'Projects', 'projects', 'folder'],
  ['Title format', 'Format of this project', 'title', 'title'], ['Separator', 'Format › Title format', 'title', 'title'], ['Description sections', 'Format of this project', 'sections', 'sections'],
  ['Fields and choices', 'Format of this project', 'fields', 'fields'], ['Tags', 'Format of this project', 'tags', 'tag'], ['Zoho labels', 'Format of this project', 'zoho', 'link'], ['Sites and portals', 'Format of this project', 'scopes', 'globe']
];
const pageOf = (id) => (ALL_NAV.find((n) => n[3].includes(id)) || MAIN_NAV[1])[0];
let curPage = pageOf((location.hash || '').slice(1) || 'ai'), fmtOpen = true, query = '';
function navHtml() {
  const item = (n, sub = false) => `<a class="nav-item${sub ? ' nav-sub' : ''}" href="#${n[0]}" ${curPage === n[0] && !query ? 'aria-current="page"' : ''}>${ic(n[2], sub ? 'ic-14' : '')}${esc(n[1])}</a>`;
  return `<div class="search" style="margin-bottom:10px">${ic('search')}<input class="field" id="nav-q" type="search" style="height:32px" placeholder="Search settings" aria-label="Search settings" value="${esc(query)}"></div>
  ${MAIN_NAV.map((n) => item(n)).join('')}
  <button type="button" class="nav-group" id="fmt-toggle" aria-expanded="${fmtOpen}" style="border:0;background:transparent;cursor:pointer;width:100%"><span>Format of this project · <span class="mono">${esc((S.title && S.title.project) || '')}</span></span>${ic(fmtOpen ? 'chevDown' : 'chevRight', 'ic-14')}</button>
  ${fmtOpen ? FMT_NAV.map((n) => item(n, true)).join('') : '<p class="t-xs c3" style="padding:0 10px">Usually set once by the team lead. Open to change the title, sections, fields and tags.</p>'}`;
}
function resultsHtml() {
  const q = query.trim().toLowerCase();
  const hits = INDEX.filter((r) => (r[0] + ' ' + r[1]).toLowerCase().includes(q));
  return `<section class="sec" id="results"><div><h2>Results for “${esc(query)}”</h2><p class="desc">${hits.length} setting${hits.length === 1 ? '' : 's'} match.</p></div>
  <div>${hits.map((r) => `<a class="lrow" href="#${r[2]}" data-result="${r[2]}" style="color:var(--text);text-decoration:none"><span class="c3">${ic(r[3])}</span><div style="flex:1"><div class="medium">${esc(r[0])}</div><div class="t-sm c3">${esc(r[1])}</div></div><span class="c3">${ic('chevRight')}</span></a>`).join('') || '<p class="hint">Nothing matches. Try “key”, “theme” or “tags”.</p>'}</div></section>`;
}
function applyPage() {
  const show = query.trim() ? ['results'] : (ALL_NAV.find((n) => n[0] === curPage) || MAIN_NAV[1])[3];
  document.querySelectorAll('main > .sec').forEach((el) => { el.hidden = !show.includes(el.id); });
  const nav = $('#nav'); if (nav) { const q = document.getElementById('nav-q'); const keep = q && document.activeElement === q ? [q.selectionStart, q.selectionEnd] : null; nav.innerHTML = navHtml(); if (keep) { const n = document.getElementById('nav-q'); n.focus(); n.setSelectionRange(...keep); } }
}
function showPage(id) { query = ''; curPage = pageOf(id); history.replaceState(null, '', '#' + id); render(); scrollTo(0, 0); }

// ---------- saving ----------
let t = 0;
function save() {
  clearTimeout(t);
  $('#saved').textContent = 'Saving…';
  t = setTimeout(async () => {
    await saveSettings(S);
    $('#saved').textContent = `All changes saved · ${fmtTime(Date.now())}`;
  }, 350);
}

function getPath(path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), S); }
function setPath(path, value) {
  const keys = path.split('.'); const last = keys.pop();
  const obj = keys.reduce((o, k) => o[k], S);
  obj[last] = value;
}
const B = (inner) => beam(inner);
const input = (path, attrs = '') => B(`<input class="field" data-path="${path}" value="${esc(getPath(path))}" ${attrs}>`);

// ---------- sections ----------
function secAI() {
  const p = S.ai.provider;
  const models = S.ai.models || [];
  const st = modelStatus;
  return `<section class="sec" id="ai">
  <div><h2>AI provider and key</h2><p class="desc">QArator sends the screenshot, your note and page details to this provider to write the report.</p></div>
  <div class="g2">
    <div><label class="lbl" for="prov">Provider</label>
      <select id="prov" class="field" data-path="ai.provider" data-rerender="1">${Object.entries(PROVIDERS).map(([k, v]) => `<option value="${k}" ${k === p ? 'selected' : ''}>${esc(v.label)}</option>`).join('')}</select></div>
    <div><label class="lbl" for="key">API key</label>
      <div style="display:flex;gap:6px"><div style="flex:1;min-width:0">${B(`<input id="key" class="field mono" type="${keyShown ? 'text' : 'password'}" data-path="ai.apiKey" value="${esc(S.ai.apiKey)}" autocomplete="off" spellcheck="false" placeholder="${esc(PROVIDERS[p].keyHint)}">`)}</div>
      <button type="button" class="btn btn-secondary" data-act="show-key" style="flex:none" aria-pressed="${keyShown}">${keyShown ? 'Hide' : 'Show'}</button></div></div>
    ${p !== 'compatible' ? `<div style="grid-column:1/-1"><label class="lbl" for="key2">Backup key <span style="font-weight:400;color:var(--ink3)">optional</span></label>
      <div style="max-width:480px">${B(`<input id="key2" class="field mono" type="${keyShown ? 'text' : 'password'}" data-path="ai.apiKey2" value="${esc(S.ai.apiKey2 || '')}" autocomplete="off" spellcheck="false" placeholder="Used when the main key runs out or is rejected">`)}</div>
      <div class="hint" style="margin-top:4px">${p === 'gemini' ? 'Google counts free quota per Google Cloud project, not per key: create the backup key in a different project or Google account, or it runs out at the same time.' : 'Used when the main key is rate-limited or rejected.'}</div></div>` : ''}
    ${PROVIDERS[p].needsBase ? `<div class="span2" style="grid-column:1/-1"><label class="lbl" for="base">Endpoint base address</label>${B(`<input id="base" class="field mono" data-path="ai.baseUrl" value="${esc(S.ai.baseUrl)}" placeholder="https://your-server/v1">`)}
      <div class="hint" style="margin-top:4px">QArator calls /models and /chat/completions under this address.</div></div>` : ''}
  </div>
  ${p === 'gemini' && !String(S.ai.apiKey || '').trim() ? `<div class="getkey"><div class="gk-t">No key yet? It is free and takes a minute.</div><div class="row"><button type="button" class="btn btn-primary" data-act="get-key">Get my free key ${icon.external}</button><span class="hint">Opens Google AI Studio. QArator shows a card there with a button that sends the key back here. If Google blocks your work account, use a personal Gmail.</span></div></div>` : ''}
  <div class="row">
    <button type="button" class="btn btn-secondary" data-act="check" ${st === 'busy' ? 'aria-disabled="true"' : ''}>${st === 'busy' ? orb('connecting', 20) + 'Checking…' : icon.refresh + 'Check key and load models'}</button>
    <span role="status" aria-live="polite">${st && st !== 'busy' ? (st.ok ? `<span class="status">${icon.check}Key works. ${st.count} model${st.count === 1 ? '' : 's'} loaded.</span>` : `<span class="status bad">${icon.alert}${esc(st.msg)}</span>`) : ''}</span>
  </div>
  ${modelPicker()}
  <p class="hint" style="margin:0">Your key is stored only in this browser and sent only to the provider above. It is never included in an export.</p>
  </section>`;
}

function modelPicker() {
  const models = S.ai.models || [];
  const auto = !S.ai.model || S.ai.model === AUTO;
  const list = models.some((m) => m.id === S.ai.model) || auto ? models : [{ id: S.ai.model, label: S.ai.model }, ...models];
  const order = rankModels(S.ai.provider, models).slice(0, 4);
  const autoHint = !models.length ? 'Auto loads your key\'s models the first time it writes, or press Check key now.'
    : order.length ? `Auto tries ${order.map(esc).join(', then ')}. A model that hits its limit rests until it can answer again.` : 'No image-capable model found for this key.';
  return `<div class="g2">
    <div><label class="lbl" for="model">Model</label>
      <select id="model" class="field" data-path="ai.model" data-type="model">
        <option value="${AUTO}" ${auto ? 'selected' : ''}>Auto (recommended)</option>
        ${list.map((m) => `<option value="${esc(m.id)}" ${m.id === S.ai.model ? 'selected' : ''}>${esc(m.label === m.id ? m.id : `${m.label} · ${m.id}`)}</option>`).join('')}
      </select>
      <div class="hint" style="margin-top:4px">${auto ? autoHint : 'Pick a model that can read images.'}</div></div>
    ${!models.length && S.ai.provider !== 'gemini' ? `<div><label class="lbl" for="model-id">Or type a model id</label>${B(`<input id="model-id" class="field mono" data-path="ai.model" value="${auto ? '' : esc(S.ai.model)}" placeholder="model-id">`)}</div>` : ''}
  </div>
  ${auto ? '' : `<label class="chk"><input type="checkbox" data-type="bool" data-path="ai.fallback" ${S.ai.fallback !== false ? 'checked' : ''}><span>When this model is busy or out of quota, use the next best one<br><span class="hint">The report says which model wrote it.</span></span></label>`}`;
}

function secUsage() {
  const rows = summarize(U.usage, usageDays);
  const own = parsePrices(S.usage.prices);
  const rate = S.usage.usdInr;
  const RANGE = { 1: 'today', 7: 'in the last 7 days', 30: 'in the last 30 days' };
  const KIND = { write: 'Write report', rewrite: 'Rewrite section' };
  const fmtN = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
  let usd = 0, assumed = false;
  const body = rows.map((r) => {
    const c = rowCost(r, own);
    if (c) { usd += c.usd; assumed ||= c.assumed; }
    const lim = limitFor(r.model, { learned: U.learnedLimits, typed: parseLimits(S.usage.limits) });
    let left = usageDays === 1 ? '<span class="hint">No known limit</span>' : '';
    if (usageDays === 1 && lim) {
      const remaining = Math.max(0, lim.limit - usedToday(U.usage, r.model, r.key));
      const pct = Math.round((remaining / lim.limit) * 100);
      left = `<div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${esc(r.model)} left today"><i class="${pct === 0 ? 's' : pct <= 20 ? 'q' : ''}" style="width:${pct}%"></i></div><div class="hint">${lim.source === 'assumed' ? '~' : ''}${remaining} of ${lim.source === 'assumed' ? '~' : ''}${lim.limit} left${lim.source === 'assumed' ? ' (assumed free-tier limit)' : ''}</div>`;
    }
    const rest = Object.entries(U.cool).filter(([slot]) => { const p = parseSlot(slot); return p.model === r.model && p.tag === r.key; }).map(([, u]) => u);
    if (rest.length) left += `<div class="hint" style="color:var(--acc-text)">Resting until ${istClock(Math.max(...rest))}</div>`;
    return `<tr><td><strong style="font-weight:600">${esc(r.model)}</strong><div class="hint">${esc(r.provider)}${r.key === 'backup' ? ' · backup key' : ''}</div></td><td>${KIND[r.kind] || esc(r.kind)}</td>
      <td class="num">${r.req}</td><td class="num">${r.fail ? `${r.fail}${r.rl ? ` (${r.rl} limit)` : ''}` : '0'}</td>
      <td class="num">${r.tin || r.tout ? `${fmtN(r.tin)} / ${fmtN(r.tout)}` : '–'}</td>
      <td class="num">${c ? `${c.assumed ? '~' : ''}${rupees(c.usd, rate)}` : '–'}</td><td>${left}</td></tr>`;
  }).join('');
  const reqs = rows.reduce((a, r) => a + r.req, 0);
  return `<section class="sec" id="usage">
  <div><div><h2>Usage</h2><p class="desc">Every request QArator sends to your AI provider, counted in this browser. Providers do not report free quota left, so limits are learned from their rate-limit replies.</p></div></div>
  <div class="row" role="group" aria-label="Range">${[1, 7, 30].map((d) => `<button type="button" class="btn ${usageDays === d ? 'btn-primary' : 'btn-secondary'} btn-sm" data-act="usage-days" data-i="${d}" aria-pressed="${usageDays === d}">${d === 1 ? 'Today' : `${d} days`}</button>`).join('')}</div>
  <div class="tbl-wrap"><table class="tbl" id="usage-table" style="min-width:720px"><thead><tr><th scope="col">Model</th><th scope="col">Used for</th><th scope="col" class="num">Requests</th><th scope="col" class="num">Failed</th><th scope="col" class="num">Tokens in / out</th><th scope="col" class="num">Cost if paid</th><th scope="col" style="width:150px">${usageDays === 1 ? 'Left today' : ''}</th></tr></thead>
  <tbody>${body || '<tr><td colspan="7" class="hint">Nothing yet. Counts start with your next report.</td></tr>'}</tbody></table></div>
  <div class="row" id="usage-totals" style="gap:6px 18px"><strong>Total ${RANGE[usageDays]}</strong><span>${reqs} request${reqs === 1 ? '' : 's'}</span>
    <span>If paid: about ${rupees(usd, rate)}${assumed ? ' (list prices assumed)' : ''}</span>
    <span class="hint" style="margin-left:auto">Daily quotas reset at ${istClock(nextQuotaReset())} (midnight Pacific)</span></div>
  <details><summary class="hint" style="cursor:pointer">Daily limits, prices and exchange rate</summary>
    <div class="g2" style="margin-top:10px">
      <div><label class="lbl" for="ulimits">Daily request limits</label>${B(`<textarea id="ulimits" class="field mono" rows="3" data-path="usage.limits" placeholder="gemini-2.5-flash=250">${esc(S.usage.limits || '')}</textarea>`)}
        <div class="hint" style="margin-top:4px">One model per line: model=requests per day. Used for the running-low warning; limits Google reports in its rate-limit replies are learned automatically.</div></div>
      <div><label class="lbl" for="uprices">Your prices (USD per million tokens)</label>${B(`<textarea id="uprices" class="field mono" rows="3" data-path="usage.prices" placeholder="gemini-2.5-flash=0.30,2.50">${esc(S.usage.prices)}</textarea>`)}
        <div class="hint" style="margin-top:4px">One model per line: model=input,output. Others use rough list prices.</div></div>
      <div><label class="lbl" for="urate">Rupees per US dollar</label>${B(`<input id="urate" class="field" type="number" min="1" data-type="number" data-path="usage.usdInr" value="${esc(rate)}">`)}</div>
    </div></details>
  <div><button type="button" class="btn btn-ghost" data-act="usage-reset" style="margin-left:-8px">Reset counters</button></div>
  </section>`;
}

async function loadUsage() {
  const { usage = {}, learnedLimits = {} } = await chrome.storage.local.get(['usage', 'learnedLimits']);
  U = { usage, learnedLimits, cool: await cooldowns() };
}

// ---------- projects ----------
function secProjects() {
  const rows = P.map((p) => `<div class="prow${p.active ? ' on' : ''}">
    <span class="pdot" aria-hidden="true">${p.active ? icon.check : ''}</span>
    ${B(`<input class="field" data-pj-name="${esc(p.id)}" aria-label="Project name" value="${esc(p.name)}">`)}
    <span class="hint pmeta">${p.scopes ? `${p.scopes} portal${p.scopes === 1 ? '' : 's'}` : ''}</span>
    ${p.active ? '<span class="hint">In use</span>' : `<button type="button" class="btn btn-secondary btn-sm" data-act="pj-use" data-id="${esc(p.id)}">Use</button>`}
    <button type="button" class="btn btn-icon" data-act="pj-del" data-id="${esc(p.id)}" aria-label="Delete ${esc(p.name)}" ${P.length < 2 ? 'disabled' : ''}>${icon.x}</button></div>`).join('');
  const notes = importNotes ? `<div class="notes" role="status"><strong>${esc(importNotes.title)}</strong>${importNotes.items.length ? `<ul>${importNotes.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><div class="hint">Anything listed was repaired on import. Fix it in the sections below, or send this list back to your AI agent.</div>` : ''}</div>` : '';
  return `<section class="sec" id="projects">
  <div><h2>Projects</h2><p class="desc">A project is a saved setup: title format, sections, fields, tags and portals. Keep one per team or product, and switch in the panel. Your AI key and look stay yours.</p></div>
  <div>${rows}</div>
  ${notes}
  <div class="row">
    <a class="btn btn-primary" href="project-setup.html">Set up a new project</a>
    <button type="button" class="btn btn-secondary" data-act="import">${icon.upload}Import a project file</button>
    <button type="button" class="btn btn-secondary" data-act="pj-new">${icon.plus}New blank project</button>
    <button type="button" class="btn btn-secondary" data-act="export">${icon.download}Export this project</button>
    <button type="button" class="btn btn-ghost" data-act="reset">Reset this project to the neutral setup</button>
  </div>
  <div class="guide-box"><strong>Setting up a new platform (Jira, Confluence, Zoho, anything)?</strong>
    <p class="desc" style="margin:4px 0 8px">Download the setup guide, give it to any AI agent together with a screenshot or description of your bug form and a sample report, and import the file it writes.</p>
    <button type="button" class="btn btn-secondary" data-act="guide">${icon.download}Download setup guide (.md)</button></div>
  </section>`;
}

function secLength() {
  const opt = [['brief', 'Brief', 'One or two sentences per section. Good for obvious visual bugs.'], ['standard', 'Standard', 'Short paragraphs and full steps. The team default.'], ['detailed', 'Detailed', 'Adds context, affected areas and console errors in full.']];
  return `<section class="sec" id="length">
  <div><h2>Writing length</h2><p class="desc">How much detail the AI writes in each section.</p></div>
  <fieldset style="border:0;padding:0;margin:0;display:flex;flex-direction:column;gap:10px"><legend class="lbl" style="margin-bottom:8px">Length</legend>
  ${opt.map(([v, n, d]) => `<label class="chk"><input type="radio" name="len" value="${v}" data-path="writingLength" ${S.writingLength === v ? 'checked' : ''}><span><strong style="font-weight:600">${n}</strong><br><span class="hint">${d}</span></span></label>`).join('')}
  </fieldset>
  <label class="chk"><input type="checkbox" data-type="bool" data-path="pageErrors" ${S.pageErrors ? 'checked' : ''}><span>Collect page errors<br><span class="hint">Off by default. When on, QArator watches console errors and failed requests on the sites you test and offers them for the report. Tabs that were already open need one reload.</span></span></label>
  </section>`;
}

function exampleTitle() {
  return buildTitle({ segments: { project: S.title.project, portal: 'Admin Portal', module: 'Orders', page: 'Order List', summary: S.title.summaryCase === 'title' ? 'Export Button Does Nothing' : 'Export button does nothing' } }, S);
}

function secTitle() {
  const segs = S.title.segments;
  return `<section class="sec" id="title">
  <div><h2>Title format</h2><p class="desc">Titles are built from these segments in this order. Use the arrows to reorder.</p></div>
  <div class="row" role="list" aria-label="Title segments">${segs.map((k, i) => `<span class="tok" role="listitem">${SEGMENTS[k]}
    <button type="button" class="btn btn-icon" style="width:24px;height:24px" data-act="seg-left" data-i="${i}" aria-label="Move ${SEGMENTS[k]} earlier" ${i === 0 ? 'disabled' : ''}>${icon.left}</button>
    <button type="button" class="btn btn-icon" style="width:24px;height:24px" data-act="seg-right" data-i="${i}" aria-label="Move ${SEGMENTS[k]} later" ${i === segs.length - 1 ? 'disabled' : ''}>${icon.right}</button></span>`).join('')}</div>
  <div class="g4">
    <div><label class="lbl" for="tproj">Project</label>${B(`<input id="tproj" class="field" data-path="title.project" data-live="example" value="${esc(S.title.project)}">`)}</div>
    <div><label class="lbl" for="tsep">Separator</label>${B(`<input id="tsep" class="field mono" data-path="title.separator" data-live="example" value="${esc(S.title.separator)}">`)}</div>
    <div><label class="lbl" for="tmax">Max length</label>${B(`<input id="tmax" class="field" type="number" min="20" max="500" data-type="number" data-path="title.maxLength" value="${esc(S.title.maxLength)}">`)}</div>
    <div><label class="lbl" for="tcase">Summary style</label><select id="tcase" class="field" data-path="title.summaryCase" data-live="example"><option value="title" ${S.title.summaryCase === 'title' ? 'selected' : ''}>Title Case</option><option value="sentence" ${S.title.summaryCase === 'sentence' ? 'selected' : ''}>Sentence case</option></select></div>
  </div>
  <div class="example"><div class="lab">Example</div><div class="t" id="ex-title">${esc(exampleTitle())}</div></div>
  <div><h3>URL rules</h3>
  <p class="hint" style="margin:0 0 10px">Checked top to bottom; the first match fills each segment. Without a rule, names are read from the page (breadcrumb, menu, heading). When you change them in a report and fill, copy or export it, QArator saves a rule for that page.</p>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col" style="width:34%">When the URL contains</th><th scope="col">Portal</th><th scope="col">Module</th><th scope="col">Page</th><th scope="col" style="width:96px"><span class="sr-only">Actions</span></th></tr></thead><tbody>
  ${S.urlRules.map((r, i) => `<tr>
    <td>${B(`<input class="field mono" aria-label="URL contains, rule ${i + 1}" data-path="urlRules.${i}.match" value="${esc(r.match)}">`)}${r.learned ? '<div class="hint">Learned from a report</div>' : ''}</td>
    <td>${B(`<input class="field" aria-label="Portal, rule ${i + 1}" data-path="urlRules.${i}.portal" value="${esc(r.portal)}" placeholder="—">`)}</td>
    <td>${B(`<input class="field" aria-label="Module, rule ${i + 1}" data-path="urlRules.${i}.module" value="${esc(r.module)}" placeholder="—">`)}</td>
    <td>${B(`<input class="field" aria-label="Page, rule ${i + 1}" data-path="urlRules.${i}.page" value="${esc(r.page)}" placeholder="—">`)}</td>
    <td style="white-space:nowrap"><button type="button" class="btn btn-icon" data-act="rule-up" data-i="${i}" aria-label="Move rule ${i + 1} up" ${i === 0 ? 'disabled' : ''}>${icon.up}</button><button type="button" class="btn btn-icon" data-act="rule-del" data-i="${i}" aria-label="Delete rule ${i + 1}">${icon.x}</button></td></tr>`).join('')}
  </tbody></table></div>
  <button type="button" class="btn btn-ghost" data-act="rule-add" style="margin:8px 0 0 -8px">${icon.plus}Add rule</button></div>
  </section>`;
}

function secSections() {
  return `<section class="sec" id="sections">
  <div><h2>Description sections</h2><p class="desc">The sections the AI writes, in this order. Guidance tells it what belongs in each one.</p></div>
  <div>${S.sections.map((s, i) => `<div class="secrow">
    <div style="display:flex"><button type="button" class="btn btn-icon" data-act="sec-up" data-i="${i}" aria-label="Move ${esc(s.name)} up" ${i === 0 ? 'disabled' : ''}>${icon.up}</button><button type="button" class="btn btn-icon" data-act="sec-down" data-i="${i}" aria-label="Move ${esc(s.name)} down" ${i === S.sections.length - 1 ? 'disabled' : ''}>${icon.down}</button></div>
    ${B(`<input class="field" aria-label="Section name" data-path="sections.${i}.name" value="${esc(s.name)}" style="font-weight:600">`)}
    <select class="field" aria-label="Layout for ${esc(s.name)}" data-path="sections.${i}.layout">${Object.entries(LAYOUTS).map(([k, v]) => `<option value="${k}" ${k === s.layout ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <label class="chk inline" style="font-size:12px"><input type="checkbox" data-type="bool" data-path="sections.${i}.include" ${s.include ? 'checked' : ''}>Include</label>
    <button type="button" class="btn btn-icon" data-act="sec-del" data-i="${i}" aria-label="Delete ${esc(s.name)}" ${S.sections.length <= 1 ? 'disabled' : ''}>${icon.x}</button>
    <div class="guide">${B(`<input class="field" aria-label="AI guidance for ${esc(s.name)}" data-path="sections.${i}.guide" value="${esc(s.guide)}" style="color:var(--ink2)" placeholder="What the AI should write here">`)}</div>
  </div>`).join('')}</div>
  <div class="row"><button type="button" class="btn btn-ghost" data-act="sec-add" style="margin-left:-8px">${icon.plus}Add section</button>
  <span class="hint">A section named “Steps to Reproduce” (id steps) keeps the tester's own steps when they add them.</span></div>
  </section>`;
}

function secFields() {
  return `<section class="sec" id="fields">
  <div><h2>Issue fields</h2><p class="desc">Dropdowns shown in the review screen. Option names must match Zoho exactly to fill without a manual check. The Zoho label is the text QArator looks for next to the field; separate alternatives with |.</p></div>
  <div class="tbl-wrap"><table class="tbl" style="min-width:760px"><thead><tr><th scope="col" style="width:120px">Field</th><th scope="col" style="width:150px">Zoho label</th><th scope="col">Options</th><th scope="col" style="width:140px">Default</th><th scope="col" style="width:92px">AI chooses</th><th scope="col" style="width:36px"><span class="sr-only">Delete</span></th></tr></thead><tbody>
  ${S.fields.map((f, i) => `<tr>
    <td>${B(`<input class="field" aria-label="Field name" data-path="fields.${i}.name" value="${esc(f.name)}" style="font-weight:600">`)}</td>
    <td>${B(`<input class="field" aria-label="Zoho label for ${esc(f.name)}" data-path="fields.${i}.zohoLabel" value="${esc(f.zohoLabel)}">`)}</td>
    <td>${B(`<input class="field" aria-label="Options for ${esc(f.name)}, comma separated" data-type="list" data-rerender-blur="1" data-path="fields.${i}.options" value="${esc(f.options.join(', '))}">`)}</td>
    <td><select class="field" aria-label="Default for ${esc(f.name)}" data-path="fields.${i}.default">${f.options.map((o) => `<option ${o === f.default ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></td>
    <td><label class="chk inline"><input type="checkbox" role="switch" data-type="bool" aria-label="AI chooses ${esc(f.name)}" data-path="fields.${i}.ai" ${f.ai ? 'checked' : ''}><span class="hint">${f.ai ? 'On' : 'Off'}</span></label></td>
    <td><button type="button" class="btn btn-icon" data-act="field-del" data-i="${i}" aria-label="Delete ${esc(f.name)}">${icon.x}</button></td></tr>`).join('')}
  </tbody></table></div>
  <div class="row"><button type="button" class="btn btn-ghost" data-act="field-add" style="margin-left:-8px">${icon.plus}Add field</button>
  <span class="hint">When AI chooses is off, the default is used and the tester can change it in review. A value of Unassigned is left empty in Zoho.</span></div>
  </section>`;
}

function secTags() {
  return `<section class="sec" id="tags">
  <div><h2>Tags</h2><p class="desc">The AI suggests tags from this list. Testers tick the ones to add.</p></div>
  <div class="row">${S.tags.list.map((g, i) => `<span class="tok">${esc(g)}<button type="button" class="btn btn-icon" style="width:22px;height:22px" data-act="tag-del" data-i="${i}" aria-label="Remove tag ${esc(g)}">${icon.x}</button></span>`).join('') || '<span class="hint">No tags yet.</span>'}</div>
  <div class="g2" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr);align-items:end">
    <div><label class="lbl" for="newtag">Add a tag</label>${B(`<input id="newtag" class="field" placeholder="Type a tag and press Enter">`)}</div>
    <div><label class="lbl" for="maxtag">Suggest up to</label><select id="maxtag" class="field" data-type="number" data-path="tags.max">${[3, 5, 8, 10].map((n) => `<option value="${n}" ${S.tags.max === n ? 'selected' : ''}>${n} tags</option>`).join('')}</select></div>
  </div>
  <label class="chk"><input type="checkbox" data-type="bool" data-path="tags.onlyFromList" ${S.tags.onlyFromList ? 'checked' : ''}><span>Only suggest tags from this list<br><span class="hint">Turn off to let the AI propose new tags. New tags need creating in Zoho before they fill.</span></span></label>
  </section>`;
}

function secStyle() {
  return `<section class="sec" id="style">
  <div><h2>Style example</h2><p class="desc">Paste one report your team considers good. The AI matches its tone, length and wording.</p></div>
  <div><label class="lbl" for="example">Example report</label>${B(`<textarea id="example" class="field" rows="12" data-path="styleExample">${esc(S.styleExample)}</textarea>`)}
  <div class="hint" style="margin-top:4px">Remove names, phone and ID numbers before pasting. This text is included when you export the format.</div></div>
  </section>`;
}

function secZoho() {
  const z = S.zoho;
  const cb = (path, title, hint = '') => `<label class="chk"><input type="checkbox" data-type="bool" data-path="zoho.${path}" ${z[path] ? 'checked' : ''}><span>${title}${hint ? `<br><span class="hint">${hint}</span>` : ''}</span></label>`;
  return `<section class="sec" id="zoho">
  <div><h2>Zoho fill options</h2><p class="desc">How QArator fills the Submit Issue form. It never presses Submit.</p></div>
  <div class="g2">
    <div><label class="lbl" for="zdom">Zoho Projects address</label>${B(`<input id="zdom" class="field mono" data-path="zoho.domain" value="${esc(z.domain)}" placeholder="projects.zoho.in">`)}</div>
    <div><label class="lbl" for="zsub">Submit Issue page (optional)</label>${B(`<input id="zsub" class="field mono" data-path="zoho.submitUrl" value="${esc(z.submitUrl)}" placeholder="Opened by “Open Zoho Projects”">`)}</div>
    <div><label class="lbl" for="zt">Title field label</label>${input('zoho.titleLabel', 'id="zt"')}</div>
    <div><label class="lbl" for="zd">Description field label</label>${input('zoho.descriptionLabel', 'id="zd"')}</div>
    <div><label class="lbl" for="zg">Tags field label</label>${input('zoho.tagsLabel', 'id="zg"')}</div>
    <div><label class="lbl" for="za">Attachment field label</label>${input('zoho.attachLabel', 'id="za"')}</div>
    <div><label class="lbl" for="zs">Steps box label</label>${input('zoho.stepsLabel', 'id="zs"')}</div>
  </div>
  <p class="hint" style="margin:-6px 0 0">Labels are matched against the text shown next to each field in your Zoho form. Separate alternatives with |.</p>
  <div style="display:flex;flex-direction:column;gap:12px">
    ${cb('uploadScreenshots', 'Upload screenshots as attachments')}
    ${cb('looseMatch', 'Match dropdown options loosely', 'Ignores case and extra spaces, so “ui / visual” fills “UI / Visual”.')}
    ${cb('scrollToFirst', 'Scroll to the first field that needs a check')}
    ${cb('emptyOnly', 'Fill empty fields only', 'Keeps anything you already typed in the Zoho form.')}
    ${cb('stepsField', 'Also fill Zoho’s separate Steps to Reproduce box', 'The steps stay in the description too. Zoho limits this box to 1000 characters.')}
    ${cb('fillTags', 'Also add ticked tags in Zoho', 'Off: after filling, QArator lists the suggested tags from your list with Copy buttons and you add them in Zoho.')}
    <label class="chk" style="cursor:default"><input type="checkbox" checked disabled><span>Leave Submit to me <span class="hint">· always on</span></span></label>
  </div>
  </section>`;
}

function secAppearance() {
  const a = S.appearance;
  const group = (key, legend, hint = '') => `<fieldset class="segf"><legend class="lbl">${legend}</legend>
    <div class="seg">${Object.entries(APPEARANCE[key]).map(([v, n]) => `<label><input type="radio" name="ap-${key}" value="${v}" data-path="appearance.${key}" ${a[key] === v ? 'checked' : ''}><span>${n}</span></label>`).join('')}</div>
    ${hint ? `<div class="hint" style="margin-top:6px">${hint}</div>` : ''}</fieldset>`;
  return `<section class="sec" id="appearance">
  <div><h2>Appearance</h2><p class="desc">How the side panel and these pages look on this computer. Not included in format exports.</p></div>
  <div class="g2">
    ${group('theme', 'Theme', 'System follows your Windows or macOS setting.')}
    ${group('fontSize', 'Text size')}
    ${group('glow', 'Field glow', 'The light around a text box while you type in it.')}
    ${group('motion', 'Animations', 'System turns them off when your computer asks for reduced motion.')}
    ${group('density', 'Side panel spacing')}
  </div>
  <div style="max-width:360px"><label class="lbl" for="ap-try">Try it</label>${B('<input id="ap-try" class="field" placeholder="Click here to see the field glow">')}</div>
  </section>`;
}

function secScopes() {
  const sc = (S.meta.scopes || []).map((x, i) => `<div class="scope">
    <div class="g2">
      <div><label class="lbl" for="sc-n${i}">Portal or area name</label>${B(`<input id="sc-n${i}" class="field" data-sc="${i}" data-k="name" value="${esc(x.name)}">`)}</div>
      <div><label class="lbl" for="sc-m${i}">Applies when the page address contains</label>${B(`<input id="sc-m${i}" class="field mono" data-sc="${i}" data-k="match" value="${esc(x.match)}" placeholder="admin.example.com or /orders">`)}</div>
      <div><label class="lbl" for="sc-c${i}">Project code in the title <span class="hint">blank = same as the project</span></label>${B(`<input id="sc-c${i}" class="field" data-sc="${i}" data-k="code" value="${esc(x.override?.title?.project || '')}">`)}</div>
      <div><label class="lbl" for="sc-t${i}">Tags for this portal <span class="hint">one per line, blank = the project's tags</span></label>${B(`<textarea id="sc-t${i}" class="field" rows="3" data-sc="${i}" data-k="tags">${esc((x.override?.tags?.list || []).join('\n'))}</textarea>`)}</div>
    </div>
    <div class="row"><span class="hint">${esc(['sections', 'fields', 'urlRules', 'styleExample'].filter((k) => x.override?.[k] != null && (!Array.isArray(x.override[k]) || x.override[k].length)).map((k) => ({ sections: 'its own sections', fields: 'field changes', urlRules: 'its own page names', styleExample: 'its own style example' })[k]).join(', ') || 'No other overrides')}</span><span class="grow"></span>
      <button type="button" class="btn btn-ghost btn-sm" data-act="sc-del" data-i="${i}">${icon.x}Remove portal</button></div></div>`).join('');
  return `<section class="sec" id="scopes">
  <div><h2>Where this project applies</h2><p class="desc">The sites this project is for, and the portals or areas within them that differ. When a page matches a portal, its settings go on top of the project's. The longer match wins.</p></div>
  <div><label class="lbl" for="sites">Sites <span class="hint">one per line; QArator switches to this project on these sites</span></label>${B(`<textarea id="sites" class="field mono" rows="3" data-sites="1" placeholder="app.example.com">${esc((S.meta.sites || []).join('\n'))}</textarea>`)}</div>
  ${sc || '<div class="hint">No portals. Add one when part of the site needs its own tags, title code or page names.</div>'}
  <div class="row"><button type="button" class="btn btn-ghost" data-act="sc-add" style="margin-left:-8px">${icon.plus}Add portal or area</button>
    <span class="hint">Sections, field changes and page names per portal come from the project file.</span></div>
  </section>`;
}

function render() {
  const y = scrollY;
  const a = document.activeElement;
  const keep = a && a.id && main.contains(a) ? { id: a.id, s: a.selectionStart, e: a.selectionEnd } : null;
  main.innerHTML = secAI() + secProjects() + secLength() + secUsage() + secAppearance()
    + secScopes() + secTitle() + secSections() + secFields() + secTags() + secStyle() + secZoho() + (query.trim() ? resultsHtml() : '');
  applyPage();
  applyTheme();
  scrollTo(0, y);
  if (keep) {
    const el = document.getElementById(keep.id);
    if (el) { el.focus({ preventScroll: true }); try { if (keep.s != null) el.setSelectionRange(keep.s, keep.e); } catch (e) { /* not a text field */ } }
  }
}

// ---------- events ----------
// The team-format sections sit in one collapsed group so a new user sees only the key, length, usage and look.
document.addEventListener('click', (e) => {
  const tg = e.target.closest('#fmt-toggle');
  if (tg) { fmtOpen = !fmtOpen; applyPage(); return; }
  const a = e.target.closest('.nav a[href^="#"], a[data-result]');
  if (!a) return;
  e.preventDefault(); showPage(a.getAttribute('href').slice(1));
});
document.addEventListener('input', (e) => {
  if (e.target.id !== 'nav-q') return;
  query = e.target.value; render();
});
document.addEventListener('input', (e) => {
  const el = e.target;
  if (el.dataset.sites) { S.meta.sites = String(el.value).split('\n').map((x) => x.trim()).filter(Boolean); save(); return; }
  if (el.dataset.sc !== undefined) {
    const x = S.meta.scopes[Number(el.dataset.sc)]; if (!x) return;
    const k = el.dataset.k, v = el.value;
    x.override = x.override || {};
    if (k === 'name' || k === 'match') x[k] = v;
    else if (k === 'code') { if (v.trim()) x.override.title = { ...(x.override.title || {}), project: v.trim() }; else if (x.override.title) { delete x.override.title.project; if (!Object.keys(x.override.title).length) delete x.override.title; } }
    else if (k === 'tags') { const list = v.split('\n').map((t) => t.trim()).filter(Boolean); if (list.length) x.override.tags = { ...(x.override.tags || {}), list }; else if (x.override.tags) { delete x.override.tags.list; if (!Object.keys(x.override.tags).length) delete x.override.tags; } }
    save(); return;
  }
  const path = el.dataset.path;
  if (!path) return;
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (path === 'ai.apiKey' || path === 'ai.apiKey2') {
    // what a copy drags along (spaces, quotes) is removed; a key of another provider switches the provider
    const k = cleanKey(v); if (k !== v) { el.value = k; v = k; }
    const d = path === 'ai.apiKey' ? detectProvider(k) : '';
    if (d && d !== S.ai.provider) {
      setPath(path, v); S.ai.provider = d; S.ai.models = []; S.ai.model = AUTO; modelStatus = null;
      toast(`That looks like a ${PROVIDERS[d].label} key, so the provider was switched.`, 3200);
      save(); render(); clearTimeout(keyTimer); keyTimer = setTimeout(checkKey, 400); return;
    }
  }
  if (el.dataset.type === 'number') v = Number(v) || 0;
  if (el.dataset.type === 'list') v = String(v).split(',').map((x) => x.trim()).filter(Boolean);
  if (el.type === 'radio' && !el.checked) return;
  setPath(path, v);
  if (path.startsWith('appearance.')) applyAppearance(S);
  if (path === 'ai.apiKey' || path === 'ai.provider' || path === 'ai.baseUrl') {
    modelStatus = null;
    clearTimeout(keyTimer);
    const ready = S.ai.provider === 'compatible' ? /^https?:\/\/.+/.test(S.ai.baseUrl) : String(S.ai.apiKey).trim().length >= 20;
    if (ready && path !== 'ai.provider') keyTimer = setTimeout(checkKey, 900);
  }
  if (el.dataset.live === 'example') $('#ex-title').textContent = exampleTitle();
  save();
});
document.addEventListener('change', (e) => {
  const el = e.target;
  if (el.dataset.pjName) { renameProject(el.dataset.pjName, el.value).then(refreshProjects); return; }
  if (el.id === 'import-file') return doImport(el);
  if (!el.dataset.path) return;
  if (el.dataset.path === 'ai.provider') { S.ai.models = []; S.ai.model = AUTO; save(); render(); return; }
  if (el.dataset.type === 'model') { save(); render(); return; }
  if (el.dataset.path.startsWith('usage.')) { render(); return; }
  if (el.dataset.rerenderBlur) {
    const i = Number(el.dataset.path.split('.')[1]); const f = S.fields[i];
    if (f && !f.options.includes(f.default)) { f.default = f.options[0] || ''; save(); }
    render();
  } else if (el.dataset.type === 'bool') render();
});
document.addEventListener('keydown', (e) => {
  if (e.target.id === 'newtag' && e.key === 'Enter') {
    e.preventDefault();
    const v = e.target.value.trim().toLowerCase();
    if (v && !S.tags.list.includes(v)) { S.tags.list.push(v); save(); render(); $('#newtag').focus(); }
  }
});
const move = (arr, i, d) => { const j = i + d; if (j < 0 || j >= arr.length) return; [arr[i], arr[j]] = [arr[j], arr[i]]; };
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b || b.disabled || b.getAttribute('aria-disabled') === 'true') return;
  const i = Number(b.dataset.i);
  switch (b.dataset.act) {
    case 'show-key': keyShown = !keyShown; render(); $('#key').focus(); return;
    case 'check': return checkKey();
    case 'seg-left': move(S.title.segments, i, -1); break;
    case 'seg-right': move(S.title.segments, i, 1); break;
    case 'rule-up': move(S.urlRules, i, -1); break;
    case 'rule-del': S.urlRules.splice(i, 1); break;
    case 'rule-add': S.urlRules.push({ match: '', portal: '', module: '', page: '' }); break;
    case 'sec-up': move(S.sections, i, -1); break;
    case 'sec-down': move(S.sections, i, 1); break;
    case 'sec-del': if (!await askConfirm({ title: 'Delete this section?', body: `“${S.sections[i].name}” is removed from the report format.`, ok: 'Delete' })) return; S.sections.splice(i, 1); break;
    case 'sec-add': {
      let id = 'custom'; let n = 1; while (S.sections.some((s) => s.id === id)) id = `custom_${++n}`;
      S.sections.push({ id, name: 'New section', layout: 'paragraph', include: true, guide: '' }); break;
    }
    case 'field-del': if (!await askConfirm({ title: 'Delete this field?', body: `“${S.fields[i].name}” is removed from the report format.`, ok: 'Delete' })) return; S.fields.splice(i, 1); break;
    case 'field-add': {
      let id = 'field'; let n = 1; while (S.fields.some((f) => f.id === id)) id = `field_${++n}`;
      S.fields.push({ id, name: 'New field', zohoLabel: 'New field', options: ['Option 1', 'Option 2'], default: 'Option 1', ai: false }); break;
    }
    case 'tag-del': S.tags.list.splice(i, 1); break;
    case 'usage-days': usageDays = i; render(); return;
    case 'usage-reset':
      if (!await askConfirm({ title: 'Reset the usage counters?', body: 'This only clears QArator\'s own tally. Your provider keeps its own count.', ok: 'Reset' })) return;
      await chrome.storage.local.remove(['usage', 'learnedLimits', 'modelCooldown']);
      await loadUsage(); render(); return;
    case 'get-key': return openKeyPage();
    case 'export': return doExport();
    case 'guide': return downloadText('qarator-setup-guide.md', buildGuide(), 'text/markdown');
    case 'pj-use': await flush(); await switchProject(b.dataset.id); await reloadAll(); toast('Project switched'); return;
    case 'pj-new': {
      const name = await askText({ title: 'New blank project', label: 'Name of the project', ok: 'Create', placeholder: 'e.g. Acme Shop' }); if (!name) return;
      await flush(); await newProject(name); await reloadAll(); toast('Project created. It starts with the neutral setup.', 3000); return;
    }
    case 'pj-del': {
      const p = P.find((x) => x.id === b.dataset.id); if (!p) return;
      if (!await askConfirm({ title: `Delete ${p.name}?`, body: 'Export it first if you may need it again. Your AI key is not affected.', ok: 'Delete project' })) return;
      await flush(); await deleteProject(p.id); await reloadAll(); toast('Project deleted'); return;
    }
    case 'sc-add': { let id = 'portal', n = 1; while (S.meta.scopes.some((x) => x.id === id)) id = `portal_${++n}`; S.meta.scopes.push({ id, name: 'New portal', match: '', override: {} }); break; }
    case 'sc-del': S.meta.scopes.splice(i, 1); break;
    case 'import': return $('#import-file').click();
    case 'reset': {
      if (!await askConfirm({ title: 'Reset this project?', body: 'Its sections, fields, tags and portals are cleared and it goes back to the neutral setup. Your AI key is kept.', ok: 'Reset project' })) return;
      const keep = { ai: S.ai, look: S.appearance, usage: S.usage, meta: { ...S.meta, scopes: [], sites: [] } }; S = normalize(JSON.parse(JSON.stringify(DEFAULTS))); S.ai = keep.ai; S.appearance = keep.look; S.usage = keep.usage; S.meta = keep.meta; break;
    }
    default: return;
  }
  save(); render();
});

async function checkKey() {
  modelStatus = 'busy'; render();
  try {
    const models = await listModels(S.ai);
    S.ai.models = models;
    if (S.ai.model !== AUTO && !models.some((m) => m.id === S.ai.model)) {
      const pref = models.find((m) => /sonnet|gpt-4\.1|gpt-4o|gemini-.*flash|gemini-.*pro/.test(m.id)) || models[0];
      S.ai.model = pref ? pref.id : S.ai.model;
    }
    modelStatus = { ok: true, count: models.length };
    save();
  } catch (e) {
    const d = describeError(e);
    modelStatus = { ok: false, msg: e.kind === 'nokey' ? 'Enter a key first.' : `${d.title}. ${e.status ? `(HTTP ${e.status})` : ''}` };
  }
  render();
}

function downloadText(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function doExport() {
  downloadText(`qarator-format-${slug(S.meta.name || S.title.project || 'project')}.json`, JSON.stringify(exportFormat(S), null, 2), 'application/json');
}

// Pending edits are saved before a project operation reads or switches the stored settings.
async function flush() { clearTimeout(t); await saveSettings(S); }
async function refreshProjects() { P = await listProjects(); render(); }
async function reloadAll() { S = await loadSettings(); P = await listProjects(); render(); }

async function doImport(el) {
  const f = el.files[0]; el.value = '';
  if (!f) return;
  let json;
  try { json = JSON.parse(await f.text()); } catch (e) { toast('That file is not valid JSON.', 3500); return; }
  try {
    await flush();
    const same = P.find((x) => x.id === json?.meta?.id);
    const update = !!same && await askConfirm({ title: `${same.name} is already here`, body: 'Update it with this file (your edits to it are replaced), or add the file as a separate copy.', ok: 'Update it', cancel: 'Add a copy', danger: false });
    const r = await addProject(json, { replace: update ? same.id : '' });
    await reloadAll();
    importNotes = { title: `${update ? 'Updated' : 'Imported'} “${r.name}”${r.warnings.length ? `, with ${r.warnings.length} thing${r.warnings.length === 1 ? '' : 's'} to check` : ''}.`, items: r.warnings };
    render();
    toast(`${update ? 'Updated' : 'Imported'} “${r.name}”`, 2800);
    showPage('projects');
  } catch (e) {
    importNotes = { title: 'The file was not imported.', items: String(e.message).split(/(?<=\.)\s+(?=["A-Z])/) };
    showPage('projects');
  }
}



(async function start() {
  $('#mark').innerHTML = markSvg(24);
  S = await loadSettings();
  P = await listProjects();
  applyAppearance(S);
  await loadUsage();
  render();
  chrome.storage.onChanged.addListener(async (c, area) => {
    if (area === 'local' && (c.usage || c.learnedLimits || c.modelCooldown)) {
      await loadUsage();
      const old = document.getElementById('usage');
      if (old && !old.contains(document.activeElement)) { old.outerHTML = secUsage(); applyPage(); applyTheme(); } else if (!old) render();
    }
    if (area === 'local' && c.settings) applyAppearance(normalize(c.settings.newValue));
  });
  watchTheme();
})();
