// Settings: defaults, load/save, export/import. Everything lives in
// chrome.storage.local on this machine; the API key never leaves it except
// to the chosen AI provider, and is stripped from exports.

export const FORMAT_VERSION = 2;

export const PROVIDERS = {
  anthropic: { label: 'Anthropic', keyHint: 'Starts with sk-ant-', needsBase: false },
  openai: { label: 'OpenAI', keyHint: 'Starts with sk-', needsBase: false },
  gemini: { label: 'Google Gemini', keyHint: 'From Google AI Studio', needsBase: false },
  compatible: { label: 'OpenAI-compatible endpoint', keyHint: 'Key for your endpoint (optional for local servers)', needsBase: true }
};

export const LAYOUTS = { inline: 'One line (Name: text)', paragraph: 'Paragraph', bullets: 'Bullet list', numbered: 'Numbered list' };
export const SEGMENTS = { project: 'Project', portal: 'Portal', module: 'Module', page: 'Page', summary: 'Summary' };

/** Per-person look and feel. Not part of the shared format: never exported, kept on import. */
export const APPEARANCE = {
  theme: { system: 'System', light: 'Light', dark: 'Dark' },
  motion: { system: 'System', on: 'On', off: 'Off' },
  fontSize: { small: 'Small', default: 'Default', large: 'Large', larger: 'Larger' },
  glow: { off: 'Off', subtle: 'Subtle', strong: 'Strong' },
  density: { comfortable: 'Comfortable', compact: 'Compact' }
};

// Image editor: the colours and line weights offered, and the defaults for new marks.
export const MARK_COLORS = { '#FF6A2B': 'Orange', '#E5361F': 'Red', '#2F6FEB': 'Blue', '#16A34A': 'Green', '#FACC15': 'Yellow', '#111111': 'Black' };
export const MARK_WIDTHS = { thin: 'Thin', medium: 'Medium', thick: 'Thick' };
export const MARK_WIDTH_FACTOR = { thin: 0.6, medium: 1, thick: 1.8 };

export const DEFAULTS = {
  formatVersion: FORMAT_VERSION,
  // which project this setup is, the sites it applies to, and the portals/areas that override parts of it
  meta: { id: 'default', name: 'My project', sites: [], scopes: [], version: 1 },
  ai: { provider: 'gemini', apiKey: '', apiKey2: '', model: 'auto', fallback: true, baseUrl: '', models: [] },
  usage: { prices: '', usdInr: 88, limits: '' },
  appearance: { theme: 'system', motion: 'system', fontSize: 'default', glow: 'strong', density: 'comfortable' },
  editor: { color: '#FF6A2B', width: 'medium' },
  writingLength: 'standard',
  pageErrors: false,
  title: {
    segments: ['project', 'portal', 'module', 'page', 'summary'],
    project: 'APP',
    separator: ' | ',
    maxLength: 150,
    summaryCase: 'title'
  },
  urlRules: [],
  sections: [
    { id: 'url_note', name: 'URL', layout: 'inline', include: true, guide: 'Only a short note on which part of the application on this URL is affected. The URL itself is added automatically; do not repeat it.' },
    { id: 'summary', name: 'Summary', layout: 'inline', include: true, guide: 'Two or three sentences: what the user did, what went wrong and where. Plain and specific.' },
    { id: 'issue_details', name: 'Issue Details', layout: 'paragraph', include: true, guide: 'One intro line that names the screenshot file, then two or three short paragraphs, each starting with a label and a colon. Describe exactly what is visible: components, values, messages. Mention captured console errors if relevant. Separate paragraphs with a blank line.' },
    { id: 'steps', name: 'Steps to Reproduce', layout: 'numbered', include: true, guide: 'Start from opening the application. One action per step, using the labels shown on screen. The last step is the observation.' },
    { id: 'expected', name: 'Expected Result', layout: 'paragraph', include: true, guide: 'What should happen, stated as a requirement.' },
    { id: 'actual', name: 'Actual Result', layout: 'paragraph', include: true, guide: 'What happens instead, in one or two sentences, matching the screenshot.' }
  ],
  fields: [
    { id: 'severity', name: 'Severity', zohoLabel: 'Severity', options: ['None', 'Show stopper', 'Critical', 'Major', 'Minor'], default: 'Minor', ai: true },
    { id: 'priority', name: 'Priority', zohoLabel: 'Priority', options: ['None', 'Low', 'Medium', 'High'], default: 'Low', ai: true },
    { id: 'classification', name: 'Classification', zohoLabel: 'Classification', options: ['Bug', 'Functional', 'UI/Usability', 'Performance', 'Security', 'Data loss', 'Enhancement', 'Suggestion'], default: 'Bug', ai: true }
  ],
  tags: {
    list: [],
    max: 5,
    onlyFromList: true
  },
  styleExample: "APP | Admin Portal | Orders | Order List | Export Button Does Nothing\n\nURL: https://app.example.com/admin/orders (Specifically affects the Order List export)\n\nSummary: On the Order List, pressing Export shows no file and no message. The button looks pressed and then returns to normal.\n\nIssue Details\nThe screenshot (orders-1.png) shows the Order List with the Export button highlighted.\n\nNo Download Starts: Pressing Export does not start a download and no confirmation appears.\n\nSteps to Reproduce\n1. Open the application and log in.\n2. Open Orders > Order List.\n3. Press Export.\n4. Observe that nothing is downloaded and no message appears.\n\nExpected Result\nPressing Export downloads the list of orders as a file.\n\nActual Result\nNothing is downloaded and no message is shown.\n\nSeverity: Major | Priority: Medium | Classification: Bug",
  zoho: {
    domain: 'projects.zoho.com',
    submitUrl: '',
    titleLabel: 'Issue Title|Bug Title|Title',
    descriptionLabel: 'Description|Issue Description',
    tagsLabel: 'Tags',
    attachLabel: 'Attachment|Attachments|Attach',
    uploadScreenshots: true,
    looseMatch: true,
    scrollToFirst: true,
    emptyOnly: false,
    stepsField: false,
    stepsLabel: 'Steps to Reproduce',
    fillTags: false
  }
};

