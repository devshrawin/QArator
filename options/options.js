// QArator settings page. Edits a copy of the settings and autosaves.
import { loadSettings, saveSettings, normalize, exportFormat, importFormat, DEFAULTS, PROVIDERS, LAYOUTS, SEGMENTS, slug } from '../lib/settings.js';
import { listModels, describeError, rankModels, cooldowns, AUTO } from '../lib/ai.js';
import { summarize, parsePrices, rowCost, rupees, nextQuotaReset, istClock, usedToday } from '../lib/usage.js';
import { buildTitle } from '../lib/report.js';
import { esc, icon, beam, orb, markSvg, applyTheme, watchTheme, toast, fmtTime } from '../lib/ui.js';

const $ = (s, r = document) => r.querySelector(s);
const main = $('#main');
let S;
let keyShown = false, modelStatus = null, undoImport = null, undoTimer = 0, keyTimer = 0;
let U = { usage: {}, learnedLimits: {}, cool: {} }, usageDays = 1;

// ---------- saving ----------
let t = 0;
function save() {
  clearTimeout(t);
  $('#saved').textContent = 'Saving…';
  t = setTimeout(async () => {
    await saveSettings(S);
    $('#saved').textContent = `Changes save automatically · saved ${fmtTime(Date.now())}`;
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
      <button type="button" class="btn b-sec" data-act="show-key" style="flex:none" aria-pressed="${keyShown}">${keyShown ? 'Hide' : 'Show'}</button></div></div>
    ${PROVIDERS[p].needsBase ? `<div class="span2" style="grid-column:1/-1"><label class="lbl" for="base">Endpoint base address</label>${B(`<input id="base" class="field mono" data-path="ai.baseUrl" value="${esc(S.ai.baseUrl)}" placeholder="https://your-server/v1">`)}
      <div class="hint" style="margin-top:4px">QArator calls /models and /chat/completions under this address.</div></div>` : ''}
  </div>
  <div class="row">
    <button type="button" class="btn b-sec" data-act="check" ${st === 'busy' ? 'aria-disabled="true"' : ''}>${st === 'busy' ? orb('connecting', 20) + 'Checking…' : icon.refresh + 'Check key and load models'}</button>
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
    const limit = U.learnedLimits[r.model];
    let left = usageDays === 1 ? '<span class="hint">No known limit</span>' : '';
    if (usageDays === 1 && limit) {
      const remaining = Math.max(0, limit - usedToday(U.usage, r.model));
      const pct = Math.round((remaining / limit) * 100);
      left = `<div class="meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${esc(r.model)} left today"><i class="${pct === 0 ? 's' : pct <= 20 ? 'q' : ''}" style="width:${pct}%"></i></div><div class="hint">${remaining} of ${limit} left</div>`;
    }
    if (U.cool[r.model]) left += `<div class="hint" style="color:var(--acc-text)">Resting until ${istClock(U.cool[r.model])}</div>`;
    return `<tr><td><strong style="font-weight:600">${esc(r.model)}</strong><div class="hint">${esc(r.provider)}</div></td><td>${KIND[r.kind] || esc(r.kind)}</td>
      <td class="num">${r.req}</td><td class="num">${r.fail ? `${r.fail}${r.rl ? ` (${r.rl} limit)` : ''}` : '0'}</td>
      <td class="num">${r.tin || r.tout ? `${fmtN(r.tin)} / ${fmtN(r.tout)}` : '–'}</td>
      <td class="num">${c ? `${c.assumed ? '~' : ''}${rupees(c.usd, rate)}` : '–'}</td><td>${left}</td></tr>`;
  }).join('');
  const reqs = rows.reduce((a, r) => a + r.req, 0);
  return `<section class="sec" id="usage">
  <div><div><h2>Usage</h2><p class="desc">Every request QArator sends to your AI provider, counted in this browser. Providers do not report free quota left, so limits are learned from their rate-limit replies.</p></div></div>
  <div class="row" role="group" aria-label="Range">${[1, 7, 30].map((d) => `<button type="button" class="btn ${usageDays === d ? 'b-pri' : 'b-sec'} b-sm" data-act="usage-days" data-i="${d}" aria-pressed="${usageDays === d}">${d === 1 ? 'Today' : `${d} days`}</button>`).join('')}</div>
  <div class="tbl-wrap"><table class="tbl" id="usage-table" style="min-width:720px"><thead><tr><th scope="col">Model</th><th scope="col">Used for</th><th scope="col" class="num">Requests</th><th scope="col" class="num">Failed</th><th scope="col" class="num">Tokens in / out</th><th scope="col" class="num">Cost if paid</th><th scope="col" style="width:150px">${usageDays === 1 ? 'Left today' : ''}</th></tr></thead>
  <tbody>${body || '<tr><td colspan="7" class="hint">Nothing yet. Counts start with your next report.</td></tr>'}</tbody></table></div>
  <div class="row" id="usage-totals" style="gap:6px 18px"><strong>Total ${RANGE[usageDays]}</strong><span>${reqs} request${reqs === 1 ? '' : 's'}</span>
    <span>If paid: about ${rupees(usd, rate)}${assumed ? ' (list prices assumed)' : ''}</span>
    <span class="hint" style="margin-left:auto">Daily quotas reset at ${istClock(nextQuotaReset())} (midnight Pacific)</span></div>
  <details><summary class="hint" style="cursor:pointer">Prices and exchange rate</summary>
    <div class="g2" style="margin-top:10px">
      <div><label class="lbl" for="uprices">Your prices (USD per million tokens)</label>${B(`<textarea id="uprices" class="field mono" rows="3" data-path="usage.prices" placeholder="gemini-2.5-flash=0.30,2.50">${esc(S.usage.prices)}</textarea>`)}
        <div class="hint" style="margin-top:4px">One model per line: model=input,output. Others use rough list prices.</div></div>
      <div><label class="lbl" for="urate">Rupees per US dollar</label>${B(`<input id="urate" class="field" type="number" min="1" data-type="number" data-path="usage.usdInr" value="${esc(rate)}">`)}</div>
    </div></details>
  <div><button type="button" class="btn b-ghost" data-act="usage-reset" style="margin-left:-8px">Reset counters</button></div>
  </section>`;
}

