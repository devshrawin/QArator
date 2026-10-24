// AI provider calls. Each provider gets the same input (system prompt, user
// text, images as data URLs) and returns plain text. Errors are AIError with a
// `kind` the panel turns into a plain-language message and a next step.

export class AIError extends Error {
  constructor(kind, message, { status = 0, detail = '', retryAfter = 0 } = {}) {
    super(message);
    this.kind = kind; // nokey | auth | ratelimit | network | provider | model | parse | cancelled | nobase
    this.status = status;
    this.detail = detail;
    this.retryAfter = retryAfter;
  }
}

const TIMEOUT_MS = 120000;

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
  let res;
  try {
    res = await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    clearTimeout(timer);
    if (ctrl.signal.reason === 'cancelled') throw new AIError('cancelled', 'Cancelled.');
    if (ctrl.signal.reason === 'timeout') throw new AIError('network', 'The AI provider took too long to answer.', { detail: 'Timed out after 120 s' });
    throw new AIError('network', 'Could not reach the AI provider.', { detail: String(e && e.message || e) });
  }
  clearTimeout(timer);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
  if (!res.ok) throw toError(res, body, text);
  return body;
}

function toError(res, body, text) {
  const status = res.status;
  const msg = (body && (body.error?.message || body.error?.status || body.message)) || text.slice(0, 300) || res.statusText;
  const type = body && (body.error?.type || body.error?.code || body.type) || '';
  const reqId = res.headers.get('request-id') || res.headers.get('x-request-id') || '';
  const detail = `HTTP ${status}${type ? ' · ' + type : ''}${reqId ? ' · request id ' + reqId : ''}\n${msg}`;
  // Gemini answers a bad key with 400 INVALID_ARGUMENT, not 401.
  if (status === 401 || status === 403 || /API.?key not valid|API_KEY_INVALID|invalid.?api.?key/i.test(type + ' ' + msg)) return new AIError('auth', 'Your AI key was rejected.', { status, detail });
  if (status === 429 || status === 529 || /overloaded|rate.?limit|quota|RESOURCE_EXHAUSTED/i.test(type + ' ' + msg)) {
    const ra = Number(res.headers.get('retry-after')) || 0;
    return new AIError('ratelimit', status === 529 || /overloaded/i.test(type + msg) ? 'Your AI provider is overloaded right now.' : 'Your AI provider is rate-limiting requests.', { status, detail, retryAfter: ra > 0 ? Math.min(ra, 300) : 30 });
  }
  if (status === 404 || /model/i.test(type) && status === 400) return new AIError('model', 'The selected model was not found for this key.', { status, detail });
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
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/.test(m.name) && !/(embedding|tts|image-generation|aqa)/.test(m.name))
      .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name }));
  }
  throw new AIError('provider', 'Unknown provider.');
}

// ---------- generation ----------

/**
 * @param ai settings.ai
 * @param {{system:string, text:string, images:string[], json?:boolean, maxTokens?:number}} req
 */
export async function generate(ai, req, signal) {
  check(ai);
  if (!ai.model) throw new AIError('model', 'Choose a model in settings.');
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
    return (body.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
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
    return typeof msg.content === 'string' ? msg.content : (msg.content || []).map((c) => c.text || '').join('');
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
    return (cand.content?.parts || []).map((p) => p.text || '').join('');
  }
  throw new AIError('provider', 'Unknown provider.');
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
    case 'network': return { title: 'Could not reach the AI provider', body: 'Check your connection or VPN, then try again.', action: 'retry' };
    case 'model': return { title: 'The model is not available', body: 'Open settings, press Check key and load models, and pick a model from the list.', action: 'settings' };
    case 'parse': return { title: 'The AI answer was not usable', body: 'Try again. If it keeps happening, pick a larger model in settings.', action: 'retry' };
    default: return { title: 'Your AI provider returned an error', body: 'Try again. If it keeps failing, open the error details and check the model and key in settings.', action: 'retry' };
  }
}
