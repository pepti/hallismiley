'use strict';

// Integration tests for PUT /api/v1/content/party_rsvp_form — the per-locale
// save path used by PartyView's inline label/option editor. Mocks the
// translator so we control what the IS side effect writes.

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
  // Background auto-translate from a previous test can race past the DELETE
  // if we don't yield first. One tick is enough — the side effect awaits its
  // mocked translator and the subsequent INSERT inside the same microtask.
  await new Promise(r => setImmediate(r));
  await db.query("DELETE FROM site_content WHERE key = 'party_rsvp_form'");
  adminCookie = await getTestSessionCookie();
  translateTree.mockReset();
  isEnabled.mockReset();
  isEnabled.mockReturnValue(true);
});

afterAll(async () => {
  await db.query("DELETE FROM site_content WHERE key = 'party_rsvp_form'");
});

async function readRow(locale) {
  const { rows } = await db.query(
    "SELECT value FROM site_content WHERE key = 'party_rsvp_form' AND locale = $1",
    [locale]
  );
  return rows[0] ? rows[0].value : null;
}

async function waitForIs(predicate, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = await readRow('is');
    if (predicate(row)) return row;
    await new Promise(r => setTimeout(r, 25));
  }
  return await readRow('is');
}

const tick = () => new Promise(r => setImmediate(r));

// Minimal rsvp_form shape mirroring _defaultRsvpForm() in PartyView. Keeping
// the test fixture compact — the shape is the contract, not the content.
const EN_FORM = [
  { id: 'attend_when',      type: 'radio-group', label: 'When will you join?',
    options: ['Daytime', 'Evening', "Sorry, can't make it"] },
  { id: 'helping',          type: 'checkbox-group', label: 'Want to help out?',
    options: ['Help with planning', 'Host an activity'] },
  { id: 'activity_details', type: 'textarea', label: 'What activity would you host?',
    placeholder: 'A short description',
    showIf: { fieldId: 'helping', value: 'Host an activity' } },
];

