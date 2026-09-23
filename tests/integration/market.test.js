// Integration tests for Markaður, the prospect list (/api/v1/admin/markadur
// over the migration-093 tables; ENHANCEMENTS #16): RBAC (read =
// requireView('markadur'); the status hand-off = admin/moderator), the
// latest-year join, filters + sorting, the detail payload, the one allowed
// transition (shortlist → handed_to_sales / rejected, race-safe), the
// no-store posture, and the importer interplay (a re-import without `status`
// must not undo a hand-off). Fixtures go through the importer itself with
// 99-prefixed kennitalas and are swept the way marketImport.test.js does —
// the market tables have no FK to users, so cleanTables() never touches them.
// CSRF is bypassed in test mode (see tests/env.js).
const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const Role    = require('../../server/models/Role');
const { importMarketData } = require('../../server/scripts/market-import');
const {
  createTestAdminUser,
  createTestModeratorUser,
  createTestRegularUser,
  getTestSessionCookie,
  cleanTables,
} = require('../helpers');

const BASE = '/api/v1/admin/markadur';
const VIEWER_ID = 'test-market-viewer';

const fixture = () => ({
  companies: [
    {
      kennitala: '9900000011', name: 'Alfa verslun ehf.', sector_group: 'smasala', list_type: 'smb',
      platform_detected: 'shopify', fit_score: 90, tier_fit: 'verslun', status: 'shortlist',
      summary: 'Lítil búð með vefverslun.', fit_notes: 'Hár stjórnunarkostnaður.',
      sources: [{ type: 'arsreikningaskra', url: 'test://alfa', fetched_at: '2026-09-01T00:00:00Z' }],
      report_path: 'company/markadur/arsreikningar/9900000011-2024.pdf',
      financials: [
        { fiscal_year: 2023, revenue_isk: 80_000_000, admin_cost_isk: 10_000_000, employees: 6 },
        { fiscal_year: 2024, revenue_isk: 100_000_000, admin_cost_isk: 10_000_000, employees: 7 },
      ],
    },
    {
      kennitala: '9900000012', name: 'Beta heildsala hf.', sector_group: 'heildsala', list_type: 'large',
      fit_score: 40, tier_fit: 'rekstur', status: 'researched',
      financials: [{ fiscal_year: 2024, revenue_isk: 900_000_000, admin_cost_isk: 45_000_000, employees: 40 }],
    },
    {
      kennitala: '9900000013', name: 'Gamma þjónusta ehf.', sector_group: 'thjonusta', list_type: 'smb',
      fit_score: 60, status: 'candidate',
      financials: [],
    },
  ],
  stats: [],
});

async function sweep() {
  await db.query(`DELETE FROM market_companies WHERE kennitala LIKE '99%'`);
}

async function idOf(kt) {
  const { rows } = await db.query(`SELECT id FROM market_companies WHERE kennitala = $1`, [kt]);
  return rows[0].id;
}

let adminCookie, modCookie, userCookie, viewerCookie;
let alfa, beta, gamma;

beforeEach(async () => {
  await cleanTables();
  await sweep();
  await importMarketData(fixture());
  alfa = await idOf('9900000011'); beta = await idOf('9900000012'); gamma = await idOf('9900000013');

  // A custom role holding ONLY the markadur view, plus a user on it.
  await db.query(
    `INSERT INTO roles (name, description, view_access, is_system)
     VALUES ('testmarket', 'e2e: markadur only', '["markadur"]'::jsonb, FALSE)
     ON CONFLICT (name) DO UPDATE SET view_access = EXCLUDED.view_access`
  );
  Role.invalidateCache();
  const adminId = await createTestAdminUser();
  const modId   = await createTestModeratorUser();
  const userId  = await createTestRegularUser();
  await db.query(
    `INSERT INTO users (id, email, username, password_hash, role, email_verified)
     VALUES ($1, 'market@test.com', 'testmarket',
             (SELECT password_hash FROM users WHERE id = $2), 'testmarket', TRUE)`,
    [VIEWER_ID, userId]
  );
  adminCookie  = await getTestSessionCookie(adminId);
  modCookie    = await getTestSessionCookie(modId);
  userCookie   = await getTestSessionCookie(userId);
  viewerCookie = await getTestSessionCookie(VIEWER_ID);
});

