// Local usage tally. QArator makes every AI call itself, so it can count them; providers do not expose
// remaining free quota, so "left today" is an estimate against limits learned from 429 replies.
// Days roll over at midnight Pacific time, when Gemini's daily quota resets.

const FIELDS = ['req', 'fail', 'rl', 'tin', 'tout'];

export function dayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(date);
}

const rowKey = (e) => `${e.provider}|${e.model || '-'}|${e.kind || 'write'}|${e.key || 'main'}`;

/** Pure: a new usage object with the entry added. Keeps about two months. */
export function addEntry(usage, e, now = new Date()) {
  const next = { ...(usage || {}) };
  const day = dayKey(now);
  const rows = { ...(next[day] || {}) };
  const key = rowKey(e);
  const row = { req: 0, fail: 0, rl: 0, tin: 0, tout: 0, ...(rows[key] || {}) };
  row.req += 1;
  row.fail += e.fail ? 1 : 0;
  row.rl += e.rl ? 1 : 0;
  row.tin += e.tin || 0;
  row.tout += e.tout || 0;
  rows[key] = row;
  next[day] = rows;
  const oldest = dayKey(new Date(now.getTime() - 62 * 86400000));
  for (const d of Object.keys(next)) if (d < oldest) delete next[d];
  return next;
}

/** Totals per provider/model/kind over the last `days` days (1 = today). */
export function summarize(usage, days = 1, now = new Date()) {
  const out = {};
  const seen = new Set();
  for (let i = 0; i < days + 1; i++) {
    const day = dayKey(new Date(now.getTime() - i * 86400000));
    if (seen.has(day) || seen.size >= days) continue;
    seen.add(day);
    for (const [key, r] of Object.entries((usage || {})[day] || {})) {
      const [provider, model, kind, k = 'main'] = key.split('|');
      const t = (out[`${provider}|${model}|${kind}|${k}`] ||= { provider, model, kind, key: k, req: 0, fail: 0, rl: 0, tin: 0, tout: 0 });
      for (const f of FIELDS) t[f] += r[f] || 0;
    }
  }
  return Object.values(out).sort((a, b) => b.req - a.req);
}

/** Requests made today per model (and key: main | backup), all kinds together. */
export function usedToday(usage, model, key = 'main', now = new Date()) {
  return summarize(usage, 1, now).filter((r) => r.model === model && r.key === key).reduce((a, r) => a + r.req, 0);
}

// Daily request limits of Google's free tier, as a starting point for the "running low" warning.
// Google changes these: limits from its own rate-limit replies, and limits typed in settings, win.
export const GEMINI_FREE_LIMITS = [[/flash-lite/, 1000], [/flash/, 250], [/pro/, 100]];
export function limitFor(model, { learned = {}, typed = {} } = {}) {
  if (typed[model]) return { limit: typed[model], source: 'typed' };
  if (learned[model]) return { limit: learned[model], source: 'learned' };
  const hit = /^gemini/.test(model || '') && GEMINI_FREE_LIMITS.find(([re]) => re.test(model));
  return hit ? { limit: hit[1], source: 'assumed' } : null;
}
/** "model=number" per line. */
export function parseLimits(text) {
  const out = {};
  for (const line of String(text || '').split(/\n/)) {
    const m = line.match(/^\s*([\w.:\/-]+)\s*[=:]\s*(\d+)\s*$/);
    if (m) out[m[1]] = Number(m[2]);
  }
  return out;
}

/** "limit: 20, model: gemini-2.5-flash" appears in Gemini quota errors. */
export function learnLimit(text) {
  const s = String(text || '');
  const limit = Number((s.match(/limit:\s*(\d+)/i) || [])[1]);
  const model = (s.match(/model:\s*([\w.-]+)/i) || [])[1];
  return limit && model ? { model, limit } : null;
}

/**
 * Model + key pairs used today at 80% or more of their daily limit, for the panel warning.
 * limits: { learned, typed } (see limitFor).
 */
export function nearLimit(usage, limits = {}, now = new Date()) {
  const hits = [];
  const pairs = new Set(summarize(usage, 1, now).map((r) => `${r.model}|${r.key}`));
  for (const pair of pairs) {
    const [model, key] = pair.split('|');
    const l = limitFor(model, limits);
    if (!l) continue;
    const used = usedToday(usage, model, key, now);
    if (used >= Math.ceil(l.limit * 0.8)) hits.push({ model, key, used, limit: l.limit, source: l.source, out: used >= l.limit });
  }
  return hits;
}

