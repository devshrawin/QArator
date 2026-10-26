// AI provider calls. Each provider gets the same input (system prompt, user
// text, images as data URLs) and returns plain text. Errors are AIError with a
// `kind` the panel turns into a plain-language message and a next step.

export class AIError extends Error {
  constructor(kind, message, { status = 0, detail = '', retryAfter = 0 } = {}) {
    super(message);
    this.kind = kind; // nokey | auth | ratelimit | network | timeout | provider | model | parse | cancelled | nobase
    this.status = status;
    this.detail = detail;
    this.retryAfter = retryAfter;
  }
}

import { recordUsage, learnLimit, nextQuotaReset } from './usage.js';

const TIMEOUT_MS = 60000;
export const AUTO = 'auto';

function trimBase(u) { return String(u || '').trim().replace(/\/+$/, ''); }

function splitDataUrl(dataUrl) {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl || '');
  if (!m) throw new AIError('provider', 'A screenshot could not be read.');
  return { mime: m[1], data: m[2] };
}

async function request(url, init, signal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort('timeout'), TIMEOUT_MS);
  const onAbort = () => ctrl.abort('cancelled');
  if (signal) { if (signal.aborted) onAbort(); else signal.addEventListener('abort', onAbort, { once: true }); }
  let res, text;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal });
    text = await res.text();
  } catch (e) {
    clearTimeout(timer);
    if (ctrl.signal.reason === 'cancelled') throw new AIError('cancelled', 'Cancelled.');
    if (ctrl.signal.reason === 'timeout') throw new AIError('timeout', 'The AI provider took too long to answer.', { detail: `No answer after ${TIMEOUT_MS / 1000} s` });
    throw new AIError('network', 'Could not reach the AI provider.', { detail: String(e && e.message || e) });
  }
  clearTimeout(timer);
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
  if (!res.ok) throw toError(res, body, text);
  return body;
}

function toError(res, body, text) {
  const status = res.status;
  const msg = (body && (body.error?.message || body.error?.status || body.message)) || text.slice(0, 300) || res.statusText;
  // Gemini puts a number in error.code and the useful word (INVALID_ARGUMENT, RESOURCE_EXHAUSTED) in error.status
  const type = body && (body.error?.type || body.error?.status || (typeof body.error?.code === 'string' ? body.error.code : '') || body.type) || '';
  const reqId = res.headers.get('request-id') || res.headers.get('x-request-id') || '';
  // Gemini names the exhausted quota (…PerDay…, …PerMinute…) only in error.details.
  const quotas = [...new Set((body?.error?.details || []).flatMap((d) => d.violations || []).map((v) => v.quotaId).filter(Boolean))];
  const detail = `HTTP ${status}${type ? ' · ' + type : ''}${reqId ? ' · request id ' + reqId : ''}\n${msg}${quotas.length ? `\nQuota: ${quotas.join(', ')}` : ''}`;
  // Gemini answers a bad key with 400 INVALID_ARGUMENT, not 401.
  if (status === 401 || status === 403 || /API.?key (not valid|expired|invalid)|API_KEY_INVALID|invalid.?api.?key|PERMISSION_DENIED|UNAUTHENTICATED/i.test(type + ' ' + msg)) return new AIError('auth', 'Your AI key was rejected.', { status, detail });
  if (status === 429 || status === 529 || /overloaded|rate.?limit|quota|RESOURCE_EXHAUSTED/i.test(type + ' ' + msg)) {
    const ra = Number(res.headers.get('retry-after')) || 0;
    return new AIError('ratelimit', status === 529 || /overloaded/i.test(type + msg) ? 'Your AI provider is overloaded right now.' : 'Your AI provider is rate-limiting requests.', { status, detail, retryAfter: ra > 0 ? Math.min(ra, 300) : 30 });
  }
  // a 404 is about the model only when it says so; otherwise the address is wrong (e.g. a compatible endpoint without /v1)
  if ((status === 404 || status === 400) && /model/i.test(type + ' ' + msg)) return new AIError('model', 'The selected model was not found for this key.', { status, detail });
  if (status >= 500) return new AIError('server', 'Your AI provider had a problem on its side.', { status, detail });
  return new AIError('provider', 'Your AI provider returned an error.', { status, detail });
}

