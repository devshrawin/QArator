// Projects: each one is a saved format (title, sections, fields, tags, Zoho labels, portals). The one in use
// is the working copy in `settings`; the rest wait on the shelf in `projects`. A person's own AI key, usage
// and look stay with the browser, never with a project.
import { PROJECTS_KEY, loadSettings, saveSettings, normalize, importFormat, checkFormat, formatPart, DEFAULTS } from './settings.js';

const hostPath = (u) => String(u || '').toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/^\*\./, '');

async function shelf() {
  const { [PROJECTS_KEY]: all = {} } = await chrome.storage.local.get(PROJECTS_KEY);
  return all;
}

/** All projects, the active one included (its latest edits are in `settings`). */
export async function listProjects() {
  const [all, cur] = await Promise.all([shelf(), loadSettings()]);
  const rows = { ...all, [cur.meta.id]: formatPart(cur) };
  return Object.values(rows).map((f) => ({ id: f.meta.id, name: f.meta.name, sites: f.meta.sites, scopes: f.meta.scopes.length, active: f.meta.id === cur.meta.id }))
    .sort((a, b) => (b.active - a.active) || a.name.localeCompare(b.name));
}

const uniqueId = (base, taken) => { let id = base, n = 1; while (taken.has(id)) id = `${base}_${++n}`; return id; };

/** Make another project the one in use. Personal settings (AI, usage, look) stay as they are. */
export async function switchProject(id) {
  const [all, cur] = await Promise.all([shelf(), loadSettings()]);
  if (id === cur.meta.id) return cur;
  const target = all[id];
  if (!target) throw new Error('That project was not found.');
  const next = normalize({ ...target, ai: cur.ai, usage: cur.usage, appearance: cur.appearance, pageErrors: cur.pageErrors });
  await saveSettings(next);
  return next;
}

/**
 * Add a project from a file. It never overwrites an existing project unless `replace` names its id:
 * a file whose id is already here becomes a copy, so a teammate's import cannot undo your edits.
 * Returns { id, warnings, name }.
 */
export async function addProject(json, { replace = '', activate = true } = {}) {
  const { errors, warnings } = checkFormat(json);
  if (errors.length) throw new Error(errors.join(' '));
  const cur = await loadSettings();
  const all = await shelf();
  const next = importFormat(cur, json);
  // a browser that has only the untouched neutral project gives it up for the first real one
  const untouched = Object.keys(all).every((k) => k === cur.meta.id) && JSON.stringify(formatPart(cur)) === JSON.stringify(formatPart(normalize({})));
  if (untouched && activate && !replace) { delete all[cur.meta.id]; await chrome.storage.local.set({ [PROJECTS_KEY]: all }); }
  const taken = new Set(untouched && activate && !replace ? Object.keys(all) : [...Object.keys(all), cur.meta.id]);
  if (replace) taken.delete(replace); else next.meta.id = uniqueId(next.meta.id, taken);
  if (replace) next.meta.id = replace;
  if (!replace && next.meta.name && [...taken].length && Object.values(all).some((f) => f.meta.name === next.meta.name)) next.meta.name = `${next.meta.name} (2)`;
  if (activate) await saveSettings(next);
  else await chrome.storage.local.set({ [PROJECTS_KEY]: { ...all, [next.meta.id]: formatPart(next) } });
  return { id: next.meta.id, name: next.meta.name, warnings };
}

/** A new project with the neutral setup. */
export async function newProject(name, { activate = true } = {}) {
  const base = normalize({ ...DEFAULTS, meta: { ...DEFAULTS.meta, id: 'project', name: String(name || '').trim() || 'New project' } });
  return addProject({ qarator: 'format', ...formatPart(base) }, { activate });
}

export async function renameProject(id, name) {
  const [all, cur] = await Promise.all([shelf(), loadSettings()]);
  const nm = String(name || '').trim();
  if (!nm) return;
  if (id === cur.meta.id) { cur.meta.name = nm; await saveSettings(cur); return; }
  if (all[id]) await chrome.storage.local.set({ [PROJECTS_KEY]: { ...all, [id]: { ...all[id], meta: { ...all[id].meta, name: nm } } } });
}

/** Remove a project. The one in use cannot be removed while it is the only one. */
export async function deleteProject(id) {
  const [all, cur] = await Promise.all([shelf(), loadSettings()]);
  const rows = { ...all, [cur.meta.id]: formatPart(cur) };
  const ids = Object.keys(rows);
  if (ids.length < 2 || !rows[id]) return false;
  delete rows[id];
  if (id === cur.meta.id) {
    const nextId = Object.keys(rows)[0];
    const next = normalize({ ...rows[nextId], ai: cur.ai, usage: cur.usage, appearance: cur.appearance, pageErrors: cur.pageErrors });
    await chrome.storage.local.set({ settings: next, [PROJECTS_KEY]: rows });
  } else {
    await chrome.storage.local.set({ [PROJECTS_KEY]: rows });
  }
  return true;
}

/** Which project's `sites` this page belongs to (the longest match), or ''. */
export async function projectForUrl(url) {
  const u = hostPath(url);
  if (!u) return '';
  const rows = await listProjects();
  let best = '', len = 0;
  for (const r of rows) for (const site of r.sites) {
    const m = hostPath(site);
    if (m && u.includes(m) && m.length > len) { best = r.id; len = m.length; }
  }
  return best;
}
