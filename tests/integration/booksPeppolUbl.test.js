// Peppol/UBL outbound over HTTP, against real Postgres.
//
//   1. Issuing an invoice snapshots the STRUCTURED party block (migration 095) —
//      the buyer's parts from orders.shipping_address, the seller's from settings —
//      while customer_address stays byte-for-byte what the PDF has always printed.
//   2. GET /invoices/:id/ubl.xml serves a BIS 3.0 document, records the exact bytes
//      and their checksum in invoice_ubl_exports (append-only) and an audit row.
//   3. Expand/contract: a row with every 095 column NULL — the previous release's
//      shape — still serves its PDF and JSON, and the UBL route refuses it by name.
const request = require('supertest');
const { XMLParser } = require('fast-xml-parser');
const app = require('../../server/app');
const db = require('../../server/config/database');
const Role = require('../../server/models/Role');
const Setting = require('../../server/models/Setting');
const ledger = require('../../server/services/bookkeeping/ledgerService');
const {
  createTestAdminUser, createTestRegularUser, getTestSessionCookie, cleanTables,
} = require('../helpers');

const BASE = '/api/v1/admin/bookkeeping';
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', parseTagValue: false, removeNSPrefix: true });

let adminId; let adminCookie;
let readerCookie;
let strangerCookie;
let orderId;

async function makeInvoicesReaderRole() {
  const { rows } = await db.query(
    `INSERT INTO roles (name, description, view_access, is_system)
     VALUES ('ubl-reader-test', 'read-only invoices', $1::jsonb, FALSE)
     ON CONFLICT (name) DO UPDATE SET view_access = EXCLUDED.view_access
     RETURNING name`,
    [JSON.stringify(['books', 'invoices'])]
  );
  Role.invalidateCache();
  return rows[0];
}

async function seedOrder() {
  const { rows: p } = await db.query(
    `INSERT INTO products (slug, name, description, price_isk, price_eur, stock, sku)
     VALUES ('ubl-bord','Eikarborð','',12400, 8900, 5, 'SKU-UBL-1')
     ON CONFLICT (slug) DO UPDATE SET price_isk = EXCLUDED.price_isk RETURNING id`
  );
  const { rows: o } = await db.query(
    `INSERT INTO orders (order_number, currency, subtotal, shipping, total, status,
       payment_status, shipping_method, shipping_address, guest_email, guest_name, paid_at)
     VALUES ($1,'ISK',12400,0,12400,'paid','paid','local_pickup',$2::jsonb,
             'jon@example.is','Jón Jónsson', NOW())
     RETURNING id`,
    [`HP-UBL-${Math.random().toString(36).slice(2, 9)}`,
      JSON.stringify({ name: 'Jón Jónsson', line1: 'Bæjargata 5', line2: 'íbúð 2', postal: '101', city: 'Reykjavík', country_code: 'IS' })]
  );
  await db.query(
    `INSERT INTO order_items (order_id, product_id, product_name_snapshot,
       product_price_snapshot, quantity, currency)
     VALUES ($1,$2,'Eikarborð',12400,1,'ISK')`,
    [o[0].id, p[0].id]
  );
  return o[0].id;
}

beforeEach(async () => {
  await cleanTables();
  ledger.invalidateAccountCache();
  adminId = await createTestAdminUser();
  adminCookie = await getTestSessionCookie(adminId);
  strangerCookie = await getTestSessionCookie(await createTestRegularUser());

  const role = await makeInvoicesReaderRole();
  const { rows } = await db.query(
    `INSERT INTO users (id, email, username, password_hash, role, email_verified)
     VALUES ('ubl-reader-id','ublreader@test.com','ublreader','x',$1,TRUE)
     ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role RETURNING id`,
    [role.name]
  );
  readerCookie = await getTestSessionCookie(rows[0].id);

  await Setting.updateBookkeepingSettings({
    seller_name: 'Orange Smiley ehf.',
    seller_kennitala: '1203894599',
    seller_vat_number: '162561',
    seller_address: 'Arnarhraun 4\n220 Hafnarfjörður',
    seller_street: 'Arnarhraun 4',
    seller_city: 'Hafnarfjörður',
    seller_postal_zone: '220',
    seller_country: 'IS',
    payment_terms_days: 14,
  });
  orderId = await seedOrder();
});

afterAll(async () => { await db.pool.end(); });

async function issue() {
  const res = await request(app).post(`${BASE}/invoices/from-order/${orderId}`)
    .set('Cookie', adminCookie).expect(201);
  return res.body.invoice.id;
}