const clone = (o) => JSON.parse(JSON.stringify(o));

/** Fill any missing keys from defaults (keeps user values). */
export function normalize(s) {
  const d = clone(DEFAULTS);
  if (!s || typeof s !== 'object') return d;
  const out = { ...d, ...s };
  out.ai = { ...d.ai, ...(s.ai || {}) };
  out.title = { ...d.title, ...(s.title || {}) };
  out.tags = { ...d.tags, ...(s.tags || {}) };
  if (!Array.isArray(out.tags.list)) out.tags.list = d.tags.list;
  out.zoho = { ...d.zoho, ...(s.zoho || {}) };
  out.usage = { ...d.usage, ...(s.usage || {}) };
  out.appearance = { ...d.appearance, ...(s.appearance || {}) };
  for (const [k, opts] of Object.entries(APPEARANCE)) if (!(out.appearance[k] in opts)) out.appearance[k] = d.appearance[k];
  out.editor = { ...d.editor, ...(s.editor || {}) };
  if (!(out.editor.color in MARK_COLORS)) out.editor.color = d.editor.color;
  if (!(out.editor.width in MARK_WIDTHS)) out.editor.width = d.editor.width;
  if (!Array.isArray(out.urlRules)) out.urlRules = d.urlRules;
  if (!Array.isArray(out.sections) || !out.sections.length) out.sections = d.sections;
  if (!Array.isArray(out.fields)) out.fields = d.fields;
  if (!PROVIDERS[out.ai.provider]) out.ai.provider = d.ai.provider;
  // ids end up in the panel's HTML and selectors: keep them to letters, digits and _
  const safeId = (v, i, pre) => String(v || '').toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || `${pre}_${i + 1}`;
  out.sections = out.sections.filter((x) => x && typeof x === 'object').map((x, i) => ({ ...x, id: safeId(x.id, i, 'section'), name: String(x.name || 'Section'), guide: String(x.guide || '') }));
  out.fields = out.fields.filter((x) => x && typeof x === 'object').map((x, i) => {
    const options = Array.isArray(x.options) ? x.options.map(String).filter(Boolean) : [];
    if (!options.length) options.push(String(x.default || 'None'));
    // a default of '' means "leave it empty": Fill skips that field in Zoho
    const empty = x.default === '';
    return { ...x, id: safeId(x.id, i, 'field'), name: String(x.name || 'Field'), options, default: empty || options.includes(x.default) ? x.default : options[0] };
  });
  const segs = Object.keys(SEGMENTS);
  if (!Array.isArray(out.title.segments) || out.title.segments.length !== segs.length || !segs.every((k) => out.title.segments.includes(k))) out.title.segments = d.title.segments;
  out.meta = normalizeMeta(s.meta, d.meta, out.title.project, safeId);
  out.formatVersion = FORMAT_VERSION;
  return out;
}

