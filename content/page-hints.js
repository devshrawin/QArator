// Reads where the tester is in the site under test: breadcrumb, highlighted menu items, the selected
// tab and the main heading. The panel turns these into Module and Page for the title, so no URL rule
// is needed. Loaded before errors-bridge.js and also injected on demand; the last line is the result.
globalThis.__qaratorHints = globalThis.__qaratorHints || (() => {
  const clean = (t) => String(t || '').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).find(Boolean) || '';
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const ok = (t) => t && t.length <= 60 && /[a-z]/i.test(t);
  const uniq = (a) => a.filter((x, i) => ok(x) && a.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);
  const textOf = (els) => [...els].filter(shown).map((e) => clean(e.innerText || e.textContent));

  let crumbs = [];
  const bc = [...document.querySelectorAll('nav[aria-label*="breadcrumb" i], ol.breadcrumb, [class*="breadcrumb" i]')].find(shown);
  if (bc) {
    const items = bc.querySelectorAll('li, a, [class*="item" i]');
    crumbs = uniq(items.length ? textOf(items) : [clean(bc.innerText)]).filter((t) => !/^(home|homepage)$/i.test(t));
  }

  const NAV = 'nav, aside, [role="navigation"], [class*="sidebar" i], [class*="sidenav" i], [class*="side-nav" i], [class*="menu" i]';
  const ACTIVE = '[aria-current="page"], [aria-current="true"], .active, .is-active, .selected, .router-link-active, [class*="--active"], [class*="-activated"]';
  const nav = [];
  for (const box of document.querySelectorAll(NAV)) {
    if (!shown(box) || (bc && (box === bc || bc.contains(box) || box.contains(bc)))) continue;
    box.querySelectorAll('[aria-expanded="true"]').forEach((e) => shown(e) && nav.push(clean(e.innerText)));
    box.querySelectorAll(ACTIVE).forEach((e) => shown(e) && nav.push(clean(e.innerText)));
  }
  const tabEl = [...document.querySelectorAll('[role="tab"][aria-selected="true"], .nav-tabs .active, .mdc-tab--active, .ant-tabs-tab-active')].find(shown);
  const headEl = [...document.querySelectorAll('main h1, h1, main h2, h2')].find(shown);

  return {
    crumbs: crumbs.slice(-4),
    nav: uniq(nav).slice(0, 3),
    tab: tabEl ? clean(tabEl.innerText) : '',
    heading: headEl ? clean(headEl.innerText).slice(0, 80) : ''
  };
});
// loaded at document_start as a content script there is nothing to read yet; injected later it returns the hints
document.readyState === 'loading' ? null : globalThis.__qaratorHints();
