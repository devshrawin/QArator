// Browser/OS detection and image helpers.

export async function detectEnv() {
  const uad = navigator.userAgentData;
  let browser = 'Chrome', os = '';
  try {
    if (uad) {
      const hi = await uad.getHighEntropyValues(['platformVersion', 'fullVersionList']);
      const list = hi.fullVersionList || uad.brands || [];
      const pick = list.find((b) => /Edge/.test(b.brand)) || list.find((b) => /Google Chrome/.test(b.brand)) || list.find((b) => /Chromium/.test(b.brand)) || list[0];
      if (pick) browser = `${pick.brand.replace('Google ', '').replace('Microsoft ', '')} ${String(pick.version).split('.')[0]}`;
      const pv = parseInt(String(hi.platformVersion || '0').split('.')[0], 10);
      if (uad.platform === 'Windows') os = pv >= 13 ? 'Windows 11' : 'Windows 10';
      else if (uad.platform === 'macOS') os = `macOS ${String(hi.platformVersion || '').split('.').slice(0, 2).join('.')}`.trim();
      else os = uad.platform || '';
    }
  } catch (e) { /* fall back */ }
  if (!os) {
    const ua = navigator.userAgent;
    os = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : '';
    const m = /Chrome\/(\d+)/.exec(ua); if (m && browser === 'Chrome') browser = `Chrome ${m[1]}`;
  }
  return { browser, os };
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image could not be loaded'));
    img.src = src;
  });
}

export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

/** Shrink for the AI: long edge ≤ 1568 px, JPEG. Keeps text readable and requests small. */
export async function forAi(dataUrl, maxEdge = 1568) {
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return c.toDataURL('image/jpeg', 0.85);
}

export async function thumb(dataUrl, w = 360) {
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, w / img.naturalWidth);
  const c = document.createElement('canvas');
  c.width = Math.round(img.naturalWidth * scale); c.height = Math.round(img.naturalHeight * scale);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}
