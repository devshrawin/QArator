// Guided project setup: three ways in (import a file, have an AI agent write one, or answer a few questions),
// then a project is added and made the one in use. Nothing is saved until the last step.
import { loadSettings, normalize, DEFAULTS, SEGMENTS, LAYOUTS, checkFormat, slug } from '../lib/settings.js';
import { addProject } from '../lib/projects.js';
import { buildGuide } from '../lib/guide.js';
import { buildTitle } from '../lib/report.js';
import { esc, icon, beam, markSvg, applyTheme, applyAppearance, watchTheme, toast } from '../lib/ui.js';

const $ = (s, r = document) => r.querySelector(s);
const base = normalize(JSON.parse(JSON.stringify(DEFAULTS)));
const FIELD_PRESETS = [
  { id: 'severity', name: 'Severity', options: 'Show stopper, Critical, Major, Minor', def: 'Minor', ai: true, on: true },
  { id: 'priority', name: 'Priority', options: 'High, Medium, Low', def: 'Medium', ai: true, on: true },
  { id: 'classification', name: 'Classification', options: 'Bug, Functional, UI/Usability, Performance, Security, Enhancement', def: 'Bug', ai: true, on: true },
  { id: 'environment', name: 'Environment', options: 'Staging, UAT, Production', def: '', ai: false, on: false },
  { id: 'device', name: 'Device', options: 'Desktop, Mobile, Tablet', def: '', ai: false, on: false }
];
const SECTION_PRESETS = [
  ...base.sections.map((s) => ({ ...s })),
  { id: 'environment_note', name: 'Environment', layout: 'inline', include: false, guide: 'Browser, device and build or version, only if the tester gave them.' },
  { id: 'additional', name: 'Additional Notes', layout: 'paragraph', include: false, guide: 'Anything else worth knowing: workarounds, how often it happens, related screens.' }
];

// the answers so far
const W = {
  route: '', step: 0, name: '', code: '', sites: '',
  segments: ['project', 'portal', 'module', 'page', 'summary'], sep: ' | ', summaryCase: 'title',
  sections: SECTION_PRESETS.map((s) => ({ ...s })),
  fields: FIELD_PRESETS.map((f) => ({ ...f })),
  tags: '', style: '', json: '', note: null, done: null
};
const ROUTE_STEPS = { import: ['start', 'import'], agent: ['start', 'agent'], hand: ['start', 'name', 'title', 'sections', 'fields', 'tags', 'style', 'review'] };
const steps = () => ROUTE_STEPS[W.route] || ['start'];
const cur = () => steps()[W.step] || 'start';

const nav = (next = 'Next', { back = true, nextGo = 'next', disabled = false } = {}) => `<div class="foot">
  ${back ? `<button type="button" class="btn btn-ghost" data-go="back">${icon.back}Back</button>` : ''}<span class="grow"></span>
  <button type="button" class="btn btn-primary" data-go="${nextGo}" id="next" ${disabled ? 'aria-disabled="true"' : ''}>${next}</button></div>`;
const card = (inner) => `<div class="card">${inner}</div>`;

// ---------- screens ----------
function start() {
  const r = (id, t, d, tag) => `<button type="button" class="route" data-go="route" data-id="${id}"><span class="r-t">${t}${tag ? ` <span class="r-tag">${tag}</span>` : ''}</span><span class="r-d">${d}</span></button>`;
  return card(`<h1>Set up a project</h1>
    <p>A project tells QArator how your team writes bug reports: the title, the sections, the dropdowns and the tags, and which sites it applies to. Pick the way that suits you.</p>
    <div class="routes">
      ${r('import', 'I have a project file', 'A teammate or an AI agent already made one. Import it and you are done.')}
      ${r('agent', 'Let an AI agent write it', 'Works for Zoho, Jira, Confluence or anything else. You download a guide, give it to the agent with a description of your bug form, and import what it writes.', 'Easiest for a new tool')}
      ${r('hand', 'I will answer a few questions', 'Name, title, sections, dropdowns and tags, one screen at a time. About five minutes.')}
    </div>
    <div class="foot"><span class="grow"></span><a class="btn btn-ghost" href="options.html#projects">Back to settings</a></div>`);
}

function importStep() {
  return card(`<h1>Import a project file</h1>
    <p>Choose the <span class="kbd">.json</span> file, or paste its text. Nothing is changed until the check passes, and the file never touches your AI key.</p>
    <div class="row"><button type="button" class="btn btn-secondary" data-go="pick">${icon.upload}Choose a file</button></div>
    <div><label class="lbl" for="json">Or paste the text</label>${beam(`<textarea id="json" class="field mono" rows="8" placeholder='{ "qarator": "format", ... }'>${esc(W.json)}</textarea>`)}</div>
    ${notes()}
    ${nav('Check and import', { nextGo: 'doimport' })}`);
}

