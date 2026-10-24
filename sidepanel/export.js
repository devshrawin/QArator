// Word export of whatever the tester has: works with or without an AI report. Without one it holds
// the page address, environment, the note, the tester's steps, page errors and the screenshots;
// with one it adds the title, the written sections, the issue fields and suggested tags.
import { buildDocx, dataUrlBytes } from '../lib/docx.js';
import { buildTitle, locate } from '../lib/report.js';
import { loadImage } from '../lib/env.js';

const when = (ts) => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

// The written sections and the issue fields of one report.
function reportBody(r, S, { withTags = false } = {}) {
  const blocks = [];
  for (const s of r.sections.filter((x) => x.text.trim())) {
    if (s.id === 'url_note') continue; // the URL is above
    blocks.push({ h2: s.name });
    const lines = s.text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (s.layout === 'numbered' || s.layout === 'bullets') blocks.push({ list: lines, numbered: s.layout === 'numbered' });
    else blocks.push({ p: s.text.trim() });
  }
  const fields = S.fields.filter((f) => r.fields[f.id]);
  if (fields.length) {
    blocks.push({ h2: 'Issue fields' });
    for (const f of fields) blocks.push({ kv: [f.name, r.fields[f.id]] });
  }
  const tags = withTags ? (r.tags || []).filter((t) => t.on).map((t) => t.name) : [];
  if (tags.length) { blocks.push({ h2: 'Tags' }); blocks.push({ list: tags }); }
  return blocks;
}

/** Saved reports from Recent reports in one document, one per page. Text only: history keeps no screenshots. */
export function exportReports(entries, S) {
  const blocks = [];
  entries.forEach((h, i) => {
    if (i) blocks.push({ pagebreak: true });
    const r = h.report, p = h.page || {};
    blocks.push({ h1: h.title || buildTitle(r, S) });
    if (p.url) blocks.push({ kv: ['URL', p.url], link: true });
    const loc = ['portal', 'module', 'page'].map((k) => r.segments[k]).filter(Boolean).join(' › ');
    if (loc) blocks.push({ kv: ['Location', loc] });
    blocks.push({ kv: ['Status', `${h.status} · ${when(h.at)}`] });
    blocks.push(...reportBody(r, S, { withTags: true }));
  });
  return buildDocx(blocks);
}

export async function exportDocx(st, S, env, { tags = [] } = {}) {
  const r = st.report;
  const p = st.page || {};
  const where = r ? r.segments : locate(p, S.urlRules);
  const blocks = [];
  blocks.push({ h1: r ? buildTitle(r, S) : (st.note.trim() || 'Bug report') });
  if (p.url) blocks.push({ kv: ['URL', p.url], link: true });
  const loc = ['portal', 'module', 'page'].map((k) => where[k]).filter(Boolean).join(' › ');
  if (loc) blocks.push({ kv: ['Location', loc] });
  if (p.title) blocks.push({ kv: ['Page title', p.title] });
  if (p.capturedAt) blocks.push({ kv: ['Captured', when(p.capturedAt)] });
  const envLine = [env.browser, env.os, p.viewport ? `viewport ${p.viewport.w} × ${p.viewport.h}` : ''].filter(Boolean).join(', ');
  if (envLine) blocks.push({ kv: ['Environment', envLine] });

  if (r) {
    blocks.push(...reportBody(r, S));
  } else {
    if (st.note.trim()) { blocks.push({ h2: "What's wrong" }); blocks.push({ p: st.note.trim() }); }
    const steps = st.steps.split('\n').map((l) => l.trim()).filter(Boolean);
    if (steps.length) { blocks.push({ h2: 'Steps to Reproduce' }); blocks.push({ list: steps, numbered: true }); }
  }
  if (tags.length) { blocks.push({ h2: 'Suggested tags' }); blocks.push({ list: tags }); }
  if (p.errors && p.errors.length && p.errorsIncluded) {
    blocks.push({ h2: 'Page errors' });
    blocks.push({ list: p.errors.slice(0, 20).map((e) => `${e.message}${e.source ? ` · ${e.source}` : ''}${e.count > 1 ? ` (×${e.count})` : ''}`) });
  }
  if (st.videos && st.videos.length) {
    blocks.push({ h2: 'Videos' });
    blocks.push({ list: st.videos.map((v) => `${v.name} (${v.dur}, saved next to this document)`) });
  }
  if (st.shots.length) {
    blocks.push({ h2: 'Screenshots' });
    for (const s of st.shots) {
      const img = await loadImage(s.dataUrl);
      blocks.push({ img: { ...dataUrlBytes(s.dataUrl), w: img.naturalWidth, h: img.naturalHeight }, caption: s.name });
    }
  }
  return buildDocx(blocks);
}
