'use strict';
// Orders list → Excel workbook (.xlsx) for GET /admin/shop/orders/export.xlsx.
// Harvested from icelandicstore (ice@4694289 #325, harvest-ice-d-2026-09-24),
// cut to the engine's orders: no Regla invoice/credit-note, company, store,
// kennitala or line-discount columns (all ice-only). Net and VAT are not
// columns either — the engine's orders carry no VAT total; the books do.
//
// Why a real workbook and not the CSV the page used to build in the browser:
// Excel on Icelandic regional settings expects ';' as the list separator, so a
// comma CSV opened with a double-click lands in column A with every amount as
// text. Cells written here are typed — numbers are numbers, dates are dates —
// and a string cell is never evaluated as a formula, so a customer name
// starting with '=' stays literal without the quote-prefix guard the CSV needed.

const ExcelJS = require('exceljs');
const { t } = require('../i18n');

// A translated status label, falling back to the raw value for a status the
// locale files do not know yet (never the dotted key itself).
function statusLabel(locale, prefix, value) {
  const key = `${prefix}.${value}`;
  const label = t(locale, key);
  return label === key ? value : label;
}

// EUR is stored in cents (see formatMoney in public/js/services/cart.js); ISK
// in whole krónur.
function money(amount, currency) {
  const n = Number(amount) || 0;
  return currency === 'EUR' ? n / 100 : n;
}

const MONEY_FMT = { ISK: '#,##0', EUR: '#,##0.00' };

// Most orders one workbook may hold; the route refuses an export past it rather
// than truncating. A mutable object so the integration test can lower it.
const limits = { maxRows: 10000 };

function customerText(o) {
  return o.user_email || o.guest_name || o.guest_email || '';
}

function buildOrdersWorkbook(orders, locale, { creator = '' } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = creator;
  wb.created = new Date();

  const ws = wb.addWorksheet(t(locale, 'export.orders.sheet'), {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  const h = (k) => t(locale, `export.orders.${k}`);
  const dateFmt = { numFmt: 'dd.mm.yyyy hh:mm' };
  ws.columns = [
    { header: h('order'),       key: 'order',       width: 18 },
    { header: h('date'),        key: 'date',        width: 17, style: dateFmt },
    { header: h('customer'),    key: 'customer',    width: 30 },
    { header: h('subtotal'),    key: 'subtotal',    width: 13 },
    { header: h('discount'),    key: 'discount',    width: 12 },
    { header: h('shipping'),    key: 'shipping',    width: 12 },
    { header: h('total'),       key: 'total',       width: 14 },
    { header: h('currency'),    key: 'currency',    width: 9 },
    { header: h('payment'),     key: 'payment',     width: 16 },
    { header: h('fulfillment'), key: 'fulfillment', width: 16 },
    { header: h('paidAt'),      key: 'paidAt',      width: 17, style: dateFmt },
    { header: h('fulfilledAt'), key: 'fulfilledAt', width: 17, style: dateFmt },
    { header: h('items'),       key: 'items',       width: 8 },
    { header: h('tags'),        key: 'tags',        width: 24 },
  ];

  for (const o of orders) {
    const cur = o.currency || 'ISK';
    const discount = (Number(o.discount_amount) || 0) + (Number(o.shipping_discount) || 0);
    const row = ws.addRow({
      order:       o.order_number,
      // Iceland is UTC+0 all year, so the UTC instant exceljs serialises IS
      // local time — no offset to apply.
      date:        o.created_at ? new Date(o.created_at) : null,
      customer:    customerText(o),
      subtotal:    money(o.subtotal, cur),
      discount:    money(discount, cur),
      shipping:    money(o.shipping, cur),
      total:       money(o.total, cur),
      currency:    cur,
      payment:     statusLabel(locale, 'export.orders.pay', String(o.payment_status || 'pending')),
      fulfillment: statusLabel(locale, 'export.orders.ful', String(o.fulfillment_status || 'unfulfilled')),
      paidAt:      o.paid_at ? new Date(o.paid_at) : null,
      fulfilledAt: o.fulfilled_at ? new Date(o.fulfilled_at) : null,
      items:       Number(o.item_count) || 0,
      tags:        Array.isArray(o.tags) ? o.tags.join('; ') : '',
    });
    const fmt = MONEY_FMT[cur] || MONEY_FMT.ISK;
    for (const key of ['subtotal', 'discount', 'shipping', 'total']) row.getCell(key).numFmt = fmt;
  }

  ws.getRow(1).font = { bold: true };
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: ws.columns.length } };
  return wb;
}

module.exports = { buildOrdersWorkbook, limits };
