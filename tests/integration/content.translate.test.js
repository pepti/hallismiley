'use strict';

// Integration tests for the site_content auto-translate side effect in
// contentController.putContent. Mocks the translator so we control what the
// jsonb tree looks like after translation.

jest.mock('../../server/services/translator', () => ({
  translate:     jest.fn(),
  translateTree: jest.fn(),
  isEnabled:     jest.fn(() => true),
}));

const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const { getTestSessionCookie } = require('../helpers');
const { translateTree, isEnabled } = require('../../server/services/translator');

let adminCookie;

beforeEach(async () => {
  await db.query("DELETE FROM site_content WHERE key LIKE 'test_%'");
  adminCookie = await getTestSessionCookie();
  translateTree.mockReset();
  isEnabled.mockReset();
  isEnabled.mockReturnValue(true);
});

afterAll(async () => {
  await db.query("DELETE FROM site_content WHERE key LIKE 'test_%'");
});

async function readRow(key, locale) {
  const { rows } = await db.query(
    'SELECT value FROM site_content WHERE key = $1 AND locale = $2',
    [key, locale]
  );
  return rows[0] ? rows[0].value : null;
}

// The IS auto-translate side effect runs as a fire-and-forget background
// task in contentController.putContent — see runAutoTranslateSideEffect.
// Tests that assert on IS state after a save must poll for the row, since
// supertest's `.send()` resolves as soon as the EN response is sent (which
// is now BEFORE the IS write happens).
async function waitForIs(key, predicate, timeoutMs = 2000) {
  const start = Date.now();
  // 25ms poll cadence: tight enough for tests to feel instant, loose
  // enough to avoid hammering the test DB.
  while (Date.now() - start < timeoutMs) {
    const row = await readRow(key, 'is');
    if (predicate(row)) return row;
    await new Promise(r => setTimeout(r, 25));
  }
  return await readRow(key, 'is');
}

// For tests that expect the IS write to NOT happen (flag off, opt-out,
// translator returns null/throws), give any misbehaving background promise
// one event-loop tick to fire so the absence is meaningful, not racy.
const tick = () => new Promise(r => setImmediate(r));

