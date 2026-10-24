// Bug list: bugs saved with "Write later" while testing. Each holds what the tester captured
// (screenshots, video ids, page, note, steps) and, once the AI has written it, the report.
// status: waiting | writing | ready | failed | filled
const KEY = 'bugs';

export async function loadBugs() {
  return (await chrome.storage.local.get(KEY))[KEY] || [];
}

// Changes are chained so the background writer and the panel never overwrite each other.
let chain = Promise.resolve();
export function updateBugs(fn) {
  chain = chain.then(async () => {
    const list = await loadBugs();
    const next = fn(list) || list;
    await chrome.storage.local.set({ [KEY]: next });
    return next;
  }).catch(() => loadBugs());
  return chain;
}
export const patchBug = (id, patch) => updateBugs((list) => list.map((b) => (b.id === id ? { ...b, ...patch } : b)));
export const removeBugs = (ids) => updateBugs((list) => list.filter((b) => !ids.includes(b.id)));
export const addBug = (bug) => updateBugs((list) => [...list, bug]);

export const bugNote = (b) => String(b.snap.note || '').split('\n')[0].trim() || 'Untitled bug';
export const STATUS = { waiting: 'Waiting to be written', writing: 'Writing…', ready: 'Ready', failed: 'Not written', filled: 'Filled in Zoho' };