const PROMPT = 'Follow the attached QArator setup guide. Ask me the questions it lists, using my notes and screenshots, then write the QArator project file as one JSON block. Spell every option and tag exactly as my tracker does, and do not invent any.';
function agentStep() {
  return card(`<h1>Let an AI agent write it</h1>
    <ol class="steps">
      <li><div class="s-t">Download the guide</div><div class="s-d">It tells the agent exactly what a project file is and which questions to ask you.</div>
        <button type="button" class="btn btn-secondary btn-sm" data-go="guide">${icon.download}Download setup guide (.md)</button></li>
      <li><div class="s-t">Give the agent the guide and your notes</div>
        <div class="s-d">Use any AI chat that can read files (Claude, ChatGPT, Gemini). Attach the guide, and add what describes your tracker:</div>
        <ul class="s-l"><li>a screenshot or description of your <strong>new bug form</strong>, with every dropdown's choices</li><li>one <strong>real finished bug report</strong> from your team</li><li>your <strong>tag list</strong>, if you have one</li><li>which <strong>sites or portals</strong> differ</li></ul>
        <div class="s-d">Then send it this message:</div>
        <div class="promptbox"><span id="prompt">${esc(PROMPT)}</span><button type="button" class="btn btn-secondary btn-sm" data-go="copyprompt">${icon.copy}Copy message</button></div></li>
      <li><div class="s-t">Paste its answer here</div>
        <div class="s-d">Copy the JSON block it writes, or save it as a file. QArator checks it and tells you in plain words if anything is wrong; send that list back to the agent and ask it to fix exactly that.</div>
        <div class="row"><button type="button" class="btn btn-secondary btn-sm" data-go="pick">${icon.upload}Choose a file</button></div>
        ${beam(`<textarea id="json" class="field mono" rows="7" placeholder='{ "qarator": "format", ... }'>${esc(W.json)}</textarea>`)}</li>
    </ol>
    ${notes()}
    ${nav('Check and import', { nextGo: 'doimport' })}`);
}

