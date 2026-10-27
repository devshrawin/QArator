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

// The tags the team really uses in Zoho (from the exported issue list), spellings merged.
const TEAM_TAGS = ["UR", "UR - Citizen Portal", "UR - Citizen Portal - About Us", "UR - Citizen Portal - Bank Details", "UR - Citizen Portal - CitizenAssist", "UR - Citizen Portal - Consent Management", "UR - Citizen Portal - Contact Us", "UR - Citizen Portal - FAQs", "UR - Citizen Portal - Family Details", "UR - Citizen Portal - Gallery", "UR - Citizen Portal - Home", "UR - Citizen Portal - Landing Page", "UR - Citizen Portal - Mobile", "UR - Citizen Portal - My Dashboard", "UR - Citizen Portal - My Information", "UR - Citizen Portal - Profile", "UR - Citizen Portal - Schemes", "UR - Citizen Portal - Support", "UR - Department Portal", "UR - Department Portal - Content Management System", "UR - Department Portal - Dashboard", "UR - Department Portal - Department Help", "UR - Department Portal - FAQs", "UR - Department Portal - Feedback", "UR - Department Portal - GR Assist", "UR - Department Portal - GR Assist - 2", "UR - Department Portal - Login", "UR - Department Portal - Notification Config", "UR - Department Portal - Organization Structure", "UR - Department Portal - Profile", "UR - Department Portal - Reports", "UR - Department Portal - SEVI Dashboard", "UR - Department Portal - Scheme Creation", "UR - Department Portal - Scheme Management", "UR - Department Portal - Scheme Planning", "UR - Department Portal - Scheme Scrutiny", "UR - Department Portal - Support", "UR - Department Portal - User Management", "UR - Consent Management - Consent Request Form", "UR - Consent Management - Consent Type Master", "UR - Consent Management - My Dashboard"];
// The short list older versions shipped; a stored copy of exactly this is upgraded to the full list.
const OLD_TAG_LIST = ['UR - Department Portal', 'UR - Department Portal - SEVI Dashboard'];