const OVERRIDE_KEYS = ['title', 'tags', 'sections', 'fields', 'styleExample', 'urlRules', 'zoho', 'writingLength'];
const str = (v) => String(v == null ? '' : v).trim();

/** What a portal/area may override. Anything else in the file is dropped. */
function normalizeOverride(o, safeId) {
  const src = o && typeof o === 'object' && !Array.isArray(o) ? o : {};
  const out = {};
  for (const k of OVERRIDE_KEYS) {
    const v = src[k];
    if (v == null) continue;
    if (['title', 'tags', 'zoho'].includes(k) && typeof v === 'object' && !Array.isArray(v)) out[k] = clone(v);
    else if (k === 'sections' && Array.isArray(v)) out[k] = v.filter((x) => x && typeof x === 'object').map((x, i) => ({ ...x, id: safeId(x.id, i, 'section'), name: str(x.name) || 'Section', guide: str(x.guide) }));
    else if (k === 'fields' && Array.isArray(v)) out[k] = v.filter((x) => x && typeof x === 'object').map((x, i) => ({ ...x, id: safeId(x.id, i, 'field'), ...(Array.isArray(x.options) ? { options: x.options.map(String).filter(Boolean) } : {}) }));
    else if (k === 'urlRules' && Array.isArray(v)) out[k] = v.filter((r) => r && typeof r === 'object' && str(r.match));
    else if (k === 'styleExample' || k === 'writingLength') out[k] = String(v);
  }
  return out;
}

function normalizeMeta(m, dm, projectCode, safeId) {
  const src = m && typeof m === 'object' && !Array.isArray(m) ? m : {};
  const scopes = (Array.isArray(src.scopes) ? src.scopes : []).filter((x) => x && typeof x === 'object' && str(x.match)).slice(0, 60)
    .map((x, i) => ({ id: safeId(x.id || x.name, i, 'scope'), name: str(x.name) || str(x.match), match: str(x.match), override: normalizeOverride(x.override, safeId) }));
  return {
    id: safeId(src.id, 0, 'project') || dm.id,
    name: str(src.name) || str(projectCode) || dm.name,
    sites: (Array.isArray(src.sites) ? src.sites : []).map(str).filter(Boolean).slice(0, 30),
    scopes,
    version: Math.max(1, Math.floor(Number(src.version)) || 1)
  };
}

const hostPath = (u) => String(u || '').toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^\*\./, '');

/** Portals/areas whose match is in this address, shortest first, so a deeper one overrides a broader one. */
export function scopesFor(s, url) {
  const u = hostPath(url);
  if (!u) return [];
  return (s.meta?.scopes || []).filter((x) => hostPath(x.match) && u.includes(hostPath(x.match))).sort((a, b) => hostPath(a.match).length - hostPath(b.match).length);
}

/** The settings as they apply on this page: the project's own plus every matching portal's overrides. */
export function applyScope(s, url) {
  const hits = scopesFor(s, url);
  const out = { ...s, scope: hits.length ? hits[hits.length - 1].name : '' };
  for (const sc of hits) {
    const o = sc.override || {};
    for (const k of ['title', 'tags', 'zoho']) if (o[k]) out[k] = { ...out[k], ...o[k] };
    if (o.sections && o.sections.length) out.sections = o.sections.map((x) => ({ layout: 'paragraph', include: true, ...x }));
    if (o.fields) {
      const byId = new Map(out.fields.map((f) => [f.id, f]));
      for (const f of o.fields) {
        const base = byId.get(f.id) || { name: f.id, zohoLabel: f.name || f.id, options: [], default: '', ai: false };
        const merged = { ...base, ...f };
        if (!merged.options.length) merged.options = base.options.length ? base.options : [String(merged.default || 'None')];
        byId.set(f.id, merged);
      }
      out.fields = [...byId.values()];
    }
    if (o.urlRules) out.urlRules = [...o.urlRules, ...out.urlRules];
    if (typeof o.styleExample === 'string') out.styleExample = o.styleExample;
    if (typeof o.writingLength === 'string') out.writingLength = o.writingLength;
  }
  return out;
}

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return normalize(settings);
}

export const PROJECTS_KEY = 'projects';

// The working copy lives in `settings`; every save also mirrors its project part into `projects`,
// the shelf of all of this browser's projects, so switching never loses edits.
export async function saveSettings(s) {
  const next = normalize(s);
  const { [PROJECTS_KEY]: shelf = {} } = await chrome.storage.local.get(PROJECTS_KEY);
  await chrome.storage.local.set({ settings: next, [PROJECTS_KEY]: { ...shelf, [next.meta.id]: formatPart(next) } });
}

