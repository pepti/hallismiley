// The leads export/import pair (server/scripts/leads-export.js +
// leads-import.js, migration 097; D-020 step 4): enquiries captured on a
// public instance are carried by hand to the private ops instance.
//
// What matters: the export carries submission fields ONLY (never the ops
// workflow columns), the import is insert-only by submission_id — a second
// run adds nothing and an existing row's status / note / owner survive
// untouched — one bad row fails the whole file, --dry-run writes nothing and
// --source labels the rows.
const { randomUUID } = require('crypto');
const db   = require('../../server/config/database');
const Lead = require('../../server/models/Lead');
const exporter = require('../../server/scripts/leads-export');
const importer = require('../../server/scripts/leads-import');
const { createTestAdminUser, cleanTables } = require('../helpers');

const SUBMISSION_KEYS = [
  'submission_id', 'name', 'email', 'company', 'phone', 'current_platform',
  'message', 'source', 'locale', 'created_at',
];
const WORKFLOW_KEYS = ['status', 'owner_user_id', 'contacted_at', 'contacted_by', 'note', 'id', 'updated_at'];

async function insertLead(over = {}) {
  const row = await Lead.create({
    submissionId: randomUUID(),
    name: 'Prufa', email: 'prufa@example.is', message: 'Halló, ég vil vita meira um kerfið.',
    company: 'Prufufyrirtæki', phone: '555 0000', platform: 'wix', locale: 'is',
    ...over,
  });
  return row.id;
}

// A file as the public box would write it: two enquiries, one with every
// optional field, one with none.
const fixture = () => ({
  exportedAt: '2026-09-22T10:00:00.000Z',
  instance: 'www.orangesmiley.is',
  leads: [
    {
      submission_id: '11111111-1111-4111-8111-111111111111',
      name: 'Jóna Jónsdóttir', email: 'jona@example.is', company: 'Ísprjón ehf.',
      phone: '555 1234', current_platform: 'shopify',
      message: 'Við erum með Shopify og viljum skoða Rekstrarkerfið.',
      source: 'hafa-samband', locale: 'is', created_at: '2026-09-20T08:15:00.000Z',
    },
    {
      submission_id: '22222222-2222-4222-8222-222222222222',
      name: 'Bjarni', email: 'bjarni@example.is', company: null, phone: null,
      current_platform: null, message: 'Get ég fengið tilboð í vefverslun?',
      source: 'hafa-samband', locale: null, created_at: '2026-09-21T12:00:00.000Z',
    },
  ],
});

async function count() {
  return (await db.query('SELECT COUNT(*)::int AS n FROM leads')).rows[0].n;
}

let adminId;

beforeEach(async () => {
  await cleanTables();
  await db.query('TRUNCATE TABLE leads RESTART IDENTITY');
  adminId = await createTestAdminUser();
});

afterAll(async () => { await db.pool.end(); });

// ── Export ───────────────────────────────────────────────────────────────────