function notes() {
  if (!W.note) return '';
  const n = W.note;
  return `<div class="notes ${n.bad ? 'bad' : ''}" role="status"><strong>${esc(n.title)}</strong>${n.items.length ? `<ul>${n.items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${n.bad ? '<div class="hint">Send this list to your AI agent and ask it to fix exactly these and send the whole file again.</div>' : ''}</div>`;
}

function nameStep() {
  return card(`<h1>Name and sites</h1>
    <p>What is this project called, and which sites do you test? When you capture a page on one of these sites, QArator switches to this project by itself.</p>
    <div class="g2">
      <div><label class="lbl" for="pname">Project name</label>${beam(`<input id="pname" class="field" value="${esc(W.name)}" placeholder="Acme Shop">`)}</div>
      <div><label class="lbl" for="pcode">Code at the start of every title</label>${beam(`<input id="pcode" class="field" value="${esc(W.code)}" placeholder="ACME">`)}</div>
    </div>
    <div><label class="lbl" for="psites">Sites, one per line <span class="hint">optional</span></label>${beam(`<textarea id="psites" class="field mono" rows="3" placeholder="shop.acme.example&#10;admin.acme.example">${esc(W.sites)}</textarea>`)}</div>
    <p class="hint">Different sites can have their own tags or title code later: Settings › Format of this project › Sites and portals.</p>
    ${nav('Next', { disabled: !W.name.trim() })}`);
}

const exampleTitle = () => buildTitle({ segments: { project: W.code || 'ACME', portal: 'Admin', module: 'Orders', page: 'Order List', summary: W.summaryCase === 'title' ? 'Export Button Does Nothing' : 'Export button does nothing' } }, { title: { segments: W.segments, separator: W.sep } });
function titleStep() {
  const all = Object.keys(SEGMENTS);
  const rows = [...W.segments, ...all.filter((k) => !W.segments.includes(k))].map((k) => {
    const on = W.segments.includes(k), i = W.segments.indexOf(k);
    return `<div class="segrow"><label class="chk inline"><input type="checkbox" data-seg="${k}" ${on ? 'checked' : ''}><span>${SEGMENTS[k]}</span></label>
      <button type="button" class="btn btn-icon" data-go="segup" data-id="${k}" aria-label="Move ${SEGMENTS[k]} up" ${!on || i === 0 ? 'disabled' : ''}>${icon.up}</button>
      <button type="button" class="btn btn-icon" data-go="segdown" data-id="${k}" aria-label="Move ${SEGMENTS[k]} down" ${!on || i === W.segments.length - 1 ? 'disabled' : ''}>${icon.down}</button></div>`;
  }).join('');
  return card(`<h1>How a bug title looks</h1>
    <p>A title is built from parts. Tick the ones you use and put them in order. Portal, Module and Page are read from the site you test, so you can leave them in.</p>
    <div>${rows}</div>
    <div class="g2">
      <div><label class="lbl" for="sep">Between parts</label>${beam(`<input id="sep" class="field mono" value="${esc(W.sep)}">`)}</div>
      <div><label class="lbl" for="scase">The summary part</label><select id="scase" class="field"><option value="title" ${W.summaryCase === 'title' ? 'selected' : ''}>Title Case</option><option value="sentence" ${W.summaryCase === 'sentence' ? 'selected' : ''}>Sentence case</option></select></div>
    </div>
    <div class="example"><div class="lab">Example</div><div class="t" id="ex">${esc(exampleTitle())}</div></div>
    ${nav('Next')}`);
}

function sectionsStep() {
  return card(`<h1>What the description contains</h1>
    <p>Tick the sections your reports have. The note under each one tells the AI what belongs there; edit it to match your team's habits.</p>
    ${W.sections.map((s, i) => `<div class="secbox"><label class="chk inline"><input type="checkbox" data-sec="${i}" ${s.include ? 'checked' : ''}><span><strong>${esc(s.name)}</strong></span></label>
      ${beam(`<input class="field" data-secguide="${i}" aria-label="What goes in ${esc(s.name)}" value="${esc(s.guide)}">`)}</div>`).join('')}
    <div class="row"><div style="flex:1;min-width:180px">${beam('<input id="newsec" class="field" placeholder="Another section, e.g. Workaround">')}</div><button type="button" class="btn btn-secondary" data-go="addsec">${icon.plus}Add</button></div>
    ${nav('Next')}`);
}

function fieldsStep() {
  return card(`<h1>The dropdowns on a bug</h1>
    <p>These are the fields your tracker has. Type the choices exactly as the tracker shows them, separated by commas. <strong>AI picks it</strong> lets QArator choose the value from the screenshot; otherwise the tester chooses. The first choice shown, <em>Leave empty</em>, is always available.</p>
    ${W.fields.map((f, i) => `<div class="secbox"><div class="row"><label class="chk inline"><input type="checkbox" data-fon="${i}" ${f.on ? 'checked' : ''}><span><strong>${esc(f.name)}</strong></span></label><span class="grow"></span>
      <label class="chk inline hint"><input type="checkbox" data-fai="${i}" ${f.ai ? 'checked' : ''}><span>AI picks it</span></label></div>
      ${beam(`<input class="field" data-fopt="${i}" aria-label="Choices for ${esc(f.name)}" value="${esc(f.options)}" placeholder="Choice 1, Choice 2">`)}</div>`).join('')}
    <div class="row"><div style="flex:1;min-width:180px">${beam('<input id="newfield" class="field" placeholder="Another field, e.g. Browser">')}</div><button type="button" class="btn btn-secondary" data-go="addfield">${icon.plus}Add</button></div>
    ${nav('Next')}`);
}

function tagsStep() {
  return card(`<h1>Tags</h1>
    <p>If your team uses a fixed list of tags or labels, paste them here, one per line, spelled exactly as in the tracker. QArator suggests only from this list, looking at the page address and the bug. No list? Leave it empty and skip.</p>
    <div><label class="lbl" for="tags">Tags, one per line</label>${beam(`<textarea id="tags" class="field" rows="9" placeholder="Admin&#10;Admin - Orders&#10;Shop - Checkout">${esc(W.tags)}</textarea>`)}</div>
    <p class="hint">Tip: copy the Tags column from a tracker export, or paste a list from your tracker's settings.</p>
    ${nav('Next')}`);
}

function styleStep() {
  return card(`<h1>A report you are proud of</h1>
    <p>Paste one finished bug report your team considers good. The AI copies its tone, length and wording, not its facts. Remove names, phone numbers and IDs first. You can skip this and add it later.</p>
    <div>${beam(`<textarea id="style" class="field" rows="12" placeholder="ACME | Admin | Orders | Order List | Export Button Does Nothing&#10;&#10;Summary: ...">${esc(W.style)}</textarea>`)}</div>
    ${nav('Next')}`);
}

function build() {
  const sections = W.sections.filter((s) => s.include).map((s) => ({ id: s.id, name: s.name, layout: s.layout, include: true, guide: s.guide }));
  const fields = W.fields.filter((f) => f.on).map((f) => {
    const options = f.options.split(',').map((x) => x.trim()).filter(Boolean);
    return { id: f.id, name: f.name, zohoLabel: f.name, options: options.length ? options : ['None'], default: options.includes(f.def) ? f.def : '', ai: f.ai };
  });
  return {
    qarator: 'format', formatVersion: 2,
    meta: { id: slug(W.name) || 'project', name: W.name.trim(), version: 1, sites: W.sites.split('\n').map((x) => x.trim()).filter(Boolean), scopes: [] },
    title: { segments: W.segments.length ? W.segments : ['summary'], project: W.code.trim() || W.name.trim().slice(0, 12), separator: W.sep, maxLength: 150, summaryCase: W.summaryCase },
    urlRules: [], sections, fields,
    tags: { list: W.tags.split('\n').map((x) => x.trim()).filter(Boolean), max: 5, onlyFromList: true },
    styleExample: W.style.trim()
  };
}

function reviewStep() {
  const f = build();
  return card(`<h1>Check and create</h1>
    <ul class="sum">
      <li><strong>${esc(f.meta.name)}</strong> · title code <span class="mono">${esc(f.title.project)}</span>${f.meta.sites.length ? ` · ${f.meta.sites.length} site${f.meta.sites.length === 1 ? '' : 's'}` : ''}</li>
      <li>Title: <span class="mono">${esc(exampleTitle())}</span></li>
      <li>${f.sections.length} description section${f.sections.length === 1 ? '' : 's'}: ${esc(f.sections.map((s) => s.name).join(', ') || 'none')}</li>
      <li>${f.fields.length} dropdown${f.fields.length === 1 ? '' : 's'}: ${esc(f.fields.map((x) => x.name).join(', ') || 'none')}</li>
      <li>${f.tags.list.length ? `${f.tags.list.length} tags` : 'No tag list'}${f.styleExample ? ' · style example added' : ''}</li>
    </ul>
    <p class="hint">You can change anything later in Settings › Format of this project. Creating this adds a new project and switches to it; your other projects stay as they are.</p>
    ${nav('Create the project', { nextGo: 'create' })}`);
}

function finished() {
  const d = W.done;
  return card(`<h1>${esc(d.name)} is ready</h1>
    <p>${d.warnings.length ? `It was created, with ${d.warnings.length} thing${d.warnings.length === 1 ? '' : 's'} repaired along the way:` : 'It is now the project in use.'}</p>
    ${d.warnings.length ? `<ul class="s-l">${d.warnings.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
    <ul class="s-l"><li>Open the QArator panel on the site you test, capture a screenshot and press Generate.</li><li>If a sentence in a report sounds off, tune the matching section note in Settings › Format of this project › Description sections.</li><li>Share this project with a teammate: Settings › Projects › Export this project.</li></ul>
    <div class="foot"><a class="btn btn-secondary" href="options.html#projects">Open settings</a><span class="grow"></span><button type="button" class="btn btn-primary" data-go="close">Close this tab</button></div>`);
}

const SCREENS = { start, import: importStep, agent: agentStep, name: nameStep, title: titleStep, sections: sectionsStep, fields: fieldsStep, tags: tagsStep, style: styleStep, review: reviewStep };
function render() {
  const n = steps().length;
  $('#dots').innerHTML = n > 1 ? steps().map((s, i) => `<i class="${i <= W.step ? 'on' : ''}"></i>`).join('') : '';
  $('#step').innerHTML = W.done ? finished() : SCREENS[cur()]();
  applyTheme();
  const f = $('#step input:not([type=checkbox]), #step textarea, #step select');
  if (f && cur() !== 'start') f.focus({ preventScroll: true });
}

// ---------- actions ----------
async function tryImport() {
  const text = ($('#json')?.value || W.json || '').trim();
  W.json = text;
  if (!text) { W.note = { bad: true, title: 'Nothing to import yet.', items: ['Choose a file or paste the text of the project file.'] }; return render(); }
  let json;
  try { json = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); }
  catch (e) { W.note = { bad: true, title: 'That is not valid JSON.', items: [String(e.message), 'Make sure only the JSON block is pasted: starting with { and ending with }.'] }; return render(); }
  const { errors, warnings } = checkFormat(json);
  if (errors.length) { W.note = { bad: true, title: 'The file was not imported.', items: errors }; return render(); }
  try {
    const r = await addProject(json);
    W.done = { name: r.name, warnings };
  } catch (e) { W.note = { bad: true, title: 'The file was not imported.', items: [e.message] }; }
  render();
}