function check(ai) {
  if (ai.provider !== 'compatible' && !String(ai.apiKey || '').trim()) throw new AIError('nokey', 'Add an AI key in settings.');
  if (ai.provider === 'compatible' && !trimBase(ai.baseUrl)) throw new AIError('nobase', 'Add your endpoint address in settings.');
}

// ---------- model lists ----------

export async function listModels(ai) {
  check(ai);
  const key = String(ai.apiKey || '').trim();
  if (ai.provider === 'anthropic') {
    const body = await request('https://api.anthropic.com/v1/models?limit=100', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }
    });
    return (body.data || []).filter((m) => !/claude-(2|instant)/.test(m.id)).map((m) => ({ id: m.id, label: m.display_name || m.id }));
  }
  if (ai.provider === 'openai' || ai.provider === 'compatible') {
    const base = ai.provider === 'openai' ? 'https://api.openai.com/v1' : trimBase(ai.baseUrl);
    const headers = key ? { Authorization: `Bearer ${key}` } : {};
    const body = await request(`${base}/models`, { headers });
    let ids = (body.data || body.models || []).map((m) => m.id || m.name).filter(Boolean);
    if (ai.provider === 'openai') {
      ids = ids.filter((id) => /^(gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-5|o3|o4|chatgpt-4o)/.test(id) && !/(audio|realtime|transcribe|tts|search|embedding|image|mini-tts|codex)/.test(id));
    }
    return ids.sort().map((id) => ({ id, label: id }));
  }
  if (ai.provider === 'gemini') {
    const body = await request('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': key } });
    return (body.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/.test(m.name) && !NOT_FOR_REPORTS.test(m.name))
      .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name }));
  }
  throw new AIError('provider', 'Unknown provider.');
}

// ---------- generation ----------

/**
 * One request to one model. Counts it in the usage tally (kind: write | rewrite).
 * @param ai settings.ai
 * @param {{system:string, text:string, images:string[], json?:boolean, maxTokens?:number, kind?:string}} req
 */
export async function generate(ai, req, signal) {
  check(ai);
  if (!ai.model || ai.model === AUTO) throw new AIError('model', 'Choose a model in settings.');
  const entry = { provider: ai.provider, model: ai.model, kind: req.kind || 'write', key: ai.keyTag || 'main' };
  try {
    const { text, tin, tout } = await generateOnce(ai, req, signal);
    recordUsage({ ...entry, tin, tout });
    return text;
  } catch (e) {
    if (e.kind !== 'cancelled' && e.kind !== 'nokey' && e.kind !== 'nobase') {
      recordUsage({ ...entry, fail: true, rl: e.kind === 'ratelimit', learned: e.kind === 'ratelimit' ? learnLimit(e.detail) : null });
    }
    throw e;
  }
}

