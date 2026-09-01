// The market-research importer (server/scripts/market-import.js, migration 093).
//
// What matters is idempotency: the Markaðsstjóri agent re-runs it after every
// research pass, so a second run over the same file must add zero rows, a changed
// figure must land as an UPDATE on the same id, and a workflow status set by sales
// must survive a re-import that does not mention it.
const db = require('../../server/config/database');
const { importMarketData, validate, parseArgs } = require('../../server/scripts/market-import');

const KT = '9900000001';   // 99-prefix: never a real kennitala, easy to sweep

const fixture = () => ({
  companies: [{
    kennitala: KT,
    name: 'Prófun ehf.',
    sector_group: 'smasala',
    list_type: 'smb',
    platform_detected: 'shopify',
    fit_score: 70,
    tier_fit: 'verslun',
    status: 'researched',
    sources: [{ type: 'arsreikningaskra', url: 'test://a', fetched_at: '2026-09-01T00:00:00Z' }],
    financials: [{ fiscal_year: 2024, revenue_isk: 10_000_000, admin_cost_isk: 1_000_000, employees: 3 }],
  }],
  stats: [{
    sector_group: 'smasala', isat_code: '47', size_class: '10-49',
    metric: 'company_count', value: 412, unit: 'count', reference_year: 2024, source_url: 'test://h',
  }],
});

async function counts() {
  const n = async (sql) => Number((await db.query(sql)).rows[0].n);
  return {
    companies:  await n(`SELECT COUNT(*) AS n FROM market_companies WHERE kennitala LIKE '99%'`),
    financials: await n(`SELECT COUNT(*) AS n FROM market_financials f
                           JOIN market_companies c ON c.id = f.company_id WHERE c.kennitala LIKE '99%'`),
    stats:      await n(`SELECT COUNT(*) AS n FROM market_stats WHERE source_url LIKE 'test://%'`),
  };
}

async function sweep() {
  await db.query(`DELETE FROM market_companies WHERE kennitala LIKE '99%'`);   // financials cascade
  await db.query(`DELETE FROM market_stats WHERE source_url LIKE 'test://%'`);
}

beforeEach(sweep);
afterAll(async () => { await sweep(); await db.pool.end(); });

describe('idempotency', () => {
  it('a second run over the same file adds zero rows', async () => {
    const first = await importMarketData(fixture());
    expect(first).toEqual({
      companies:  { inserted: 1, updated: 0 },
      financials: { inserted: 1, updated: 0 },
      stats:      { inserted: 1, updated: 0 },
    });
    const before = await counts();
    expect(before).toEqual({ companies: 1, financials: 1, stats: 1 });

    const second = await importMarketData(fixture());
    expect(second).toEqual({
      companies:  { inserted: 0, updated: 1 },
      financials: { inserted: 0, updated: 1 },
      stats:      { inserted: 0, updated: 1 },
    });
    expect(await counts()).toEqual(before);
  });

  it('a changed figure updates the same row, bumps updated_at and recomputes the ratio', async () => {
    await importMarketData(fixture());
    const { rows: [a] } = await db.query(
      `SELECT id, updated_at FROM market_companies WHERE kennitala = $1`, [KT]);
    const { rows: [f0] } = await db.query(
      `SELECT admin_cost_ratio FROM market_financials WHERE company_id = $1 AND fiscal_year = 2024`, [a.id]);
    expect(Number(f0.admin_cost_ratio)).toBeCloseTo(0.1, 4);

    await new Promise((r) => setTimeout(r, 5));
    const changed = fixture();
    changed.companies[0].name = 'Prófun hf.';
    changed.companies[0].financials[0].revenue_isk = 20_000_000;
    await importMarketData(changed);

    const { rows: [b] } = await db.query(
      `SELECT id, name, updated_at FROM market_companies WHERE kennitala = $1`, [KT]);
    expect(b.id).toBe(a.id);
    expect(b.name).toBe('Prófun hf.');
    expect(new Date(b.updated_at) > new Date(a.updated_at)).toBe(true);   // set_updated_at trigger

    const { rows: [f] } = await db.query(
      `SELECT revenue_isk, admin_cost_ratio FROM market_financials WHERE company_id = $1 AND fiscal_year = 2024`, [a.id]);
    expect(Number(f.revenue_isk)).toBe(20_000_000);          // BIGINT arrives as a string
    expect(Number(f.admin_cost_ratio)).toBeCloseTo(0.05, 4); // generated column recomputed
  });

  it('keeps a workflow status the file does not mention', async () => {
    await importMarketData(fixture());
    await db.query(`UPDATE market_companies SET status = 'handed_to_sales' WHERE kennitala = $1`, [KT]);
    const again = fixture();
    delete again.companies[0].status;
    await importMarketData(again);
    const { rows: [r] } = await db.query(`SELECT status FROM market_companies WHERE kennitala = $1`, [KT]);
    expect(r.status).toBe('handed_to_sales');
  });

  it('a second fiscal year is a new financials row, not a replacement', async () => {
    await importMarketData(fixture());
    const more = fixture();
    more.companies[0].financials.push({ fiscal_year: 2023, revenue_isk: 8_000_000 });
    const r = await importMarketData(more);
    expect(r.financials).toEqual({ inserted: 1, updated: 1 });
    expect((await counts()).financials).toBe(2);
  });
});