async function create() {
  try { const f = build(); const r = await addProject(f); W.done = { name: r.name, warnings: r.warnings }; }
  catch (e) { toast(e.message, 4000); return; }
  render();
}

document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-go]');
  if (!b || b.getAttribute('aria-disabled') === 'true') return;
  const go = b.dataset.go, id = b.dataset.id;
  if (go === 'route') { W.route = id; W.step = 1; W.note = null; return render(); }
  if (go === 'next') { W.step = Math.min(steps().length - 1, W.step + 1); return render(); }
  if (go === 'back') { if (W.step <= 1) { W.route = ''; W.step = 0; W.note = null; } else W.step -= 1; return render(); }
  if (go === 'pick') return $('#pick-file').click();
  if (go === 'guide') { dl('qarator-setup-guide.md', buildGuide(), 'text/markdown'); return; }
  if (go === 'copyprompt') { try { await navigator.clipboard.writeText(PROMPT); toast('Message copied'); } catch (err) { toast('Select the message and copy it.', 2600); } return; }
  if (go === 'doimport') return tryImport();
  if (go === 'create') return create();
  if (go === 'close') return window.close();
  if (go === 'addsec') { const v = $('#newsec').value.trim(); if (v) { let sid = slug(v), k = 1; while (W.sections.some((s) => s.id === sid)) sid = `${slug(v)}_${++k}`; W.sections.push({ id: sid, name: v, layout: 'paragraph', include: true, guide: '' }); render(); } return; }
  if (go === 'addfield') { const v = $('#newfield').value.trim(); if (v) { let fid = slug(v), k = 1; while (W.fields.some((x) => x.id === fid)) fid = `${slug(v)}_${++k}`; W.fields.push({ id: fid, name: v, options: '', def: '', ai: false, on: true }); render(); } return; }
  if (go === 'segup' || go === 'segdown') { const i = W.segments.indexOf(id), j = i + (go === 'segup' ? -1 : 1); if (i >= 0 && j >= 0 && j < W.segments.length) { [W.segments[i], W.segments[j]] = [W.segments[j], W.segments[i]]; render(); } return; }
});