export function onSettingsChanged(cb) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) cb(normalize(changes.settings.newValue));
  });
}

/** The part of the settings a project file carries: no keys, no usage, no look and feel. */
const FORMAT_KEYS = ['meta', 'writingLength', 'title', 'urlRules', 'sections', 'fields', 'tags', 'styleExample', 'zoho'];
export const formatPart = (s) => Object.fromEntries(FORMAT_KEYS.map((k) => [k, clone(s[k])]));

export function exportFormat(s) {
  return { qarator: 'format', formatVersion: FORMAT_VERSION, ...formatPart(normalize(s)) };
}

/**
 * Read a project file and say what is wrong with it in plain words an AI agent can act on.
 * errors stop the import; warnings are things normalize() repaired.
 */
export function checkFormat(json) {
  const errors = [], warnings = [];
  if (!json || typeof json !== 'object' || Array.isArray(json) || json.qarator !== 'format') return { errors: ['This file is not a QArator format. The top level must be an object with "qarator": "format".'], warnings };
  if (Number(json.formatVersion) > FORMAT_VERSION) errors.push(`The file is formatVersion ${json.formatVersion}; this QArator reads up to ${FORMAT_VERSION}. Update QArator.`);
  for (const k of ['sections', 'fields', 'urlRules']) if (json[k] != null && !Array.isArray(json[k])) errors.push(`"${k}" must be a list.`);
  if (json.meta != null && (typeof json.meta !== 'object' || Array.isArray(json.meta))) errors.push('"meta" must be an object.');
  if (json.meta?.scopes != null && !Array.isArray(json.meta.scopes)) errors.push('"meta.scopes" must be a list.');
  if (json.tags != null && (typeof json.tags !== 'object' || Array.isArray(json.tags))) errors.push('"tags" must be an object like {"list": [...], "max": 5, "onlyFromList": true}.');
  if (json.tags?.list != null && !Array.isArray(json.tags.list)) errors.push('"tags.list" must be a list of strings.');
  if (errors.length) return { errors, warnings };
  const ids = new Set();
  (json.sections || []).forEach((x, i) => {
    if (!x || typeof x !== 'object') return warnings.push(`sections[${i}] is not an object and was skipped.`);
    if (!str(x.name)) warnings.push(`sections[${i}] has no "name"; it is called "Section".`);
    if (x.layout && !LAYOUTS[x.layout]) warnings.push(`sections[${i}].layout "${x.layout}" is not one of ${Object.keys(LAYOUTS).join(', ')}; "paragraph" is used.`);
  });
  (json.fields || []).forEach((x, i) => {
    if (!x || typeof x !== 'object') return warnings.push(`fields[${i}] is not an object and was skipped.`);
    if (!str(x.name)) warnings.push(`fields[${i}] has no "name".`);
    if (!Array.isArray(x.options) || !x.options.length) warnings.push(`fields[${i}].options is empty; "${str(x.default) || 'None'}" is the only choice.`);
    else if (x.default != null && x.default !== '' && !x.options.map(String).includes(String(x.default))) warnings.push(`fields[${i}].default "${x.default}" is not in its options; the first option is used.`);
    if (x.id && ids.has(x.id)) warnings.push(`fields[${i}].id "${x.id}" is used twice.`); else if (x.id) ids.add(x.id);
  });
  (json.urlRules || []).forEach((r, i) => { if (!r || !str(r.match)) warnings.push(`urlRules[${i}] has no "match" and was skipped.`); });
  (json.meta?.scopes || []).forEach((x, i) => {
    if (!x || !str(x.match)) warnings.push(`meta.scopes[${i}] has no "match" and was skipped.`);
    else if (!str(x.name)) warnings.push(`meta.scopes[${i}] has no "name"; its match is used.`);
  });
  if (!(json.sections || []).length && !(json.fields || []).length) warnings.push('The file has no sections and no fields; the built-in ones are kept.');
  return { errors, warnings };
}

/** A project file on top of this browser's own AI connection, look and usage. */
export function importFormat(current, json) {
  const { errors } = checkFormat(json);
  if (errors.length) throw new Error(errors.join(' '));
  const next = normalize({ ...json });
  delete next.qarator;
  // The AI connection stays this browser's own: a shared file must never point this browser's key
  // (and screenshots) at another server, so provider, address, model and keys are not imported.
  next.ai = { ...current.ai };
  next.appearance = { ...current.appearance };
  next.editor = { ...current.editor };
  next.usage = { ...current.usage };
  next.pageErrors = current.pageErrors;
  return next;
}

export const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'section';