describe('PUT /api/v1/content/:key — site_content auto-translate', () => {
  test('PUT ?locale=en inserts matching IS row from translateTree output', async () => {
    translateTree.mockResolvedValue({
      eyebrow: 'HALLÓ',
      subtitle: 'Prófunartexti',
      image_url: 'https://example.is/x.png',
    });
    const res = await request(app)
      .put('/api/v1/content/test_hero?locale=en')
      .set('Cookie', adminCookie)
      .send({
        eyebrow:  'HELLO',
        subtitle: 'Test text',
        image_url: 'https://example.is/x.png',
      });
    expect(res.status).toBe(200);
    expect(res.body.eyebrow).toBe('HELLO'); // EN response unchanged

    const isRow = await waitForIs('test_hero', r => r && r.eyebrow === 'HALLÓ');
    expect(isRow).toEqual({
      eyebrow: 'HALLÓ',
      subtitle: 'Prófunartexti',
      image_url: 'https://example.is/x.png',
    });
  });

  test('strips __autoTranslate from the persisted EN value', async () => {
    translateTree.mockResolvedValue({ title: 'Þ' });
    await request(app)
      .put('/api/v1/content/test_flag?locale=en')
      .set('Cookie', adminCookie)
      .send({ title: 'T', __autoTranslate: true });

    const enRow = await readRow('test_flag', 'en');
    expect(enRow).toEqual({ title: 'T' });
    expect(enRow).not.toHaveProperty('__autoTranslate');
  });

  test('__autoTranslate:false skips the IS side effect', async () => {
    await request(app)
      .put('/api/v1/content/test_skip?locale=en')
      .set('Cookie', adminCookie)
      .send({ title: 'T', __autoTranslate: false });
    await tick(); // give any errant background promise a chance to fire

    expect(translateTree).not.toHaveBeenCalled();
    const isRow = await readRow('test_skip', 'is');
    expect(isRow).toBeNull();
  });

  test('does not run IS side effect when saving an IS row directly', async () => {
    await request(app)
      .put('/api/v1/content/test_direct_is?locale=is')
      .set('Cookie', adminCookie)
      .send({ title: 'Beint á íslensku' });
    await tick();

    expect(translateTree).not.toHaveBeenCalled();
    const isRow = await readRow('test_direct_is', 'is');
    expect(isRow).toEqual({ title: 'Beint á íslensku' });
  });

  test('PUT ?locale=is writes only the IS row and leaves the EN row untouched', async () => {
    // Regression for the bilingual-overwrite bug: an admin editing /is/halli
    // saved Icelandic content and the EN row got overwritten because the SPA
    // omitted ?locale=is on the PUT, falling back to DEFAULT_LOCALE on the
    // server. With the fix in place the explicit ?locale=is in the URL must
    // land in the IS row only, no matter what req.locale resolves to.
    await db.query(
      `INSERT INTO site_content (key, locale, value) VALUES
         ($1, 'en', $2::jsonb),
         ($1, 'is', $3::jsonb)`,
      [
        'test_isolation',
        JSON.stringify({ title: 'English title', body: 'English body' }),
        JSON.stringify({ title: 'Íslenskur titill', body: 'Íslenskur texti' }),
      ]
    );

    const res = await request(app)
      .put('/api/v1/content/test_isolation?locale=is')
      .set('Cookie', adminCookie)
      .send({ title: 'Nýr titill', body: 'Nýr texti' });
    expect(res.status).toBe(200);

    const enRow = await readRow('test_isolation', 'en');
    expect(enRow).toEqual({ title: 'English title', body: 'English body' });

    const isRow = await readRow('test_isolation', 'is');
    expect(isRow).toEqual({ title: 'Nýr titill', body: 'Nýr texti' });
  });

  test('merges translation into an existing IS row without overwriting filled leaves', async () => {
    // Seed an IS row where the title is already filled but eyebrow is null
    await db.query(
      `INSERT INTO site_content (key, locale, value) VALUES ($1, 'is', $2::jsonb)`,
      ['test_merge', JSON.stringify({ eyebrow: null, title: 'Halldórssamningur' })]
    );
    translateTree.mockResolvedValue({ eyebrow: 'NÝR', title: 'NÝR TITILL' });

    await request(app)
      .put('/api/v1/content/test_merge?locale=en')
      .set('Cookie', adminCookie)
      .send({ eyebrow: 'NEW', title: 'Hello' });

    const isRow = await waitForIs('test_merge', r => r && r.eyebrow === 'NÝR');
    // Eyebrow was null → filled from translation; title was a real manual IS
    // edit (differs from EN) → preserved.
    expect(isRow.eyebrow).toBe('NÝR');
    expect(isRow.title).toBe('Halldórssamningur');
  });

  test('overwrites IS leaves that are byte-identical to the source EN (stale-EN-as-IS)', async () => {
    // Seed an IS row where every leaf is a verbatim copy of an old EN value —
    // simulating the contamination state we hit on production halli_bio:
    // earlier saves wrote EN text into the IS row (or migration 029 copied
    // EN to IS), and the merge logic preserved those non-empty English
    // strings forever, swallowing every subsequent translation.
    await db.query(
      `INSERT INTO site_content (key, locale, value) VALUES ($1, 'is', $2::jsonb)`,
      ['test_stale', JSON.stringify({
        eyebrow:  'OLD EYEBROW',     // identical to source EN below
        title:    'OLD TITLE',        // identical to source EN below
        manual_is: 'Þetta er handskrifað', // a real IS edit — should be kept
      })]
    );
    translateTree.mockResolvedValue({
      eyebrow:   'NÝR EYEBROW',
      title:     'NÝR TITLE',
      manual_is: 'AUTO TRANSLATED',
    });

    await request(app)
      .put('/api/v1/content/test_stale?locale=en')
      .set('Cookie', adminCookie)
      .send({
        eyebrow:   'OLD EYEBROW',           // unchanged from what's in IS
        title:     'OLD TITLE',             // unchanged from what's in IS
        manual_is: 'Some new English here', // EN side edited
      });

    const isRow = await waitForIs('test_stale', r => r && r.eyebrow === 'NÝR EYEBROW');
    // Stale-EN-as-IS leaves get the new translation
    expect(isRow.eyebrow).toBe('NÝR EYEBROW');
    expect(isRow.title).toBe('NÝR TITLE');
    // The IS leaf that was a real manual Icelandic edit (not equal to EN)
    // is still preserved, even though EN changed
    expect(isRow.manual_is).toBe('Þetta er handskrifað');
  });

  test('still preserves IS that differs from EN even when EN matches the translation', async () => {
    // Defensive: ensure that with NO previous EN row (first-time save) and
    // EN that differs from existing IS, the IS manual edit is preserved.
    await db.query(
      `INSERT INTO site_content (key, locale, value) VALUES ($1, 'is', $2::jsonb)`,
      ['test_real_is', JSON.stringify({ title: 'Frumlegt íslenskt' })]
    );
    translateTree.mockResolvedValue({ title: 'Halló heimur' });

    await request(app)
      .put('/api/v1/content/test_real_is?locale=en')
      .set('Cookie', adminCookie)
      .send({ title: 'Hello world' }); // differs from existing IS

    // Wait briefly for any background write — the merge SHOULD leave the
    // manual edit alone, but if it ever broke we want to catch it.
    await new Promise(r => setTimeout(r, 100));
    const isRow = await readRow('test_real_is', 'is');
    expect(isRow.title).toBe('Frumlegt íslenskt'); // manual edit preserved
  });

  test('overwrites stale-translated IS when EN changed since last save', async () => {
    // Reproduces the production halli_bio bug: previous EN was "The Beginning",
    // IS got "Upphafið". Admin edits EN to "Years of experience" — IS should
    // become "Ára reynsla", not stay at "Upphafið".
    //
    // Seed previous state: an EN row + a matching IS row that's a real
    // translation of the previous EN.
    await db.query(
      `INSERT INTO site_content (key, locale, value) VALUES ($1, 'en', $2::jsonb)`,
      ['test_drift', JSON.stringify({ title: 'The Beginning', untouched: 'Stays the same' })]
    );
    await db.query(
      `INSERT INTO site_content (key, locale, value) VALUES ($1, 'is', $2::jsonb)`,
      ['test_drift', JSON.stringify({ title: 'Upphafið', untouched: 'Helst eins' })]
    );
    translateTree.mockResolvedValue({
      title: 'Ára reynsla',
      untouched: 'Helst eins (translated)',
    });

    // Now simulate the admin editing the title in EN
    await request(app)
      .put('/api/v1/content/test_drift?locale=en')
      .set('Cookie', adminCookie)
      .send({ title: 'Years of experience', untouched: 'Stays the same' });

    const isRow = await waitForIs('test_drift', r => r && r.title === 'Ára reynsla');
    expect(isRow.title).toBe('Ára reynsla');           // EN changed → IS retranslated
    expect(isRow.untouched).toBe('Helst eins');        // EN unchanged → IS preserved
  });

  test('preserves manual IS edits on leaves where EN did not change', async () => {
    // The "EN changed" rule must not be too eager — leaves where EN stays
    // the same keep their manual IS edits, even when the admin saves
    // changes to OTHER leaves.
    await db.query(
      `INSERT INTO site_content (key, locale, value) VALUES ($1, 'en', $2::jsonb)`,
      ['test_partial', JSON.stringify({ title: 'Hello', subtitle: 'World' })]
    );
    await db.query(
      `INSERT INTO site_content (key, locale, value) VALUES ($1, 'is', $2::jsonb)`,
      ['test_partial', JSON.stringify({ title: 'Halló', subtitle: 'Sérsniðin íslenska' })]
    );
    translateTree.mockResolvedValue({ title: 'Halló nýtt', subtitle: 'Heimur' });

    // Admin edits only the title; subtitle EN stays the same
    await request(app)
      .put('/api/v1/content/test_partial?locale=en')
      .set('Cookie', adminCookie)
      .send({ title: 'Hello new', subtitle: 'World' });

    const isRow = await waitForIs('test_partial', r => r && r.title === 'Halló nýtt');
    expect(isRow.title).toBe('Halló nýtt');             // EN changed → retranslated
    expect(isRow.subtitle).toBe('Sérsniðin íslenska');  // EN same → manual IS kept
  });

  test('swallows translator errors — EN save still succeeds', async () => {
    translateTree.mockRejectedValue(new Error('boom'));
    const res = await request(app)
      .put('/api/v1/content/test_err?locale=en')
      .set('Cookie', adminCookie)
      .send({ title: 'T' });

    expect(res.status).toBe(200);
    await tick(); // let the background rejection log + settle
    const enRow = await readRow('test_err', 'en');
    expect(enRow).toEqual({ title: 'T' });
    const isRow = await readRow('test_err', 'is');
    expect(isRow).toBeNull();
  });

  test('no IS row is written when translateTree returns null', async () => {
    translateTree.mockResolvedValue(null);
    await request(app)
      .put('/api/v1/content/test_nullout?locale=en')
      .set('Cookie', adminCookie)
      .send({ title: 'T' });
    await tick();

    const isRow = await readRow('test_nullout', 'is');
    expect(isRow).toBeNull();
  });

  test('no-ops when translator feature flag is off', async () => {
    isEnabled.mockReturnValue(false);
    await request(app)
      .put('/api/v1/content/test_flag_off?locale=en')
      .set('Cookie', adminCookie)
      .send({ title: 'T' });
    await tick();

    expect(translateTree).not.toHaveBeenCalled();
    const isRow = await readRow('test_flag_off', 'is');
    expect(isRow).toBeNull();
  });

  test('returns the EN response without waiting for IS translation', async () => {
    // Hold the translator promise open so we can prove the response returned
    // BEFORE the IS write (the whole point of fire-and-forget).
    let resolveTranslator;
    translateTree.mockImplementation(() => new Promise(r => {
      resolveTranslator = r;
    }));

    const res = await request(app)
      .put('/api/v1/content/test_async?locale=en')
      .set('Cookie', adminCookie)
      .send({ title: 'Hi there' });

    expect(res.status).toBe(200);
    expect(res.body.title).toBe('Hi there');
    // Background translation is still in flight — IS must NOT exist yet.
    const isBefore = await readRow('test_async', 'is');
    expect(isBefore).toBeNull();

    // Unblock the translator and confirm the IS row appears shortly after.
    resolveTranslator({ title: 'Halló' });
    const isAfter = await waitForIs('test_async', r => r && r.title === 'Halló');
    expect(isAfter).toEqual({ title: 'Halló' });
  });
});
