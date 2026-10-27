// QArator side panel. One small state object, re-rendered per view; typing
// updates state without re-rendering so focus and caret stay put.
import { loadSettings, onSettingsChanged, PROVIDERS, applyScope } from '../lib/settings.js';
import { listProjects, switchProject, projectForUrl } from '../lib/projects.js';
import { generateAuto, parseJson, describeError, AIError, AUTO, cooldowns, parseSlot } from '../lib/ai.js';
import { nearLimit, usedToday, istClock, parseLimits } from '../lib/usage.js';
import { buildPrompt, buildReport, buildTitle, descriptionText, descriptionHtml, rewritePrompt, rewriteResult, locate, isText, stepsText, matchOption, looseKey, learnRule, suggestTags } from '../lib/report.js';
import { detectEnv, fileToDataUrl, forAi, thumb } from '../lib/env.js';
import { esc, icon, orb, beam, markSvg, applyTheme, applyAppearance, watchTheme, toast, copyText, downloadDataUrl, fmtTime, uid } from '../lib/ui.js';
import { openMarkup } from './markup.js';
import { exportDocx, exportReports, exportBugs, bundle } from './export.js';
import { loadBugs, updateBugs, patchBug, removeBugs, addBug, bugNote, STATUS } from './queue.js';
import { startRecording, extFor, fmtDur, fmtSize } from './recorder.js';
import { putVideo, getVideo, pruneVideos, blobToDataUrl, putMedia, getMedia, deleteMedia, allMedia } from '../lib/videostore.js';
import { loadImage } from '../lib/env.js';
import { saveSettings } from '../lib/settings.js';

const $ = (s, r = document) => r.querySelector(s);
const main = $('#main'), dock = $('#dock');
// BASE is the active project as saved; S is BASE with the matching portal's overrides for the page in view.
let BASE = null, S = null, projects = [];
let ctrl = null, tick = null;

const fresh = () => ({
  view: 'capture',        // capture | writing | review | filled | history
  shots: [],              // {id, dataUrl, original, marks, thumb, name}
  videos: [],             // {id, name, mime, size, ms, dur, thumb, frames[]}; the video itself is in IndexedDB
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
  saveTimer = setTimeout(writeDraft, 300);
}
// Closing or hiding the panel saves at once, so nothing typed in the last moment is lost.
function flushDraft() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = 0; writeDraft(); } }
addEventListener('pagehide', flushDraft);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushDraft(); });
function writeDraft() {
  saveTimer = 0;
  const view = st.view === 'writing' ? 'capture' : st.view === 'history' || st.view === 'bugs' ? st.back : st.view;
  const d = { ...st, view: ['writing', 'history', 'bugs'].includes(view) || !view ? 'capture' : view, back: 'capture', writing: null, busy: null, zoho: null, error: st.error && st.error.kind === 'ratelimit' ? st.error : null };
  chrome.storage.local.set({ draft: d }).catch((e) => console.warn('QArator: draft not saved', e && e.message));
  syncBug();
}
async function loadDraft() {
  const { draft } = await chrome.storage.local.get('draft');
  if (draft && typeof draft === 'object') st = { ...fresh(), ...draft, videos: draft.videos || [], shots: draft.shots || [], writing: null, busy: null };
  if (['writing', 'history', 'bugs'].includes(st.view)) st.view = 'capture';
  if (st.view === 'review' && !st.report) st.view = 'capture';
  if (st.view === 'filled' && !st.fill) st.view = st.report ? 'review' : 'capture';
}
async function history() { return (await chrome.storage.local.get('history')).history || []; }
async function saveHistory(status, s = st) {
  if (!s.report) return;
  const st = s; // the report this is about, even if the panel moved on
  const list = await history();
  const id = st.report.createdAt;
  // a report filled in Zoho stays "Filled" when it is copied or exported afterwards
  const before = list.find((h) => h.id === id);
  if (before && before.status === 'Filled in Zoho') status = before.status;
  const entry = { id, title: buildTitle(st.report, S), status, at: Date.now(), report: st.report, page: st.page && { ...st.page, errors: [] } };
  const next = [entry, ...list.filter((h) => h.id !== id)].slice(0, 20);
  await chrome.storage.local.set({ history: next });
  // screenshots and video list go to IndexedDB with the entry, so exports from history keep them
  await putMedia(id, { shots: st.shots.map((s) => ({ name: s.name, dataUrl: s.dataUrl })), videos: st.videos || [] }).catch(() => {});
  for (const old of list) if (!next.some((h) => h.id === old.id)) deleteMedia(old.id).catch(() => {});
}

// ---------- helpers ----------
const providerName = () => (PROVIDERS[S.ai.provider] || {}).label || 'your AI provider';
const scoped = () => { if (BASE) S = applyScope(BASE, st.page && st.page.url); };
const portalLabel = () => {
  const p = st.report?.segments.portal || (st.page && locate(st.page, S.urlRules).portal) || '';
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
    if (info) return S.pageErrors ? { ...info, errorsIncluded: info.errors.length > 0 } : { ...info, errors: null, errorsIncluded: false };
  } catch (e) { /* content script not in this tab yet */ }
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => ({ url: location.href, title: document.title, viewport: { w: innerWidth, h: innerHeight, dpr: devicePixelRatio || 1 } }) });
    const [h] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/page-hints.js'] }).catch(() => [{}]);
    return { ...r.result, hints: (h && h.result) || null, errors: null, errorsIncluded: false };
  } catch (e) {
    return { url: tab.url || '', title: tab.title || '', viewport: null, errors: null, errorsIncluded: false };
  }
}
// The page under test when there is no capture yet (a pasted image, or a bug without a screenshot).
async function notePage(s = st) {
  const { tab } = await activeTab().catch(() => ({}));
  if (tab && /^(https?|file):/.test(tab.url || '')) s.page = { ...(await pageInfo(tab)), capturedAt: Date.now() };
}
// Only limits Google reported or the tester typed stop a model from being tried; assumed ones only warn.
async function quotaOpts() {
  const { usage, learnedLimits = {} } = await chrome.storage.local.get(['usage', 'learnedLimits']);
  return { limits: { ...learnedLimits, ...parseLimits(S.usage.limits) }, used: (m, k) => usedToday(usage, m, k) };
}
const keyName = (slot) => { const p = parseSlot(slot); return p.model + (p.tag === 'backup' ? ' (backup key)' : ''); };
// A warning under the Generate buttons when a model is running low, used up or resting.
let quota = null; // { level: 'low' | 'out', text, needBackup }
async function refreshQuota() {
  const { usage, learnedLimits = {} } = await chrome.storage.local.get(['usage', 'learnedLimits']);
  const resting = Object.entries(await cooldowns());
  const hasBackup = !!String(S.ai.apiKey2 || '').trim();
  const hits = nearLimit(usage, { learned: learnedLimits, typed: parseLimits(S.usage.limits) });
  const parts = hits.map((h) => `${h.model}${h.key === 'backup' ? ' (backup key)' : ''}: ${h.used} of ${h.source === 'assumed' ? 'about ' : ''}${h.limit} requests used today`);
  if (resting.length) parts.push(`${resting.map(([m]) => keyName(m)).join(', ')} resting until ${istClock(Math.min(...resting.map(([, u]) => u)))}`);
  const mainOut = resting.some(([m]) => parseSlot(m).tag === 'main') || hits.some((h) => h.key === 'main' && h.out);
  const usingBackup = hasBackup && mainOut;
  const next = !parts.length ? null : {
    level: mainOut || hits.some((h) => h.out) ? 'out' : 'low',
    text: `${parts.join(' · ')}.${usingBackup ? ' QArator is using your backup key.' : S.ai.model === AUTO || S.ai.fallback !== false ? ' Other models are used meanwhile.' : ''}`,
    needBackup: !hasBackup && S.ai.provider === 'gemini'
  };
  if (JSON.stringify(next) !== JSON.stringify(quota)) { quota = next; if (st.view === 'capture') render(); }
}
const quotaHtml = () => (quota ? `<div class="hint" role="status" id="quota" style="text-align:center;color:var(--acc-text)">${quota.level === 'out' ? '<strong>Quota running out.</strong> ' : '<strong>Running low.</strong> '}${esc(quota.text)}
  ${quota.needBackup ? '<button type="button" class="btn b-ghost b-sm" data-action="settings" style="height:auto;padding:0 4px">Add a backup key</button>' : ''}
  <button type="button" class="btn b-ghost b-sm" data-action="usage" style="height:auto;padding:0 4px">Usage</button></div>` : '');
const modelLabel = () => (S.ai.model === AUTO ? 'Auto model' : S.ai.model);

