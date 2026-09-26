// AdminView — /admin, "Í dag" (the admin home; D-020 step 4, 2026-09-26).
//
// One read, GET /api/v1/admin/home (server/routes/adminHomeRoutes.js), in
// place of the seven card endpoints the company overview used to call. The
// SERVER decides what exists: a block whose view the role does not hold is
// absent from the answer, so nothing here hides anything — an absent key
// renders nothing, and an empty block is left out (the spec's rule: a line in
// the header, never an empty card). The client still checks canSeeView before
// it LINKS to a screen.
//
// Layout (public/css/admin-idag.css): Fyrstu skrefin across the top on a new
// instance; "Bíður þín" (the to-do list, the primary object) and "Nýjast" (the
// feed) in the wide column; "Staðan" (four figures, each in its own form) as a
// ruled rail beside them. Container queries, not media queries, decide the
// columns, because the content width depends on whether the sidebar is open.
//
// Words: every string is an adminHome.* key (DRÖG until Halli approves them).
// Icelandic names are only ever the subject, after a colon or in quotes, so
// they never need declining; counted strings go through plural().
//
// CSP: bar shares (the channel split, the ageing bar) are set with
// el.style.flexGrow after insertion — never a style="" attribute, which
// helmet's style-src (no 'unsafe-inline') would refuse.

import { isAuthenticated, canEdit, canSeeView } from '../services/auth.js';
import { escHtml }         from '../utils/escHtml.js';
import { formatNumber }    from '../utils/format.js';
import { t, href, plural, isSingular, getLocale } from '../i18n/i18n.js';
import { navigateReplace } from '../navigate.js';
import { renderAdminShell, ADMIN_NAV, adminIcon } from '../components/AdminSidebar.js';
import { isk } from './booksShared.js';

const TZ = 'Atlantic/Reykjavik';

// Chrome ships no Icelandic ICU data (utils/format.js), so the Icelandic
// weekday and month names are written out, like format.js does for months.
const IS_WEEKDAYS = ['sunnudagur', 'mánudagur', 'þriðjudagur', 'miðvikudagur', 'fimmtudagur', 'föstudagur', 'laugardagur'];
const IS_MONTHS = ['janúar', 'febrúar', 'mars', 'apríl', 'maí', 'júní', 'júlí', 'ágúst', 'september', 'október', 'nóvember', 'desember'];
const IS_MONTHS_SHORT = ['jan', 'feb', 'mar', 'apr', 'maí', 'jún', 'júl', 'ágú', 'sep', 'okt', 'nóv', 'des'];

const isIs = () => getLocale() === 'is';