export const DEFAULTS = {
  formatVersion: FORMAT_VERSION,
  ai: { provider: 'gemini', apiKey: '', apiKey2: '', model: 'auto', fallback: true, baseUrl: '', models: [] },
  usage: { prices: '', usdInr: 88, limits: '' },
  appearance: { theme: 'system', motion: 'system', fontSize: 'default', glow: 'strong', density: 'comfortable' },
  writingLength: 'standard',
  pageErrors: false,
  title: {
    segments: ['project', 'portal', 'module', 'page', 'summary'],
    project: 'UR',
    separator: ' | ',
    maxLength: 150,
    summaryCase: 'title'
  },
  urlRules: [
    { match: 'unifiedregistry-department-portal', portal: 'Department Portal', module: '', page: '' },
    { match: '/department/sevidashboard', portal: '', module: 'SEVI Dashboard', page: '' }
  ],
  sections: [
    { id: 'url_note', name: 'URL', layout: 'inline', include: true, guide: 'Only a short note on which module or workspace on this URL is affected, e.g. "Specifically affects the SEVI State Overview module workspace". The URL itself is added automatically; do not repeat it.' },
    { id: 'summary', name: 'Summary', layout: 'inline', include: true, guide: 'Two or three sentences: what the user did, what went wrong and where. Plain and specific.' },
    { id: 'issue_details', name: 'Issue Details', layout: 'paragraph', include: true, guide: 'One intro line that names the screenshot file, then two or three short paragraphs, each starting with a label and a colon (e.g. "Isolated Light Canvas Layout: ..."). Describe exactly what is visible: components, colours, values, messages. Mention captured console errors if relevant. Separate paragraphs with a blank line.' },
    { id: 'steps', name: 'Steps to Reproduce', layout: 'numbered', include: true, guide: 'Start from opening the portal and logging in. One action per step, using the labels shown on screen. The last step is the observation.' },
    { id: 'expected', name: 'Expected Result', layout: 'paragraph', include: true, guide: 'What should happen, stated as a requirement.' },
    { id: 'actual', name: 'Actual Result', layout: 'paragraph', include: true, guide: 'What happens instead, in one or two sentences, matching the screenshot.' }
  ],
  fields: [
    { id: 'severity', name: 'Severity', zohoLabel: 'Severity', options: ['None', 'Show stopper', 'Critical', 'Major', 'Minor'], default: 'Minor', ai: true },
    { id: 'priority', name: 'Priority', zohoLabel: 'Priority', options: ['None', 'Low', 'Medium', 'High'], default: 'Low', ai: true },
    { id: 'classification', name: 'Classification', zohoLabel: 'Classification', options: ['Issue', 'Functional', 'Security', 'Crash/Hang', 'Data loss', 'Performance', 'UI/Usabililty', 'UI/Usability', 'UI', 'Other bug', 'Feature(New)', 'Enhancement', 'Suggestion', 'New Requirement', 'Change Request', 'Backend'], default: 'Issue', ai: true },
    { id: 'test_phase', name: 'Test Phase', zohoLabel: 'Test Phase', options: ['Smoke', 'System', 'Sanity', 'Functional', 'Regression', 'UAT'], default: 'Smoke', ai: false },
    { id: 'device_type', name: 'Device Type', zohoLabel: 'Device Type', options: ['Web Application', 'Mobile', 'TOM', 'EFO', 'TVM', 'LTVM', 'SCS', 'AG', 'CC', 'HHD', 'TR'], default: '', ai: false },
    { id: 'reproducible', name: 'Reproducible', zohoLabel: 'Reproducible|Is it reproducible', options: ['None', 'Always', 'Sometimes', 'Rarely', 'Unable'], default: '', ai: false },
    { id: 'flag', name: 'Flag', zohoLabel: 'Flag', options: ['Internal', 'External'], default: 'Internal', ai: false },
    { id: 'assignee', name: 'Assignee', zohoLabel: 'Assignee|Assign To', options: ['Unassigned'], default: 'Unassigned', ai: false }
  ],
  tags: {
    list: TEAM_TAGS,
    max: 5,
    onlyFromList: true
  },
  styleExample: "UR | Department Portal | SEVI Dashboard | State Overview | Incomplete Theme Propagation for Dark Mode on Dashboard Canvas\n\nURL: https://unifiedregistry-department-portal.amnex.co.in/department/sevidashboard (Specifically affects the SEVI State Overview module workspace)\n\nSummary: The application's dark mode theme fails to fully propagate down to the analytics components. When a user clicks the theme toggle utility button in the header bar, the peripheral structures\u2014such as the vertical navigation sidebar, top navigation band, and master page wrapper\u2014successfully paint dark theme variables. However, the core SEVI Dashboard body canvas ignores this state shift, remaining stuck in light mode with high-contrast white card backgrounds.\n\nIssue Details\nAn inspection of the dashboard theme layout verified via image_af8558.png isolates a CSS class injection or theme variable mapping breakdown across the inner workspace containers:\n\nIncomplete Theme Mixin Allocation: The persistent structural frames (the left sidebar container and the top user status bar) adapt correctly, switching to deep charcoal/navy background states (#1e293b / #0f172a equivalents).\n\nIsolated Light Canvas Layout: In contrast, the main analytics panel area remains entirely unaltered. The parent content viewport container, filter strip block backgrounds, informational metrics overview cards, and charting widget frames remain forced into a bright white state (#ffffff). This incomplete transition creates an unpleasant high-contrast visual clash and compromises readability.\n\nSteps to Reproduce\n1. Open the Department Portal workspace and log in using verified administrative or department credentials.\n2. Click on the theme toggle button (the sun/moon icon) located inside the top right corner utility cluster of the persistent header band (image_af8558.png).\n3. Confirm that the application shell transitions into its dark mode presentation layout.\n4. Navigate to Sevi Dashboard > State Overview using the vertical sidebar menu drawer.\n5. Observe the background color mapping applied to the metric analytics widgets and main content canvas.\n\nExpected Result\nThe dark theme context must pass seamlessly down to all child modules. Turning dark mode on should trigger a global update that adapts the background, card elements, input panels, text fonts, and data charting canvases of the SEVI Dashboard to use cohesive, dark-palette CSS variables.\n\nActual Result\nThe interface exhibits an incomplete theme transition; the main web workspace frame changes correctly, but the core analytical charts and data component cards stay rendered in full light mode.\n\nSeverity: Minor | Priority: Low | Classification: Issue | Test Phase: Smoke",
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
  if (!Array.isArray(out.tags.list) || (out.tags.list.length === OLD_TAG_LIST.length && OLD_TAG_LIST.every((t, i) => out.tags.list[i] === t))) out.tags.list = d.tags.list;
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
    // a default of '' means "leave it empty": Fill skips that field in Zoho
    const empty = x.default === '';
    return { ...x, id: safeId(x.id, i, 'field'), name: String(x.name || 'Field'), options, default: empty || options.includes(x.default) ? x.default : options[0] };
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
