// Combobox — a text input with a searchable dropdown of known values.
//
// Ported from icelandicstore #194, #264, #269, #351, #398 (ice@941cf51d,
// harvest 2 lane 4a, 2026-09-26) — the file as ice ships it, plus the engine
// deltas marked below (per-instance option ids + aria-controls, rows cleared on
// hide, detach restores the input); its CSS lives in public/css/admin-kit.css
// (tokens only). Engine users: AdminExpensesView
// (supplier), PartyAdminView (task assignee), AdminRolesView (member search,
// async source).
//
// Replaces the native <datalist>, which looked right in the DOM but was useless
// in practice: no visible affordance that suggestions exist, and when the field
// already holds a value the browser filters the list against it, so focusing an
// existing product showed an empty dropdown.
//
// Deliberately still a free-text input — a genuinely new type or vendor must
// stay typeable. The list suggests, it does not constrain.
//
// Matching is case-insensitive substring, with prefix matches ranked first, so
// "key" finds "Keychain" and "chain" does too.
//
// Usage:  const detach = attachCombobox(inputEl, () => ['Keychain', 'Mug']);
//
// Values may be plain strings, or { value, label } objects when the visible text
// is not the thing being chosen — a product picker shows "Blank T-Shirt — BLK-1"
// but must hand back a product id.
//
// getValues is ALWAYS called with the current query string, and may return either
// an array or a PROMISE of one — so a source that has to hit the server (searching
// a 260-product catalogue) gets the same listbox, arrow keys and aria-activedescendant
// as a local array, instead of each caller hand-rolling a bare div of buttons with
// no roles at all. A local source simply ignores the argument and filtering stays
// synchronous; pass { debounceMs, minQuery } when the source is remote.
//
// onPick(item) fires with the chosen entry — the only way to see the `value` of
// an object entry, since the input itself shows the label.
//
// An object entry may also carry `meta` — a quiet right-hand note on its row
// ("Umboðssala · 3 verslanir" beside a company name). It is display only: typing
// never matches it and it never lands in the input.
//
// An object entry may also carry `keywords` — extra text typing MATCHES but
// that is never shown (a company found by one of its store names or addresses).
// A keyword-only hit ranks after every label match.

function _esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Visible text of an entry (string entries are their own label). */
export function labelOf(v) { return (v && typeof v === 'object') ? String(v.label ?? v.value ?? '') : String(v); }

/** The quiet right-hand note of an object entry, or '' (strings have none). */
export function metaOf(v) { return (v && typeof v === 'object' && v.meta) ? String(v.meta) : ''; }

/** Hidden match text of an object entry (`keywords`: string or string[]), lowercased. */
export function keywordsOf(v) {
  if (!v || typeof v !== 'object' || !v.keywords) return '';
  // Joined with a separator no query contains, so a match never spans two keywords.
  return (Array.isArray(v.keywords) ? v.keywords : [v.keywords]).filter(Boolean).join(' | ').toLowerCase();
}

/** Rank: prefix matches first, then substring, then keyword-only hits — each in input order. */
export function rank(values, query) {
  const q = query.trim().toLowerCase();
  if (!q) return values.slice();
  const starts = [];
  const contains = [];
  const byKeyword = [];
  for (const v of values) {
    const lower = labelOf(v).toLowerCase();
    const at = lower.indexOf(q);
    if (at === 0) starts.push(v);
    else if (at > 0) contains.push(v);
    else if (keywordsOf(v).includes(q)) byKeyword.push(v);
  }
  return starts.concat(contains, byKeyword);
}

/** Bold the matched run so the reason a row is listed is visible. */
export function highlight(value, query) {
  const q = query.trim();
  if (!q) return _esc(value);
  const at = String(value).toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return _esc(value);
  const s = String(value);
  return _esc(s.slice(0, at)) + '<mark>' + _esc(s.slice(at, at + q.length)) + '</mark>' + _esc(s.slice(at + q.length));
}

/**
 * One <li> of the listbox. A row with `meta` wraps its label so the two can sit
 * at opposite ends; a plain row keeps the bare text it always had (wrapping it
 * would turn the label and its <mark> into separate flex items).
 */
export function optionHtml(v, i, query, idPrefix = 'cb-opt') {
  const label = highlight(labelOf(v), query);
  const meta = metaOf(v);
  if (!meta) return `<li class="combobox__opt" role="option" id="${idPrefix}-${i}" data-i="${i}">${label}</li>`;
  return `<li class="combobox__opt combobox__opt--meta" role="option" id="${idPrefix}-${i}" data-i="${i}">`
    + `<span class="combobox__label">${label}</span><span class="combobox__meta">${_esc(meta)}</span></li>`;
}

// Engine delta (harvest 2 lane 4a review, not yet in ice): option ids are
// unique PER INSTANCE. ice rendered `cb-opt-<i>` in every combobox, so a page
// with several (the party assignee inputs) carried duplicate ids and
// aria-activedescendant could resolve to a row of another, hidden list.
let _instances = 0;