// Calendar fields of an instant in Reykjavík (en-US is in every ICU build and
// only its digits are read).
function parts(value) {
  const d = value instanceof Date ? value : new Date(value);
  const p = {};
  new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  }).formatToParts(d).forEach((x) => { p[x.type] = Number(x.value); });
  p.hour %= 24;
  p.weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return p;
}
// A date-only 'YYYY-MM-DD' is a calendar day, not an instant: read it as is.
function dayParts(ymd) {
  const [y, m, d] = String(ymd).slice(0, 10).split('-').map(Number);
  return { year: y, month: m, day: d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}
const pad2 = n => String(n).padStart(2, '0');
const hhmm = v => { const p = parts(v); return `${pad2(p.hour)}:${pad2(p.minute)}`; };
const dayKey = v => { const p = parts(v); return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`; };

function enName(p, opts) {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...opts })
    .format(new Date(Date.UTC(p.year, p.month - 1, p.day)));
}
// "laugardagur 26. september" / "Saturday 26 September"
function longDate(p) {
  return isIs() ? `${IS_WEEKDAYS[p.weekday]} ${p.day}. ${IS_MONTHS[p.month - 1]}`
    : enName(p, { weekday: 'long', day: 'numeric', month: 'long' });
}
// "5. október" / "5 October"
function dayMonth(p) {
  return isIs() ? `${p.day}. ${IS_MONTHS[p.month - 1]}` : enName(p, { day: 'numeric', month: 'long' });
}
function monthName(m) {
  return isIs() ? IS_MONTHS[m - 1] : enName({ year: 2000, month: m, day: 1 }, { month: 'long' });
}
// A VSK period's months: "júlí–ágúst" / "July–August".
function monthRange(from, to) {
  const a = dayParts(from); const b = dayParts(to);
  return a.month === b.month ? monthName(a.month) : `${monthName(a.month)}–${monthName(b.month)}`;
}
const capitalise = s => s.charAt(0).toUpperCase() + s.slice(1);

// t() with some parameters as trusted HTML: the template and the plain
// parameters are escaped, the html ones are spliced in afterwards.
function tHtml(key, params = {}, html = {}) {
  const marks = {};
  Object.keys(html).forEach((k, i) => { marks[k] = `\u0001${i}\u0001`; });
  let out = escHtml(t(key, { ...params, ...marks }));
  Object.keys(html).forEach((k) => { out = out.split(marks[k]).join(html[k]); });
  return out;
}

// A counted string split at {n}, so the count can stand in the number column
// and the rest reads on as the title ("3" · "reikningar fram yfir gjalddaga").
function countedTitle(n, oneKey, manyKey) {
  const MARK = '\u0002';
  const s = t(isSingular(n) ? oneKey : manyKey, { n: MARK });
  return s.startsWith(MARK) ? s.slice(MARK.length).trim() : s.split(MARK).join(formatNumber(n));
}

const unit = () => (isIs() ? 'kr.' : 'ISK');
const link = (view, route) => (view && canSeeView(view) ? href(route) : null);
const iconFor = (view) => {
  for (const g of ADMIN_NAV) for (const it of g.items) if (it.id === view) return adminIcon(it.icon);
  return '';
};

// ── Bíður þín ────────────────────────────────────────────────────────────────
function vatDue(v) {
  const date = dayMonth(dayParts(v.dueOn ?? v.detail?.dueOn));
  const amount = Number(v.amount ?? v.payable) || 0;
  if (amount === 0) return t('adminHome.waiting.vat.nil', { date });
  if (amount < 0) return t('adminHome.waiting.vat.refund', { date, amount: isk(-amount) });
  return t('adminHome.waiting.vat.due', { date, amount: isk(amount) });
}
function inDays(n) {
  if (n <= 0) return t('adminHome.waiting.vat.today');
  if (n === 1) return t('adminHome.waiting.vat.tomorrow');
  return plural(n, 'adminHome.waiting.vat.inDays.one', 'adminHome.waiting.vat.inDays.many');
}

const TODO = {
  invoices_overdue: (i) => ({
    title: countedTitle(i.count, 'adminHome.waiting.overdue.one', 'adminHome.waiting.overdue.many'),
    tag: t('adminHome.waiting.tag.overdue'),
    detail: [
      t('adminHome.waiting.overdue.sum', { amount: isk(i.amount) }),
      i.detail?.oldestParty ? plural(i.detail.oldestDays, 'adminHome.waiting.overdue.oldest.one',
        'adminHome.waiting.overdue.oldest.many', { customer: i.detail.oldestParty }) : '',
    ],
    go: t('adminHome.waiting.overdue.action'),
  }),
  vat_deadline: (i) => ({
    title: vatDue({ dueOn: i.detail.dueOn, amount: i.amount }),
    tag: inDays(i.detail.daysLeft),
    detail: [t('adminHome.waiting.vat.period', { period: `${monthRange(i.detail.from, i.detail.to)} (${i.detail.period})` })],
    go: t('adminHome.waiting.vat.action'),
  }),
  orders_to_ship: (i) => ({
    title: countedTitle(i.count, 'adminHome.waiting.toShip.one', 'adminHome.waiting.toShip.many'),
    detail: [i.detail?.oldestAt ? t('adminHome.figures.openOrders.oldest', {
      date: `${dayMonth(parts(i.detail.oldestAt))} ${hhmm(i.detail.oldestAt)}`,
    }) : ''],
    go: t('adminHome.waiting.toShip.action'),
  }),
  leads_new: (i) => ({
    title: countedTitle(i.count, 'adminHome.waiting.enquiries.one', 'adminHome.waiting.enquiries.many'),
    detail: [i.detail?.latest ? t('adminHome.waiting.latest', { title: i.detail.latest }) : ''],
    go: t('adminHome.waiting.enquiries.action'),
  }),
  change_requests_open: (i) => ({
    title: countedTitle(i.count, 'adminHome.waiting.crOpen.one', 'adminHome.waiting.crOpen.many'),
    detail: [i.detail?.latest ? t('adminHome.waiting.latest', { title: i.detail.latest }) : ''],
    go: t('adminHome.waiting.changeRequests.action'),
  }),
  bins_unshelved: (i) => {
    const sample = (i.detail?.sample || []);
    const more = i.count - sample.length;
    return {
      title: countedTitle(i.count, 'adminHome.waiting.unshelved.one', 'adminHome.waiting.unshelved.many'),
      detail: [sample.join(', ') + (sample.length && more > 0 ? ` ${t('adminHome.waiting.unshelved.more', { n: formatNumber(more) })}` : '')],
      go: t('adminHome.waiting.unshelved.action'),
    };
  },
};

function renderTodo(todo) {
  const rows = (todo || []).filter(i => TODO[i.kind]).map((i) => {
    const c = TODO[i.kind](i);
    const detail = c.detail.filter(Boolean).join(' · ');
    const url = link(i.view, i.route);
    const tag = url ? 'a' : 'div';
    return `<li><${tag} class="idag-todo__item${i.tone ? ` idag-todo__item--${escHtml(i.tone)}` : ''}"${url ? ` href="${escHtml(url)}" data-route="${escHtml(i.route)}"` : ''} data-kind="${escHtml(i.kind)}">
      <span class="idag-todo__n">${escHtml(formatNumber(i.count))}</span>
      <span class="idag-todo__body"><span class="idag-todo__title">${escHtml(c.title)}</span>${c.tag ? `<span class="idag-todo__tag">${escHtml(c.tag)}</span>` : ''}${detail ? `
        <span class="idag-todo__detail">${escHtml(detail)}</span>` : ''}</span>
      ${url ? `<span class="idag-todo__go" aria-hidden="true">${escHtml(c.go)} →</span>` : ''}
    </${tag}></li>`;
  });
  if (!rows.length) return '';
  return `<section class="dash-card idag-todo-card" aria-labelledby="idag-todo-h" data-block="todo">
    <div class="dash-card__head"><h2 class="dash-card__title" id="idag-todo-h">${escHtml(t('adminHome.waiting.title'))}</h2>
      <span class="idag-card__count">${escHtml(plural(rows.length, 'adminHome.waiting.count.one', 'adminHome.waiting.count.many'))}</span></div>
    <ul class="idag-todo">${rows.join('')}</ul></section>`;
}

// ── Staðan ───────────────────────────────────────────────────────────────────
function figShell(mod, url, route, inner) {
  return url
    ? `<a class="idag-fig idag-fig--${mod}" href="${escHtml(url)}" data-route="${escHtml(route)}" data-fig="${mod}">${inner}</a>`
    : `<div class="idag-fig idag-fig--${mod}" data-fig="${mod}">${inner}</div>`;
}
const value = n => `<span class="idag-fig__value">${escHtml(formatNumber(n))}<span class="idag-fig__unit">${escHtml(unit())}</span></span>`;

function figSales(f) {
  const channels = f.byChannel || [];
  const segs = channels.map(c => `<span class="idag-split__seg idag-sw--${escHtml(c.channel)}" data-grow="${Number(c.amount) || 0}"></span>`).join('');
  const legend = channels.map(c => `<div class="idag-legend__row"><span class="idag-legend__sw idag-sw--${escHtml(c.channel)}" aria-hidden="true"></span>`
    + `<dt>${escHtml(t(`adminHome.figures.salesToday.channel.${c.channel}`))}</dt><dd>${escHtml(isk(c.amount))}</dd></div>`).join('');
  const notes = [];
  if (!f.total) notes.push(escHtml(t('adminHome.figures.salesToday.none')));
  const base = f.compare ? Number(f.compare.total) || 0 : null;
  if (base !== null && base > 0) {
    const pct = Math.round(((f.total - base) / base) * 100);
    const delta = `<span class="idag-fig__delta">${pct >= 0 ? '▲' : '▼'} ${escHtml(t('adminHome.figures.salesToday.delta', { pct: formatNumber(Math.abs(pct)) }))}</span>`;
    notes.push(`${delta} ${escHtml(t('adminHome.figures.salesToday.vsLastWeek', { amount: isk(base) }))}`);
  } else if (base === 0) {
    notes.push(escHtml(t('adminHome.figures.salesToday.lastWeek', { amount: isk(0) })));
  }
  if (f.partial) notes.push(escHtml(t('adminHome.figures.salesToday.partial')));
  const inner = `<span class="idag-fig__label"><span>${escHtml(t('adminHome.figures.salesToday.label'))}</span>`
    + `<time datetime="${escHtml(f.asOf)}">${escHtml(t('adminHome.figures.asOf', { time: hhmm(f.asOf) }))}</time></span>`
    + value(f.total)
    + (f.total > 0 ? `<span class="idag-split" aria-hidden="true">${segs}</span>` : '')
    + `<dl class="idag-legend">${legend}</dl>`
    + notes.map(n => `<span class="idag-fig__note">${n}</span>`).join('');
  return figShell('sales', link('sales', '/admin/sales'), '/admin/sales', inner);
}

function figOrders(f) {
  const s = f.byState || {};
  const body = f.count > 0
    ? `<ul class="idag-states">
        <li><b>${escHtml(formatNumber(s.toShip))}</b> ${escHtml(t('adminHome.figures.openOrders.toShip'))}</li>
        <li><b>${escHtml(formatNumber(s.shipped))}</b> ${escHtml(t('adminHome.figures.openOrders.shipped'))}</li>
        <li><b>${escHtml(formatNumber(s.awaitingPayment))}</b> ${escHtml(t('adminHome.figures.openOrders.awaitingPayment'))}</li>
      </ul>`
    : `<span class="idag-fig__note">${escHtml(t('adminHome.figures.openOrders.none'))}</span>`;
  const inner = `<span class="idag-fig__label"><span>${escHtml(t('adminHome.figures.openOrders.label'))}</span></span>
    <span class="idag-fig__row"><span class="idag-fig__count">${escHtml(formatNumber(f.count))}</span>${body}</span>`;
  return figShell('orders', link('orders', '/admin/shop/orders'), '/admin/shop/orders', inner);
}

function figReceivables(f) {
  const a = f.aging || {};
  const aria = t('adminHome.figures.receivables.aging', { current: isk(a.current), late: isk(a.days1to30), later: isk(a.days31plus) });
  const inner = `<span class="idag-fig__label"><span>${escHtml(t('adminHome.figures.receivables.label'))}</span>`
    + `<span>${escHtml(plural(f.invoices, 'adminHome.figures.receivables.invoices.one', 'adminHome.figures.receivables.invoices.many', { n: formatNumber(f.invoices) }))}</span></span>`
    + value(f.outstanding)
    + (f.outstanding > 0 ? `<span class="idag-aging" role="img" aria-label="${escHtml(aria)}">
        <span class="idag-aging__seg idag-aging__seg--current" data-grow="${Number(a.current) || 0}"></span>
        <span class="idag-aging__seg idag-aging__seg--late" data-grow="${Number(a.days1to30) || 0}"></span>
        <span class="idag-aging__seg idag-aging__seg--later" data-grow="${Number(a.days31plus) || 0}"></span>
      </span>` : '')
    + (f.overdue && f.overdue.count > 0
      ? `<span class="idag-fig__note"><span class="idag-fig__warn">${escHtml(t('adminHome.figures.receivables.overdue', { amount: isk(f.overdue.amount) }))}</span></span>` : '');
  return figShell('ar', link('ar', '/admin/books/ar'), '/admin/books/ar', inner);
}

function figVat(f) {
  const due = dayParts(f.dueOn);
  const date = dayMonth(due);
  const running = dayKey(new Date()) <= f.to;
  const note = running
    ? t('adminHome.figures.vat.soFar', { period: monthRange(f.from, f.to), date })
    : (f.payable < 0 ? t('adminHome.figures.vat.refund', { date }) : t('adminHome.figures.vat.due', { date }));
  const month = isIs() ? IS_MONTHS_SHORT[due.month - 1] : enName(due, { month: 'short' });
  const inner = `<span class="idag-fig__label"><span>${escHtml(t('adminHome.figures.vat.label'))}</span><span>${escHtml(f.period)}</span></span>
    <span class="idag-fig__row">
      <span class="idag-date" aria-hidden="true"><span class="idag-date__m">${escHtml(month)}</span><span class="idag-date__d">${due.day}</span></span>
      <span>${value(Math.abs(f.payable))}
        <span class="idag-fig__note">${escHtml(note)} · ${escHtml(inDays(f.daysLeft))}</span></span>
    </span>`;
  return figShell('vat', link('vat', '/admin/books/vat'), '/admin/books/vat', inner);
}

function renderTally(figs) {
  if (!figs) return '';
  const parts2 = [
    figs.salesToday && figSales(figs.salesToday),
    figs.openOrders && figOrders(figs.openOrders),
    figs.receivables && figReceivables(figs.receivables),
    figs.vatNext && figVat(figs.vatNext),
  ].filter(Boolean);
  if (!parts2.length) return '';
  return `<aside class="idag-tally" aria-labelledby="idag-tally-h" data-block="figures">
    <h2 class="idag-tally__title" id="idag-tally-h">${escHtml(t('adminHome.figures.title'))}</h2>
    <div class="idag-tally__list">${parts2.join('')}</div></aside>`;
}

// ── Nýjast ───────────────────────────────────────────────────────────────────
function feedWhat(e) {
  switch (e.type) {
    case 'order_placed':
      return e.party
        ? t('adminHome.feed.orderPlaced', { number: e.ref, customer: e.party, amount: isk(e.amount) })
        : t('adminHome.feed.orderPlacedGuest', { number: e.ref, amount: isk(e.amount) });
    case 'invoice_paid':
      return t('adminHome.feed.invoicePaid', { customer: e.party || '', number: e.ref, amount: isk(e.amount) });
    case 'invoice_part_paid':
      return t('adminHome.feed.invoicePartPaid', { customer: e.party || '', number: e.ref, amount: isk(e.amount) });
    case 'lead_received':
      return t('adminHome.feed.newEnquiry', { name: e.party || '' });
    case 'change_request_received':
      return t('adminHome.feed.changeRequestReceived', { title: e.summary || '' });
    case 'change_request_resolved':
      return t('adminHome.feed.changeRequestStatus', { title: e.summary || '', status: t('adminCR.status_resolved') });
    default:
      return null;
  }
}

function relTime(at, now) {
  const mins = Math.floor((now - new Date(at).getTime()) / 60000);
  if (mins < 1) return t('adminHome.time.justNow');
  if (mins < 60) return plural(mins, 'adminHome.time.minutesAgo.one', 'adminHome.time.minutesAgo.many');
  return hhmm(at);
}

function dayLabel(key, todayKey, yesterdayKey) {
  if (key === todayKey) return t('adminHome.time.today');
  if (key === yesterdayKey) return t('adminHome.time.yesterday');
  return longDate(dayParts(key));
}

function renderRecent(recent) {
  const items = (recent || []).map(e => ({ e, what: feedWhat(e) })).filter(x => x.what);
  if (!items.length) return '';
  const now = Date.now();
  const todayKey = dayKey(new Date(now));
  const yesterdayKey = dayKey(new Date(now - 86400000));
  let lastDay = null;
  const rows = items.map(({ e, what }) => {
    const k = dayKey(e.at);
    const head = k !== lastDay ? `<li class="idag-feed__day">${escHtml(dayLabel(k, todayKey, yesterdayKey))}</li>` : '';
    lastDay = k;
    const url = link(e.view, e.route);
    const tag = url ? 'a' : 'div';
    const who = e.type === 'lead_received' ? [e.company, e.summary].filter(Boolean).join(' · ') : '';
    return `${head}<li><${tag} class="idag-feed__item"${url ? ` href="${escHtml(url)}" data-route="${escHtml(e.route)}"` : ''} data-type="${escHtml(e.type)}">
      <span class="idag-feed__icon" aria-hidden="true">${iconFor(e.view)}</span>
      <span><span class="idag-feed__what">${escHtml(what)}</span>${who ? `<span class="idag-feed__who">${escHtml(who)}</span>` : ''}</span>
      <span class="idag-feed__meta"><time datetime="${escHtml(e.at)}">${escHtml(relTime(e.at, now))}</time></span>
    </${tag}></li>`;
  }).join('');
  return `<section class="dash-card idag-feed-card" aria-labelledby="idag-feed-h" data-block="recent">
    <div class="dash-card__head"><h2 class="dash-card__title" id="idag-feed-h">${escHtml(t('adminHome.feed.title'))}</h2></div>
    <ul class="idag-feed">${rows}</ul></section>`;
}

// ── Fyrstu skrefin ───────────────────────────────────────────────────────────
const STEP_KEYS = ['company', 'product', 'seller', 'staff', 'twoStep'];

function renderSetup(s) {
  if (!s || !Array.isArray(s.steps) || s.done >= s.total) return '';
  const steps = s.steps.filter(x => STEP_KEYS.includes(x.key));
  const nextKey = (steps.find(x => !x.done) || {}).key;
  const segs = steps.map(x => `<span class="idag-progress__seg${x.done ? ' is-done' : ''}"></span>`).join('');
  const rows = steps.map((x, i) => {
    const base = `adminHome.setup.${x.key}`;
    const cls = x.done ? ' idag-step--done' : (x.key === nextKey ? ' idag-step--next' : '');
    const url = href(x.route);
    const action = x.done
      ? `<span class="idag-step__check">${escHtml(t('adminHome.setup.done'))}</span>`
      : x.key === nextKey
        ? `<a class="btn btn--primary btn--sm" href="${escHtml(url)}" data-route="${escHtml(x.route)}">${escHtml(t(`${base}.action`))}</a>`
        : `<a class="idag-step__go" href="${escHtml(url)}" data-route="${escHtml(x.route)}">${escHtml(t(`${base}.action`))} →</a>`;
    return `<li class="idag-step${cls}" data-step="${escHtml(x.key)}"><span class="idag-step__n">${pad2(i + 1)}</span>
      <span><span class="idag-step__title">${escHtml(t(`${base}.title`))}</span><span class="idag-step__hint">${escHtml(t(`${base}.why`))}</span></span>${action}</li>`;
  }).join('');
  return `<section class="idag-setup" aria-labelledby="idag-setup-h" data-block="setup">
    <div><h2 class="idag-setup__title" id="idag-setup-h">${escHtml(t('adminHome.setup.title'))}</h2>
      <p class="idag-setup__lead">${escHtml(t('adminHome.setup.lead'))}</p>
      <div class="idag-progress" role="progressbar" aria-valuemin="0" aria-valuemax="${steps.length}" aria-valuenow="${s.done}" aria-label="${escHtml(t('adminHome.setup.title'))}">${segs}</div>
      <p class="idag-progress__text">${escHtml(t('adminHome.setup.progress', { done: s.done, total: s.total }))}</p></div>
    <ol class="idag-steps">${rows}</ol></section>`;
}

// ── Page ─────────────────────────────────────────────────────────────────────
const ERROR_BLOCK = [
  ['todo.', 'adminHome.waiting.title'],
  ['figures.', 'adminHome.figures.title'],
  ['recent.', 'adminHome.feed.title'],
  ['setup', 'adminHome.setup.title'],
];

function header(data) {
  const at = data ? new Date(data.generatedAt) : new Date();
  const date = capitalise(longDate(parts(at)));
  let line = escHtml(date);
  if (data) {
    line += ` · ${tHtml('adminHome.asOf', {}, { time: `<time datetime="${escHtml(data.generatedAt)}">${escHtml(hhmm(at))}</time>` })}`;
    if (!(data.todo || []).length && !data.setup) {
      line += ` · <span class="idag-head__clear">${escHtml(t('adminHome.waiting.allClear.title'))}.</span>`;
    }
  }
  return `<div class="admin-header">
      <div>
        <p class="admin-eyebrow">${escHtml(t('admin.dashboard'))}</p>
        <h1 class="admin-title">${escHtml(t('adminHome.title'))}</h1>
        <p class="idag-head__when">${line}</p>
      </div>
    </div>`;
}

function skeleton() {
  const bars = n => `<div class="idag-skel">${'<div class="admin-skeleton__bar"></div>'.repeat(n)}</div>`;
  return `<div class="idag-grid" aria-busy="true">
      <div class="idag-main"><section class="dash-card idag-todo-card">${bars(4)}</section></div>
      <aside class="idag-tally">${bars(3)}</aside>
    </div>`;
}

export function renderHome(data) {
  const errors = [...new Set((data.errors || []).map((e) => {
    const hit = ERROR_BLOCK.find(([prefix]) => e.startsWith(prefix));
    return hit ? t(hit[1]) : null;
  }).filter(Boolean))];
  const todo = renderTodo(data.todo);
  const tally = renderTally(data.figures);
  const recent = renderRecent(data.recent);
  const main = todo || recent ? `<div class="idag-main">${todo}${recent}</div>` : '';
  const grid = main || tally ? `<div class="idag-grid${tally && main ? '' : ' idag-grid--solo'}">${main}${tally}</div>` : '';
  return header(data)
    + (errors.length ? `<p class="idag-note" role="status">${escHtml(t('adminHome.partialError', { blocks: errors.join(', ') }))}</p>` : '')
    + renderSetup(data.setup)
    + grid;
}

// Bar shares through the CSSOM (see the header note on CSP).
function applyShares(el) {
  el.querySelectorAll('[data-grow]').forEach((s) => {
    s.style.flexGrow = String(Math.max(Number(s.dataset.grow) || 0, 0));
  });
}

export class AdminView {
  constructor() {
    this._destroyed = false;
    this._seq = 0;
  }

  // The router calls destroy() on navigation; a late answer then paints nothing.
  destroy() { this._destroyed = true; }

  async render() {
    if (!isAuthenticated()) {
      navigateReplace(href('/'));
      return document.createTextNode('');
    }

    // A role without the dashboard view — e.g. `solufolk` with only 'handbok' —
    // lands here from the NavBar "Admin" entry: forward it to the first sidebar
    // item it can see (the server would answer 403). An editor with no admin
    // view at all gets the projects board, which the old overview linked to.
    if (!canSeeView('dashboard')) {
      const first = ADMIN_NAV.flatMap(g => g.items)
        .find(item => !item.soon && item.route !== '/admin' && canSeeView(item.id));
      const to = first ? first.route : (canEdit() ? '/admin/projects' : '/');
      navigateReplace(href(to));
      return document.createTextNode('');
    }

    const el = document.createElement('div');
    el.className = 'main admin-page idag';
    el.innerHTML = header(null) + skeleton();
    this._load(el);
    return renderAdminShell({ activePath: '/admin', content: el });
  }

  // No isConnected guard: the router awaits render() and attaches the element
  // afterwards, and a local endpoint can answer before the swap. Writing into
  // the not-yet-attached element is exactly right.
  async _load(el) {
    const seq = ++this._seq;
    let data;
    try {
      const res = await fetch('/api/v1/admin/home', { credentials: 'include' });
      data = await res.json().catch(() => null);
      if (!res.ok || !data) throw new Error((data && data.error) || 'load failed');
    } catch {
      if (this._destroyed || seq !== this._seq) return;
      el.innerHTML = `${header(null)}<p class="dash-card__error" role="alert">${escHtml(t('adminHome.loadError'))}</p>`;
      return;
    }
    if (this._destroyed || seq !== this._seq) return;
    el.innerHTML = renderHome(data);
    applyShares(el);
  }
}