async function loadUsage() {
  const { usage = {}, learnedLimits = {} } = await chrome.storage.local.get(['usage', 'learnedLimits']);
  U = { usage, learnedLimits, cool: await cooldowns() };
}

function secLength() {
  const opt = [['brief', 'Brief', 'One or two sentences per section. Good for obvious visual bugs.'], ['standard', 'Standard', 'Short paragraphs and full steps. The team default.'], ['detailed', 'Detailed', 'Adds context, affected areas and console errors in full.']];
  return `<section class="sec" id="length">
  <div><h2>Writing length</h2><p class="desc">How much detail the AI writes in each section.</p></div>
  <fieldset style="border:0;padding:0;margin:0;display:flex;flex-direction:column;gap:10px"><legend class="lbl" style="margin-bottom:8px">Length</legend>
  ${opt.map(([v, n, d]) => `<label class="chk"><input type="radio" name="len" value="${v}" data-path="writingLength" ${S.writingLength === v ? 'checked' : ''}><span><strong style="font-weight:600">${n}</strong><br><span class="hint">${d}</span></span></label>`).join('')}
  </fieldset></section>`;
}

function exampleTitle() {
  return buildTitle({ segments: { project: S.title.project, portal: 'Department Portal', module: 'SEVI Dashboard', page: 'State Overview', summary: S.title.summaryCase === 'title' ? 'Incomplete Theme Propagation for Dark Mode on Dashboard Canvas' : 'Incomplete theme propagation for dark mode on dashboard canvas' } }, S);
}