export function attachCombobox(input, getValues, { max = 100, onPick = null, debounceMs = 0, minQuery = 0 } = {}) {
  if (!input || input.dataset.combobox === 'on') return () => {};
  input.dataset.combobox = 'on';

  const wrap = document.createElement('div');
  wrap.className = 'combobox';
  input.parentNode.insertBefore(wrap, input);
  wrap.appendChild(input);

  const list = document.createElement('ul');
  list.className = 'combobox__list';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  const uid = `cb${(_instances += 1)}`;
  list.id = `${uid}-list`;
  wrap.appendChild(list);

  // Attributes this attach adds, so detach() can take back exactly these.
  const hadAutocomplete = input.getAttribute('autocomplete');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'false');
  input.setAttribute('aria-controls', list.id);
  input.setAttribute('autocomplete', 'off');

  let items = [];
  let active = -1;
  // Generation counter — the same "did something newer happen while this was in
  // flight" guard AdminInventoryView/AdminAnalyticsView/AdminBooksView already use.
  // An async source resolves after an await, by which time the user may have typed
  // again, picked a row or closed the list; each of those bumps `gen`, and a stale
  // resolution then paints nothing.
  let gen = 0;
  let timer = null;

  // Hide WITHOUT bumping the generation: close() is the deliberate gesture and owns
  // the bump. items is emptied so a stale data-i can never index a live array.
  const hide = () => {
    list.hidden = true;
    // Engine delta: the rows go too, so no stale option id outlives the list
    // and aria-activedescendant cannot point into it.
    list.innerHTML = '';
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    active = -1;
    items = [];
  };

  const close = () => { gen += 1; clearTimeout(timer); hide(); };

  // Synchronous and atomic: items and the <li data-i> list are built from the same
  // array with nothing awaited between them, so a click or Enter can never resolve
  // against a different array than the one on screen.
  const render = (all, query) => {
    items = rank(all || [], query).slice(0, max);
    if (!items.length) { hide(); return; }
    list.innerHTML = items.map((v, i) => optionHtml(v, i, query, `${uid}-opt`)).join('');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    active = -1;
  };

  const paint = (query) => {
    clearTimeout(timer);
    const mine = (gen += 1);
    if (minQuery && String(query == null ? '' : query).trim().length < minQuery) { hide(); return; }

    const run = () => {
      if (mine !== gen) return undefined;
      const src = typeof getValues === 'function' ? getValues(query) : getValues;
      // Sync fast path — a plain array source paints in this same tick, so a local
      // combobox behaves exactly as it did before this component learned to await.
      if (!src || typeof src.then !== 'function') { render(src, query); return undefined; }
      return src.then(
        (all) => { if (mine === gen) render(all, query); },
        ()    => { if (mine === gen) hide(); }
      );
    };

    if (!debounceMs) return run();
    return new Promise((resolve) => { timer = setTimeout(() => resolve(run()), debounceMs); });
  };

  const setActive = (i) => {
    // A debounced paint can resolve after a supersede or a close; without this the
    // ArrowDown handler below would mark is-active on a hidden row and leave a
    // dangling aria-activedescendant.
    if (list.hidden) return;
    const opts = [...list.querySelectorAll('.combobox__opt')];
    opts.forEach(o => o.classList.remove('is-active'));
    if (i < 0 || i >= opts.length) { active = -1; input.removeAttribute('aria-activedescendant'); return; }
    active = i;
    opts[i].classList.add('is-active');
    opts[i].scrollIntoView({ block: 'nearest' });
    input.setAttribute('aria-activedescendant', opts[i].id);
  };

  const choose = (i) => {
    if (i < 0 || i >= items.length) return;
    // The input shows the LABEL; onPick is how a caller learns the underlying
    // value when entries are objects (a product picker needs the id, not the name).
    input.value = labelOf(items[i]);
    if (onPick) onPick(items[i]);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    close();
  };

  // Focus shows the FULL list regardless of the current value — the whole point
  // is to see what already exists without having to clear the field first.
  const onFocus = () => paint('');
  const onInput = () => paint(input.value);

  const onKeydown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      // paint() runs to completion synchronously for a plain array source, but
      // an async source resolves later — so highlight only once it has painted.
      if (list.hidden) { Promise.resolve(paint(input.value)).then(() => setActive(0)); return; }
      const next = e.key === 'ArrowDown'
        ? Math.min(active + 1, items.length - 1)
        : Math.max(active - 1, 0);
      setActive(next);
    } else if (e.key === 'Enter') {
      if (!list.hidden && active >= 0) { e.preventDefault(); choose(active); }
    } else if (e.key === 'Escape') {
      // Close even when the list is ALREADY hidden: with a debounced remote source
      // a search may still be in flight, and Escape has to cancel it rather than
      // let the results pop the list open a second later. Only swallow the key
      // when something was actually showing, so Escape still reaches an enclosing
      // dialog when the dropdown is closed.
      if (!list.hidden) e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      close();
    }
  };

  // mousedown, not click: blur would close the list before click landed.
  const onMousedown = (e) => {
    const li = e.target.closest('.combobox__opt');
    if (!li) return;
    e.preventDefault();
    choose(Number(li.dataset.i));
  };

  const onDocDown = (e) => { if (!wrap.contains(e.target)) close(); };

  input.addEventListener('focus', onFocus);
  input.addEventListener('input', onInput);
  input.addEventListener('keydown', onKeydown);
  list.addEventListener('mousedown', onMousedown);
  document.addEventListener('mousedown', onDocDown);

  return function detach() {
    // Cancel a queued fetch and invalidate anything already in flight, so nothing
    // paints into a list that is about to be removed from the DOM.
    gen += 1;
    clearTimeout(timer);
    input.removeEventListener('focus', onFocus);
    input.removeEventListener('input', onInput);
    input.removeEventListener('keydown', onKeydown);
    list.removeEventListener('mousedown', onMousedown);
    document.removeEventListener('mousedown', onDocDown);
    delete input.dataset.combobox;
    list.remove();
    // Engine delta: hand the input back as it was found — out of the wrapper
    // and without the combobox attributes — so a later attach does not nest.
    wrap.replaceWith(input);
    for (const a of ['role', 'aria-autocomplete', 'aria-expanded', 'aria-controls', 'aria-activedescendant']) {
      input.removeAttribute(a);
    }
    if (hadAutocomplete === null) input.removeAttribute('autocomplete');
    else input.setAttribute('autocomplete', hadAutocomplete);
  };
}