afterAll(sweep);

// ── Read access ──────────────────────────────────────────────────────────────

describe('GET /api/v1/admin/markadur', () => {
  test('unauthenticated 401, plain user 403, view holder 200 + no-store, admin 200', async () => {
    expect((await request(app).get(BASE)).status).toBe(401);
    expect((await request(app).get(BASE).set('Cookie', userCookie)).status).toBe(403);
    const v = await request(app).get(BASE).set('Cookie', viewerCookie);
    expect(v.status).toBe(200);
    expect(v.headers['cache-control']).toBe('no-store');
    expect((await request(app).get(BASE).set('Cookie', adminCookie)).status).toBe(200);
  });

  test('joins the LATEST fiscal year, with the generated ratio; no figures → latest null', async () => {
    const res = await request(app).get(`${BASE}?q=99000000`).set('Cookie', viewerCookie);
    const byKt = Object.fromEntries(res.body.companies.map(c => [c.kennitala, c]));
    expect(byKt['9900000011'].latest.fiscal_year).toBe(2024);
    expect(Number(byKt['9900000011'].latest.revenue_isk)).toBe(100_000_000);
    expect(Number(byKt['9900000011'].latest.admin_cost_ratio)).toBeCloseTo(0.1, 4);
    expect(byKt['9900000013'].latest).toBeNull();
    expect(res.body.filters.statuses).toContain('shortlist');
  });

  test('default sort is fit_score desc; revenue sort puts the figure-less company last', async () => {
    const def = await request(app).get(`${BASE}?q=99000000`).set('Cookie', viewerCookie);
    expect(def.body.sort).toBe('fit_score');
    expect(def.body.companies.map(c => c.kennitala)).toEqual(['9900000011', '9900000013', '9900000012']);

    const rev = await request(app).get(`${BASE}?q=99000000&sort=revenue&dir=desc`).set('Cookie', viewerCookie);
    expect(rev.body.companies.map(c => c.kennitala)).toEqual(['9900000012', '9900000011', '9900000013']);

    const asc = await request(app).get(`${BASE}?q=99000000&sort=name&dir=asc`).set('Cookie', viewerCookie);
    expect(asc.body.companies[0].kennitala).toBe('9900000011');
  });

  test('each filter narrows; an unknown sort is a 400', async () => {
    const c = viewerCookie;
    const only = async (qs) => (await request(app).get(`${BASE}?q=99000000&${qs}`).set('Cookie', c)).body.companies.map(x => x.kennitala);
    expect(await only('list_type=large')).toEqual(['9900000012']);
    expect(await only('sector_group=thjonusta')).toEqual(['9900000013']);
    expect(await only('status=shortlist')).toEqual(['9900000011']);
    expect(await only('tier_fit=rekstur')).toEqual(['9900000012']);
    // A kennitala search on its own (the helper already carries a `q`).
    const byKt = await request(app).get(`${BASE}?q=9900000013`).set('Cookie', c);
    expect(byKt.body.companies.map(x => x.kennitala)).toEqual(['9900000013']);
    const byName = await request(app).get(`${BASE}?q=gamma`).set('Cookie', c);
    expect(byName.body.companies.map(x => x.kennitala)).toEqual(['9900000013']);
    expect((await request(app).get(`${BASE}?sort=revenue_isk;DROP`).set('Cookie', c)).status).toBe(400);
  });

  test('total and paging agree with the filter', async () => {
    const res = await request(app).get(`${BASE}?q=99000000&limit=2&page=2`).set('Cookie', viewerCookie);
    expect(res.body.total).toBe(3);
    expect(res.body.companies).toHaveLength(1);
    expect(res.body.page).toBe(2);
  });
});

