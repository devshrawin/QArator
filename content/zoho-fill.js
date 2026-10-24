// Injected into the Zoho Projects tab on demand. Finds fields by their visible
// labels (configurable in settings), fills them, and reports per field what
// was filled and what needs a manual check. It never presses Submit.
(() => {
  if (window.__qaratorFill) return;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const norm = (s) => String(s || '').replace(/[*:：]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
  const loose = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    if (el.tagName === 'INPUT' && el.type === 'file') return true;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
  };
  const ownText = (el) => {
    let t = '';
    el.childNodes.forEach((n) => { if (n.nodeType === 3) t += n.textContent; });
    t = t.trim();
    return t || (el.children.length <= 1 ? (el.innerText || '').trim() : '');
  };

  const CONTROL = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file]):not([type=submit]):not([type=button]), textarea, select, [contenteditable=""], [contenteditable=true], iframe, [role=combobox], [role=listbox], [aria-haspopup=listbox], [aria-haspopup=true]';

  function labelMatches(text, labels) {
    const t = norm(text);
    if (!t || t.length > 60) return 0;
    let best = 0;
    for (const l of labels) {
      const n = norm(l);
      if (!n) continue;
      if (t === n) best = Math.max(best, 3);
      else if (t.startsWith(n) && t.length - n.length < 12) best = Math.max(best, 2);
    }
    return best;
  }

  function controlLabelText(c) {
    const parts = [];
    if (c.labels) c.labels.forEach((l) => parts.push(l.innerText));
    if (c.getAttribute('aria-label')) parts.push(c.getAttribute('aria-label'));
    const lb = c.getAttribute('aria-labelledby');
    if (lb) lb.split(/\s+/).forEach((id) => { const e = document.getElementById(id); if (e) parts.push(e.innerText); });
    if (c.getAttribute('placeholder')) parts.push(c.getAttribute('placeholder'));
    if (c.getAttribute('title')) parts.push(c.getAttribute('title'));
    if (c.name) parts.push(c.name.replace(/[_-]+/g, ' '));
    return parts;
  }

  // Zoho Projects renders fields as Lyte components: <ruc-field> wrapping
  // ruc-input / ruc-textarea / ruc-editor (iframe) / ruc-select (custom list
  // with a hidden one-option <select>). Match on the component's rc-label.
  function lyteControl(labels, used) {
    let best = null, bestScore = 0;
    for (const f of document.querySelectorAll('ruc-field')) {
      if (!visible(f)) continue;
      const comp = f.querySelector('ruc-input, ruc-textarea, ruc-editor, ruc-select');
      if (!comp) continue;
      const texts = [comp.getAttribute('rc-label'), f.querySelector('ruc-label label')?.innerText];
      const score = Math.max(0, ...texts.map((t) => labelMatches(t, labels)));
      if (!score || score <= bestScore) continue;
      const tag = comp.tagName.toLowerCase();
      const c = tag === 'ruc-input' ? comp.querySelector('input')
        : tag === 'ruc-textarea' ? comp.querySelector('textarea')
        : tag === 'ruc-editor' ? comp.querySelector('iframe')
        : comp.querySelector('.zselectbox, .ztokenfield__textbox, [aria-haspopup=listbox]');
      if (c && !used.has(c)) { best = c; bestScore = score; }
    }
    return best;
  }

  async function waitFor(fn, ms = 2000) {
    const end = Date.now() + ms;
    while (Date.now() < end) { const v = fn(); if (v) return v; await sleep(80); }
    return null;
  }

  // Rows of a dropdown that are real options (not the loader or a "No results" line).
  const optionRows = (box) => [...(box?.querySelectorAll('li') || [])].filter((li) => !/loader|noresult|no-result/i.test(li.className) && visible(li) && li.innerText.trim() && !/^(no (results|matches) found|loading)/i.test(li.innerText.trim()));
  // Scroll a lazily loaded list until no new rows come in. complete: the end was reached, so the list is whole.
  async function readWholeList(list, items, find) {
    let seen = [...new Set(items().map((li) => li.innerText.trim()))], hit = null, complete = false;
    for (let round = 0; round < 15; round++) {
      const body = list()?.querySelector('.zdropdownlist__body, ul');
      if (!body) { complete = seen.length < 10; break; }
      const before = seen.length;
      body.scrollTop = body.scrollHeight;
      body.dispatchEvent(new Event('scroll', { bubbles: true }));
      await sleep(350);
      hit = hit || find();
      seen = [...new Set([...seen, ...items().map((li) => li.innerText.trim())])];
      if (seen.length === before) { complete = true; break; }
      if (hit) break;
    }
    return { hit, seen: seen.slice(0, 200), complete };
  }

  // Zoho dropdown: open it, find the item in its own listbox (aria-owns), use the search box if needed.
  async function pickZoho(box, value, looseMatch) {
    const host = box.closest('ruc-select') || box.parentElement;
    const shown = () => (host.querySelector('.zselectbox__selected')?.innerText || '').trim();
    const same = (a, b) => looseMatch ? loose(a) === loose(b) : a.trim() === b.trim();
    if (same(shown(), value)) return { ok: true };
    const listId = box.getAttribute('aria-owns');
    const list = () => (listId && document.getElementById(listId)) || host.querySelector('.zdropdownlist');
    const items = () => optionRows(list());
    const find = () => items().find((li) => same(li.innerText, value));
    box.scrollIntoView({ block: 'center' });
    click(box); box.focus();
    let hit = await waitFor(find, 1500);
    // Zoho shows the first 10 options and loads the rest as the list scrolls: scroll until nothing new arrives.
    const read = await readWholeList(list, items, find);
    hit = hit || read.hit;
    const seenAll = read.seen, complete = read.complete;
    if (!hit) {
      const search = list()?.querySelector('input.zdropdownlist__searchfield, input[type=text]');
      if (search) {
        setNativeValue(search, value);
        search.dispatchEvent(new KeyboardEvent('keyup', { key: value.slice(-1) || 'a', bubbles: true }));
        hit = await waitFor(find, 3000);
      }
    }
    if (!hit) {
      document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
      return { ok: false, options: seenAll, all: complete && seenAll.length > 0 };
    }
    hit.scrollIntoView({ block: 'nearest' });
    hit.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    click(hit);
    await sleep(250);
    return same(shown(), value) ? { ok: true } : { ok: false, options: [], unsure: true };
  }

  // Zoho token field (multi-select such as Device Type): type, pick from the menu, a chip appears.
  async function pickToken(input, value, looseMatch) {
    const host = input.closest('ruc-select') || input.closest('.ztokenfield') || input.parentElement;
    const tokenText = () => [...host.querySelectorAll('.ztokenfield__token, [class*="token__text"], [class*="tokenfield__token"]')].map((t) => t.innerText.trim());
    const same = (a, b) => looseMatch ? loose(a) === loose(b) : a.trim() === b.trim();
    if (tokenText().some((t) => same(t, value))) return { ok: true };
    const menuId = input.getAttribute('aria-owns');
    const menu = () => (menuId && document.getElementById(menuId)) || host.querySelector('.zdropdownlist');
    const items = () => optionRows(menu());
    const find = () => items().find((li) => same(li.innerText, value));
    input.scrollIntoView({ block: 'center' });
    click(input); input.focus();
    let hit = await waitFor(find, 1200);
    // read the whole menu first (it loads more as it scrolls), then fall back to typing into the box
    const read = await readWholeList(menu, items, find);
    hit = hit || read.hit;
    const seenAll = read.seen, complete = read.complete;
    if (!hit) { setNativeValue(input, value); input.dispatchEvent(new KeyboardEvent('keyup', { key: value.slice(-1) || 'a', bubbles: true })); hit = await waitFor(find, 2500); }
    if (!hit) {
      setNativeValue(input, '');
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
      return { ok: false, options: seenAll, all: complete && seenAll.length > 0 };
    }
    click(hit);
    await sleep(250);
    const ok = tokenText().some((t) => same(t, value));
    return ok ? { ok: true } : { ok: false, options: [], unsure: true };
  }

  // Zoho tag box: type the name, pick the matching suggestion. Never creates a new tag.
  async function zohoTags(tags) {
    const input = document.querySelector('#addBugTag input.inputcatsearch, [data-zpqa="tag_input_tagsearch"]');
    if (!input) return null;
    const holder = input.closest('#addBugTag') || input.parentElement;
    holder.setAttribute('data-qarator-field', 'Tags');
    // compare whole tag names: "ui" must not count as present because a chip says "UR - Build"
    const chipSet = () => new Set([...(holder.querySelector('.associatedTags')?.children || [])].map((c) => loose(c.innerText)).filter(Boolean));
    const has = (t) => chipSet().has(loose(t));
    const out = []; const failed = [];
    for (const t of tags) {
      if (has(t)) continue;
      input.focus();
      setNativeValue(input, t);
      input.dispatchEvent(new KeyboardEvent('keyup', { key: t.slice(-1), bubbles: true }));
      const list = () => document.querySelector('[id^="tag_suggestion_list"]');
      const hit = await waitFor(() => [...(list()?.querySelectorAll('*') || [])].find((el) => el.children.length === 0 && visible(el) && loose(el.innerText) === loose(t)), 2500);
      if (hit) { click(hit.closest('li, [class*="tag"], div') || hit); await sleep(350); }
      if (!has(t)) { failed.push(t); setNativeValue(input, ''); }
    }
    const ok = tags.length - failed.length;
    if (ok) out.push({ field: 'Tags', status: 'filled', value: `${ok} of ${tags.length} added` });
    failed.forEach((t) => out.push({ field: 'Tags', status: 'check', value: t, reason: `“${t}” wasn’t found in Zoho’s tag list. Create it in Zoho, or untick it and fill again.` }));
    return out;
  }

  /** Find the control for a field label list. Zoho components first, then label text, then attributes. */
  function findControl(labels, used) {
    const z = lyteControl(labels, used);
    if (z) return z;
    const scored = [];
    // 1) visible text that equals the label, then the next control after it nearby
    const textEls = document.querySelectorAll('label, span, div, td, th, p, legend, dt, strong, b, h3, h4');
    for (const el of textEls) {
      if (!visible(el)) continue;
      const score = labelMatches(ownText(el), labels);
      if (!score) continue;
      let anc = el;
      for (let lvl = 0; lvl < 5 && anc; lvl++, anc = anc.parentElement) {
        const ctrls = [...anc.querySelectorAll(CONTROL)].filter((c) => !el.contains(c) && !used.has(c) && (visible(c) || c.tagName === 'SELECT') &&
          (el.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING));
        if (el.tagName === 'LABEL' && el.htmlFor) {
          const f = document.getElementById(el.htmlFor);
          if (f && !used.has(f)) { scored.push({ c: f, s: score * 10 + 9 }); break; }
        }
        if (ctrls.length) { scored.push({ c: ctrls[0], s: score * 10 + (5 - lvl) }); break; }
      }
    }
    // 2) controls whose own label attributes match
    for (const c of document.querySelectorAll(CONTROL)) {
      if (used.has(c) || !(visible(c) || c.tagName === 'SELECT')) continue;
      const s = Math.max(0, ...controlLabelText(c).map((t) => labelMatches(t, labels)));
      if (s) scored.push({ c, s: s * 10 });
    }
    scored.sort((a, b) => b.s - a.s);
    return scored.length ? scored[0].c : null;
  }

  function setNativeValue(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  function editableOf(c) {
    if (c.tagName === 'IFRAME') {
      try { const d = c.contentDocument; if (d && d.body) return { el: d.body, doc: d }; } catch (e) { return null; }
      return null;
    }
    if (c.isContentEditable) return { el: c, doc: document };
    return null;
  }

  function currentValue(c) {
    if (c.classList && c.classList.contains('zselectbox')) return (c.querySelector('.zselectbox__selected')?.innerText || '').trim();
    const ed = editableOf(c);
    if (ed) return (ed.el.innerText || '').trim();
    if ('value' in c && c.tagName !== 'IFRAME') return String(c.value || '').trim();
    return (c.innerText || '').trim();
  }

  const isDropdown = (c) => c.tagName === 'SELECT' || c.getAttribute('role') === 'combobox' || c.getAttribute('role') === 'listbox' ||
    /listbox|true/.test(c.getAttribute('aria-haspopup') || '') || (c.tagName === 'INPUT' && c.readOnly) ||
    /select|dropdown|picker/i.test(c.className && c.className.baseVal === undefined ? c.className : '');

  function click(el) {
    const r = el.getBoundingClientRect();
    const opts = { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.dispatchEvent(new MouseEvent('click', opts));
  }

  function visibleOptions() {
    const sel = '[role=option], [role=menuitem], li, .option, [class*="option"], [class*="Option"], [class*="list-item"]';
    return [...document.querySelectorAll(sel)].filter((o) => visible(o) && (o.innerText || '').trim() && (o.innerText || '').trim().length < 80 && !o.querySelector(sel));
  }

  async function pickCustom(c, value, looseMatch) {
    const before = new Set(visibleOptions());
    click(c);
    await sleep(350);
    // type into a search box if the dropdown opened one
    const active = document.activeElement;
    if (active && active !== c && active.tagName === 'INPUT' && visible(active)) { setNativeValue(active, value); await sleep(400); }
    // only options that appeared when the control opened; never items already on the page (filters, menus)
    const opts = visibleOptions().filter((o) => !before.has(o));
    if (!opts.length) return { ok: false, options: [] };
    const want = looseMatch ? loose(value) : value;
    const hit = opts.find((o) => (looseMatch ? loose(o.innerText) : o.innerText.trim()) === want);
    if (hit) { hit.scrollIntoView({ block: 'nearest' }); click(hit); await sleep(200); return { ok: true }; }
    const list = [...new Set(opts.map((o) => o.innerText.trim()))].slice(0, 8);
    document.activeElement && document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return { ok: false, options: list };
  }

  async function fillField(f, opt, used) {
    const c = findControl(f.labels, used);
    if (!c) return { field: f.name, status: 'check', value: f.value, missing: true, reason: `Field not found. Check the label “${f.labels[0]}” in settings › Issue fields.` };
    used.add(c);
    c.setAttribute('data-qarator-field', f.name);
    if (opt.emptyOnly && currentValue(c) && !/^(none|select|--|-none-|choose)/i.test(currentValue(c))) {
      return { field: f.name, status: 'kept', value: currentValue(c), reason: 'Already had a value, left as it was' };
    }
    if (c.tagName === 'SELECT') {
      const options = [...c.options];
      const hit = options.find((o) => o.text.trim() === f.value) || (opt.looseMatch && options.find((o) => loose(o.text) === loose(f.value)));
      const offered = options.map((o) => o.text.trim()).filter((t) => t && !/^(-*none-*|select)$/i.test(t));
      if (!hit) return { field: f.name, status: 'check', value: f.value, options: offered, reason: `“${f.value}” is not in Zoho's list. Zoho offers ${offered.slice(0, 20).join(', ')}.` };
      setNativeValue(c, hit.value);
      return { field: f.name, status: 'filled', value: hit.text.trim() };
    }
    // a box that opens a list (token fields, autocompletes) is a dropdown even though it is an <input>
    const listy = c.classList.contains('ztokenfield__textbox') || c.getAttribute('aria-owns') || c.getAttribute('aria-autocomplete') || c.getAttribute('list') || c.getAttribute('aria-haspopup') || c.getAttribute('role') === 'combobox';
    const typable = (c.tagName === 'INPUT' && !c.readOnly && !listy) || c.tagName === 'TEXTAREA';
    if (isDropdown(c) || (f.kind === 'dropdown' && !typable)) {
      const r = c.classList.contains('zselectbox') ? await pickZoho(c, f.value, opt.looseMatch)
        : c.classList.contains('ztokenfield__textbox') ? await pickToken(c, f.value, opt.looseMatch)
        : await pickCustom(c, f.value, opt.looseMatch);
      if (r.unsure) return { field: f.name, status: 'check', value: f.value, reason: `Picked “${f.value}” but Zoho did not confirm it. Check the dropdown.` };
      if (r.ok) return { field: f.name, status: 'filled', value: f.value };
      return { field: f.name, status: 'check', value: f.value, options: r.all ? r.options : undefined,
        reason: r.options.length ? `“${f.value}” is not in Zoho's list. Zoho offers ${r.options.slice(0, 20).join(', ')}${r.options.length > 20 ? ` and ${r.options.length - 20} more` : ''}.` : `Couldn't open the list to pick “${f.value}”. Choose it by hand.` };
    }
    const ed = editableOf(c);
    if (ed) return fillRich(c, f) ;
    if (!typable) return { field: f.name, status: 'check', value: f.value, reason: "This field could not be filled automatically. Set it by hand." };
    setNativeValue(c, f.value);
    return { field: f.name, status: currentValue(c) ? 'filled' : 'check', value: f.value, reason: currentValue(c) ? '' : 'The field did not accept the text. Paste it by hand.' };
  }

  function fillRich(c, f) {
    const ed = editableOf(c);
    if (!ed) return { field: f.name, status: 'check', value: '', reason: 'The editor could not be reached. Use Copy description and paste it.' };
    ed.el.focus();
    try {
      const sel = ed.doc.getSelection();
      const range = ed.doc.createRange();
      range.selectNodeContents(ed.el);
      sel.removeAllRanges(); sel.addRange(range);
      const ok = ed.doc.execCommand('insertHTML', false, f.html);
      if (!ok) ed.el.innerHTML = f.html;
    } catch (e) { ed.el.innerHTML = f.html; }
    ed.el.dispatchEvent(new Event('input', { bubbles: true }));
    ed.el.dispatchEvent(new Event('change', { bubbles: true }));
    const got = (ed.el.innerText || '').trim().length > 0;
    return { field: f.name, status: got ? 'filled' : 'check', value: got ? `${f.sections} sections` : '', reason: got ? '' : 'The editor stayed empty. Use Copy description and paste it.' };
  }

  async function fillTags(conf, tags, used) {
    const res = [];
    if (!tags.length) return res;
    const z = await zohoTags(tags);
    if (z) return z;
    const c = findControl(conf.labels, used);
    if (!c) return [{ field: 'Tags', status: 'check', missing: true, value: tags.join(', '), reason: `Tags field not found. Add them by hand or check the label “${conf.labels[0]}” in settings.` }];
    used.add(c);
    c.setAttribute('data-qarator-field', 'Tags');
    const input = c.tagName === 'INPUT' || c.tagName === 'TEXTAREA' ? c : c.querySelector('input') || c;
    const box = c.closest('div') || c.parentElement;
    const failed = [];
    for (const t of tags) {
      if ('value' in input) setNativeValue(input, t); else { click(input); }
      await sleep(400);
      const opts = visibleOptions().filter((o) => loose(o.innerText) === loose(t));
      if (opts.length) click(opts[0]);
      else ['keydown', 'keypress', 'keyup'].forEach((type) => input.dispatchEvent(new KeyboardEvent(type, { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true })));
      await sleep(300);
      const accepted = (box && (box.innerText || '').toLowerCase().includes(t.toLowerCase())) && (!('value' in input) || !input.value);
      if (!accepted) failed.push(t);
    }
    const ok = tags.filter((t) => !failed.includes(t));
    if (ok.length) res.push({ field: 'Tags', status: 'filled', value: `${ok.length} of ${tags.length} added` });
    failed.forEach((t) => res.push({ field: 'Tags', status: 'check', value: t, reason: `“${t}” was not accepted. Create the tag in Zoho, or untick it in the report and fill again.` }));
    return res;
  }

  function dataUrlToFile(d, name) {
    const [head, b64] = d.split(',');
    const mime = /data:([^;]+)/.exec(head)[1];
    const bin = atob(b64); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new File([arr], name, { type: mime });
  }

  async function dropFiles(target, files) {
    const dt = new DataTransfer();
    files.forEach((f) => dt.items.add(dataUrlToFile(f.dataUrl, f.name)));
    for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
    await sleep(1500);
    const listed = files.filter((f) => document.body.innerText.includes(f.name)).length;
    target.setAttribute('data-qarator-field', 'Attachments');
    return listed
      ? [{ field: 'Attachments', status: listed === files.length ? 'filled' : 'check', value: `${listed} of ${files.length} attached`, reason: listed === files.length ? '' : 'Some files did not attach. Use Save files and drag the rest in.' }]
      : [{ field: 'Attachments', status: 'check', value: `${files.length} file${files.length > 1 ? 's' : ''}`, reason: 'Zoho did not confirm the upload. Use Save files and drag them onto the attachment area.' }];
  }

  async function fillAttachments(conf, files, anchor) {
    if (!files.length) return [];
    const all = [...document.querySelectorAll('input[type=file]')];
    if (!all.length) {
      const zone = document.querySelector('ruc-fileupload .attachment-bar, #add-form-attachment-bar, ruc-fileupload');
      if (zone) return dropFiles(zone, files);
      return [{ field: 'Attachments', status: 'check', missing: true, value: `${files.length} files`, reason: 'No attachment field found. Use Save files and attach them by hand.' }];
    }
    let input = null;
    // prefer the file input next to an "Attach" label, then one in the same form/dialog as the title
    for (const el of document.querySelectorAll('label, span, div, a, button')) {
      if (!visible(el) || !labelMatches(ownText(el), conf.labels)) continue;
      let anc = el;
      for (let i = 0; i < 5 && anc && !input; i++, anc = anc.parentElement) input = anc.querySelector('input[type=file]');
      if (input) break;
    }
    if (!input && anchor) {
      const scope = anchor.closest('form, [role=dialog], .modal, [class*="dialog"], [class*="popup"]');
      if (scope) input = scope.querySelector('input[type=file]');
    }
    if (!input) {
      const scope = anchor && anchor.closest('form, [role=dialog], .modal, [class*="dialog"], [class*="popup"], [class*="form"]');
      input = scope ? scope.querySelector('input[type=file]') : (all.length === 1 ? all[0] : null);
    }
    if (!input) return [{ field: 'Attachments', status: 'check', missing: true, value: `${files.length} files`, reason: 'No attachment field found in this form. Use Save files and attach them by hand.' }];
    try {
      const dt = new DataTransfer();
      files.forEach((f) => dt.items.add(dataUrlToFile(f.dataUrl, f.name)));
      if (!input.multiple && files.length > 1) {
        dt.items.clear(); dt.items.add(dataUrlToFile(files[0].dataUrl, files[0].name));
      }
      input.files = dt.files;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      input.setAttribute('data-qarator-field', 'Attachments');
      if (!input.multiple && files.length > 1) return [{ field: 'Attachments', status: 'check', value: `1 of ${files.length}`, reason: 'This form takes one file at a time. Attach the rest by hand (use Save files).' }];
      return [{ field: 'Attachments', status: 'filled', value: `${files.length} file${files.length > 1 ? 's' : ''} attached` }];
    } catch (e) {
      return [{ field: 'Attachments', status: 'check', value: '', reason: 'The attachment field did not accept files. Use Save files and attach them by hand.' }];
    }
  }

  function flash(el) {
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    const prev = el.style.outline, prevOff = el.style.outlineOffset;
    el.style.outline = '3px solid #FF6A2B'; el.style.outlineOffset = '2px';
    setTimeout(() => { el.style.outline = prev; el.style.outlineOffset = prevOff; }, 3000);
    try { el.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }

  window.__qaratorGoto = (name) => {
    const el = document.querySelector(`[data-qarator-field="${CSS.escape(name)}"]`);
    if (el) { flash(el); return true; }
    return false;
  };

  /** payload: {title, description, fields, tags, attachments, options} */
  // How well this frame matches the form: Zoho's own title field counts most. Used to fill only one frame.
  window.__qaratorProbe = (labels) => (lyteControl(labels, new Set()) ? 3 : findControl(labels, new Set()) ? 1 : 0) + (window === window.top ? 0.5 : 0);

  window.__qaratorFill = async (p) => {
    document.querySelectorAll('[data-qarator-field]').forEach((el) => el.removeAttribute('data-qarator-field'));
    const used = new Set();
    const opt = p.options || {};
    const titleCtrl = findControl(p.title.labels, new Set());
    if (!titleCtrl) {
      return { ok: false, reason: 'noform', frame: location.href };
    }
    const results = [];
    results.push(await fillField({ name: 'Title', labels: p.title.labels, value: p.title.value }, opt, used));
    const desc = findControl(p.description.labels, used);
    if (desc) {
      used.add(desc); desc.setAttribute('data-qarator-field', 'Description');
      if (opt.emptyOnly && currentValue(desc)) results.push({ field: 'Description', status: 'kept', reason: 'Already had text, left as it was' });
      else if (editableOf(desc)) results.push(fillRich(desc, { name: 'Description', html: p.description.html, sections: p.description.sections }));
      else if (desc.tagName === 'TEXTAREA' || desc.tagName === 'INPUT') { setNativeValue(desc, p.description.text); results.push({ field: 'Description', status: 'filled', value: `${p.description.sections} sections` }); }
      else results.push({ field: 'Description', status: 'check', value: '', reason: 'The description editor could not be reached. Use Copy description and paste it.' });
    } else {
      results.push({ field: 'Description', status: 'check', missing: true, value: '', reason: 'Description editor not found. Use Copy description and paste it.' });
    }
    for (const f of p.fields) {
      if (!f.value || /^unassigned$/i.test(f.value)) { results.push({ field: f.name, status: 'kept', value: f.value || '—', reason: 'Not changed in Zoho' }); continue; }
      results.push(await fillField({ ...f, kind: 'dropdown' }, opt, used));
    }
    results.push(...await fillTags(p.tags, p.tags.values, used));
    if (p.steps && p.steps.enabled && p.steps.text) {
      const sc = findControl(p.steps.labels, used);
      if (!sc || sc.tagName !== 'TEXTAREA' && sc.tagName !== 'INPUT') results.push({ field: 'Steps to Reproduce', status: 'check', missing: true, value: '', reason: 'Steps box not found on this form.' });
      else {
        used.add(sc); sc.setAttribute('data-qarator-field', 'Steps to Reproduce');
        const max = Number(sc.getAttribute('maxlength')) || 0;
        setNativeValue(sc, max ? p.steps.text.slice(0, max) : p.steps.text);
        results.push({ field: 'Steps to Reproduce', status: 'filled', value: max && p.steps.text.length > max ? `cut to ${max} characters` : 'steps added' });
      }
    }
    if (opt.uploadScreenshots) results.push(...await fillAttachments(p.attachments, p.attachments.files, titleCtrl));
    if (opt.scrollToFirst) {
      const first = results.find((r) => r.status === 'check' && !r.missing);
      if (first) window.__qaratorGoto(first.field); else flash(titleCtrl);
    }
    return { ok: true, results, frame: location.href };
  };
})();