async function generateOnce(ai, req, signal) {
  const key = String(ai.apiKey || '').trim();
  const images = (req.images || []).map(splitDataUrl);

  if (ai.provider === 'anthropic') {
    const content = [];
    images.forEach((im, i) => {
      content.push({ type: 'text', text: `Screenshot ${i + 1}:` });
      content.push({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.data } });
    });
    content.push({ type: 'text', text: req.text });
    const body = await request('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: ai.model, max_tokens: req.maxTokens || 4096, system: req.system, messages: [{ role: 'user', content }] })
    }, signal);
    return { text: (body.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n'), tin: body.usage?.input_tokens || 0, tout: body.usage?.output_tokens || 0 };
  }

  if (ai.provider === 'openai' || ai.provider === 'compatible') {
    const base = ai.provider === 'openai' ? 'https://api.openai.com/v1' : trimBase(ai.baseUrl);
    const content = [{ type: 'text', text: req.text }];
    (req.images || []).forEach((url) => content.push({ type: 'image_url', image_url: { url } }));
    const payload = { model: ai.model, messages: [{ role: 'system', content: req.system }, { role: 'user', content }] };
    if (req.json && ai.provider === 'openai') payload.response_format = { type: 'json_object' };
    const headers = { 'content-type': 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;
    const body = await request(`${base}/chat/completions`, { method: 'POST', headers, body: JSON.stringify(payload) }, signal);
    const msg = body.choices && body.choices[0] && body.choices[0].message;
    if (!msg) throw new AIError('provider', 'The AI provider returned an empty answer.');
    const text = typeof msg.content === 'string' ? msg.content : (msg.content || []).map((c) => c.text || '').join('');
    return { text, tin: body.usage?.prompt_tokens || 0, tout: body.usage?.completion_tokens || 0 };
  }

  if (ai.provider === 'gemini') {
    const parts = [];
    images.forEach((im) => parts.push({ inline_data: { mime_type: im.mime, data: im.data } }));
    parts.push({ text: req.text });
    const payload = { systemInstruction: { parts: [{ text: req.system }] }, contents: [{ role: 'user', parts }] };
    if (req.json) payload.generationConfig = { responseMimeType: 'application/json' };
    const body = await request(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(ai.model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(payload)
    }, signal);
    const cand = body.candidates && body.candidates[0];
    if (!cand) throw new AIError('provider', 'The AI provider returned an empty answer.', { detail: JSON.stringify(body.promptFeedback || {}) });
    const u = body.usageMetadata || {};
    return { text: (cand.content?.parts || []).map((p) => p.text || '').join(''), tin: u.promptTokenCount || 0, tout: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) };
  }
  throw new AIError('provider', 'Unknown provider.');
}

// ---------- automatic model choice and fallback ----------

const NOT_FOR_REPORTS = /(tts|image|embed|aqa|live|audio|transcribe|whisper|rerank|moderation|computer-use|robotics|gemma|learnlm|veo|imagen|nano)/i;
const version = (id) => {
  const nums = String(id).replace(/\d{8}/g, '').match(/\d+/g) || [];
  return Number(nums[0] || 0) + Number(nums[1] || 0) / 100;
};

/** Model ids in the order Auto tries them: the everyday image-capable model first, bigger or smaller ones after. */
export function rankModels(provider, models) {
  const ids = [...new Set((models || []).map((m) => (typeof m === 'string' ? m : m.id)).filter(Boolean))];
  if (provider === 'compatible') return ids.filter((id) => !NOT_FOR_REPORTS.test(id) || /vision|vl/i.test(id));
  const usable = ids.filter((id) => !NOT_FOR_REPORTS.test(id));
  const family = (id) => {
    if (provider === 'gemini') return /flash-lite/.test(id) ? 1 : /flash/.test(id) ? 0 : /pro/.test(id) ? 2 : 3;
    if (provider === 'anthropic') return /sonnet/.test(id) ? 0 : /haiku/.test(id) ? 1 : /opus/.test(id) ? 2 : 3;
    return /^gpt-5/.test(id) ? 0 : /^gpt-4\.1/.test(id) ? 1 : /^(gpt-4o|chatgpt-4o)/.test(id) ? 2 : 3;
  };
  const unstable = (id) => (/(preview|exp|latest)/i.test(id) ? 1 : 0);
  const small = (id) => (provider === 'openai' && /(mini|nano)/.test(id) ? 1 : 0);
  return usable.sort((a, b) => family(a) - family(b) || unstable(a) - unstable(b) || small(a) - small(b) || version(b) - version(a) || a.localeCompare(b));
}

async function store(key) { try { return (await chrome.storage.local.get(key))[key]; } catch (e) { return undefined; } }
async function put(obj) { try { await chrome.storage.local.set(obj); } catch (e) { /* ignore */ } }