document.addEventListener('input', (e) => {
  const t = e.target, d = t.dataset;
  if (t.id === 'json') W.json = t.value;
  else if (t.id === 'pname') { W.name = t.value; const n = $('#next'); if (n) n.setAttribute('aria-disabled', W.name.trim() ? 'false' : 'true'); }
  else if (t.id === 'pcode') W.code = t.value;
  else if (t.id === 'psites') W.sites = t.value;
  else if (t.id === 'sep') { W.sep = t.value; $('#ex').textContent = exampleTitle(); }
  else if (t.id === 'tags') W.tags = t.value;
  else if (t.id === 'style') W.style = t.value;
  else if (d.secguide !== undefined) W.sections[Number(d.secguide)].guide = t.value;
  else if (d.fopt !== undefined) W.fields[Number(d.fopt)].options = t.value;
});
document.addEventListener('change', async (e) => {
  const t = e.target, d = t.dataset;
  if (t.id === 'scase') { W.summaryCase = t.value; $('#ex').textContent = exampleTitle(); }
  else if (d.seg) { if (t.checked) { if (!W.segments.includes(d.seg)) { const order = Object.keys(SEGMENTS); W.segments.push(d.seg); W.segments.sort((a, b) => order.indexOf(a) - order.indexOf(b)); } } else W.segments = W.segments.filter((k) => k !== d.seg); render(); }
  else if (d.sec !== undefined) W.sections[Number(d.sec)].include = t.checked;
  else if (d.fon !== undefined) W.fields[Number(d.fon)].on = t.checked;
  else if (d.fai !== undefined) W.fields[Number(d.fai)].ai = t.checked;
  else if (t.id === 'pick-file') {
    const f = t.files[0]; t.value = '';
    if (!f) return;
    W.json = await f.text(); render(); tryImport();
  }
});

function dl(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

(async function startUp() {
  $('#mark').innerHTML = markSvg(24);
  applyAppearance(await loadSettings());
  watchTheme();
  const r = new URLSearchParams(location.search).get('route');
  if (ROUTE_STEPS[r]) { W.route = r; W.step = 1; }
  render();
})();
