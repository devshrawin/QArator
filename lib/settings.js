// Settings: defaults, load/save, export/import. Everything lives in
// chrome.storage.local on this machine; the API key never leaves it except
// to the chosen AI provider, and is stripped from exports.

export const FORMAT_VERSION = 1;

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

export const DEFAULTS = {
  formatVersion: FORMAT_VERSION,
  ai: { provider: 'gemini', apiKey: '', apiKey2: '', model: 'auto', fallback: true, baseUrl: '', models: [] },
  usage: { prices: '', usdInr: 88, limits: '' },
  appearance: { theme: 'system', motion: 'system', fontSize: 'default', glow: 'strong', density: 'comfortable' },
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
    { id: 'url_note', name: 'URL', layout: 'inline', include: true, guide: 'Only a short note on which module or workspace on this URL is affected, e.g. "Specifically affects the order list toolbar". The URL itself is added automatically; do not repeat it.' },
    { id: 'summary', name: 'Summary', layout: 'inline', include: true, guide: 'Two or three sentences: what the user did, what went wrong and where. Plain and specific.' },
    { id: 'issue_details', name: 'Issue Details', layout: 'paragraph', include: true, guide: 'One intro line that names the screenshot file, then two or three short paragraphs, each starting with a label and a colon (e.g. "Isolated Light Canvas Layout: ..."). Describe exactly what is visible: components, colours, values, messages. Mention captured console errors if relevant. Separate paragraphs with a blank line.' },
    { id: 'steps', name: 'Steps to Reproduce', layout: 'numbered', include: true, guide: 'Start from opening the portal and logging in. One action per step, using the labels shown on screen. The last step is the observation.' },
    { id: 'expected', name: 'Expected Result', layout: 'paragraph', include: true, guide: 'What should happen, stated as a requirement.' },
    { id: 'actual', name: 'Actual Result', layout: 'paragraph', include: true, guide: 'What happens instead, in one or two sentences, matching the screenshot.' }
  ],
  fields: [
    { id: 'severity', name: 'Severity', zohoLabel: 'Severity', options: ['None', 'Show stopper', 'Critical', 'Major', 'Minor'], default: 'Minor', ai: true },
    { id: 'priority', name: 'Priority', zohoLabel: 'Priority', options: ['None', 'Low', 'Medium', 'High'], default: 'Low', ai: true },
    { id: 'classification', name: 'Classification', zohoLabel: 'Classification', options: ['Bug', 'Issue', 'Enhancement', 'Suggestion', 'UI/Usability', 'Performance', 'Security', 'Functional'], default: 'Bug', ai: true },
    { id: 'test_phase', name: 'Test Phase', zohoLabel: 'Test Phase', options: ['Smoke', 'Sanity', 'Functional', 'Regression', 'UAT'], default: 'Smoke', ai: false },
    { id: 'device_type', name: 'Device Type', zohoLabel: 'Device Type', options: ['Desktop', 'Web Application', 'Mobile', 'Tablet'], default: 'Desktop', ai: false },
    { id: 'reproducible', name: 'Reproducible', zohoLabel: 'Reproducible|Is it reproducible', options: ['None', 'Always', 'Sometimes', 'Rarely', 'Unable'], default: 'Always', ai: false },
    { id: 'flag', name: 'Flag', zohoLabel: 'Flag', options: ['Internal', 'External'], default: 'Internal', ai: false },
    { id: 'assignee', name: 'Assignee', zohoLabel: 'Assignee|Assign To', options: ['Unassigned'], default: 'Unassigned', ai: false }
  ],
  tags: {
    list: [],
    max: 5,
    onlyFromList: true
  },
  styleExample: "APP | Admin Portal | Orders | Order List | Export Button Does Nothing When Filters Are Applied\n\nURL: https://admin.example.com/orders (Specifically affects the order list toolbar)\n\nSummary: With a date filter applied on the Order List, clicking Export does nothing. No file downloads and no message appears. Export works when no filter is set.\n\nIssue Details\nThe screenshot qarator_20260101_101500_1.png shows the Order List with a date filter and the Export button in the toolbar.\n\nToolbar State: The Export button looks enabled and shows its pressed state on click, but nothing follows.\n\nConsole: A request to the export endpoint returns 500 when the filter is set.\n\nSteps to Reproduce\n1. Open the Admin Portal and sign in.\n2. Go to Orders > Order List.\n3. Set the date filter to the last 7 days.\n4. Click Export.\n5. Observe that no file is downloaded.\n\nExpected Result\nExport downloads the filtered orders as a file, the same as it does without a filter.\n\nActual Result\nNothing happens and no error is shown to the user.\n\nSeverity: Major | Priority: Medium | Classification: Bug | Test Phase: Functional",
  zoho: {
    domain: 'projects.zoho.in',
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
  out.zoho = { ...d.zoho, ...(s.zoho || {}) };
  out.usage = { ...d.usage, ...(s.usage || {}) };
  out.appearance = { ...d.appearance, ...(s.appearance || {}) };
  for (const [k, opts] of Object.entries(APPEARANCE)) if (!(out.appearance[k] in opts)) out.appearance[k] = d.appearance[k];
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
    return { ...x, id: safeId(x.id, i, 'field'), name: String(x.name || 'Field'), options, default: options.includes(x.default) ? x.default : options[0] };
  });
  const segs = Object.keys(SEGMENTS);
  if (!Array.isArray(out.title.segments) || out.title.segments.length !== segs.length || !segs.every((k) => out.title.segments.includes(k))) out.title.segments = d.title.segments;
  out.formatVersion = FORMAT_VERSION;
  return out;
}

export async function loadSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return normalize(settings);
}

export async function saveSettings(s) {
  await chrome.storage.local.set({ settings: normalize(s) });
}

export function onSettingsChanged(cb) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.settings) cb(normalize(changes.settings.newValue));
  });
}

/** Everything except the key, the cached model list and the personal appearance. */
export function exportFormat(s) {
  const out = clone(normalize(s));
  out.ai = { provider: out.ai.provider, model: out.ai.model, fallback: out.ai.fallback, baseUrl: out.ai.baseUrl };
  delete out.appearance;
  return { qarator: 'format', ...out };
}

export function importFormat(current, json) {
  if (!json || typeof json !== 'object' || json.qarator !== 'format') throw new Error('This file is not a QArator format export.');
  const next = normalize({ ...json });
  delete next.qarator;
  // The AI connection stays this browser's own: a shared file must never point this browser's key
  // (and screenshots) at another server, so provider, address, model and keys are not imported.
  next.ai = { ...current.ai };
  next.appearance = { ...current.appearance };
  return next;
}

export const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'section';