function secTitle() {
  const segs = S.title.segments;
  return `<section class="sec" id="title">
  <div><h2>Title format</h2><p class="desc">Titles are built from these segments in this order. Use the arrows to reorder.</p></div>
  <div class="row" role="list" aria-label="Title segments">${segs.map((k, i) => `<span class="tok" role="listitem">${SEGMENTS[k]}
    <button type="button" class="ib" style="width:24px;height:24px" data-act="seg-left" data-i="${i}" aria-label="Move ${SEGMENTS[k]} earlier" ${i === 0 ? 'disabled' : ''}>${icon.left}</button>
    <button type="button" class="ib" style="width:24px;height:24px" data-act="seg-right" data-i="${i}" aria-label="Move ${SEGMENTS[k]} later" ${i === segs.length - 1 ? 'disabled' : ''}>${icon.right}</button></span>`).join('')}</div>
  <div class="g4">
    <div><label class="lbl" for="tproj">Project</label>${B(`<input id="tproj" class="field" data-path="title.project" data-live="example" value="${esc(S.title.project)}">`)}</div>
    <div><label class="lbl" for="tsep">Separator</label>${B(`<input id="tsep" class="field mono" data-path="title.separator" data-live="example" value="${esc(S.title.separator)}">`)}</div>
    <div><label class="lbl" for="tmax">Max length</label>${B(`<input id="tmax" class="field" type="number" min="20" max="500" data-type="number" data-path="title.maxLength" value="${esc(S.title.maxLength)}">`)}</div>
    <div><label class="lbl" for="tcase">Summary style</label><select id="tcase" class="field" data-path="title.summaryCase" data-live="example"><option value="title" ${S.title.summaryCase === 'title' ? 'selected' : ''}>Title Case</option><option value="sentence" ${S.title.summaryCase === 'sentence' ? 'selected' : ''}>Sentence case</option></select></div>
  </div>
  <div class="example"><div class="lab">Example</div><div class="t" id="ex-title">${esc(exampleTitle())}</div></div>
  <div><h3>URL rules</h3>
  <p class="hint" style="margin:0 0 10px">Checked top to bottom; the first match fills each segment. Anything left empty is filled by AI from the page.</p>
  <div class="tbl-wrap"><table class="tbl"><thead><tr><th scope="col" style="width:34%">When the URL contains</th><th scope="col">Portal</th><th scope="col">Module</th><th scope="col">Page</th><th scope="col" style="width:96px"><span class="sr-only">Actions</span></th></tr></thead><tbody>
  ${S.urlRules.map((r, i) => `<tr>
    <td>${B(`<input class="field mono" aria-label="URL contains, rule ${i + 1}" data-path="urlRules.${i}.match" value="${esc(r.match)}">`)}</td>
    <td>${B(`<input class="field" aria-label="Portal, rule ${i + 1}" data-path="urlRules.${i}.portal" value="${esc(r.portal)}" placeholder="—">`)}</td>
    <td>${B(`<input class="field" aria-label="Module, rule ${i + 1}" data-path="urlRules.${i}.module" value="${esc(r.module)}" placeholder="—">`)}</td>
    <td>${B(`<input class="field" aria-label="Page, rule ${i + 1}" data-path="urlRules.${i}.page" value="${esc(r.page)}" placeholder="—">`)}</td>
    <td style="white-space:nowrap"><button type="button" class="ib" data-act="rule-up" data-i="${i}" aria-label="Move rule ${i + 1} up" ${i === 0 ? 'disabled' : ''}>${icon.up}</button><button type="button" class="ib" data-act="rule-del" data-i="${i}" aria-label="Delete rule ${i + 1}">${icon.x}</button></td></tr>`).join('')}
  </tbody></table></div>
  <button type="button" class="btn b-ghost" data-act="rule-add" style="margin:8px 0 0 -8px">${icon.plus}Add rule</button></div>
  </section>`;
}

