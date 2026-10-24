// Full-panel markup editor: Box, Arrow, Hide (real black pixels), Undo.
import { esc, icon } from '../lib/ui.js';
import { loadImage } from '../lib/env.js';

const MARK = '#FF6A2B';
const NAMES = { box: 'Box', arrow: 'Arrow', hide: 'Hidden area' };
const HINTS = {
  box: 'Drag to draw a box around the problem. Drag a mark to move it; Delete removes the selected mark.',
  arrow: 'Drag from where the arrow starts to the thing it points at.',
  hide: 'Drag over personal data such as ID numbers. It is blacked out in the saved image, not just covered.'
};

function drawMarks(ctx, marks, sw, selected = -1, k = 1) {
  const order = [...marks.keys()].sort((a, b) => (marks[a].type === 'hide') - (marks[b].type === 'hide'));
  for (const i of order) {
    const m = marks[i];
    const x = Math.min(m.x1, m.x2), y = Math.min(m.y1, m.y2), w = Math.abs(m.x2 - m.x1), h = Math.abs(m.y2 - m.y1);
    if (m.type === 'hide') { ctx.fillStyle = '#000'; ctx.fillRect(x, y, w, h); }
    else if (m.type === 'box') { ctx.strokeStyle = MARK; ctx.lineWidth = sw; ctx.lineJoin = 'round'; ctx.strokeRect(x, y, w, h); }
    else if (m.type === 'arrow') {
      const ang = Math.atan2(m.y2 - m.y1, m.x2 - m.x1), head = sw * 4.5;
      ctx.strokeStyle = MARK; ctx.lineWidth = sw; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(m.x1, m.y1); ctx.lineTo(m.x2, m.y2);
      ctx.moveTo(m.x2 - head * Math.cos(ang - 0.45), m.y2 - head * Math.sin(ang - 0.45)); ctx.lineTo(m.x2, m.y2);
      ctx.lineTo(m.x2 - head * Math.cos(ang + 0.45), m.y2 - head * Math.sin(ang + 0.45));
      ctx.stroke();
    }
    if (i === selected) {
      const hs = 7 / k;
      ctx.fillStyle = '#fff'; ctx.strokeStyle = MARK; ctx.lineWidth = 1.5 / k;
      const pts = m.type === 'arrow' ? [[m.x1, m.y1], [m.x2, m.y2]] : [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
      for (const [px, py] of pts) { ctx.fillRect(px - hs / 2, py - hs / 2, hs, hs); ctx.strokeRect(px - hs / 2, py - hs / 2, hs, hs); }
    }
  }
}

/** Render a flattened PNG from the original image plus marks. */
export async function flatten(original, marks) {
  const img = await loadImage(original);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0);
  drawMarks(ctx, marks, strokeFor(img.naturalWidth));
  return c.toDataURL('image/png');
}
const strokeFor = (w) => Math.max(3, Math.round(w / 420));