describe('validation and safety', () => {
  it('refuses a bad kennitala and writes nothing', async () => {
    const bad = fixture();
    bad.companies.push({ ...fixture().companies[0], kennitala: '123', financials: [] });
    await expect(importMarketData(bad)).rejects.toThrow(/kennitala/);
    expect((await counts()).companies).toBe(0);
  });

  it('rolls the whole file back when the database rejects a row', async () => {
    // Passes validate() but violates the fit_score CHECK — the earlier good row must not survive.
    const p = fixture();
    p.companies.push({ kennitala: '9900000002', name: 'Annað ehf.', list_type: 'smb', fit_score: 50 });
    p.companies[1].financials = [{ fiscal_year: 2024, revenue_isk: -1 }];
    await expect(importMarketData(p)).rejects.toThrow();
    expect((await counts()).companies).toBe(0);
  });

  it('--dry-run validates and counts but leaves the tables untouched', async () => {
    const c = await importMarketData(fixture(), { dryRun: true });
    expect(c.companies.inserted).toBe(1);
    expect(await counts()).toEqual({ companies: 0, financials: 0, stats: 0 });
  });

  it.each([
    ['sector_group', 'x'],
    ['list_type', 'big'],
    ['platform_detected', 'magento'],
    ['tier_fit', 'gull'],
    ['status', 'won'],
  ])('rejects a bad %s', (k, v) => {
    const p = fixture();
    p.companies[0][k] = v;
    expect(() => validate(p)).toThrow(k);
  });

  it('rejects fractional ISK and a kennitala listed twice', () => {
    const p = fixture();
    p.companies[0].financials[0].revenue_isk = 10.5;
    expect(() => validate(p)).toThrow(/whole ISK/);
    const q = fixture();
    q.companies.push(fixture().companies[0]);
    expect(() => validate(q)).toThrow(/twice/);
  });

  it('parses the file argument and --dry-run, refuses unknown flags', () => {
    expect(parseArgs(['node', 'x', 'a.json'])).toEqual({ file: 'a.json', dryRun: false });
    expect(parseArgs(['node', 'x', '--dry-run', 'a.json'])).toEqual({ file: 'a.json', dryRun: true });
    expect(() => parseArgs(['node', 'x', '--force', 'a.json'])).toThrow(/unknown flag/);
    expect(() => parseArgs(['node', 'x'])).toThrow(/Usage/);
  });
});