describe('leads-export', () => {
  test('carries submission fields only — never the workflow columns', async () => {
    const worked = await insertLead({ email: 'a@example.is' });
    await insertLead({ email: 'b@example.is' });
    await Lead.update(worked, { status: 'contacted', note: 'hringdi', owner_user_id: adminId }, adminId);

    const out = await exporter.buildExport();
    expect(Number.isNaN(Date.parse(out.exportedAt))).toBe(false);
    expect(out.instance).toBe('www.hallismiley.is');       // APP_URL host (tests/env.js)
    expect(out.leads).toHaveLength(2);
    for (const l of out.leads) {
      expect(Object.keys(l).sort()).toEqual([...SUBMISSION_KEYS].sort());
      for (const k of WORKFLOW_KEYS) expect(l).not.toHaveProperty(k);
      expect(l.submission_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(typeof l.created_at).toBe('string');
    }
    expect(exporter.EXPORT_COLUMNS).toEqual(SUBMISSION_KEYS);
  });

  test('--since keeps only rows received on or after the date', async () => {
    const old = await insertLead({ email: 'old@example.is' });
    await db.query(`UPDATE leads SET created_at = '2026-01-01T00:00:00Z' WHERE id = $1`, [old]);
    await insertLead({ email: 'new@example.is' });

    const all = await exporter.buildExport();
    expect(all.leads.map(l => l.email)).toEqual(['old@example.is', 'new@example.is']); // oldest first
    const since = await exporter.buildExport({ since: '2026-06-01' });
    expect(since.leads.map(l => l.email)).toEqual(['new@example.is']);
  });

  test('instance label: APP_URL host, else the instance role', () => {
    expect(exporter.instanceLabel({ APP_URL: 'https://www.orangesmiley.is/' })).toBe('www.orangesmiley.is');
    expect(exporter.instanceLabel({ APP_URL: 'not a url' })).toBe('ops');
    expect(exporter.instanceLabel({})).toBe('ops');
  });

  test('parseArgs: --since must be a date, --out a path, nothing else', () => {
    expect(exporter.parseArgs(['node', 'x'])).toEqual({ since: null, out: null });
    expect(exporter.parseArgs(['node', 'x', '--since', '2026-09-15', '--out', 'f.json']))
      .toEqual({ since: '2026-09-15', out: 'f.json' });
    expect(() => exporter.parseArgs(['node', 'x', '--since', 'yesterday'])).toThrow(/ISO date/);
    expect(() => exporter.parseArgs(['node', 'x', '--out'])).toThrow(/needs a value/);
    expect(() => exporter.parseArgs(['node', 'x', 'file.json'])).toThrow(/Usage/);
  });
});

// ── Import ───────────────────────────────────────────────────────────────────

describe('leads-import', () => {
  test('inserts every row as status new, source = the file instance, created_at kept', async () => {
    const r = await importer.importLeads(fixture());
    expect(r).toEqual({ inserted: 2, skipped: 0, source: 'www.orangesmiley.is' });
    expect(await count()).toBe(2);

    const { rows } = await db.query('SELECT * FROM leads ORDER BY created_at');
    expect(rows.map(x => x.status)).toEqual(['new', 'new']);
    expect(rows.map(x => x.source)).toEqual(['www.orangesmiley.is', 'www.orangesmiley.is']);
    expect(rows.map(x => x.owner_user_id)).toEqual([null, null]);
    expect(rows[0].name).toBe('Jóna Jónsdóttir');
    expect(rows[0].current_platform).toBe('shopify');
    expect(new Date(rows[0].created_at).toISOString()).toBe('2026-09-20T08:15:00.000Z');
    expect(rows[1].company).toBeNull();
    expect(rows[1].locale).toBeNull();
  });

  test('a second import of the same file skips every row', async () => {
    await importer.importLeads(fixture());
    const again = await importer.importLeads(fixture());
    expect(again).toEqual({ inserted: 0, skipped: 2, source: 'www.orangesmiley.is' });
    expect(await count()).toBe(2);
  });

  test('an existing row is never updated — status, note, owner and the submission survive', async () => {
    await importer.importLeads(fixture());
    const { rows: [row] } = await db.query(
      `SELECT id FROM leads WHERE submission_id = $1`, [fixture().leads[0].submission_id]);
    await Lead.update(row.id, { status: 'won', note: 'samningur undirritaður', owner_user_id: adminId }, adminId);

    // A "corrected" file: same ids, changed text, a new third row.
    const changed = fixture();
    changed.leads[0].name = 'Einhver annar';
    changed.leads[0].message = 'Þessi texti á aldrei að lenda í töflunni á rekstri.';
    changed.leads.push({
      submission_id: '33333333-3333-4333-8333-333333333333',
      name: 'Nýr', email: 'nyr@example.is', message: 'Ný fyrirspurn eftir fyrsta innlestur.',
      created_at: '2026-09-22T09:00:00.000Z',
    });
    const r = await importer.importLeads(changed);
    expect(r).toEqual({ inserted: 1, skipped: 2, source: 'www.orangesmiley.is' });

    const after = await Lead.findById(row.id);
    expect(after.status).toBe('won');
    expect(after.note).toBe('samningur undirritaður');
    expect(after.owner_user_id).toBe(adminId);
    expect(after.contacted_by).toBe(adminId);
    expect(after.name).toBe('Jóna Jónsdóttir');
    expect(after.message).toBe(fixture().leads[0].message);
    expect(await count()).toBe(3);
  });

  test('one invalid row fails the whole file and writes nothing', async () => {
    const bad = fixture();
    bad.leads.push({ ...fixture().leads[1], submission_id: '44444444-4444-4444-8444-444444444444', email: 'not-an-email' });
    await expect(importer.importLeads(bad)).rejects.toThrow(/leads\[2\] \(4444.*email/);
    expect(await count()).toBe(0);
  });

  test('--dry-run validates and counts but inserts nothing', async () => {
    const r = await importer.importLeads(fixture(), { dryRun: true });
    expect(r).toEqual({ inserted: 2, skipped: 0, source: 'www.orangesmiley.is' });
    expect(await count()).toBe(0);
  });

  test('--source label wins over the file instance', async () => {
    const r = await importer.importLeads(fixture(), { source: 'rekstrarkerfi.is' });
    expect(r.source).toBe('rekstrarkerfi.is');
    const { rows } = await db.query('SELECT DISTINCT source FROM leads');
    expect(rows).toEqual([{ source: 'rekstrarkerfi.is' }]);
  });

  test('the round trip: an export of instance A imports on B with the same ids', async () => {
    await insertLead({ email: 'a@example.is' });
    await insertLead({ email: 'b@example.is' });
    const file = JSON.parse(JSON.stringify(await exporter.buildExport()));   // through the file format
    const ids = (await db.query('SELECT submission_id FROM leads ORDER BY id')).rows.map(r => r.submission_id);

    await db.query('TRUNCATE TABLE leads RESTART IDENTITY');                  // "instance B"
    expect(await importer.importLeads(file)).toEqual({ inserted: 2, skipped: 0, source: 'www.hallismiley.is' });
    const got = (await db.query('SELECT submission_id, status FROM leads ORDER BY id')).rows;
    expect(got.map(r => r.submission_id)).toEqual(ids);
    expect(got.map(r => r.status)).toEqual(['new', 'new']);
  });

  describe('validate — the contact form limits', () => {
    const row = (over) => { const p = fixture(); Object.assign(p.leads[0], over); return p; };

    it.each([
      ['submission_id', 'abc', /UUID/],
      ['name', '', /name required/],
      ['name', 'x'.repeat(101), /name longer than 100/],
      ['email', 'nobody', /email/],
      ['email', 'a@' + 'b'.repeat(200) + '.is', /email longer than 200/],
      ['message', 'stutt', /message shorter than 10/],
      ['message', 'x'.repeat(2001), /message longer than 2000/],
      ['company', 'x'.repeat(151), /company longer than 150/],
      ['phone', 'x'.repeat(41), /phone longer than 40/],
      ['current_platform', 'x'.repeat(21), /current_platform longer than 20/],
      ['locale', 'is-ISL', /locale longer than 5/],
      ['created_at', 'í gær', /created_at/],
      ['company', 42, /company must be a string/],
    ])('rejects a bad %s', (k, v, re) => {
      expect(() => importer.validate(row({ [k]: v }))).toThrow(re);
    });

    it('rejects a submission_id listed twice, a missing instance and a non-array', () => {
      const twice = fixture();
      twice.leads.push({ ...fixture().leads[0] });
      expect(() => importer.validate(twice)).toThrow(/twice/);
      const noInstance = fixture();
      delete noInstance.instance;
      expect(() => importer.validate(noInstance)).toThrow(/--source/);
      expect(importer.validate(noInstance, { source: 'x' })).toBe('x');
      expect(() => importer.validate({ leads: 'no' })).toThrow(/array/);
      expect(() => importer.validate([])).toThrow(/object/);
    });

    it('names every bad row in one message, never a field value', () => {
      const p = fixture();
      p.leads[0].email = 'bad';
      p.leads[1].message = 'x';
      let msg = '';
      try { importer.validate(p); } catch (e) { msg = e.message; }
      expect(msg).toMatch(/leads\[0\] \(1111/);
      expect(msg).toMatch(/leads\[1\] \(2222/);
      expect(msg).not.toMatch(/Jóna|bjarni@/);
    });
  });

  test('parseArgs: file, --dry-run, --source; refuses unknown flags and two files', () => {
    expect(importer.parseArgs(['node', 'x', 'a.json'])).toEqual({ file: 'a.json', dryRun: false, source: null });
    expect(importer.parseArgs(['node', 'x', '--dry-run', 'a.json', '--source', 'rekstrarkerfi.is']))
      .toEqual({ file: 'a.json', dryRun: true, source: 'rekstrarkerfi.is' });
    expect(() => importer.parseArgs(['node', 'x', '--force', 'a.json'])).toThrow(/unknown flag/);
    expect(() => importer.parseArgs(['node', 'x', 'a.json', 'b.json'])).toThrow(/one file/);
    expect(() => importer.parseArgs(['node', 'x', 'a.json', '--source'])).toThrow(/label/);
    expect(() => importer.parseArgs(['node', 'x', 'a.json', '--source', 'x'.repeat(31)])).toThrow(/30/);
    expect(() => importer.parseArgs(['node', 'x'])).toThrow(/Usage/);
  });
});
