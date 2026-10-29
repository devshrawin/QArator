// Helpers for pasted AI keys: strip what a copy often drags along, and tell which provider a key belongs to.
export const GEMINI_KEY = /AIza[0-9A-Za-z_-]{35}/;
export const KEY_PAGE = 'https://aistudio.google.com/app/apikey';

/** A key as pasted: no spaces, line breaks or quotes, and no leading "Bearer ". */
export const cleanKey = (s) => String(s || '').trim().replace(/^bearer\s+/i, '').replace(/[\s"'`“”‘’]+/g, '');

/** gemini | anthropic | openai, or '' when the key does not say. */
export function detectProvider(key) {
  const k = cleanKey(key);
  if (/^AIza[0-9A-Za-z_-]{20,}$/.test(k)) return 'gemini';
  if (/^sk-ant-/.test(k)) return 'anthropic';
  if (/^sk-[A-Za-z0-9_-]{20,}$/.test(k)) return 'openai';
  return '';
}

/** Ask the AI Studio helper to show itself on the key page for the next half hour. */
export async function openKeyPage() {
  await chrome.storage.local.set({ keyHelper: { until: Date.now() + 30 * 60 * 1000 } });
  await chrome.tabs.create({ url: KEY_PAGE });
}