export async function openMarkup(shot, index, total, { onApply, onCancel }) {
  const host = document.getElementById('overlay');
  const original = shot.original || shot.dataUrl;
  const img = await loadImage(original);
  const W = img.naturalWidth, H = img.naturalHeight, SW = strokeFor(W);
  let marks = JSON.parse(JSON.stringify(shot.marks || []));
  let tool = 'box', selected = marks.length ? marks.length - 1 : -1;
  const undo = [];
  const prevFocus = document.activeElement;

  host.innerHTML = `
  <div class="mk-wrap" role="dialog" aria-modal="true" aria-label="Mark up screenshot ${index + 1} of ${total}">
    <div class="mk-bar"><span class="h2">Mark up screenshot ${index + 1} of ${total}</span><span class="grow"></span><span class="hint">Esc cancels</span></div>
    <div class="mk-bar" role="toolbar" aria-label="Markup tools" style="padding:0 8px">
      <button type="button" class="tool" data-tool="box" aria-pressed="true">${icon.box}Box <span class="k">B</span></button>
      <button type="button" class="tool" data-tool="arrow" aria-pressed="false">${icon.arrow}Arrow <span class="k">A</span></button>
      <button type="button" class="tool" data-tool="hide" aria-pressed="false">${icon.hide}Hide <span class="k">H</span></button>
      <span class="vsep"></span>
      <button type="button" class="ib" data-mk="undo" aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)">${icon.undo}</button>
    </div>
    <div class="mk-stage" id="mk-stage">
      <canvas id="mk-canvas" tabindex="0" role="img" aria-label="Screenshot. Use the tools to draw on it."></canvas>
      <div class="hint" id="mk-hint" aria-live="polite" style="text-align:center;max-width:340px"></div>
    </div>
    <div class="mk-list" id="mk-list"></div>
    <div class="mk-foot">
      <button type="button" class="btn b-sec" data-mk="cancel">Cancel</button>
      <button type="button" class="btn b-pri" data-mk="apply">Apply <span class="kbd">Enter</span></button>
    </div>
  </div>`;
  const wrap = host.firstElementChild;
  const canvas = wrap.querySelector('#mk-canvas');
  const stage = wrap.querySelector('#mk-stage');
  const ctx = canvas.getContext('2d');
  let k = 1, dpr = Math.min(2, devicePixelRatio || 1);

  function layout() {
    const maxW = stage.clientWidth - 32, maxH = stage.clientHeight - 60;
    k = Math.min(maxW / W, maxH / H, 1.5);
    const dw = Math.max(1, Math.round(W * k)), dh = Math.max(1, Math.round(H * k));
    canvas.style.width = dw + 'px'; canvas.style.height = dh + 'px';
    canvas.width = Math.round(dw * dpr); canvas.height = Math.round(dh * dpr);
    draw();
  }
  function draw() {
    ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(img, 0, 0);
    drawMarks(ctx, marks, SW, selected, k);
  }
  function list() {
    const el = wrap.querySelector('#mk-list');
    if (!marks.length) { el.innerHTML = '<div class="hint" style="padding:6px 0">No marks yet.</div>'; return; }
    const counts = {};
    el.innerHTML = `<div class="lbl" style="margin-bottom:2px">Marks · ${marks.length}</div>` + marks.map((m, i) => {
      counts[m.type] = (counts[m.type] || 0) + 1;
      const name = `${NAMES[m.type]} ${counts[m.type]}`;
      return `<div class="mk-row" ${i === selected ? 'aria-current="true"' : ''}>
        <span aria-hidden="true" style="color:${m.type === 'hide' ? 'var(--ink)' : MARK}">${icon[m.type]}</span>
        <button type="button" class="sel" data-sel="${i}">${esc(name)}${i === selected ? ' <span class="hint">selected</span>' : ''}</button>
        <button type="button" class="ib" data-del="${i}" aria-label="Delete ${esc(name)}">${icon.x}</button></div>`;
    }).join('');
  }
  function setTool(t) {
    tool = t;
    wrap.querySelectorAll('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === t)));
    wrap.querySelector('#mk-hint').textContent = HINTS[t];
  }
  const snapshot = () => { undo.push(JSON.stringify(marks)); if (undo.length > 50) undo.shift(); };
  const refresh = () => { draw(); list(); };

  // pointer interaction
  const toImg = (e) => { const r = canvas.getBoundingClientRect(); return { x: Math.max(0, Math.min(W, (e.clientX - r.left) / k)), y: Math.max(0, Math.min(H, (e.clientY - r.top) / k)) }; };
  function hit(p) {
    const tol = 8 / k;
    for (let i = marks.length - 1; i >= 0; i--) {
      const m = marks[i];
      if (m.type === 'arrow') {
        const dx = m.x2 - m.x1, dy = m.y2 - m.y1, L = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p.x - m.x1) * dx + (p.y - m.y1) * dy) / L));
        if (Math.hypot(p.x - (m.x1 + t * dx), p.y - (m.y1 + t * dy)) < tol) return i;
      } else {
        const x = Math.min(m.x1, m.x2), y = Math.min(m.y1, m.y2), w = Math.abs(m.x2 - m.x1), h = Math.abs(m.y2 - m.y1);
        const inside = p.x >= x - tol && p.x <= x + w + tol && p.y >= y - tol && p.y <= y + h + tol;
        const nearEdge = inside && (p.x <= x + tol || p.x >= x + w - tol || p.y <= y + tol || p.y >= y + h - tol);
        if (m.type === 'hide' ? inside : nearEdge) return i;
      }
    }
    return -1;
  }
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = toImg(e); const h = hit(p);
    snapshot();
    if (h >= 0) { selected = h; drag = { mode: 'move', p, orig: { ...marks[h] } }; }
    else { marks.push({ type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y }); selected = marks.length - 1; drag = { mode: 'new' }; }
    refresh();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag) { canvas.style.cursor = hit(toImg(e)) >= 0 ? 'move' : 'crosshair'; return; }
    const p = toImg(e), m = marks[selected];
    if (drag.mode === 'new') { m.x2 = p.x; m.y2 = p.y; }
    else { const dx = p.x - drag.p.x, dy = p.y - drag.p.y; Object.assign(m, { x1: drag.orig.x1 + dx, x2: drag.orig.x2 + dx, y1: drag.orig.y1 + dy, y2: drag.orig.y2 + dy }); }
    draw();
  });
  const end = () => {
    if (!drag) return;
    const m = marks[selected];
    if (drag.mode === 'new' && Math.hypot(m.x2 - m.x1, m.y2 - m.y1) * k < 6) { marks.pop(); selected = marks.length - 1; undo.pop(); }
    else if (drag.mode === 'move' && m.x1 === drag.orig.x1 && m.y1 === drag.orig.y1) undo.pop();
    drag = null; refresh();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  async function apply() {
    const dataUrl = marks.length ? await flatten(original, marks) : original;
    close();
    onApply({ dataUrl, marks, original });
  }
  function close() {
    document.removeEventListener('keydown', onKey, true);
    removeEventListener('resize', layout);
    host.innerHTML = '';
    if (prevFocus && prevFocus.focus) prevFocus.focus();
  }
  function onKey(e) {
    if (e.key === 'Escape') { e.preventDefault(); close(); onCancel && onCancel(); return; }
    if (e.key === 'Enter' && !e.target.closest('.mk-row')) { e.preventDefault(); apply(); return; }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (undo.length) { marks = JSON.parse(undo.pop()); selected = Math.min(selected, marks.length - 1); refresh(); } return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === 'b') setTool('box'); else if (key === 'a') setTool('arrow'); else if (key === 'h') setTool('hide');
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selected >= 0) { e.preventDefault(); snapshot(); marks.splice(selected, 1); selected = marks.length - 1; refresh(); }
    else if (e.key.startsWith('Arrow') && selected >= 0 && document.activeElement === canvas) {
      e.preventDefault(); snapshot();
      const d = (e.shiftKey ? 10 : 1) / k, m = marks[selected];
      const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
      m.x1 += dx; m.x2 += dx; m.y1 += dy; m.y2 += dy; draw();
    }
  }
  wrap.addEventListener('click', (e) => {
    const t = e.target.closest('button'); if (!t) return;
    if (t.dataset.tool) setTool(t.dataset.tool);
    else if (t.dataset.mk === 'undo') { if (undo.length) { marks = JSON.parse(undo.pop()); selected = Math.min(selected, marks.length - 1); refresh(); } }
    else if (t.dataset.mk === 'cancel') { close(); onCancel && onCancel(); }
    else if (t.dataset.mk === 'apply') apply();
    else if (t.dataset.sel) { selected = Number(t.dataset.sel); refresh(); canvas.focus(); }
    else if (t.dataset.del) { snapshot(); marks.splice(Number(t.dataset.del), 1); selected = marks.length - 1; refresh(); }
  });
  document.addEventListener('keydown', onKey, true);
  addEventListener('resize', layout);
  setTool('box');
  requestAnimationFrame(() => { layout(); list(); canvas.focus(); });
}
