'use strict';

// Integration tests for the party-specific auto-translate direction in
// partyController.updateInfo. Unlike generic site content (EN-primary,
// see content.translate.test.js), the /party page is ICELANDIC-primary:
// saving the IS locale translates IS → EN in the background; saving EN
// leaves IS untouched.
//
// Mocks the translator so we control the translated tree without hitting
// the Anthropic API.

jest.mock('../../server/services/translator', () => ({
  translate:     jest.fn(),
  translateTree: jest.fn(),
  isEnabled:     jest.fn(() => true),
}));

const request = require('supertest');
const app     = require('../../server/app');
const db      = require('../../server/config/database');
const {
  createTestAdminUser,
  getTestSessionCookie,
  cleanTables,
} = require('../helpers');
const { translateTree, isEnabled } = require('../../server/services/translator');

let adminCookie;

beforeEach(async () => {
  await cleanTables();
  const adminId = await createTestAdminUser();
  adminCookie   = await getTestSessionCookie(adminId);
  translateTree.mockReset();
  isEnabled.mockReset();
  isEnabled.mockReturnValue(true);
});

async function readRow(key, locale) {
  const { rows } = await db.query(
    'SELECT value FROM site_content WHERE key = $1 AND locale = $2',
    [key, locale]
  );
  return rows[0] ? rows[0].value : null;
}

// The EN auto-translate side effect runs fire-and-forget after the response
// is sent, so tests that assert on the EN row must poll for it.
async function waitForEn(key, predicate, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = await readRow(key, 'en');
    if (predicate(row)) return row;
    await new Promise(r => setTimeout(r, 25));
  }
  return await readRow(key, 'en');
}

const tick = () => new Promise(r => setImmediate(r));

describe('PATCH /api/v1/party/info — Icelandic-primary auto-translate', () => {
  test('saving IS fans out a translated EN row (IS → EN)', async () => {
    translateTree.mockResolvedValue([
      { time: '18:00', title: 'The Beginning' },
    ]);

    const res = await request(app)
      .patch('/api/v1/party/info?locale=is')
      .set('Cookie', adminCookie)
      .send({ schedule: JSON.stringify([{ time: '18:00', title: 'Upphafið' }]) });
    expect(res.status).toBe(200);

    const en = await waitForEn('party_schedule', r => Array.isArray(r) && r.length > 0);
    expect(en).toEqual([{ time: '18:00', title: 'The Beginning' }]);

    // The translator was asked to go IS → EN — the flipped direction.
    expect(translateTree).toHaveBeenCalledTimes(1);
    expect(translateTree.mock.calls[0][1]).toMatchObject({
      sourceLocale: 'is',
      targetLocale: 'en',
    });
  });

  test('saving EN runs NO side effect — the IS row is left untouched', async () => {
    // Seed a manual IS row first.
    await request(app)
      .patch('/api/v1/party/info?locale=is')
      .set('Cookie', adminCookie)
      .send({ venue_details: JSON.stringify({ note: 'Íslensk lýsing' }) });
    // The IS save above translates IS → EN — let it settle, then reset the spy
    // so the EN-save assertion below is clean.
    await waitForEn('party_venue_details', r => r !== null);
    translateTree.mockReset();

    await request(app)
      .patch('/api/v1/party/info?locale=en')
      .set('Cookie', adminCookie)
      .send({ venue_details: JSON.stringify({ note: 'English description' }) });
    await tick();

    // EN edit must not touch IS, and must not invoke the translator at all.
    expect(translateTree).not.toHaveBeenCalled();
    const is = await readRow('party_venue_details', 'is');
    expect(is).toEqual({ note: 'Íslensk lýsing' });
  });

  test('__autoTranslate:false on an IS save skips the EN side effect', async () => {
    translateTree.mockResolvedValue([{ time: '18:00', title: 'The Beginning' }]);

    await request(app)
      .patch('/api/v1/party/info?locale=is')
      .set('Cookie', adminCookie)
      .send({
        schedule: JSON.stringify([{ time: '18:00', title: 'Upphafið' }]),
        __autoTranslate: false,
      });
    await tick();

    expect(translateTree).not.toHaveBeenCalled();
    expect(await readRow('party_schedule', 'en')).toBeNull();
  });

  test('merge preserves a manual EN leaf that the admin edited by hand', async () => {
    // Existing EN row holds a manual translation the admin typed themselves.
    await db.query(
      `INSERT INTO site_content (key, locale, value, updated_by)
       VALUES ('party_venue_details', 'en', $1::jsonb, NULL)`,
      [JSON.stringify({ note: 'Hand-written EN' })]
    );

    // translateTree would produce a different EN, but since the IS leaf did
    // not previously exist as a stale copy and EN didn't change, the manual
    // EN survives.
    translateTree.mockResolvedValue({ note: 'Auto EN' });

    await request(app)
      .patch('/api/v1/party/info?locale=is')
      .set('Cookie', adminCookie)
      .send({ venue_details: JSON.stringify({ note: 'Ný íslensk lýsing' }) });

    // Give the background merge a moment; EN should stay the hand-written value.
    await waitForEn('party_venue_details', () => true);
    const en = await readRow('party_venue_details', 'en');
    expect(en).toEqual({ note: 'Hand-written EN' });
  });
});