function secSections() {
  return `<section class="sec" id="sections">
  <div><h2>Description sections</h2><p class="desc">The sections the AI writes, in this order. Guidance tells it what belongs in each one.</p></div>
  <div>${S.sections.map((s, i) => `<div class="secrow">
    <div style="display:flex"><button type="button" class="ib" data-act="sec-up" data-i="${i}" aria-label="Move ${esc(s.name)} up" ${i === 0 ? 'disabled' : ''}>${icon.up}</button><button type="button" class="ib" data-act="sec-down" data-i="${i}" aria-label="Move ${esc(s.name)} down" ${i === S.sections.length - 1 ? 'disabled' : ''}>${icon.down}</button></div>
    ${B(`<input class="field" aria-label="Section name" data-path="sections.${i}.name" value="${esc(s.name)}" style="font-weight:600">`)}
    <select class="field" aria-label="Layout for ${esc(s.name)}" data-path="sections.${i}.layout">${Object.entries(LAYOUTS).map(([k, v]) => `<option value="${k}" ${k === s.layout ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <label class="chk inline" style="font-size:12px"><input type="checkbox" data-type="bool" data-path="sections.${i}.include" ${s.include ? 'checked' : ''}>Include</label>
    <button type="button" class="ib" data-act="sec-del" data-i="${i}" aria-label="Delete ${esc(s.name)}" ${S.sections.length <= 1 ? 'disabled' : ''}>${icon.x}</button>
    <div class="guide">${B(`<input class="field" aria-label="AI guidance for ${esc(s.name)}" data-path="sections.${i}.guide" value="${esc(s.guide)}" style="color:var(--ink2)" placeholder="What the AI should write here">`)}</div>
  </div>`).join('')}</div>
  <div class="row"><button type="button" class="btn b-ghost" data-act="sec-add" style="margin-left:-8px">${icon.plus}Add section</button>
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
    <td><button type="button" class="ib" data-act="field-del" data-i="${i}" aria-label="Delete ${esc(f.name)}">${icon.x}</button></td></tr>`).join('')}
  </tbody></table></div>
  <div class="row"><button type="button" class="btn b-ghost" data-act="field-add" style="margin-left:-8px">${icon.plus}Add field</button>
  <span class="hint">When AI chooses is off, the default is used and the tester can change it in review. A value of Unassigned is left empty in Zoho.</span></div>
  </section>`;
}

function secTags() {
  return `<section class="sec" id="tags">
  <div><h2>Tags</h2><p class="desc">The AI suggests tags from this list. Testers tick the ones to add.</p></div>
  <div class="row">${S.tags.list.map((g, i) => `<span class="tok">${esc(g)}<button type="button" class="ib" style="width:22px;height:22px" data-act="tag-del" data-i="${i}" aria-label="Remove tag ${esc(g)}">${icon.x}</button></span>`).join('') || '<span class="hint">No tags yet.</span>'}</div>
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
    <label class="chk" style="cursor:default"><input type="checkbox" checked disabled><span>Leave Submit to me <span class="hint">· always on</span></span></label>
  </div>
  </section>`;
}

function secShare() {
  return `<section class="sec" id="share">
  <div><h2>Export and import</h2><p class="desc">Share one format across the team: title format, URL rules, sections, fields, tags, Zoho labels and the style example. Your API key is never exported.</p></div>
  <div class="row">
    <button type="button" class="btn b-pri" data-act="export">${icon.download}Export format</button>
    <button type="button" class="btn b-sec" data-act="import">${icon.upload}Import format</button>
    <button type="button" class="btn b-ghost" data-act="reset">Reset to defaults</button>
    ${undoImport ? '<button type="button" class="btn b-sec" data-act="undo-import">Undo import</button>' : ''}
  </div>
  <p class="hint" style="margin:0">Exports as <span class="mono">qarator-format-${esc(slug(S.title.project || 'team'))}.json</span>. Importing replaces the current format; you can undo it for 30 seconds.</p>
  </section>`;
}

