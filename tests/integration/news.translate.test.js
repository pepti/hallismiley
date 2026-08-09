'use strict';

// Integration tests for the auto-translate hook in newsController.
// Uses jest.mock() on server/services/translator so we control translation
// output without touching Anthropic.

jest.mock('../../server/services/translator', () => ({
  translate:     jest.fn(),
  translateTree: jest.fn(),
  isEnabled:     jest.fn(() => true),
}));

const request = require('supertest');
const app     = require('../../server/app');
const {
  getTestSessionCookie,
  cleanTables,
  validArticle,
} = require('../helpers');
const { translate, isEnabled } = require('../../server/services/translator');

let adminCookie;

beforeEach(async () => {
  await cleanTables();
  adminCookie = await getTestSessionCookie();
  translate.mockReset();
  isEnabled.mockReset();
  isEnabled.mockReturnValue(true);
});


describe('POST /api/v1/news — auto-translate on create', () => {
  test('fills empty IS fields when translator is enabled', async () => {
    translate.mockImplementation(async ({ text, format }) => {
      return `IS(${format}):${text}`;
    });
    const res = await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ title: 'Hello', summary: 'Short sum', body: 'The body.' }));
    expect(res.status).toBe(201);
    expect(res.body.title_is).toBe('IS(plain):Hello');
    expect(res.body.summary_is).toBe('IS(plain):Short sum');
    expect(res.body.body_is).toBe('IS(markdown):The body.');
    expect(translate).toHaveBeenCalledTimes(3);
  });

  test('does not translate when admin typed IS fields manually', async () => {
    translate.mockResolvedValue('SHOULD-NOT-APPEAR');
    const res = await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({
        title: 'Hello',
        summary: 'Sum',
        body: 'Body.',
        title_is: 'Manual IS title',
        summary_is: 'Manual IS summary',
        body_is: 'Manual IS body',
      }));
    expect(res.status).toBe(201);
    expect(res.body.title_is).toBe('Manual IS title');
    expect(res.body.summary_is).toBe('Manual IS summary');
    expect(res.body.body_is).toBe('Manual IS body');
    expect(translate).not.toHaveBeenCalled();
  });

  test('__autoTranslate:false disables translation even with empty IS fields', async () => {
    translate.mockResolvedValue('SHOULD-NOT-APPEAR');
    const res = await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ title: 'Hello', summary: 'Sum', body: 'Body.', __autoTranslate: false }));
    expect(res.status).toBe(201);
    expect(res.body.title_is).toBeNull();
    expect(translate).not.toHaveBeenCalled();
  });

  test('no-ops when translator feature flag is off', async () => {
    isEnabled.mockReturnValue(false);
    const res = await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ title: 'Hello', summary: 'Sum', body: 'Body.' }));
    expect(res.status).toBe(201);
    expect(res.body.title_is).toBeNull();
    expect(translate).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/v1/news/:id — auto-translate on update', () => {
  async function createArticle(overrides = {}) {
    const r = await request(app)
      .post('/api/v1/news')
      .set('Cookie', adminCookie)
      .send(validArticle({ __autoTranslate: false, ...overrides }));
    return r.body;
  }

  test('fills IS when PATCH sets new EN and existing IS was null', async () => {
    const art = await createArticle({ title: 'Old', title_is: null });
    translate.mockResolvedValue('Nýr titill');
    const res = await request(app)
      .patch(`/api/v1/news/${art.id}`)
      .set('Cookie', adminCookie)
      .send({ title: 'New EN' });
    expect(res.status).toBe(200);
    expect(res.body.title_is).toBe('Nýr titill');
  });

  test('does NOT overwrite an IS value already stored in the DB', async () => {
    const art = await createArticle({ title: 'Old', title_is: 'Halldórssamningur' });
    translate.mockResolvedValue('SHOULD-NOT-APPEAR');
    const res = await request(app)
      .patch(`/api/v1/news/${art.id}`)
      .set('Cookie', adminCookie)
      .send({ title: 'New EN' });
    expect(res.status).toBe(200);
    expect(res.body.title_is).toBe('Halldórssamningur');
    expect(translate).not.toHaveBeenCalled();
  });

  test('PATCH that explicitly passes title_is overrides anything the translator would produce', async () => {
    const art = await createArticle({ title: 'Old', title_is: null });
    translate.mockResolvedValue('automatic IS');
    const res = await request(app)
      .patch(`/api/v1/news/${art.id}`)
      .set('Cookie', adminCookie)
      .send({ title: 'New EN', title_is: 'Manual override' });
    expect(res.status).toBe(200);
    expect(res.body.title_is).toBe('Manual override');
  });
});
