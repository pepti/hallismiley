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
  await db.pool.end();
});

async function readRow(key, locale) {
  const { rows } = await db.query(
    'SELECT value FROM site_content WHERE key = $1 AND locale = $2',
    [key, locale]
  );
  return rows[0] ? rows[0].value : null;
}

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

    const isRow = await readRow('test_hero', 'is');
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

    expect(translateTree).not.toHaveBeenCalled();
    const isRow = await readRow('test_skip', 'is');
    expect(isRow).toBeNull();
  });

  test('does not run IS side effect when saving an IS row directly', async () => {
    await request(app)
      .put('/api/v1/content/test_direct_is?locale=is')
      .set('Cookie', adminCookie)
      .send({ title: 'Beint á íslensku' });

    expect(translateTree).not.toHaveBeenCalled();
    const isRow = await readRow('test_direct_is', 'is');
    expect(isRow).toEqual({ title: 'Beint á íslensku' });
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

    const isRow = await readRow('test_merge', 'is');
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

    const isRow = await readRow('test_stale', 'is');
    // Stale-EN-as-IS leaves get the new translation
    expect(isRow.eyebrow).toBe('NÝR EYEBROW');
    expect(isRow.title).toBe('NÝR TITLE');
    // The IS leaf that was a real manual Icelandic edit (not equal to EN)
    // is still preserved, even though EN changed
    expect(isRow.manual_is).toBe('Þetta er handskrifað');
  });

  test('still preserves IS that differs from EN even when EN matches the translation', async () => {
    // Defensive: ensure the new "byte-identical to EN" rule is the ONLY new
    // overwrite signal — IS that differs from EN must still be preserved.
    await db.query(
      `INSERT INTO site_content (key, locale, value) VALUES ($1, 'is', $2::jsonb)`,
      ['test_real_is', JSON.stringify({ title: 'Frumlegt íslenskt' })]
    );
    translateTree.mockResolvedValue({ title: 'Halló heimur' });

    await request(app)
      .put('/api/v1/content/test_real_is?locale=en')
      .set('Cookie', adminCookie)
      .send({ title: 'Hello world' }); // differs from existing IS

    const isRow = await readRow('test_real_is', 'is');
    expect(isRow.title).toBe('Frumlegt íslenskt'); // manual edit preserved
  });

  test('swallows translator errors — EN save still succeeds', async () => {
    translateTree.mockRejectedValue(new Error('boom'));
    const res = await request(app)
      .put('/api/v1/content/test_err?locale=en')
      .set('Cookie', adminCookie)
      .send({ title: 'T' });

    expect(res.status).toBe(200);
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

    const isRow = await readRow('test_nullout', 'is');
    expect(isRow).toBeNull();
  });

  test('no-ops when translator feature flag is off', async () => {
    isEnabled.mockReturnValue(false);
    await request(app)
      .put('/api/v1/content/test_flag_off?locale=en')
      .set('Cookie', adminCookie)
      .send({ title: 'T' });

    expect(translateTree).not.toHaveBeenCalled();
    const isRow = await readRow('test_flag_off', 'is');
    expect(isRow).toBeNull();
  });
});