/** The provider's model list, cached for a day per provider. */
export async function cachedModels(ai) {
  const cache = (await store('modelCache')) || {};
  const id = `${ai.provider}|${trimBase(ai.baseUrl)}`;
  const hit = cache[id];
  if (hit && Date.now() - hit.at < 86400000 && hit.models.length) return hit.models;
  const models = await listModels(ai);
  await put({ modelCache: { ...cache, [id]: { at: Date.now(), models } } });
  return models;
}

/** When a model that just failed may be tried again. Daily quotas reset at midnight Pacific. */
export function cooldownUntil(e, now = Date.now()) {
  if (e.kind === 'model') return now + 24 * 3600000;
  if (e.kind === 'server' || e.kind === 'timeout') return now + 60 * 1000;
  if (/PerDay|per day|daily/i.test(e.detail || '')) return nextQuotaReset(now);
  const hinted = Number((String(e.detail || '').match(/retry in\s*([\d.]+)\s*s/i) || [])[1]) || e.retryAfter || 30;
  return now + Math.min(15 * 60, Math.max(20, hinted + 2)) * 1000;
}

export async function cooldowns() {
  const all = (await store('modelCooldown')) || {};
  return Object.fromEntries(Object.entries(all).filter(([, until]) => until > Date.now()));
}
// chained so a background write and a foreground write never overwrite each other's entries
let coolChain = Promise.resolve();
function coolDown(slot, until) {
  coolChain = coolChain.then(async () => put({ modelCooldown: { ...(await cooldowns()), [slot]: until } })).catch(() => {});
  return coolChain;
}

/** The models one write will try, in order: Auto's ranking, or the chosen model then the ranking as backup. */
export async function modelChain(ai) {
  const auto = !ai.model || ai.model === AUTO;
  if (!auto && ai.fallback === false) return [ai.model];
  let ranked;
  try { ranked = rankModels(ai.provider, ai.models && ai.models.length ? ai.models : await cachedModels(ai)); }
  catch (e) { if (auto) throw e; ranked = []; }
  if (auto && !ranked.length) throw new AIError('model', 'No suitable model was found for this key.');
  return [...new Set(auto ? ranked : [ai.model, ...ranked])].slice(0, 5);
}

/**
 * Write with automatic model choice: skips models that are resting after a rate limit or that used up
 * a known daily limit, and moves on to the next model when one is rate-limited or missing.
 * Returns { text, model }.
 */
// A cooldown belongs to one model on one key: "gemini-2.5-flash@main:k3f9a1". The short fingerprint (not the key)
// means a newly pasted key starts fresh instead of inheriting the old key's rest.
const fingerprint = (k) => { let h = 5381; for (const c of String(k || '')) h = ((h * 33) ^ c.charCodeAt(0)) >>> 0; return h.toString(36).slice(0, 6); };
export const slotName = (model, tag, apiKey) => `${model}@${tag}:${fingerprint(apiKey)}`;
export const parseSlot = (name) => { const m = /^(.*)@(main|backup):/.exec(name); return m ? { model: m[1], tag: m[2] } : { model: name, tag: 'main' }; };

