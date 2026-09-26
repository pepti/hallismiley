'use strict';

// public/js/utils/pageTitle.js — adminPageTitle, and the admin detail views that
// own their tab title through it; plus the date sweep that went with it.
//
// Ported from icelandicstore #324 (8e977ae), harvest 2 lane 4a. Every /admin
// route shares one tab title ("Stjórnborð — <brand>"), so three open detail tabs
// could not be told apart. The router prefers a view's `documentTitle` over its
// route map (router.js), so the detail views name their subject first.
//
// No brand literal here: the suffix is whatever titleForRoute gives every other
// /admin route (the identity seam decides the brand).
const fs = require('fs');
const path = require('path');

jest.mock('../../public/js/i18n/i18n.js', () => ({ t: (key) => key, getLocale: () => 'is' }));

const { adminPageTitle, titleForRoute } = require('../../public/js/utils/pageTitle.js');

const ROOT = path.join(__dirname, '../..');
const view = (name) => fs.readFileSync(path.join(ROOT, 'public/js/views', `${name}.js`), 'utf8');
const locale = (lc) => JSON.parse(fs.readFileSync(path.join(ROOT, `public/js/i18n/${lc}.json`), 'utf8'));

describe('adminPageTitle', () => {
  test('puts the subject before exactly what every other /admin route is titled', () => {
    for (const lc of ['en', 'is']) {
      expect(adminPageTitle('Pöntun OS-1042', lc)).toBe(`Pöntun OS-1042 — ${titleForRoute('/admin/shop/orders', lc)}`);
    }
  });

  test('no label falls back to the plain admin title', () => {
    expect(adminPageTitle('', 'is')).toBe(titleForRoute('/admin', 'is'));
    expect(adminPageTitle(null, 'en')).toBe(titleForRoute('/admin', 'en'));
  });
});

describe('the admin detail views set documentTitle through adminPageTitle', () => {
  test('order detail: the order number, in both languages', () => {
    expect(view('AdminOrderDetailView'))
      .toMatch(/this\.documentTitle = adminPageTitle\(t\('adminOrders\.documentTitle', \{ number: data\.order\.order_number \}\)/);
    for (const lc of ['en', 'is']) expect(locale(lc)['adminOrders.documentTitle']).toContain('{number}');
  });

  test('account detail: the account name', () => {
    expect(view('AdminAccountDetailView')).toMatch(/this\.documentTitle = adminPageTitle\(a\.name, getLocale\(\)\)/);
  });

  test('invoice detail: the invoice (or receipt) number', () => {
    const src = view('AdminInvoiceDetailView');
    expect(src).toMatch(/this\.documentTitle = adminPageTitle\(t\(data\.invoice\.series === 'receipt' \? 'adminBooks\.receiptNo' : 'adminBooks\.invoiceNo'/);
    for (const lc of ['en', 'is']) {
      expect(locale(lc)['adminBooks.invoiceNo']).toContain('{number}');
      expect(locale(lc)['adminBooks.receiptNo']).toContain('{number}');
    }
  });
});

// The date half of #324: a raw toLocale*() call answers in the BROWSER's
// language (or in English: Chrome ships no Icelandic ICU data), so every date
// goes through utils/format.js formatDate/formatDateTime, which follow the app
// locale and build Icelandic by hand.
describe('no raw toLocale* date formatting outside utils/format.js', () => {
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    return d.isDirectory() ? walk(p) : (p.endsWith('.js') ? [p] : []);
  });

  test('every hit is gone', () => {
    const hits = [];
    for (const file of walk(path.join(ROOT, 'public/js'))) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      // No exceptions: AdminUsersView (lane 1b's file) and ExpiryPicker
      // (login-expiry) moved to the kit formatter in the master merge.
      if (rel === 'public/js/utils/format.js') continue;
      fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
        const code = line.replace(/\/\/.*$/, '');
        if (/\.toLocale(Date|Time)?String\(/.test(code)) hits.push(`${rel}:${i + 1}`);
      });
    }
    expect(hits).toEqual([]);
  });
});