// What the AI is told about a bug: the current one, or one saved in the Bug list.
const capOf = (b) => ({ note: b.note, steps: b.steps, page: b.page && !S.pageErrors ? { ...b.page, errorsIncluded: false } : b.page, env,
  shotNames: [...b.shots.map((s) => s.name), ...(b.videos || []).flatMap((v) => v.frames.map((f, i) => `${v.name} (frame ${i + 1} of ${v.frames.length}, ${v.dur} video)`))] });
const cap = () => capOf(st);
// Screenshots, then a few frames of each recording, shrunk for the AI.
async function aiImages(b = st) {
  const out = [];
  for (const s of b.shots) out.push(await forAi(s.dataUrl));
  for (const v of b.videos || []) for (const f of v.frames) out.push(await forAi(f));
  return out;
}
/** One AI report for a bug (the current one or a saved one). */
async function generateFor(b, signal, onPhase = () => {}) {
  if (!S.ai.apiKey && S.ai.provider !== 'compatible') throw new AIError('nokey', 'no key');
  const images = await aiImages(b);
  onPhase(1);
  const { system, text, rule } = buildPrompt(S, capOf(b));
  const p = generateAuto(S.ai, { system, text, images, json: true, maxTokens: 4096, kind: 'write' }, signal, await quotaOpts());
  setTimeout(() => onPhase(2), 700);
  const { text: out, model } = await p;
  onPhase(3);
  const report = buildReport(S, capOf(b), parseJson(out), rule);
  report.model = model;
  return report;
}
const needNote = () => !st.note.trim();
function askForNote() {
  toast("Add what's wrong first. One line is enough.", 2600);
  const n = $('#note');
  if (n) { n.focus(); n.closest('[data-beam]')?.setAttribute('data-active', ''); }
}
const stamp = (d = new Date()) => { const p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
// One name per screenshot, used in the report text, the Zoho attachment and Save screenshots.
const shotName = (dataUrl = '') => `qarator_${stamp()}_${st.shots.length + 1}.${/^data:image\/jpeg/.test(dataUrl) ? 'jpg' : 'png'}`;
let markupOpening = false;
// Word and Zoho take PNG and JPEG; anything else pasted (WebP, GIF, SVG, AVIF…) becomes a PNG.
async function asPngOrJpeg(dataUrl) {
  if (/^data:image\/(png|jpeg)[;,]/.test(dataUrl)) return dataUrl;
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth || 1280, h = img.naturalHeight || 800;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/png');
}

// ---------- shots ----------
async function addShot(dataUrl, name) {
  const t = await thumb(dataUrl).catch(() => dataUrl);
  st.shots.push({ id: uid(), dataUrl, original: dataUrl, marks: [], thumb: t, name: name || shotName(dataUrl) });
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
  autoProject(st.page.url).catch(() => {});
  if (st.view !== 'review' && st.view !== 'writing') st.view = 'capture';
  await addShot(dataUrl);
}
async function addFiles(files) {
  const imgs = [...files].filter((f) => f.type.startsWith('image/'));
  if (!imgs.length) { toast('That file is not an image.'); return; }
  if (!st.page) await notePage();
  for (const f of imgs) {
    try { await addShot(await asPngOrJpeg(await fileToDataUrl(f))); }
    catch (e) { toast(`${f.name || 'That image'} could not be read.`, 3000); }
  }
}

// ---------- AI ----------
let writingNow = false;
async function write() {
  if (writingNow || st.view === 'writing') return;
  if (recording) { toast('Stop the recording first.'); return; }
  if (needNote()) { askForNote(); return; }
  const mine = st;
  writingNow = true; // before the first render, which would otherwise treat 'writing' as left over
  mine.error = null;
  mine.view = 'writing'; mine.writing = { phase: 0 };
  const myCtrl = ctrl = new AbortController();
  render();
  try {
    if (!mine.page) await notePage(mine);
    const report = await generateFor(mine, myCtrl.signal, (n) => { if (st === mine && (n !== 2 || (mine.writing && mine.writing.phase === 1))) setPhase(n); });
    mine.report = report; mine.writing = null; mine.zoho = null;
    if (mine.bugId) await updateBugs((l) => l.map((b) => (b.id === mine.bugId ? { ...b, status: 'ready', report, error: null, retryAt: 0 } : b)));
    if (st === mine) {
      if (mine.view === 'history' || mine.view === 'bugs') mine.back = 'review'; else mine.view = 'review';
      saveDraft(); render(); $('#main').scrollTop = 0;
    } else if (!mine.bugId) {
      // the tester opened something else meanwhile: keep this report in the Bug list instead of losing it
      await addBug({ id: uid(), at: Date.now(), status: 'ready', report, snap: { shots: mine.shots, videos: mine.videos, page: mine.page, note: mine.note, steps: mine.steps } });
      toast('The report you were writing is in the Bug list.', 3200);
    }
  } catch (e) {
    mine.writing = null;
    if (mine.view === 'writing') mine.view = 'capture'; else mine.back = 'capture';
    if (st === mine) { if (e.kind !== 'cancelled') showError(e); render(); }
  } finally {
    writingNow = false;
    if (ctrl === myCtrl) ctrl = null;
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
  const mine = st, report = st.report;
  mine.busy = 'rewrite:' + id; render();
  try {
    const images = await aiImages(mine);
    const { system, text } = rewritePrompt(S, capOf(mine), report, id);
    const { text: out } = await generateAuto(S.ai, { system, text, images, json: true, maxTokens: 1500, kind: 'rewrite' }, undefined, await quotaOpts());
    const sec = report.sections.find((s) => s.id === id);
    const t = sec && rewriteResult(parseJson(out), sec.layout);
    if (t) sec.text = t;
    if (st === mine) saveDraft();
  } catch (e) {
    const d = describeError(e); toast(`${d.title}. ${e.kind === 'ratelimit' ? 'Try again in a moment.' : ''}`, 3500);
  }
  mine.busy = null;
  if (st === mine) render();
}
function blankReport() {
  const rule = st.page ? locate(st.page, S.urlRules) : {};
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
  const mine = st, report = st.report;
  mine.busy = 'fill'; mine.zoho = null; render();
  const labels = (s) => String(s || '').split('|').map((x) => x.trim()).filter(Boolean);
  try {
    const { files: videos, skipped } = S.zoho.uploadScreenshots ? await videoFiles(mine) : { files: [], skipped: [] };
    const payload = {
      title: { labels: labels(S.zoho.titleLabel), value: buildTitle(report, S) },
      description: { labels: labels(S.zoho.descriptionLabel), html: descriptionHtml(report), text: descriptionText(report), sections: report.sections.filter((s) => s.text.trim()).length },
      fields: S.fields.map((f) => ({ name: f.name, labels: labels(f.zohoLabel || f.name), value: report.fields[f.id] || '' })),
      tags: { labels: labels(S.zoho.tagsLabel), values: S.zoho.fillTags ? report.tags.filter((t) => t.on).map((t) => t.name) : [] },
      attachments: { labels: labels(S.zoho.attachLabel), files: S.zoho.uploadScreenshots ? [...mine.shots.map((s) => ({ name: s.name, dataUrl: s.dataUrl })), ...videos] : [] },
      steps: { enabled: !!S.zoho.stepsField, labels: labels(S.zoho.stepsLabel || 'Steps to Reproduce'), text: stepsText(report) },
      options: { looseMatch: S.zoho.looseMatch, scrollToFirst: S.zoho.scrollToFirst, emptyOnly: S.zoho.emptyOnly, uploadScreenshots: S.zoho.uploadScreenshots }
    };
    await chrome.scripting.executeScript({ target: { tabId: tab.id, allFrames: true }, files: ['content/zoho-fill.js'] });
    // find the one frame that holds the form, and fill only that one
    const probes = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: (l) => (window.__qaratorProbe ? window.__qaratorProbe(l) : 0),
      args: [payload.title.labels]
    });
    const best = probes.filter((r) => r.result > 0).sort((a, b) => b.result - a.result || a.frameId - b.frameId)[0];
    if (!best) { mine.busy = null; mine.zoho = { kind: 'noform' }; if (st === mine) render(); return; }
    const [res] = await chrome.scripting.executeScript({
      target: { tabId: tab.id, frameIds: [best.frameId] },
      func: (p) => (window.__qaratorFill ? window.__qaratorFill(p) : { ok: false, reason: 'noscript' }),
      args: [payload]
    });
    mine.busy = null;
    const out = res && res.result;
    if (!out || !out.ok) { mine.zoho = { kind: 'noform' }; if (st === mine) render(); return; }
    for (const v of skipped) out.results.push({ field: 'Attachments', status: 'check', value: v.name, reason: `This video is ${fmtSize(v.size)}, too big to attach automatically. Use Save files and attach it in Zoho.` });
    mine.fill = { results: out.results, tabId: tab.id, frameId: best.frameId, at: Date.now() };
    mine.view = 'filled';
    await saveHistory('Filled in Zoho', mine);
    if (mine.bugId) await patchBug(mine.bugId, { status: 'filled', report, filledAt: Date.now() });
    await learn(mine);
    if (st === mine) { saveDraft(); render(); $('#main').scrollTop = 0; }
  } catch (e) {
    mine.busy = null;
    mine.zoho = { kind: 'blocked', detail: String(e.message || e) };
    if (st === mine) render();
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

// A dropdown whose value Zoho does not have: take Zoho's real option list into settings, then let the
// tester pick the right value in the report and fill again.
async function useZohoOptions(name) {
  const res = st.fill && st.fill.results.find((r) => r.field === name && r.options);
  const f = S.fields.find((x) => x.name === name);
  if (!res || !f) return;
  // keep the "leave it empty" choices the team uses, which Zoho does not list as options
  const keep = f.options.filter((o) => /^(unassigned|none)$/i.test(o) && !res.options.some((z) => z.toLowerCase() === o.toLowerCase()));
  f.options = [...keep, ...res.options];
  if (!f.options.includes(f.default)) f.default = f.options[0];
  const bf = BASE.fields.find((x) => x.id === f.id) || f;
  bf.options = f.options; bf.default = f.default;
  await saveSettings(BASE);
  if (st.report && st.report.fields[f.id] !== '' && !f.options.includes(st.report.fields[f.id])) { st.report.fields[f.id] = f.default; st.report.aiChosen[f.id] = false; }
  res.options = null;
  res.reason = `${name} now uses Zoho's ${f.options.length} options. Pick one in the report and fill again.`;
  saveDraft(); render();
  toast(`${name} options updated from Zoho`);
}

// ---------- Bug list (Generate & next bug) ----------
let bugCounts = { all: 0, ready: 0, busy: 0 };
async function refreshBugCounts() {
  const list = await loadBugs();
  bugCounts = { all: list.length, ready: list.filter((b) => b.status === 'ready').length, busy: list.filter((b) => b.status === 'waiting' || b.status === 'writing').length };
  const n = bugCounts.ready + bugCounts.busy;
  $('#btn-bugs').innerHTML = icon.list + (bugCounts.all ? `<span class="count" aria-label="${bugCounts.ready} ready">${bugCounts.ready || n}</span>` : '');
  $('#btn-bugs').title = bugCounts.all ? `Bug list · ${bugCounts.ready} ready${bugCounts.busy ? `, ${bugCounts.busy} being written` : ''}` : 'Bug list';
}
// Save the current bug to the Bug list, have the AI write it in the background, start the next one.
let savingLater = false;
async function generateLater() {
  if (recording) { toast('Stop the recording first.'); return; }
  if (needNote()) { askForNote(); return; }
  if (savingLater) return;
  savingLater = true;
  try {
    if (!st.page) await notePage();
    const snap = { shots: st.shots, videos: st.videos, page: st.page, note: st.note, steps: st.steps };
    const id = st.bugId;
    const exists = id && (await loadBugs()).some((b) => b.id === id);
    if (exists) await updateBugs((l) => l.map((b) => (b.id === id ? { ...b, snap, rev: (b.rev || 0) + 1, status: 'waiting', report: null, error: null, retryAt: 0 } : b)));
    else await addBug({ id: uid(), at: Date.now(), status: 'waiting', rev: 0, snap });
    clearTimeout(saveTimer); saveTimer = 0;
    st = fresh(); writeDraft(); render();
  } finally { savingLater = false; }
  toast('Saved to the Bug list. The report is being written; capture the next bug.', 3200);
  runQueue();
}
// One bug at a time, oldest first, while the panel is open. A bug left "writing" by a closed panel is retried.
// The writer claims a bug with this panel's id and a heartbeat, so a second panel (another window) leaves it
// alone, and a bug whose panel closed mid-write (no heartbeat for a minute) is taken up again.
const PANEL_ID = uid();
const STALE_MS = 30000;
let queueBusy = false, queueTimer = 0, writingBugId = null;
// Closing the panel hands the bug it was writing back to the list, so the next panel takes it up at once.
addEventListener('pagehide', () => {
  if (!writingBugId) return;
  const id = writingBugId;
  chrome.storage.local.get('bugs').then(({ bugs = [] }) => chrome.storage.local.set({ bugs: bugs.map((b) => (b.id === id && b.owner === PANEL_ID && b.status === 'writing' ? { ...b, status: 'waiting' } : b)) })).catch(() => {});
});
const isStale = (b, now = Date.now()) => b.status === 'writing' && now - (b.beat || b.startedAt || 0) > STALE_MS;
async function runQueue() {
  if (queueBusy) return;
  queueBusy = true;
  clearTimeout(queueTimer);
  try {
    for (;;) {
      const now = Date.now();
      let next = null;
      await updateBugs((l) => {
        const out = l.map((b) => (isStale(b, now) ? { ...b, status: 'waiting' } : b));
        const pick = out.find((b) => b.status === 'waiting' && !(b.retryAt > now));
        if (!pick) return out;
        next = { ...pick, status: 'writing', startedAt: now, beat: now, owner: PANEL_ID, error: null };
        return out.map((b) => (b.id === pick.id ? next : b));
      });
      if (!next) {
        const all = await loadBugs();
        // retry times of busy-provider bugs, and when a bug another panel was writing goes stale
        const later = [...all.filter((b) => b.status === 'waiting' && b.retryAt > now).map((b) => b.retryAt),
          ...all.filter((b) => b.status === 'writing' && b.owner !== PANEL_ID).map((b) => (b.beat || b.startedAt || now) + STALE_MS)];
        if (later.length) queueTimer = setTimeout(runQueue, Math.min(...later) - now + 500);
        break;
      }
      const id = next.id, rev = next.rev || 0;
      const mineNow = (b) => b.id === id && b.status === 'writing' && b.owner === PANEL_ID;
      const beat = setInterval(() => updateBugs((l) => l.map((b) => (mineNow(b) ? { ...b, beat: Date.now() } : b))), 10000);
      writingBugId = id;
      try {
        const report = await generateFor(next.snap);
        // edited while being written (new revision): write it again; taken over by the tester: leave it
        await updateBugs((l) => l.map((b) => (!mineNow(b) ? b : (b.rev || 0) !== rev ? { ...b, status: 'waiting' } : { ...b, status: 'ready', report, error: null, retryAt: 0 })));
      } catch (e) {
        const d = describeError(e);
        const later = ['ratelimit', 'network', 'server', 'timeout'].includes(e.kind);
        const retryAt = later ? Date.now() + Math.max(30, Math.min(900, e.retryAfter || 60)) * 1000 : 0;
        await updateBugs((l) => l.map((b) => (!mineNow(b) ? b : { ...b, status: later ? 'waiting' : 'failed', retryAt, error: { kind: e.kind || 'provider', title: d.title, body: d.body, detail: e.detail || e.message || '' } })));
        if (later) { queueTimer = setTimeout(runQueue, retryAt - Date.now() + 500); break; }
        if (['nokey', 'nobase', 'auth'].includes(e.kind)) break; // the next bugs would fail the same way; settings changes restart the queue
      } finally { clearInterval(beat); writingBugId = null; }
    }
  } finally { queueBusy = false; }
}
async function openBug(id) {
  const b = (await loadBugs()).find((x) => x.id === id);
  if (!b || (b.status === 'writing' && !isStale(b))) return;
  st = { ...fresh(), ...b.snap, videos: b.snap.videos || [], report: b.report || null, bugId: b.id, view: b.report ? 'review' : 'capture',
    error: b.status === 'failed' && b.error ? { ...b.error, retryAt: 0 } : null };
  lastSnapSig = snapSig(st);
  saveDraft(); render(); $('#main').scrollTop = 0;
}
// Edits to an opened bug go back to its entry in the list. A changed capture is a new revision, so a write
// already running for the old one is not taken as the answer; a report is never replaced with nothing.
const snapSig = (s) => JSON.stringify([s.note, s.steps, s.shots.map((x) => `${x.id}:${(x.marks || []).length}:${x.dataUrl.length}`), (s.videos || []).map((v) => v.id), s.page && s.page.url]);
let lastSnapSig = '';
function syncBug() {
  if (!st.bugId) return;
  const sig = snapSig(st), changed = sig !== lastSnapSig;
  lastSnapSig = sig;
  const id = st.bugId, report = st.report, snap = { shots: st.shots, videos: st.videos, page: st.page, note: st.note, steps: st.steps };
  if (!changed && !report) return;
  updateBugs((l) => l.map((b) => (b.id !== id ? b : { ...b, ...(changed ? { snap, rev: (b.rev || 0) + 1 } : {}), ...(report ? { report } : {}) })));
}
async function keepVideoIds() {
  const media = await allMedia().catch(() => []);
  return [...(st.videos || []).map((v) => v.id), ...(await loadBugs()).flatMap((b) => (b.snap.videos || []).map((v) => v.id)),
    ...(media || []).flatMap((m) => (m.videos || []).map((v) => v.id))];
}
async function pruneUnused() { pruneVideos(await keepVideoIds()); }
const bugSel = new Set();

const MAX_ATTACH = 25 * 1024 * 1024;
async function videoFiles(s = st) {
  const files = [], skipped = [];
  for (const v of s.videos || []) {
    const blob = await getVideo(v.id).catch(() => null);
    if (!blob) continue;
    if (blob.size > MAX_ATTACH) { skipped.push({ name: v.name, size: blob.size }); continue; }
    files.push({ name: v.name, dataUrl: await blobToDataUrl(blob) });
  }
  return { files, skipped };
}

// Remember portal / module / page for this page, so the next bug here starts with the same names.
async function learn(s = st) {
  if (!s.report || !s.page || !s.page.url) return;
  const next = learnRule(BASE.urlRules, s.page.url, s.report.segments);
  if (next) { BASE.urlRules = next; scoped(); await saveSettings(BASE); }
}
// ---------- tag picker: tick as many team tags as fit; only tags from the team list ----------
const tagOn = (name) => (st.report?.tags || []).some((t) => t.on && looseKey(t.name) === looseKey(name));
function tagPickerHtml() {
  const q = looseKey($('#tp-q')?.value || '');
  // group by the part before the first " - ", after dropping a prefix every tag shares ("UR - Citizen Portal - Home" → "Citizen Portal")
  const all = S.tags.list, split = (t) => t.split(/\s+-\s+/);
  const shared = all.length > 1 && all.every((t) => split(t).length > 1 && split(t)[0] === split(all[0])[0]) ? split(all[0])[0] : '';
  const groupOf = (t) => { const parts = split(t); if (shared && parts[0] === shared) parts.shift(); return parts.length > 1 || !shared ? parts[0] : 'General'; };
  const left = all.filter((t) => !q || looseKey(t).includes(q));
  const names = [...new Set(left.map(groupOf))].sort((a, b) => (a === 'General') - (b === 'General') || a.localeCompare(b));
  const grouped = all.length > 12 && names.length > 1;
  const rows = (grouped ? names : ['']).map((name) => {
    const mine = grouped ? left.filter((t) => groupOf(t) === name) : left;
    return mine.length ? `${grouped ? `<div class="tpg">${esc(name)}</div>` : ''}${mine.map((t) => `<button type="button" class="tpo" data-pick="${esc(t)}" aria-pressed="${tagOn(t)}"><span class="tpc">${tagOn(t) ? icon.check : ''}</span>${esc(t)}</button>`).join('')}` : '';
  }).join('');
  return rows || `<div class="hint" style="padding:8px">${all.length ? 'No team tag matches.' : 'This project has no tags yet.'} Add them in Settings › Team format and Zoho › Tags.</div>`;
}
function tagChipsHtml() {
  const on = (st.report?.tags || []).filter((t) => t.on);
  return on.length ? on.map((t) => `<span class="tagc">${esc(t.name)}<button type="button" class="tpx" data-unpick="${esc(t.name)}" aria-label="Remove tag ${esc(t.name)}">${icon.x}</button></span>`).join('') : '<span class="hint">No tags chosen. Pick any that fit, or none.</span>';
}
function refreshTags(keepSearch = true) {
  const chips = $('#tp-chips'), list = $('#tp-list');
  if (!chips || !list) return;
  const y = list.scrollTop;
  chips.innerHTML = tagChipsHtml(); list.innerHTML = tagPickerHtml(); list.scrollTop = y;
}
function togglePick(name, on) {
  const hit = S.tags.list.find((t) => looseKey(t) === looseKey(name)) || name;
  const cur = st.report.tags.find((t) => looseKey(t.name) === looseKey(hit));
  if (cur) cur.on = on; else if (on) st.report.tags.push({ name: hit, on: true });
  st.report.tags = st.report.tags.filter((t) => t.on);
  saveDraft(); refreshTags();
}

const tagSuggestions = () => (st.report ? suggestTags(st.report, S.tags.list, S.tags.max || 5) : []);

// One download: the Word file, or a zip with the Word file and its videos.
async function download(docx, base, videos) {
  const files = [], seen = new Set();
  for (const v of videos || []) {
    if (seen.has(v.id)) continue;
    seen.add(v.id);
    const blob = await getVideo(v.id).catch(() => null);
    if (blob) files.push({ name: files.some((f) => f.name === v.name) ? v.name.replace(/(\.\w+)$/, `_${files.length}$1`) : v.name, blob });
  }
  const out = await bundle(docx, base, files);
  const url = URL.createObjectURL(out.blob);
  downloadDataUrl(url, out.name);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return { name: out.name, videos: files.length };
}
async function exportWord() {
  try {
    const blob = await exportDocx({ ...st, page: cap().page }, S, env, { tags: tagSuggestions() });
    const out = await download(blob, `qarator_${stamp()}`, st.videos);
    if (st.report) { await saveHistory('Exported to Word'); await learn(); }
    toast(out.videos ? 'Word file and videos saved to Downloads as one zip' : 'Word file saved to Downloads');
  } catch (e) { toast(`Export failed: ${e.message || e}`, 3500); }
}
async function saveVideos() {
  for (const v of st.videos || []) {
    const blob = await getVideo(v.id).catch(() => null);
    if (!blob) continue;
    const url = URL.createObjectURL(blob);
    downloadDataUrl(url, v.name);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
}

// ---------- recording ----------
let recording = null, recTick = 0;
async function startRec(kind) {
  if (recording) return;
  const { tab } = await activeTab().catch(() => ({}));
  try {
    recording = { kind, started: Date.now(), handle: null };
    render();
    recording.handle = await startRecording(kind, tab, { onEnd: () => stopRec() });
    recording.started = Date.now();
    if (!st.page && tab && /^(https?|file):/.test(tab.url || '')) st.page = { ...(await pageInfo(tab)), capturedAt: Date.now() };
    render();
  } catch (e) {
    recording = null; render();
    if (!e.cancelled) toast(`Recording did not start: ${e.message || e}`, 4500);
  }
}
async function stopRec() {
  if (!recording || !recording.handle || recording.stopping) return;
  recording.stopping = true;
  const out = await recording.handle.stop();
  recording = null;
  if (!out.blob.size) { toast('The recording was empty.'); render(); return; }
  const id = uid();
  const name = `qarator_${stamp()}_rec${st.videos.length + 1}.${extFor(out.mime)}`;
  try { await putVideo(id, out.blob); }
  catch (e) {
    // could not store it (disk full?): hand the file over rather than lose it
    const url = URL.createObjectURL(out.blob); downloadDataUrl(url, name); setTimeout(() => URL.revokeObjectURL(url), 10000);
    toast('The video could not be kept in the panel, so it was saved to Downloads.', 4000); render(); return;
  }
  st.videos.push({ id, name, mime: out.mime, size: out.blob.size, ms: out.ms, dur: fmtDur(out.ms), thumb: out.thumb, frames: out.frames });
  if (st.view === 'history' || st.view === 'filled') st.view = 'capture';
  saveDraft(); render();
}
function recBar() {
  if (!recording) return '';
  const s = recording.handle ? fmtDur(Date.now() - recording.started) : 'starting';
  return `<div class="rec" role="status"><span class="dotr" aria-hidden="true"></span><span style="flex:1">Recording screen · <span id="rec-t">${s}</span></span>
    <button type="button" class="btn b-pri b-sm" data-action="stop-rec">Stop</button></div>`;
}
function startRecTimer() {
  clearInterval(recTick);
  if (!recording) return;
  recTick = setInterval(() => { const t = $('#rec-t'); if (!recording) clearInterval(recTick); else if (t && recording.handle) t.textContent = fmtDur(Date.now() - recording.started); }, 1000);
}
async function playVideo(id) {
  const v = st.videos.find((x) => x.id === id);
  const blob = v && await getVideo(id).catch(() => null);
  if (!blob) { toast('That video is no longer stored.'); return; }
  const url = URL.createObjectURL(blob);
  const host = $('#overlay');
  host.innerHTML = `<div class="vplay" role="dialog" aria-label="${esc(v.name)}"><video src="${url}" controls autoplay></video>
    <div style="color:#fff;font-size:12px">${esc(v.name)} · ${v.dur} · ${fmtSize(v.size)}</div>
    <button type="button" class="btn b-sec" id="vclose">Close</button></div>`;
  const close = () => { host.innerHTML = ''; URL.revokeObjectURL(url); };
  $('#vclose').onclick = close;
  $('#vclose').focus();
  host.querySelector('.vplay').onclick = (e) => { if (e.target.classList.contains('vplay')) close(); };
}
const videosHtml = () => (st.videos.length ? `<div><div class="lbl">Videos <span style="font-weight:400;color:var(--ink3)">${st.videos.length}</span></div><div class="shots">${st.videos.map((v, i) => `<div>
  <div class="shot-img vid"><img src="${v.thumb}" alt="Video ${i + 1}"><span class="dur">${v.dur}</span></div>
  <div class="shot-actions">
    <button type="button" class="btn b-ghost b-sm" data-action="play-video" data-id="${v.id}" aria-label="Play video ${i + 1}">Play</button>
    <button type="button" class="btn b-ghost b-sm" data-action="remove-video" data-id="${v.id}" aria-label="Remove video ${i + 1}">${icon.trash}Remove</button>
  </div><div class="hint">${fmtSize(v.size)}</div></div>`).join('')}</div></div>` : '');
const recButtons = (sm = true) => `<button type="button" class="btn b-ghost ${sm ? 'b-sm' : ''}" data-action="record-screen" title="Record a screen, window or tab, with the mouse pointer (Alt+Shift+R)" ${recording ? 'disabled' : ''}>${icon.screen}Record screen</button>`;

// Three steps, always visible: where you are and where you can go back to.
function renderFlow() {
  const v = st.view === 'writing' ? 'capture' : st.view;
  const steps = [['capture', 'Capture', true], ['review', 'Review', !!st.report], ['filled', 'Fill in Zoho', !!st.fill]];
  const at = steps.findIndex((s) => s[0] === v);
  $('#flow').innerHTML = v === 'history' ? '' : steps.map(([k, name, ok], i) => `<button type="button" data-action="flow" data-id="${k}" ${ok && st.view !== 'writing' ? '' : 'disabled'} ${i === at ? 'aria-current="step"' : ''} class="${i < at || (ok && i !== at) ? 'done' : ''}"><span class="n">${i < at && ok ? '✓' : i + 1}</span>${name}</button>`).join('');
}

// ---------- views ----------
function setProj() {
  const label = portalLabel();
  if (projects.length > 1 && BASE) {
    $('#proj').innerHTML = `<select id="projsel" class="projsel" aria-label="Project">${projects.map((p) => `<option value="${esc(p.id)}" ${p.id === BASE.meta.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>${S.scope ? `<span class="hint"> · ${esc(S.scope)}</span>` : ''}`;
  } else $('#proj').textContent = label;
}
async function refreshProjects() { try { projects = await listProjects(); } catch (e) { projects = []; } setProj(); }

// A page that belongs to another project's sites switches to that project, unless the active one claims it too.
async function autoProject(url) {
  if (!BASE || !url) return;
  const mine = (BASE.meta.sites || []).some((x) => url.toLowerCase().includes(String(x).toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^\*\./, '')));
  if (mine) return;
  const id = await projectForUrl(url);
  if (id && id !== BASE.meta.id) { const to = projects.find((p) => p.id === id); await switchProject(id); toast(`Switched to ${to ? to.name : 'the matching project'}`, 2600); }
}

function render() {
  scoped();
  setProj();
  if (st.view === 'writing' && !writingNow) st.view = 'capture';
  renderFlow();
  $('#recbar').innerHTML = recBar();
  startRecTimer();
  main.className = '';
  const v = st.view;
  if (v === 'history') return renderHistory();
  if (v === 'bugs') return renderBugs();
  if (v === 'writing') return renderWriting();
  if (v === 'review' && st.report) return renderReview();
  if (v === 'filled' && st.fill) return renderFilled();
  if (st.error && st.error.kind === 'nokey' || st.error && st.error.kind === 'nobase') return renderNoKey();
  if (!st.shots.length && !st.videos.length && !st.noShot && !recording) return renderEmpty();
  return renderCaptured();
}
const after = () => { applyTheme(); };

async function renderEmpty() {
  const recent = (await history()).slice(0, 3);
  if (st.view !== 'capture' || st.shots.length || st.videos.length || st.noShot || recording) return; // state changed while loading
  const { tab } = await activeTab().catch(() => ({}));
  const { onboarded } = await chrome.storage.local.get('onboarded');
  if (st.view !== 'capture' || st.shots.length || st.videos.length || st.noShot || recording) return;
  const setup = !onboarded && !S.ai.apiKey && S.ai.provider !== 'compatible';
  main.innerHTML = `
  ${setup ? `<div class="alert" role="region" aria-label="Set up QArator"><span class="alert-icon">${icon.key}</span>
    <div style="flex:1;min-width:0"><h2>Set up QArator · 30 seconds</h2><p>Paste your AI key. QArator tests it for you; everything else is already set.</p>
    <button type="button" class="btn b-pri b-sm" data-action="setup" style="margin-top:10px">Start setup</button></div></div>` : ''}
  <div><h1 class="h1">Capture what's wrong</h1>
  <p class="hint" style="margin:4px 0 0">QArator saves the visible part of the tab with its URL and browser details${S.pageErrors ? ' and page errors' : ''}.</p></div>
  <div class="stack">
    <button type="button" class="btn b-acc wide" data-action="capture" style="height:44px;font-size:14px">${icon.capture} Capture visible area <span class="kbd" style="margin-left:4px">Alt+Shift+S</span></button>
    ${recButtons(false).replace('btn b-ghost', 'btn b-sec wide')}
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
  if (!S.pageErrors) chip = '';
  else if (p.errors === null || p.errors === undefined) chip = `<span class="chip" title="Reload the tab once so QArator can collect errors">Page errors unavailable</span>`;
  else if (!p.errors.length) chip = `<span class="chip">No page errors</span>`;
  else chip = `<button type="button" class="chip" data-action="toggle-errors" aria-pressed="${p.errorsIncluded}">${p.errorsIncluded ? icon.check.replace('width="16" height="16"', 'width="12" height="12"') : ''}${p.errors.length} page error${p.errors.length === 1 ? '' : 's'} captured</button>`;
  const vp = p.viewport ? `<span class="chip">Viewport ${p.viewport.w} × ${p.viewport.h}</span>` : '';
  const list = !S.pageErrors ? '' : p.errors && p.errors.length && p.errorsIncluded
    ? `<div class="errlist mono">${p.errors.slice(0, 5).map((e) => `<div>${esc(e.message)}${e.source ? ' · ' + esc(e.source) : ''}${e.count > 1 ? ` (×${e.count})` : ''}</div>`).join('')}${p.errors.length > 5 ? `<div class="hint">and ${p.errors.length - 5} more</div>` : ''}</div>`
    : p.errors && p.errors.length ? `<div class="hint" style="margin-top:8px">Page errors won't be sent or added to the report.</div>` : '';
  return `<div class="chips">${env.browser ? `<span class="chip">${esc(env.browser)}</span>` : ''}${env.os ? `<span class="chip">${esc(env.os)}</span>` : ''}${vp}${chip}</div>${list}`;
}

function whereHtml() {
  const w = locate(st.page, S.urlRules);
  const parts = ['portal', 'module', 'page'].map((k) => w[k]).filter(Boolean);
  return parts.length ? `<div class="hint" id="where" style="margin-top:4px">Location: <span style="color:var(--ink)">${parts.map(esc).join(' › ')}</span> · read from the page, editable in review</div>` : '';
}

function renderCaptured() {
  const n = st.shots.length;
  main.innerHTML = `
  ${errorBanner()}
  <div>
    <div class="lbl between" style="margin-bottom:8px;flex-wrap:wrap"><span>Screenshots <span style="font-weight:400;color:var(--ink3)">${n}</span></span>
      <span style="display:flex;gap:2px;margin-right:-8px;flex-wrap:wrap">
        <button type="button" class="btn b-ghost b-sm" data-action="capture" title="Capture visible area (Alt+Shift+S)">${icon.capture}Capture</button>
        <button type="button" class="btn b-ghost b-sm" data-action="file">${icon.plus}Add</button>
        ${recButtons()}
      </span></div>
    ${n ? `<div class="shots">${st.shots.map((s, i) => `<div>
      <div class="shot-img"><img src="${s.thumb}" alt="Screenshot ${i + 1}">${s.marks.length ? '<span class="badge">Marked up</span>' : ''}</div>
      <div class="shot-actions">
        <button type="button" class="btn b-ghost b-sm" data-action="markup" data-id="${s.id}" aria-label="Mark up screenshot ${i + 1}">${icon.pen}Mark up</button>
        <button type="button" class="btn b-ghost b-sm" data-action="remove" data-id="${s.id}" aria-label="Remove screenshot ${i + 1}">${icon.trash}Remove</button>
      </div></div>`).join('')}</div>`
      : st.videos.length ? '' : `<div class="drop-hint"><div class="hint">No screenshot. Paste one with Ctrl+V, or describe the bug below.</div></div>`}
  </div>
  ${videosHtml()}
  ${st.page ? `<div>
    <div class="lbl">Page</div>
    <div class="mono url">${esc(st.page.url)}</div>
    <div class="hint" style="margin-top:2px">${st.page.capturedAt ? 'Captured ' + fmtTime(st.page.capturedAt) + ' · ' : ''}${esc(st.page.title || '')}</div>
    ${whereHtml()}
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
  const nv = st.videos.length;
  dock.innerHTML = `
  <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px">
    <button type="button" class="btn b-pri" data-action="write" data-needs-note style="height:40px" ${recording || needNote() ? 'aria-disabled="true"' : ''} title="Write the report now (Ctrl+Enter)">Generate report</button>
    <button type="button" class="btn b-sec" data-action="generate-later" data-needs-note style="height:40px" ${recording || needNote() ? 'aria-disabled="true"' : ''} title="Write it in the background and start the next bug (Ctrl+Shift+Enter)">Generate &amp; next bug</button>
  </div>
  <button type="button" class="btn b-sec wide b-sm" data-action="export-word" data-needs-note ${recording || needNote() ? 'aria-disabled="true"' : ''}>${icon.download}Export to Word without AI</button>
  <div class="hint" id="need-note" style="text-align:center;color:var(--acc-text)" ${needNote() ? '' : 'hidden'}>Add what's wrong to continue.</div>
  <div class="hint" style="text-align:center">Sends ${n ? `${n} screenshot${n === 1 ? '' : 's'}, ` : ''}${nv ? `frames of ${nv} video${nv === 1 ? '' : 's'}, ` : ''}your note${S.pageErrors && st.page?.errorsIncluded ? ', page errors' : ''}${st.page ? ' and the page address' : ''} to ${esc(providerName())} · ${esc(modelLabel())}.</div>
  ${quotaHtml()}`;
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
    `Send to ${providerName()} · ${modelLabel()}`,
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
      <select id="fld-${f.id}" class="field" data-field="${f.id}"><option value=""${val ? '' : ' selected'}>— Leave empty —</option>${opts.map((o) => `<option${o === val ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
  }).join('');
  main.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin:-8px -8px -8px -8px">
    <button type="button" class="btn b-ghost b-sm" data-action="back-capture">${icon.back}Screenshots and note</button>
    <span class="hint" style="margin-right:8px">${r.model ? `Written by ${esc(r.model)} · ` : ''}Draft · not submitted</span></div>
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
    <div class="row-between"><h2 class="h2" id="h-tag">Tags</h2><span class="hint">${S.zoho.fillTags ? 'Ticked tags are added in Zoho' : 'You add tags in Zoho; copy them after filling'}</span></div>
    <div id="tp-chips" class="chips" aria-live="polite"></div>
    <div style="margin-top:8px">${beam(`<input class="field" id="tp-q" type="search" autocomplete="off" aria-label="Search your team's tags" placeholder="Search tags, e.g. schemes">`)}</div>
    <div id="tp-list" class="tplist" role="group" aria-label="Team tags"></div>
  </section>
  ${st.shots.length || st.videos.length ? `<section aria-labelledby="h-att"><h2 class="h2" id="h-att">Attachments</h2>
    <div class="thumbs" style="margin-top:10px">${[...st.shots, ...st.videos].map((s, i) => `<img src="${s.thumb}" alt="Attachment ${i + 1}">`).join('')}
    <span class="hint">${[st.shots.length ? `${st.shots.length} screenshot${st.shots.length === 1 ? '' : 's'}` : '', st.videos.length ? `${st.videos.length} video${st.videos.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ')}${S.zoho.uploadScreenshots ? ', uploaded when you fill the form' : ''}</span></div></section>` : ''}`;
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
  <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px">
    <button type="button" class="btn b-sec b-sm" data-action="copy-title">${icon.copy}Copy title</button>
    <button type="button" class="btn b-sec b-sm" data-action="copy-desc">${icon.copy}Copy description</button>
    <button type="button" class="btn b-sec b-sm" data-action="export-word">${icon.download}Export to Word</button>
    <button type="button" class="btn b-sec b-sm" data-action="save-shots" ${st.shots.length || st.videos.length ? '' : 'disabled'}>${icon.download}Save files</button>
  </div>`;
  refreshTags();
  after();
}

function tagsHtml() {
  const list = tagSuggestions();
  if (!list.length) return '';
  return `<section aria-labelledby="h-tags2"><div class="row-between"><div class="lbl" id="h-tags2" style="margin:0">Tags to add in Zoho · ${list.length}</div>
    <button type="button" class="btn b-ghost b-sm" data-action="copy-tags" style="margin-right:-8px">${icon.copy}Copy all</button></div>
    <div class="hint" style="margin:2px 0 4px">From your team's tag list. Copy one at a time and paste it into Zoho's tag box, or pick your own there.</div>
    ${list.map((t, i) => `<div class="tagrow"><span>${esc(t)}</span><button type="button" class="btn b-sec b-sm" data-action="copy-tag" data-id="${i}" aria-label="Copy tag ${esc(t)}">${icon.copy}Copy</button></div>`).join('')}</section>`;
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
      <div style="font-size:12px;color:var(--ink2);margin-top:2px">${esc(c.reason || '')}</div>
      ${c.options && c.options.length ? `<button type="button" class="btn b-sec b-sm" data-action="use-zoho-options" data-name="${esc(c.field)}" style="margin-top:6px">Use Zoho's list for ${esc(c.field)}</button>` : ''}</div>
      ${c.missing ? '' : `<button type="button" class="btn b-sec b-sm" data-action="goto" data-name="${esc(c.field)}" aria-label="Go to ${esc(c.field)} in Zoho" style="flex:none">Go to field</button>`}</div>`).join('')}</section>` : ''}
  <section><div class="lbl">Filled · ${filled.length}</div>
    ${filled.map((d) => `<div class="res-row"><span role="img" aria-label="Filled" style="color:var(--ink2);display:inline-flex">${icon.check}</span><span class="name">${esc(d.field)}</span><span class="hint val" title="${esc(d.value || '')}">${esc(d.value || '')}</span></div>`).join('') || '<div class="hint">Nothing was filled.</div>'}
  </section>
  ${kept.length ? `<section><div class="lbl">Left as is · ${kept.length}</div>
    ${kept.map((d) => `<div class="res-row"><span aria-hidden="true" style="color:var(--ink3);display:inline-flex">–</span><span class="name">${esc(d.field)}</span><span class="hint val">${esc(d.reason || d.value || '')}</span></div>`).join('')}</section>` : ''}
  ${tagsHtml()}
  <div class="callout" id="change">
    <div class="h2">Need to change something?</div>
    <div class="hint" style="color:var(--ink2)">Press <strong>Edit report</strong>, change the title, text, fields or tags, then press <strong>Fill Zoho form</strong> again. QArator types over what it filled before. Nothing is lost while the Zoho form is open.</div>
    <div><button type="button" class="btn b-sec b-sm" data-action="back-review">${icon.pen}Edit report</button></div>
  </div>`;
  dock.innerHTML = `
  <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px">
    <button type="button" class="btn b-sec" data-action="back-review">${icon.pen}Edit report</button>
    <button type="button" class="btn b-sec" data-action="fill">Fill again</button>
  </div>
  ${bugCounts.ready ? `<button type="button" class="btn b-pri wide" data-action="next-ready" style="height:40px">Next ready bug from the list · ${bugCounts.ready}</button>
  <button type="button" class="btn b-ghost wide b-sm" data-action="next">Done · capture a new bug</button>` : `<button type="button" class="btn b-pri wide" data-action="next" style="height:40px">Done · start next bug</button>`}`;
  after();
}

async function renderBugs() {
  const list = await loadBugs();
  if (st.view !== 'bugs') return; // the tester moved on while this loaded
  for (const id of [...bugSel]) if (!list.some((b) => b.id === id)) bugSel.delete(id);
  const when = (ts) => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  const titleOf = (b) => (b.report ? buildTitle(b.report, S) : bugNote(b));
  main.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin:-8px">
    <button type="button" class="btn b-ghost b-sm" data-action="bugs-back">${icon.back}Back</button>
    ${list.some((b) => b.status === 'filled') ? '<button type="button" class="btn b-ghost b-sm" data-action="bugs-clear-filled">Remove filled bugs</button>' : ''}</div>
  <div><h1 class="h1">Bug list</h1>
  <p class="hint" style="margin:4px 0 0">Bugs saved with Generate &amp; next bug. QArator writes them one by one while this panel is open. Open a ready bug to review it and fill Zoho.</p></div>
  ${list.length ? `<label class="chk inline" style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:-12px"><input type="checkbox" id="bsel-all" ${bugSel.size === list.length ? 'checked' : ''}>Select all</label>` : ''}
  <div>${list.length ? list.map((b, i) => {
    const thumb = (b.snap.shots[0] || (b.snap.videos || [])[0] || {}).thumb;
    return `<div class="bug"><input type="checkbox" data-bsel="${b.id}" ${bugSel.has(b.id) ? 'checked' : ''} aria-label="Select bug ${i + 1}" style="margin-top:3px;flex:none;width:16px;height:16px;accent-color:var(--pri)">
      ${thumb ? `<img src="${thumb}" alt="">` : ''}
      <div style="flex:1;min-width:0"><div class="t">${esc(titleOf(b))}</div>
        <div class="hint" style="margin-top:3px;display:flex;flex-wrap:wrap;gap:4px 8px;align-items:center"><span class="st ${b.status}">${b.status === 'writing' ? orb('working', 20) : ''}${STATUS[b.status] || b.status}</span>${when(b.at)}</div>
        ${b.status === 'failed' && b.error ? `<div class="hint" style="margin-top:3px;color:var(--acc-text)">${esc(b.error.title)}</div>` : ''}
        ${b.status === 'waiting' && b.error && b.retryAt ? `<div class="hint" style="margin-top:3px;color:var(--acc-text)">${esc(b.error.title)}. Next try at ${fmtTime(b.retryAt)}.</div>` : ''}
        <div style="display:flex;gap:4px;margin:6px 0 0 -8px;flex-wrap:wrap">
          <button type="button" class="btn b-sec b-sm" data-action="bug-open" data-id="${b.id}" ${b.status === 'writing' ? 'disabled' : ''}>${b.status === 'ready' || b.status === 'filled' ? 'Open report' : 'Open'}</button>
          ${b.status === 'failed' ? `<button type="button" class="btn b-ghost b-sm" data-action="bug-retry" data-id="${b.id}">Try again</button>` : ''}
          <button type="button" class="btn b-ghost b-sm" data-action="bug-remove" data-id="${b.id}" aria-label="Remove bug ${i + 1}">${icon.trash}Remove</button>
        </div></div></div>`;
  }).join('') : '<p class="hint">No saved bugs. On the capture screen, add a screenshot and what\'s wrong, then press Generate &amp; next bug.</p>'}</div>`;
  dock.innerHTML = list.length ? bugsDock() : '';
  after();
}
const bugsDock = () => {
  const n = bugSel.size;
  return `<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px">
    <button type="button" class="btn b-pri" data-action="bugs-export-full" ${n ? '' : 'aria-disabled="true"'}>${icon.download}Export ${n || ''} full bug${n === 1 ? '' : 's'}</button>
    <button type="button" class="btn b-sec" data-action="bugs-export-notes" ${n ? '' : 'aria-disabled="true"'}>${icon.download}Notes only</button></div>
  <div class="hint" style="text-align:center">${n ? 'One Word file, a page per bug.' : 'Tick bugs to export them.'} Full: the written report with screenshots. Notes only: page address, screenshots and what's wrong.</div>`;
};
async function exportBugList(full) {
  const list = (await loadBugs()).filter((b) => bugSel.has(b.id));
  if (!list.length) return;
  try {
    await download(await exportBugs(list, S, { full }), `qarator_${full ? 'bugs' : 'notes'}_${stamp()}`, list.flatMap((b) => b.snap.videos || []));
    toast(`${list.length} bug${list.length === 1 ? '' : 's'} saved to Downloads`);
  } catch (e) { toast(`Export failed: ${e.message || e}`, 4000); }
}

// Ticked reports in Recent reports, for "Export to Word". Not saved: it starts empty each time.
const histSel = new Set();
async function renderHistory() {
  const list = await history();
  if (st.view !== 'history') return;
  for (const id of [...histSel]) if (!list.some((h) => String(h.id) === id)) histSel.delete(id);
  main.innerHTML = `
  <div style="display:flex;align-items:center;justify-content:space-between;margin:-8px">
    <button type="button" class="btn b-ghost b-sm" data-action="history-back">${icon.back}Back</button>
    ${list.length ? '<button type="button" class="btn b-ghost b-sm" data-action="history-clear">Clear list</button>' : ''}</div>
  <h1 class="h1">Recent reports</h1>
  ${list.length ? `<label class="chk inline" style="display:flex;align-items:center;gap:8px;font-size:13px;margin-bottom:-12px"><input type="checkbox" id="hsel-all" ${histSel.size === list.length ? 'checked' : ''}>Select all</label>` : ''}
  <div>${list.length ? list.map((h) => `<div class="hist-item"><input type="checkbox" data-hsel="${h.id}" ${histSel.has(String(h.id)) ? 'checked' : ''} aria-label="Select ${esc(h.title)}" style="margin-top:3px;flex:none;width:16px;height:16px;accent-color:var(--pri)">
    <div style="flex:1;min-width:0"><div class="t">${esc(h.title)}</div><div class="hint">${esc(h.status)} · ${new Date(h.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</div></div>
    <button type="button" class="btn b-ghost b-sm" data-action="history-copy" data-id="${h.id}" aria-label="Copy title">${icon.copy}</button>
    <button type="button" class="btn b-sec b-sm" data-action="history-open" data-id="${h.id}">Open</button></div>`).join('')
    : '<p class="hint">Reports you fill, copy or export appear here, with their screenshots.</p>'}</div>`;
  dock.innerHTML = list.length ? histDock() : '';
  after();
}
const histDock = () => `<button type="button" class="btn b-pri wide" data-action="history-export" id="hist-export" ${histSel.size ? '' : 'aria-disabled="true"'}>${icon.download}${histSel.size ? `Export ${histSel.size} report${histSel.size === 1 ? '' : 's'} to Word` : 'Tick reports to export to Word'}</button>
  <div class="hint" style="text-align:center">One Word file, one report per page. Screenshots are included; videos come in the same zip.</div>`;
async function exportHistory() {
  const list = (await history()).filter((h) => histSel.has(String(h.id)));
  if (!list.length) return;
  try {
    for (const h of list) h.media = (await getMedia(h.id).catch(() => null)) || {};
    const docx = await exportReports(list, S);
    await download(docx, `qarator_reports_${stamp()}`, list.flatMap((h) => h.media.videos || []));
    toast(`${list.length} report${list.length === 1 ? '' : 's'} saved to Downloads`);
  } catch (e) { toast(`Export failed: ${e.message || e}`, 4000); }
}

// ---------- events ----------
document.addEventListener('click', async (e) => {
  const pick = e.target.closest('[data-pick]'), unpick = e.target.closest('[data-unpick]');
  if (pick && st.report) return togglePick(pick.dataset.pick, !tagOn(pick.dataset.pick));
  if (unpick && st.report) return togglePick(unpick.dataset.unpick, false);
  const b = e.target.closest('[data-action]');
  if (!b || b.getAttribute('aria-disabled') === 'true' || b.disabled) return;
  const a = b.dataset.action, id = b.dataset.id;
  switch (a) {
    case 'capture': return captureTab();
    case 'file': return $('#file').click();
    case 'settings': return chrome.runtime.openOptionsPage();
    case 'usage': return chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#usage') });
    case 'setup': return chrome.tabs.create({ url: chrome.runtime.getURL('options/welcome.html') });
    case 'noshot': st.noShot = true; render(); return $('#note')?.focus();
    case 'toggle-errors': st.page.errorsIncluded = !st.page.errorsIncluded; saveDraft(); return render();
    case 'toggle-steps': st.stepsOpen = !st.stepsOpen; render(); if (st.stepsOpen) $('#steps')?.focus(); return;
    case 'remove': st.shots = st.shots.filter((s) => s.id !== id); saveDraft(); return render();
    case 'markup': {
      if (markupOpening || $('#overlay').firstChild) return;
      const i = st.shots.findIndex((s) => s.id === id);
      const shot = st.shots[i];
      if (!shot) return;
      markupOpening = true;
      try {
        return await openMarkup(shot, i, st.shots.length, {
          onApply: async ({ dataUrl, marks, original }) => { Object.assign(shot, { dataUrl, marks, original, thumb: await thumb(dataUrl) }); saveDraft(); render(); }
        });
      } finally { markupOpening = false; }
    }
    case 'write': return write();
    case 'export-word': return needNote() && !st.report ? askForNote() : exportWord();
    case 'generate-later': return generateLater();
    case 'bugs': st.back = st.view === 'bugs' || st.view === 'history' ? st.back : st.view; st.view = 'bugs'; return render();
    case 'bug-open': return openBug(id);
    case 'bug-retry': await patchBug(id, { status: 'waiting', error: null }); runQueue(); return;
    case 'bug-remove': if (!confirm('Remove this bug from the list?')) return; await removeBugs([id]); bugSel.delete(id); if (st.bugId === id) st.bugId = null; pruneUnused(); return;
    case 'bugs-export-full': return exportBugList(true);
    case 'bugs-export-notes': return exportBugList(false);
    case 'bugs-clear-filled': { const ids = (await loadBugs()).filter((b) => b.status === 'filled').map((b) => b.id); await removeBugs(ids); ids.forEach((x) => bugSel.delete(x)); if (ids.includes(st.bugId)) st.bugId = null; pruneUnused(); return; }
    case 'next-ready': { const b = (await loadBugs()).find((x) => x.status === 'ready'); if (b) return openBug(b.id); return; }
    case 'use-zoho-options': return useZohoOptions(b.dataset.name);
    case 'record-screen': return startRec('screen');
    case 'stop-rec': return stopRec();
    case 'play-video': return playVideo(id);
    case 'remove-video': st.videos = st.videos.filter((v) => v.id !== id); saveDraft(); setTimeout(pruneUnused, 600); return render();
    case 'copy-tag': return copyText(tagSuggestions()[Number(id)], 'Tag copied');
    case 'copy-tags': return copyText(tagSuggestions().join(', '), 'Tags copied');
    case 'flow': {
      if (id === 'capture') { st.view = 'capture'; st.zoho = null; }
      else if (id === 'review' && st.report) st.view = 'review';
      else if (id === 'filled' && st.fill) st.view = 'filled';
      saveDraft(); return render();
    }
    case 'cancel': ctrl && ctrl.abort(); return;
    case 'dismiss-error': st.error = null; saveDraft(); return render();
    case 'blank': return blankReport();
    case 'reset': if (confirm('Clear the screenshots, videos and note?')) { st = fresh(); saveDraft(); pruneUnused(); render(); } return;
    case 'back-capture': st.view = 'capture'; st.zoho = null; saveDraft(); return render();
    case 'back-review': st.view = 'review'; saveDraft(); return render();
    case 'rewrite': return rewrite(id);
    case 'copy-title': await copyText(buildTitle(st.report, S), 'Title copied'); await learn(); return saveHistory('Copied, not filled');
    case 'copy-desc': await copyText(descriptionText(st.report), 'Description copied'); await learn(); return saveHistory('Copied, not filled');
    case 'save-shots': st.shots.forEach((s) => downloadDataUrl(s.dataUrl, s.name)); return saveVideos();
    case 'fill': return fillZoho();
    case 'open-zoho': return openZoho();
    case 'goto': return gotoField(b.dataset.name);
    case 'next': st = fresh(); saveDraft(); pruneUnused(); return render();
    case 'history': st.back = st.view === 'history' || st.view === 'bugs' ? st.back : st.view; st.view = 'history'; return render();
    case 'history-back': st.view = st.back || 'capture'; return render();
    case 'bugs-back': st.view = st.back || 'capture'; return render();
    case 'history-clear': { for (const h of await history()) deleteMedia(h.id).catch(() => {}); await chrome.storage.local.set({ history: [] }); histSel.clear(); pruneUnused(); return render(); }
    case 'history-export': return exportHistory();
    case 'history-copy': { const h = (await history()).find((x) => String(x.id) === id); if (h) copyText(h.title, 'Title copied'); return; }
    case 'history-open': {
      const h = (await history()).find((x) => String(x.id) === id);
      if (!h) return;
      const m = (await getMedia(h.id).catch(() => null)) || {};
      const shots = [];
      for (const s of m.shots || []) shots.push({ id: uid(), dataUrl: s.dataUrl, original: s.dataUrl, marks: [], name: s.name, thumb: await thumb(s.dataUrl).catch(() => s.dataUrl) });
      st = { ...fresh(), report: h.report, page: h.page, shots, videos: m.videos || [], view: 'review' };
      saveDraft(); return render();
    }
  }
});

document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.id === 'tp-q') { refreshTags(); return; }
  if (t.dataset.bind) {
    st[t.dataset.bind] = t.value; saveDraft();
    if (t.dataset.bind === 'note') {
      document.querySelectorAll('[data-needs-note]').forEach((b) => { if (needNote() || recording) b.setAttribute('aria-disabled', 'true'); else b.removeAttribute('aria-disabled'); });
      const h = $('#need-note'); if (h) h.hidden = !needNote();
    }
    return;
  }
  if (t.dataset.seg) { st.report.segments[t.dataset.seg] = t.value; updateTitlePreview(); saveDraft(); return; }
  if (t.dataset.sec) { const s = st.report.sections.find((x) => x.id === t.dataset.sec); if (s) s.text = t.value; saveDraft(); }
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.id === 'projsel') { switchProject(t.value).catch((err) => toast(err.message, 3000)); return; }
  if (t.dataset.field) {
    st.report.fields[t.dataset.field] = t.value; st.report.aiChosen[t.dataset.field] = false; saveDraft();
    const tag = document.querySelector(`label[for="fld-${t.dataset.field}"] .ai-tag`); if (tag) tag.remove();
  }
  if (t.id === 'file') { addFiles(t.files); t.value = ''; }
  if (t.dataset.bsel !== undefined || t.id === 'bsel-all') {
    if (t.id === 'bsel-all') document.querySelectorAll('[data-bsel]').forEach((c) => { c.checked = t.checked; if (t.checked) bugSel.add(c.dataset.bsel); else bugSel.delete(c.dataset.bsel); });
    else if (t.checked) bugSel.add(t.dataset.bsel); else bugSel.delete(t.dataset.bsel);
    const all = $('#bsel-all'), boxes = document.querySelectorAll('[data-bsel]');
    if (all) all.checked = boxes.length > 0 && [...boxes].every((c) => c.checked);
    dock.innerHTML = bugsDock();
  }
  if (t.dataset.hsel !== undefined || t.id === 'hsel-all') {
    if (t.id === 'hsel-all') document.querySelectorAll('[data-hsel]').forEach((c) => { c.checked = t.checked; if (t.checked) histSel.add(c.dataset.hsel); else histSel.delete(c.dataset.hsel); });
    else if (t.checked) histSel.add(t.dataset.hsel); else histSel.delete(t.dataset.hsel);
    const all = $('#hsel-all'), boxes = document.querySelectorAll('[data-hsel]');
    if (all) all.checked = boxes.length > 0 && [...boxes].every((c) => c.checked);
    dock.innerHTML = histDock();
  }
});
document.addEventListener('keydown', (e) => {
  if ($('#overlay').firstChild) { if (e.key === 'Escape' && $('#vclose')) $('#vclose').click(); return; } // markup editor handles its own keys
  if (e.target.id === 'tp-q' && e.key === 'Enter') {
    e.preventDefault();
    const first = $('#tp-list [data-pick]'); // Enter ticks the top match, so tags can be added from the keyboard
    if (first) { togglePick(first.dataset.pick, true); e.target.value = ''; refreshTags(); }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'Enter') {
    e.preventDefault();
    if (st.view === 'capture') generateLater();
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
  if (msg && msg.type === 'qarator:record') { chrome.storage.session.remove('pendingRecord').catch(() => {}); if (recording) stopRec(); else startRec('screen'); }
});

// ---------- start ----------
(async function start() {
  $('#mark').innerHTML = markSvg(20);
  $('#btn-history').innerHTML = icon.clock;
  $('#btn-bugs').innerHTML = icon.list;
  $('#btn-settings').innerHTML = icon.settings;
  BASE = await loadSettings(); S = BASE;
  applyAppearance(S);
  refreshProjects();
  onSettingsChanged((s) => {
    BASE = s; scoped(); refreshProjects();
    applyAppearance(S);
    if (st.error && (st.error.kind === 'nokey' || st.error.kind === 'nobase') && (S.ai.apiKey || S.ai.provider === 'compatible')) st.error = null;
    if (st.view !== 'writing') render();
    refreshQuota();
    runQueue(); // a key added or changed may unblock waiting bugs
  });
  env = await detectEnv();
  await loadDraft();
  watchTheme();
  render();
  refreshQuota();
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'local') return;
    if (c.usage || c.modelCooldown || c.learnedLimits) refreshQuota();
    if (c.projects) refreshProjects();
    if (c.onboarded && st.view === 'capture') render();
    if (c.bugs) { refreshBugCounts(); if (st.view === 'bugs') render(); }
  });
  // a bug left "writing" when the panel closed goes back to waiting, then the queue carries on
  // bugs left "writing" by a panel that closed are picked up by runQueue once their heartbeat is a minute old
  refreshBugCounts();
  runQueue();
  try {
    const { pendingCapture } = await chrome.storage.session.get('pendingCapture');
    if (pendingCapture && Date.now() - pendingCapture < 5000) { await chrome.storage.session.remove('pendingCapture'); captureTab(); }
    const { pendingRecord } = await chrome.storage.session.get('pendingRecord');
    if (pendingRecord && Date.now() - pendingRecord < 5000) { await chrome.storage.session.remove('pendingRecord'); startRec('screen'); }
  } catch (e) { /* ignore */ }
})();