function render() {
  const y = scrollY;
  main.innerHTML = secAI() + secLength() + secTitle() + secSections() + secFields() + secTags() + secStyle() + secZoho() + secUsage() + secShare();
  applyTheme();
  scrollTo(0, y);
}

// ---------- events ----------
document.addEventListener('input', (e) => {
  const el = e.target; const path = el.dataset.path;
  if (!path) return;
  let v = el.type === 'checkbox' ? el.checked : el.value;
  if (el.dataset.type === 'number') v = Number(v) || 0;
  if (el.dataset.type === 'list') v = String(v).split(',').map((x) => x.trim()).filter(Boolean);
  if (el.type === 'radio' && !el.checked) return;
  setPath(path, v);
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
    case 'sec-del': if (!confirm(`Delete the section “${S.sections[i].name}”?`)) return; S.sections.splice(i, 1); break;
    case 'sec-add': {
      let id = 'custom'; let n = 1; while (S.sections.some((s) => s.id === id)) id = `custom_${++n}`;
      S.sections.push({ id, name: 'New section', layout: 'paragraph', include: true, guide: '' }); break;
    }
    case 'field-del': if (!confirm(`Delete the field “${S.fields[i].name}”?`)) return; S.fields.splice(i, 1); break;
    case 'field-add': {
      let id = 'field'; let n = 1; while (S.fields.some((f) => f.id === id)) id = `field_${++n}`;
      S.fields.push({ id, name: 'New field', zohoLabel: 'New field', options: ['Option 1', 'Option 2'], default: 'Option 1', ai: false }); break;
    }
    case 'tag-del': S.tags.list.splice(i, 1); break;
    case 'usage-days': usageDays = i; render(); return;
    case 'usage-reset':
      if (!confirm('Reset the usage counters? This only clears QArator\'s own tally.')) return;
      await chrome.storage.local.remove(['usage', 'learnedLimits', 'modelCooldown']);
      await loadUsage(); render(); return;
    case 'export': return doExport();
    case 'import': return $('#import-file').click();
    case 'reset': {
      if (!confirm('Reset the whole format to the defaults? Your API key is kept.')) return;
      const keep = S.ai; S = normalize(JSON.parse(JSON.stringify(DEFAULTS))); S.ai = keep; break;
    }
    case 'undo-import': S = undoImport; undoImport = null; clearTimeout(undoTimer); toast('Import undone'); break;
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

function doExport() {
  const data = JSON.stringify(exportFormat(S), null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url; a.download = `qarator-format-${slug(S.title.project || 'team')}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
async function doImport(el) {
  const f = el.files[0]; el.value = '';
  if (!f) return;
  try {
    const json = JSON.parse(await f.text());
    const next = importFormat(S, json);
    undoImport = JSON.parse(JSON.stringify(S));
    S = next; save(); render();
    toast('Format imported. Undo is available for 30 seconds.', 3000);
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => { undoImport = null; render(); }, 30000);
  } catch (e) {
    toast(e instanceof SyntaxError ? 'That file is not valid JSON.' : e.message, 3500);
  }
}

// nav highlight
function navSpy() {
  const secs = [...document.querySelectorAll('.sec')];
  let cur = secs[0];
  for (const s of secs) if (s.getBoundingClientRect().top < 140) cur = s;
  document.querySelectorAll('.nav a').forEach((a) => a.classList.toggle('cur', cur && a.getAttribute('href') === '#' + cur.id));
}
addEventListener('scroll', navSpy, { passive: true });

(async function start() {
  $('#mark').innerHTML = markSvg(24);
  S = await loadSettings();
  await loadUsage();
  render();
  navSpy();
  chrome.storage.onChanged.addListener(async (c, area) => {
    if (area === 'local' && (c.usage || c.learnedLimits || c.modelCooldown)) { await loadUsage(); render(); }
  });
  watchTheme();
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
})();