describe('the structured party block (migration 095)', () => {
  it('is snapshotted at issue, and the printed address is unchanged', async () => {
    const id = await issue();
    const res = await request(app).get(`${BASE}/invoices/${id}`).set('Cookie', adminCookie).expect(200);
    const inv = res.body.invoice;
    expect(inv).toMatchObject({
      customer_street: 'Bæjargata 5, íbúð 2', customer_city: 'Reykjavík', customer_postal_zone: '101',
      seller_street: 'Arnarhraun 4', seller_city: 'Hafnarfjörður', seller_postal_zone: '220', seller_country: 'IS',
    });
    // What the PDF prints, exactly as before 095.
    expect(inv.customer_address).toBe('Bæjargata 5\níbúð 2\n101 Reykjavík');
    expect(res.body.peppol).toMatchObject({ ready: true, problems: [] });
  });

  it('settings gate: peppol_complete is separate from seller_complete', async () => {
    const s = await Setting.updateBookkeepingSettings({ seller_postal_zone: '' });
    expect(s.seller_complete).toBe(true);
    expect(s.peppol_complete).toBe(false);
    await expect(Setting.updateBookkeepingSettings({ seller_country: 'Iceland' })).rejects.toThrow(/ISO 3166/);
    await expect(Setting.updateBookkeepingSettings({ seller_iban: 'not-an-iban' })).rejects.toThrow(/IBAN/);
  });
});

describe('GET /invoices/:id/ubl.xml', () => {
  it('serves a BIS 3.0 document, records the exact bytes with a checksum, and audits it', async () => {
    const id = await issue();
    const res = await request(app).get(`${BASE}/invoices/${id}/ubl.xml`).set('Cookie', adminCookie).expect(200);
    expect(res.headers['content-type']).toMatch(/application\/xml/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="reikningur-\d+-ubl.xml"/);

    const doc = parser.parse(res.text).Invoice;
    expect(doc.CustomizationID).toMatch(/peppol\.eu:2017:poacc:billing:3\.0/);
    expect(doc.DocumentCurrencyCode).toBe('ISK');
    expect(doc.AccountingSupplierParty.Party.EndpointID['@schemeID']).toBe('0196');
    expect(doc.AccountingCustomerParty.Party.PostalAddress.StreetName).toBe('Bæjargata 5, íbúð 2');
    expect(doc.LegalMonetaryTotal.PayableAmount['#text']).toBe('12400.00');
    expect(doc.TaxTotal.TaxSubtotal.TaxCategory).toMatchObject({ ID: 'S', Percent: '24' });

    const { rows } = await db.query(
      `SELECT checksum_sha256, byte_size, xml, created_by FROM invoice_ubl_exports WHERE invoice_id = $1`, [id]
    );
    expect(rows).toHaveLength(1);
    const crypto = require('crypto');
    expect(rows[0].checksum_sha256).toBe(crypto.createHash('sha256').update(res.text, 'utf8').digest('hex'));
    expect(Number(rows[0].byte_size)).toBe(Buffer.byteLength(res.text, 'utf8'));
    expect(rows[0].xml).toBe(res.text);
    expect(rows[0].created_by).toBe(adminId);

    const audit = await db.query(
      `SELECT action, summary FROM books_audit_log WHERE entity_id = $1 AND action = 'invoice.ubl_exported'`, [id]
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].summary.checksum_sha256).toBe(rows[0].checksum_sha256);
  });

  it('the export record is append-only', async () => {
    const id = await issue();
    await request(app).get(`${BASE}/invoices/${id}/ubl.xml`).set('Cookie', adminCookie).expect(200);
    await expect(db.query(`UPDATE invoice_ubl_exports SET xml = 'x' WHERE invoice_id = $1`, [id]))
      .rejects.toMatchObject({ code: '23001' }); // restrict_violation
    await expect(db.query(`DELETE FROM invoice_ubl_exports WHERE invoice_id = $1`, [id]))
      .rejects.toMatchObject({ code: '23001' });
  });

  it('a row shaped like the previous release (095 columns NULL) still serves PDF and JSON, and is refused by name here', async () => {
    const id = await issue();
    // The append-only trigger on issued invoices freezes the statutory columns it
    // knew about; the 095 parts are outside that tuple, so the previous release's
    // NULL shape can be reproduced directly.
    await db.query(
      `UPDATE invoices SET customer_street = NULL, customer_city = NULL, customer_postal_zone = NULL,
                           seller_street = NULL, seller_city = NULL, seller_postal_zone = NULL, seller_country = NULL
        WHERE id = $1`, [id]
    );
    await request(app).get(`${BASE}/invoices/${id}/pdf`).set('Cookie', adminCookie).expect(200);
    const json = await request(app).get(`${BASE}/invoices/${id}`).set('Cookie', adminCookie).expect(200);
    expect(json.body.peppol.ready).toBe(false);

    const res = await request(app).get(`${BASE}/invoices/${id}/ubl.xml`).set('Cookie', adminCookie).expect(409);
    expect(res.body.reason).toBe('UBL_NOT_READY');
    const codes = res.body.problems.map(p => p.code);
    expect(codes).toEqual(expect.arrayContaining(['SELLER_ADDRESS_INCOMPLETE', 'BUYER_ADDRESS_INCOMPLETE']));
    const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM invoice_ubl_exports WHERE invoice_id = $1`, [id]);
    expect(rows[0].n).toBe(0); // nothing recorded for a refusal
  });

  it('rides the PDF’s gating: an invoices reader may download, a stranger may not', async () => {
    const id = await issue();
    await request(app).get(`${BASE}/invoices/${id}/ubl.xml`).set('Cookie', readerCookie).expect(200);
    const denied = await request(app).get(`${BASE}/invoices/${id}/ubl.xml`).set('Cookie', strangerCookie);
    expect([403, 404]).toContain(denied.status);
  });
});