describe('PUT /api/v1/content/party_rsvp_form', () => {
  test('PUT ?locale=en persists the array and triggers translateTree → IS row', async () => {
    // translateTree is called with the saved EN array; return a parallel
    // shape with translated string leaves. fieldId is in BLOCK_KEYS, so the
    // real implementation would keep it verbatim — we model that here.
    translateTree.mockResolvedValue([
      { id: 'attend_when', type: 'radio-group', label: 'IS:When will you join?',
        options: ['IS:Daytime', 'IS:Evening', "IS:Sorry, can't make it"] },
      { id: 'helping', type: 'checkbox-group', label: 'IS:Want to help out?',
        options: ['IS:Help with planning', 'IS:Host an activity'] },
      { id: 'activity_details', type: 'textarea', label: 'IS:What activity would you host?',
        placeholder: 'IS:A short description',
        showIf: { fieldId: 'helping', value: 'IS:Host an activity' } },
    ]);

    const res = await request(app)
      .put('/api/v1/content/party_rsvp_form?locale=en')
      .set('Cookie', adminCookie)
      .send(EN_FORM);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].label).toBe('When will you join?'); // EN response is the body verbatim

    const enRow = await readRow('en');
    expect(enRow).toEqual(EN_FORM);

    const isRow = await waitForIs(r => Array.isArray(r) && r[0]?.label === 'IS:When will you join?');
    expect(Array.isArray(isRow)).toBe(true);
    expect(isRow[0].label).toBe('IS:When will you join?');
    expect(isRow[0].options).toEqual(['IS:Daytime', 'IS:Evening', "IS:Sorry, can't make it"]);
    expect(isRow[2].showIf.fieldId).toBe('helping'); // structural reference preserved
    expect(isRow[2].showIf.value).toBe('IS:Host an activity'); // matches translated option
  });

  test('PUT ?locale=is writes only the IS row and leaves the EN row untouched', async () => {
    // Seed both rows so we can prove the IS write does not cross over.
    await db.query(
      `INSERT INTO site_content (key, locale, value) VALUES
         ('party_rsvp_form', 'en', $1::jsonb),
         ('party_rsvp_form', 'is', $2::jsonb)
       ON CONFLICT (key, locale) DO UPDATE
         SET value = EXCLUDED.value`,
      [JSON.stringify(EN_FORM), JSON.stringify(EN_FORM)]
    );

    const IS_FORM = EN_FORM.map(f => ({ ...f, label: 'IS-manual:' + f.label }));
    const res = await request(app)
      .put('/api/v1/content/party_rsvp_form?locale=is')
      .set('Cookie', adminCookie)
      .send(IS_FORM);

    expect(res.status).toBe(200);
    await tick();
    expect(translateTree).not.toHaveBeenCalled();

    const enRow = await readRow('en');
    expect(enRow).toEqual(EN_FORM); // EN untouched

    const isRow = await readRow('is');
    expect(isRow[0].label).toBe('IS-manual:When will you join?');
    expect(isRow[2].showIf.fieldId).toBe('helping');
  });

  // The fix for the maybe-classification bug stores radio options as
  // `{ label, status }` objects. `status` lives in the translator's
  // BLOCK_KEYS, so the auto-translate side effect must walk the tree,
  // translate the `label` leaf, and leave the `status` value verbatim on
  // both EN and IS rows. This guards the round-trip end-to-end.
  test('PUT preserves per-option status field on EN and IS rows', async () => {
    const ENObj = [
      { id: 'attend_when', type: 'radio-group', label: 'When will you join?',
        options: [
          { label: 'Daytime',              status: 'going'    },
          { label: 'Evening',              status: 'going'    },
          { label: '🤔 Maybe',             status: 'maybe'    },
          { label: "Sorry, can't make it", status: 'declined' },
        ] },
    ];
    translateTree.mockResolvedValue([
      { id: 'attend_when', type: 'radio-group', label: 'IS:When will you join?',
        options: [
          { label: 'IS:Daytime',              status: 'going'    },
          { label: 'IS:Evening',              status: 'going'    },
          { label: 'IS:🤔 Maybe',             status: 'maybe'    },
          { label: "IS:Sorry, can't make it", status: 'declined' },
        ] },
    ]);

    const res = await request(app)
      .put('/api/v1/content/party_rsvp_form?locale=en')
      .set('Cookie', adminCookie)
      .send(ENObj);
    expect(res.status).toBe(200);
    expect(res.body[0].options[2]).toEqual({ label: '🤔 Maybe', status: 'maybe' });

    const enRow = await readRow('en');
    expect(enRow[0].options).toEqual(ENObj[0].options);
    expect(enRow[0].options[3].status).toBe('declined');

    const isRow = await waitForIs(r => Array.isArray(r) && r[0]?.options?.[2]?.label === 'IS:🤔 Maybe');
    expect(isRow[0].options[0]).toEqual({ label: 'IS:Daytime',              status: 'going'    });
    expect(isRow[0].options[2]).toEqual({ label: 'IS:🤔 Maybe',             status: 'maybe'    });
    expect(isRow[0].options[3]).toEqual({ label: "IS:Sorry, can't make it", status: 'declined' });
  });

  test('translateTree result is merged into existing IS — manual IS edits preserved when EN unchanged', async () => {
    // Admin previously hand-translated the IS row. Then edits only ONE EN
    // label and re-saves EN. The merge in mergeTranslatedTree should keep
    // the manual IS labels that have no corresponding EN change.
    await db.query(
      `INSERT INTO site_content (key, locale, value) VALUES
         ('party_rsvp_form', 'en', $1::jsonb),
         ('party_rsvp_form', 'is', $2::jsonb)
       ON CONFLICT (key, locale) DO UPDATE
         SET value = EXCLUDED.value`,
      [
        JSON.stringify(EN_FORM),
        JSON.stringify([
          { id: 'attend_when', type: 'radio-group', label: 'Hvenær mætirðu?',
            options: ['Dag', 'Kvöld', 'Því miður, kemst ekki'] },
          { id: 'helping', type: 'checkbox-group', label: 'Viltu hjálpa til?',
            options: ['Skipulagshjálp', 'Hýsa virkni'] },
          { id: 'activity_details', type: 'textarea', label: 'Hvaða virkni myndir þú hýsa?',
            placeholder: 'Stutt lýsing',
            showIf: { fieldId: 'helping', value: 'Hýsa virkni' } },
        ]),
      ]
    );

    // Admin edits only the activity_details placeholder in EN.
    const editedEn = EN_FORM.map(f => ({ ...f }));
    editedEn[2] = { ...editedEn[2], placeholder: 'Tell us more!' };

    translateTree.mockResolvedValue([
      { id: 'attend_when', type: 'radio-group', label: 'IS:When will you join?',
        options: ['IS:Daytime', 'IS:Evening', "IS:Sorry, can't make it"] },
      { id: 'helping', type: 'checkbox-group', label: 'IS:Want to help out?',
        options: ['IS:Help with planning', 'IS:Host an activity'] },
      { id: 'activity_details', type: 'textarea', label: 'IS:What activity would you host?',
        placeholder: 'IS:Tell us more!',
        showIf: { fieldId: 'helping', value: 'IS:Host an activity' } },
    ]);

    await request(app)
      .put('/api/v1/content/party_rsvp_form?locale=en')
      .set('Cookie', adminCookie)
      .send(editedEn);

    // Wait until the merged IS row reflects the EN-side placeholder change.
    const isRow = await waitForIs(r => Array.isArray(r) && r[2]?.placeholder === 'IS:Tell us more!');

    // Placeholder for activity_details changed in EN → IS leaf retranslated.
    expect(isRow[2].placeholder).toBe('IS:Tell us more!');
    // Labels that the admin manually translated and where EN didn't change
    // are preserved (mergeTranslatedTree leaves real manual IS edits alone).
    expect(isRow[0].label).toBe('Hvenær mætirðu?');
    expect(isRow[1].label).toBe('Viltu hjálpa til?');
  });
});
