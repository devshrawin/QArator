// Turns capture + AI answer into the house-format report, and the report into
// a title and description. Pure functions, no DOM.

export const isText = (layout) => layout === 'paragraph' || layout === 'inline';
export const looseKey = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');

export function matchOption(value, options) {
  if (value == null || value === '') return null;
  const exact = options.find((o) => o === value);
  if (exact) return exact;
  const k = looseKey(value);
  return options.find((o) => looseKey(o) === k) || null;
}

const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'per', 'the', 'to', 'vs', 'via', 'with', 'from', 'into']);
export function titleCase(s) {
  const words = String(s || '').trim().split(/\s+/);
  return words.map((w, i) => {
    if (!w) return w;
    if (/[A-Z].*[A-Z]/.test(w) || /\d/.test(w) || /[./]/.test(w)) return w; // acronyms, versions, paths
    const lower = w.toLowerCase();
    if (i > 0 && i < words.length - 1 && SMALL.has(lower)) return lower;
    return lower.replace(/^(\W*)(\w)/, (m, p, c) => p + c.toUpperCase()).replace(/-(\w)/g, (m, c) => '-' + c.toUpperCase());
  }).join(' ');
}
export function sentenceCase(s) {
  const t = String(s || '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/** First matching rule fills each segment, top to bottom. */
export function applyUrlRules(url, rules) {
  const out = { portal: '', module: '', page: '' };
  const u = String(url || '').toLowerCase();
  const exact = ruleMatchFor(url);
  for (const r of rules || []) {
    // a learned rule is for one page exactly; a team rule matches any URL that contains its text
    if (!r.match || (r.learned ? exact !== String(r.match).toLowerCase() : !u.includes(String(r.match).toLowerCase()))) continue;
    for (const k of ['portal', 'module', 'page']) if (!out[k] && r[k]) out[k] = r[k];
  }
  return out;
}

/** "unifiedregistry-department-portal.example.in" → "Department Portal" (only when the host names a portal). */
export function portalFromHost(url) {
  let host = '';
  try { host = new URL(url).hostname; } catch (e) { return ''; }
  const words = host.split('.')[0].split(/[-_]+/).filter(Boolean);
  const i = words.findIndex((w) => /^portal$/i.test(w));
  if (i < 0) return '';
  return titleCase(words.slice(Math.max(0, i - 1), i + 1).join(' '));
}

/** Module and page from where the tester is on the page: breadcrumb first, then the highlighted menu, tab, heading. */
export function segmentsFromPage(page) {
  const h = { ...(page?.hints || {}) };
  // Titles are English: a page shown in Malayalam or Hindi gives "ഹോം", which is no use in a title.
  const latin = (t) => /[a-z]/i.test(t || '');
  const crumbs = (h.crumbs || []).filter(latin), nav = (h.nav || []).filter(latin);
  if (!latin(h.tab)) h.tab = '';
  if (!latin(h.heading)) h.heading = '';
  const out = { portal: portalFromHost(page?.url), module: '', page: '' };
  if (crumbs.length >= 2) { out.module = crumbs[crumbs.length - 2]; out.page = crumbs[crumbs.length - 1]; }
  else if (nav.length >= 2) { out.module = nav[0]; out.page = h.tab || nav[nav.length - 1]; }
  else {
    out.module = nav[0] || crumbs[0] || '';
    const p = h.tab || h.heading || '';
    out.page = p.toLowerCase() === out.module.toLowerCase() ? '' : p;
  }
  return out;
}

/** Title segments known before the AI answers: URL rules win, then what the page shows. */
export function locate(page, rules) {
  const rule = applyUrlRules(page?.url, rules);
  const seen = segmentsFromPage(page);
  const out = {};
  for (const k of ['portal', 'module', 'page']) out[k] = rule[k] || seen[k] || '';
  return out;
}

/** The URL a learned rule matches: host and path, without query, hash, trailing slash or trailing ids. */
export function ruleMatchFor(url) {
  let u;
  try { u = new URL(url); } catch (e) { return ''; }
  // hash-routed apps (#/schemes/list) keep their route in the hash
  const route = /^#!?\//.test(u.hash) ? u.hash.replace(/^#!?/, '').split('?')[0] : '';
  const segs = (u.pathname + (route ? `/#${route}` : '')).split('/').filter(Boolean);
  while (segs.length && /^(\d+|[0-9a-f-]{16,})$/i.test(segs[segs.length - 1])) segs.pop();
  return `${u.hostname}${segs.length ? '/' + segs.join('/') : ''}`.toLowerCase();
}

/**
 * Remember portal / module / page for this page so the next bug here gets the same names.
 * Returns the new rule list, or null when nothing changed. Learned rules go first and are capped.
 */
export function learnRule(rules, url, seg) {
  const match = ruleMatchFor(url);
  if (!match.includes('/')) return null; // a site's home page says nothing about its modules
  const vals = { portal: (seg.portal || '').trim(), module: (seg.module || '').trim(), page: (seg.page || '').trim() };
  if (!match || (!vals.module && !vals.page)) return null;
  const list = (rules || []).map((r) => ({ ...r }));
  const i = list.findIndex((r) => String(r.match).toLowerCase() === match);
  if (i >= 0) {
    const r = list[i];
    if (r.portal === vals.portal && r.module === vals.module && r.page === vals.page) return null;
    if (!r.learned) return null; // never overwrite a rule the team wrote
    list.splice(i, 1);
  } else {
    const now = applyUrlRules(url, list);
    if (now.portal === vals.portal && now.module === vals.module && now.page === vals.page) return null;
  }
  const learned = [{ match, ...vals, learned: true }, ...list.filter((r) => r.learned)].slice(0, 60);
  return [...learned, ...list.filter((r) => !r.learned)];
}

/** Tags from the team list worth adding: the ticked ones first, then list tags naming this portal or module. */
export function suggestTags(report, list, max = 5) {
  const out = report.tags.filter((t) => t.on).map((t) => matchOption(t.name, list) || t.name);
  const mod = looseKey(report.segments.module), portal = looseKey(report.segments.portal);
  // module tags ("UR - Citizen Portal - Home") first, then the portal's own tag, never another module's tag
  const scored = (list || []).map((t) => {
    const k = looseKey(t);
    const s = mod.length > 2 && k.includes(mod) && (!portal || k.includes(portal)) ? 2 : portal.length > 2 && k.endsWith(portal) ? 1 : 0;
    return { t, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).map((x) => x.t);
  return [...new Set([...out, ...scored])].slice(0, Math.max(max, out.length));
}

const LENGTH = {
  brief: 'Be brief: one or two short sentences per paragraph section, at most 3 bullet points.',
  standard: 'Use short paragraphs (2-3 sentences) and complete steps. Bullet lists of 2-5 items.',
  detailed: 'Be thorough: add context, affected areas and console errors in full. Bullet lists of up to 8 items.'
};

// Tab titles on a non-English page mix scripts ("ഹോം | Kerala UR"); keep only the parts a title can use.
const latinTitle = (t) => String(t || '').split(/\s*[|–—·›-]\s+/).filter((p) => /[a-z]/i.test(p)).join(' | ');

function hintsLine(h) {
  if (!h) return '';
  const parts = [
    h.crumbs?.length ? `breadcrumb ${h.crumbs.join(' › ')}` : '',
    h.nav?.length ? `highlighted menu ${h.nav.join(' › ')}` : '',
    h.tab ? `selected tab "${h.tab}"` : '',
    h.heading ? `heading "${h.heading}"` : ''
  ].filter(Boolean);
  return parts.length ? `Where the tester is on the page: ${parts.join('; ')}` : '';
}

export function buildPrompt(settings, cap) {
  const sections = settings.sections.filter((s) => s.include);
  const aiFields = settings.fields.filter((f) => f.ai && f.options.length > 1);
  const rule = locate(cap.page, settings.urlRules);
  const needSeg = ['portal', 'module', 'page'].filter((k) => !rule[k]);
  const userSteps = String(cap.steps || '').trim();

  const system = [
    'You are a senior QA engineer writing a bug report for a government web portal. The report will be logged in Zoho Projects.',
    'Write the whole report in plain, neutral English: title, summary, every section, steps and the portal, module and page names. The portal may be shown in Malayalam, Hindi or another language: describe and translate what you see into English. Quote non-English text exactly as shown only when the bug is about that text itself (wrong, missing or untranslated wording), and keep that quote inside quotation marks within an English sentence. Describe only what the screenshots, the tester\'s note and the page details show. Do not guess causes or invent data, names, IDs or numbers.',
    'Use the exact labels shown on screen for buttons, tabs and menus. Never copy personal data (names, phone numbers, ID numbers) into the report; refer to it generically.',
    'Orange boxes and arrows on screenshots are the tester\'s markup pointing at the problem. Black bars hide personal data; ignore them.',
    LENGTH[settings.writingLength] || LENGTH.standard,
    settings.styleExample ? `Match the tone, wording and level of detail of this example report from the team (do not copy its facts):\n<<<\n${settings.styleExample}\n>>>` : '',
    'Answer with one JSON object only, no prose, no code fences.'
  ].filter(Boolean).join('\n\n');

  const schema = {
    summary_title: `string: the bug in under 80 characters, ${settings.title.summaryCase === 'title' ? 'Title Case' : 'sentence case'}, no trailing period, e.g. "Incomplete Theme Propagation for Dark Mode on Dashboard Canvas"`,
    ...(needSeg.length ? Object.fromEntries(needSeg.map((k) => [k, `string: the ${k} name in English, as shown in the portal${k === 'page' ? ' (tab or screen heading)' : ''}`])) : {}),
    sections: Object.fromEntries(sections.map((s) => [s.id, isText(s.layout) ? 'string' : 'array of strings, one item each, no numbering or bullets'])),
    fields: Object.fromEntries(aiFields.map((f) => [f.id, `one of: ${f.options.join(' | ')}`])),
    ...(settings.tags.list.length ? { tags: settings.tags.onlyFromList
      ? `array of up to ${settings.tags.max} tags chosen only from this exact list, judged by the page URL and what the bug is about (usually the portal's tag and the module's tag). Use an empty array if none of them fits; never invent a tag: ${settings.tags.list.join(', ')}`
      : `array of up to ${settings.tags.max} short lowercase tags; prefer these when they fit: ${settings.tags.list.join(', ')}` } : {})
  };

  const errors = cap.page?.errorsIncluded && cap.page?.errors?.length
    ? cap.page.errors.slice(0, 20).map((e) => `- ${e.message}${e.source ? ' · ' + e.source : ''}${e.count > 1 ? ` (×${e.count})` : ''}`).join('\n')
    : '';

  const text = [
    `Tester's note: ${String(cap.note || '').trim() || '(none — work from the screenshots)'}`,
    userSteps ? `Tester's steps (keep their wording, only fix typos):\n${userSteps}` : '',
    `Page URL: ${cap.page?.url || 'unknown'}`,
    latinTitle(cap.page?.title) ? `Tab title: ${latinTitle(cap.page.title)}` : '',
    hintsLine(cap.page?.hints),
    `Environment: ${[cap.env?.browser, cap.env?.os, cap.page?.viewport ? `viewport ${cap.page.viewport.w} × ${cap.page.viewport.h}` : ''].filter(Boolean).join(', ')}`,
    errors ? `Page errors captured:\n${errors}` : '',
    cap.shotNames?.length ? `Screenshot file names, in the order the images are attached (refer to them by name): ${cap.shotNames.join(', ')}` : '',
    'Sections to write (name — guidance):',
    sections.map((s) => `- ${s.id} = "${s.name}" (${s.layout}) — ${s.guide || 'no extra guidance'}`).join('\n'),
    aiFields.length ? 'Choose these fields from the allowed values:\n' + aiFields.map((f) => `- ${f.id} = "${f.name}": ${f.options.join(' | ')}`).join('\n') : '',
    `Return JSON with this shape:\n${JSON.stringify(schema, null, 2)}`
  ].filter(Boolean).join('\n\n');

  return { system, text, rule };
}

const cleanItem = (s) => String(s).replace(/^\s*(?:[-*•]|\d+[.)]|step\s*\d+[:.)-]?)\s*/i, '').trim();
function sectionText(value, layout) {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(cleanItem).filter(Boolean).join('\n');
  const s = String(value).trim();
  if (isText(layout)) return s;
  return s.split(/\n+/).map(cleanItem).filter(Boolean).join('\n');
}

/** "https://… (note)". Keeps the real URL even if the AI repeats or mangles it. */
export function urlLine(url, note) {
  let n = String(note || '').trim();
  if (!url) return n;
  if (url) n = n.split(url).join('').trim();
  n = n.replace(/^(url\s*:?\s*)/i, '').replace(/^[-–—:,.\s]+|[.\s]+$/g, '').replace(/^[(\[]\s*|\s*[)\]]$/g, '').replace(/[.\s]+$/g, '').trim();
  if (!url) return n;
  return n ? `${url} (${n})` : url;
}

/** Build the editable report from the AI answer. */
export function buildReport(settings, cap, answer, rule) {
  const a = answer || {};
  const seg = {
    project: settings.title.project || '',
    portal: rule.portal || String(a.portal || '').trim(),
    module: rule.module || String(a.module || '').trim(),
    page: rule.page || String(a.page || '').trim(),
    summary: String(a.summary_title || a.summary || '').trim().replace(/\.$/, '')
  };
  if (settings.title.summaryCase === 'title') seg.summary = titleCase(seg.summary);
  else seg.summary = sentenceCase(seg.summary);

  const src = a.sections || {};
  const sections = settings.sections.filter((s) => s.include).map((s) => {
    let text = sectionText(src[s.id] ?? src[s.name], s.layout);
    if (s.id === 'steps' && String(cap.steps || '').trim()) {
      // keep the tester's wording; use AI's typo-fixed version only if it has the same number of steps
      const mine = sectionText(cap.steps, s.layout);
      if (!text || text.split('\n').length !== mine.split('\n').length) text = mine;
    }
    if (s.id === 'url_note') text = urlLine(cap.page?.url, text);
    return { id: s.id, name: s.name, layout: s.layout, text };
  });

  const fields = {}; const aiChosen = {};
  for (const f of settings.fields) {
    const pick = f.ai ? matchOption(a.fields?.[f.id] ?? a.fields?.[f.name], f.options) : null;
    fields[f.id] = pick || (f.default === '' ? '' : f.default || f.options[0] || '');
    aiChosen[f.id] = !!pick;
  }

  let tags = Array.isArray(a.tags) ? a.tags.map((t) => String(t).trim().toLowerCase()).filter(Boolean) : [];
  if (settings.tags.onlyFromList) tags = tags.map((t) => matchOption(t, settings.tags.list)).filter(Boolean);
  tags = [...new Set(tags)].slice(0, settings.tags.max || 5);

  return {
    segments: seg,
    sections,
    fields,
    aiChosen,
    tags: tags.map((name) => ({ name, on: true })),
    createdAt: Date.now()
  };
}

export function buildTitle(report, settings) {
  const sep = settings.title.separator ?? ' | ';
  return settings.title.segments.map((k) => String(report.segments[k] || '').trim()).filter(Boolean).join(sep);
}

const lines = (t) => String(t || '').split('\n').map((l) => l.trim()).filter(Boolean);
// numbered and bullet lists number themselves: drop "1." or "-" the tester typed
const items = (t) => lines(t).map(cleanItem).filter(Boolean);

export function descriptionText(report) {
  return report.sections.filter((s) => s.text.trim()).map((s) => {
    let body = s.text.trim();
    if (s.layout === 'inline') return `${s.name}: ${body.replace(/\s*\n\s*/g, ' ')}`;
    if (s.layout === 'bullets') body = items(body).map((l) => `- ${l}`).join('\n');
    if (s.layout === 'numbered') body = items(body).map((l, i) => `${i + 1}. ${l}`).join('\n');
    return `${s.name}\n${body}`;
  }).join('\n\n');
}

const h = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
// "Label: text" paragraphs get a bold label, like the team's reports.
const para = (l) => {
  const m = /^([^:]{2,60}):\s+(.+)$/.exec(l);
  return m && !/https?$/i.test(m[1]) ? `<p><b>${h(m[1])}:</b> ${h(m[2])}</p>` : `<p>${h(l)}</p>`;
};
export function descriptionHtml(report) {
  return report.sections.filter((s) => s.text.trim()).map((s) => {
    if (s.layout === 'inline') return `<p><b>${h(s.name)}:</b> ${h(s.text.trim().replace(/\s*\n\s*/g, ' '))}</p>`;
    let body;
    if (s.layout === 'bullets') body = `<ul>${items(s.text).map((l) => `<li>${h(l)}</li>`).join('')}</ul>`;
    else if (s.layout === 'numbered') body = `<ol>${items(s.text).map((l) => `<li>${h(l)}</li>`).join('')}</ol>`;
    else body = lines(s.text).map(para).join('');
    return `<p><b>${h(s.name)}</b></p>${body}`;
  }).join('<br>');
}

/** Numbered steps for Zoho's separate Steps to Reproduce box. */
export function stepsText(report) {
  const s = report.sections.find((x) => x.id === 'steps');
  return s ? items(s.text).map((l, i) => `${i + 1}. ${l}`).join('\n') : '';
}

/** Prompt to rewrite one section. */
export function rewritePrompt(settings, cap, report, sectionId) {
  const s = report.sections.find((x) => x.id === sectionId);
  const conf = settings.sections.find((x) => x.id === sectionId) || s;
  const base = buildPrompt(settings, cap);
  const text = [
    base.text.split('Sections to write')[0],
    `Current report:\nTitle: ${buildTitle(report, settings)}\n\n${descriptionText(report)}`,
    `Rewrite only the "${s.name}" section (${s.layout}). Guidance: ${conf.guide || 'none'}. Keep facts consistent with the rest of the report and make it clearer.`,
    `Return JSON: {"text": ${isText(s.layout) ? 'string' : 'array of strings'}}`
  ].join('\n\n');
  return { system: base.system, text };
}
export const rewriteResult = (answer, layout) => sectionText(answer?.text, layout);