export async function generateAuto(ai, req, signal, { limits = {}, used = () => 0 } = {}) {
  check(ai);
  const chain = await modelChain(ai);
  const cool = await cooldowns();
  const keys = [{ tag: 'main', apiKey: ai.apiKey }];
  if (String(ai.apiKey2 || '').trim() && ai.apiKey2 !== ai.apiKey) keys.push({ tag: 'backup', apiKey: String(ai.apiKey2).trim() });
  // per model: main key, then backup key (free quota is per model and per Google project), then the next model
  // limits here are the ones the tester typed ("model=N", or "model@backup=N" for the backup key only)
  const limitOf = (s) => limits[`${s.model}@${s.tag}`] || limits[s.model] || 0;
  const all = chain.flatMap((model) => keys.map((k) => ({ model, ...k, name: slotName(model, k.tag, k.apiKey) })));
  const slots = all.filter((s) => !cool[s.name] && !(limitOf(s) && used(s.model, s.tag) >= limitOf(s)));
  if (!slots.length) {
    const resting = all.filter((s) => cool[s.name]);
    const soonest = resting.length ? Math.min(...resting.map((s) => cool[s.name])) : nextQuotaReset();
    throw new AIError('ratelimit', resting.length ? 'Every model is resting after a rate limit.' : 'The daily limits you set are used up.', {
      detail: `${resting.length ? 'Resting' : 'Daily limit reached'}: ${chain.join(', ')}${keys.length > 1 ? ' (main and backup key)' : ''}`,
      retryAfter: Math.max(5, Math.min(300, Math.ceil((soonest - Date.now()) / 1000)))
    });
  }
  let last, mainDead = false;
  for (const s of slots) {
    if (mainDead && s.tag === 'main') continue;
    try {
      return { text: await generate({ ...ai, model: s.model, apiKey: s.apiKey, keyTag: s.tag }, req, signal), model: s.model, key: s.tag };
    } catch (e) {
      // a rejected main key can still be saved by the backup key (and is not retried for the other models)
      if (e.kind === 'auth' && s.tag === 'main' && keys.length > 1) { last = e; mainDead = true; continue; }
      if (e.kind !== 'ratelimit' && e.kind !== 'model' && e.kind !== 'server' && e.kind !== 'timeout') throw e;
      await coolDown(s.name, cooldownUntil(e));
      last = e;
    }
  }
  throw last;
}

/** Pull the first JSON object out of a model answer (handles code fences and chatter). */
export function parseJson(text) {
  const t = String(text || '').trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t);
  const candidates = [fenced && fenced[1], t, t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1)].filter(Boolean);
  for (const c of candidates) {
    try { const v = JSON.parse(c); if (v && typeof v === 'object') return v; } catch (e) { /* next */ }
  }
  throw new AIError('parse', 'The AI answer was not in the expected format.', { detail: t.slice(0, 500) });
}

/** Plain-language message and next step for an error. */
export function describeError(e) {
  const kind = e && e.kind || 'provider';
  switch (kind) {
    case 'nokey': return { title: 'Add an AI key to write reports', body: 'QArator sends your screenshot and note to the AI provider you choose. Add a key once in settings; it stays in this browser.', action: 'settings' };
    case 'nobase': return { title: 'Add your endpoint address', body: 'An OpenAI-compatible provider needs its base address, for example https://your-server/v1. Add it in settings.', action: 'settings' };
    case 'auth': return { title: 'Your AI key was rejected', body: 'Check the key in settings, or create a new one with your provider, then try again.', action: 'settings' };
    case 'ratelimit': return { title: 'Your AI provider is busy', body: 'It returned a rate limit. Try again in a moment, or pick a different model in settings. If this keeps happening, check your plan\'s limits with the provider.', action: 'retry' };
    case 'server': return { title: 'Your AI provider had a problem', body: 'Its servers returned an error. Try again in a minute.', action: 'retry' };
    case 'timeout': return { title: 'The AI provider is not answering', body: 'No reply came back in time. QArator already tried the other models. Try again in a minute, or check your connection or VPN.', action: 'retry' };
    case 'network': return { title: 'Could not reach the AI provider', body: 'Check your connection or VPN, then try again.', action: 'retry' };
    case 'model': return { title: 'The model is not available', body: 'Open settings, press Check key and load models, and pick a model from the list.', action: 'settings' };
    case 'parse': return { title: 'The AI answer was not usable', body: 'Try again. If it keeps happening, pick a larger model in settings.', action: 'retry' };
    default: return { title: 'Your AI provider returned an error', body: 'Try again. If it keeps failing, open the error details and check the model and key in settings.', action: 'retry' };
  }
}