describe('GET /api/v1/admin/markadur/:id', () => {
  test('returns every year desc, sources, notes and the report path verbatim', async () => {
    const res = await request(app).get(`${BASE}/${alfa}`).set('Cookie', viewerCookie);
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    const c = res.body.company;
    expect(c.financials.map(f => f.fiscal_year)).toEqual([2024, 2023]);
    expect(c.sources).toEqual([{ type: 'arsreikningaskra', url: 'test://alfa', fetched_at: '2026-09-01T00:00:00Z' }]);
    expect(c.fit_notes).toBe('Hár stjórnunarkostnaður.');
    expect(c.report_path).toBe('company/markadur/arsreikningar/9900000011-2024.pdf');
  });

  test('404 unknown, 400 non-numeric, 403 plain user', async () => {
    expect((await request(app).get(`${BASE}/999999`).set('Cookie', viewerCookie)).status).toBe(404);
    expect((await request(app).get(`${BASE}/abc`).set('Cookie', viewerCookie)).status).toBe(400);
    expect((await request(app).get(`${BASE}/${alfa}`).set('Cookie', userCookie)).status).toBe(403);
  });
});

// ── The one write ────────────────────────────────────────────────────────────

describe('PATCH /api/v1/admin/markadur/:id/status', () => {
  test('view holder 403, plain user 403, unauthenticated 401', async () => {
    const body = { status: 'handed_to_sales' };
    expect((await request(app).patch(`${BASE}/${alfa}/status`).set('Cookie', viewerCookie).send(body)).status).toBe(403);
    expect((await request(app).patch(`${BASE}/${alfa}/status`).set('Cookie', userCookie).send(body)).status).toBe(403);
    expect((await request(app).patch(`${BASE}/${alfa}/status`).send(body)).status).toBe(401);
  });

  test('moderator hands a shortlisted company to sales; updated_at bumps; a second hand-off is 409', async () => {
    const { rows: [before] } = await db.query(`SELECT updated_at FROM market_companies WHERE id = $1`, [alfa]);
    await new Promise(r => setTimeout(r, 5));
    const res = await request(app).patch(`${BASE}/${alfa}/status`).set('Cookie', modCookie).send({ status: 'handed_to_sales' });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.body.company.status).toBe('handed_to_sales');
    expect(new Date(res.body.company.updated_at) > new Date(before.updated_at)).toBe(true);

    const again = await request(app).patch(`${BASE}/${alfa}/status`).set('Cookie', adminCookie).send({ status: 'rejected' });
    expect(again.status).toBe(409);
  });

  test('admin rejects a shortlisted company', async () => {
    const res = await request(app).patch(`${BASE}/${alfa}/status`).set('Cookie', adminCookie).send({ status: 'rejected' });
    expect(res.status).toBe(200);
    expect(res.body.company.status).toBe('rejected');
  });

  test('only FROM shortlist: a candidate cannot be rejected (409); the body may not name shortlist (400); unknown id 404', async () => {
    expect((await request(app).patch(`${BASE}/${gamma}/status`).set('Cookie', adminCookie).send({ status: 'rejected' })).status).toBe(409);
    expect((await request(app).patch(`${BASE}/${beta}/status`).set('Cookie', adminCookie).send({ status: 'handed_to_sales' })).status).toBe(409);
    expect((await request(app).patch(`${BASE}/${alfa}/status`).set('Cookie', adminCookie).send({ status: 'shortlist' })).status).toBe(400);
    expect((await request(app).patch(`${BASE}/${alfa}/status`).set('Cookie', adminCookie).send({})).status).toBe(400);
    expect((await request(app).patch(`${BASE}/999999/status`).set('Cookie', adminCookie).send({ status: 'rejected' })).status).toBe(404);
  });

  test('a re-import that does not mention status keeps the hand-off', async () => {
    await request(app).patch(`${BASE}/${alfa}/status`).set('Cookie', adminCookie).send({ status: 'handed_to_sales' });
    const again = fixture();
    delete again.companies[0].status;
    await importMarketData(again);
    const { rows: [row] } = await db.query(`SELECT status FROM market_companies WHERE id = $1`, [alfa]);
    expect(row.status).toBe('handed_to_sales');
  });
});