// Rough list prices in USD per million tokens (input, output), first match wins. Used only for the
// "cost if paid" estimate; the user can override any model in settings.
const PRICE_TABLE = [
  [/gemini.*flash-lite/, 0.1, 0.4], [/gemini.*flash/, 0.3, 2.5], [/gemini.*pro/, 1.25, 10],
  [/claude.*haiku/, 1, 5], [/claude.*sonnet/, 3, 15], [/claude.*opus/, 5, 25],
  [/gpt-4o-mini/, 0.15, 0.6], [/gpt-4o/, 2.5, 10], [/gpt-4\.1-nano/, 0.1, 0.4], [/gpt-4\.1-mini/, 0.4, 1.6], [/gpt-4\.1/, 2, 8],
  [/gpt-5.*nano/, 0.05, 0.4], [/gpt-5.*mini/, 0.25, 2], [/gpt-5/, 1.25, 10]
];

/** "model=in,out" per line, USD per million tokens. */
export function parsePrices(text) {
  const out = {};
  for (const line of String(text || '').split(/\n/)) {
    const m = line.match(/^\s*([\w.:/-]+)\s*[=:]\s*([\d.]+)\s*,\s*([\d.]+)\s*$/);
    if (m) out[m[1]] = { in: Number(m[2]), out: Number(m[3]) };
  }
  return out;
}

export function priceFor(row, own = {}) {
  if (row.provider === 'compatible') return own[row.model] ? { ...own[row.model], assumed: false } : { in: 0, out: 0, assumed: false, free: true };
  if (own[row.model]) return { ...own[row.model], assumed: false };
  const hit = PRICE_TABLE.find(([re]) => re.test(row.model || ''));
  return hit ? { in: hit[1], out: hit[2], assumed: true } : null;
}

/** USD for one summarized row, or null when no price is known. */
export function rowCost(row, own = {}) {
  const p = priceFor(row, own);
  if (!p) return null;
  return { usd: (row.tin / 1e6) * p.in + (row.tout / 1e6) * p.out, assumed: p.assumed };
}

export const DEFAULT_USD_INR = 88;
export function rupees(usd, usdInr = DEFAULT_USD_INR) {
  const v = usd * (Number(usdInr) > 0 ? Number(usdInr) : DEFAULT_USD_INR);
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: v < 100 ? 2 : 0, maximumFractionDigits: v < 100 ? 2 : 0 })}`;
}

/** When the daily quota resets: midnight Pacific, as milliseconds. */
export function nextQuotaReset(now = Date.now()) {
  const today = dayKey(new Date(now));
  for (let t = now + 60000; t < now + 26 * 3600000; t += 60000) if (dayKey(new Date(t)) !== today) return t;
  return now + 12 * 3600000;
}

/** "12:30 pm IST", with the weekday when it is not today in India. */
export function istClock(ms, now = Date.now()) {
  const f = (opts) => new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', ...opts });
  const time = f({ hour: 'numeric', minute: '2-digit', hour12: true }).format(ms).replace(/\s?([ap])m/i, (m, c) => ` ${c.toLowerCase()}m`);
  const day = { year: 'numeric', month: '2-digit', day: '2-digit' };
  return `${f(day).format(ms) === f(day).format(now) ? '' : `${f({ weekday: 'short' }).format(ms)} `}${time} IST`;
}

// ---------- storage (any extension page) ----------
// Writes are chained so two calls in quick succession never lose a count.
let chain = Promise.resolve();
export function recordUsage(e) {
  if (typeof chrome === 'undefined' || !chrome.storage) return Promise.resolve();
  chain = chain.then(async () => {
    const { usage, learnedLimits = {} } = await chrome.storage.local.get(['usage', 'learnedLimits']);
    const set = { usage: addEntry(usage, e) };
    if (e.learned) set.learnedLimits = { ...learnedLimits, [e.learned.model]: e.learned.limit };
    await chrome.storage.local.set(set);
  }).catch(() => {});
  return chain;
}
