'use strict';

// Unit tests for server/services/autoTranslateFields.js.
// Stubs the translator module so each test can control its output.

jest.mock('../../server/services/translator', () => ({
  translate: jest.fn(),
  isEnabled: jest.fn(() => true),
}));

const { translate, isEnabled } = require('../../server/services/translator');
const { autoTranslateFields } = require('../../server/services/autoTranslateFields');

beforeEach(() => {
  translate.mockReset();
  isEnabled.mockReset();
  isEnabled.mockReturnValue(true);
});

describe('autoTranslateFields', () => {
  const PAIRS = [
    ['title',       'title_is',       'plain'],
    ['description', 'description_is', 'markdown'],
  ];

  test('no-op when translator is disabled', async () => {
    isEnabled.mockReturnValue(false);
    const body = { title: 'Hello', title_is: null };
    await autoTranslateFields(body, PAIRS);
    expect(body.title_is).toBeNull();
    expect(translate).not.toHaveBeenCalled();
  });

  test('fills empty IS field from EN on create', async () => {
    translate.mockResolvedValueOnce('Halló');
    const body = { title: 'Hello', title_is: null };
    await autoTranslateFields(body, PAIRS);
    expect(body.title_is).toBe('Halló');
    expect(translate).toHaveBeenCalledWith({ text: 'Hello', format: 'plain' });
  });

  test('does not overwrite IS field that the admin filled in', async () => {
    translate.mockResolvedValueOnce('SHOULD-NOT-APPEAR');
    const body = { title: 'Hello', title_is: 'Manually typed IS' };
    await autoTranslateFields(body, PAIRS);
    expect(body.title_is).toBe('Manually typed IS');
    expect(translate).not.toHaveBeenCalled();
  });

  test('does not overwrite IS content that already exists in the DB on PATCH', async () => {
    const body = { title: 'New EN only' };
    const existingRow = { title: 'Old EN', title_is: 'Already-IS' };
    await autoTranslateFields(body, PAIRS, { existingRow });
    expect(body).not.toHaveProperty('title_is');
    expect(translate).not.toHaveBeenCalled();
  });

  test('fills IS on PATCH when existing IS is null', async () => {
    translate.mockResolvedValueOnce('Ný IS');
    const body = { title: 'New EN' };
    const existingRow = { title: 'Old EN', title_is: null };
    await autoTranslateFields(body, PAIRS, { existingRow });
    expect(body.title_is).toBe('Ný IS');
  });

  test('skips IS when EN is blank / missing', async () => {
    const body = { title: '', description: null };
    await autoTranslateFields(body, PAIRS);
    expect(body.title_is).toBeUndefined();
    expect(body.description_is).toBeUndefined();
    expect(translate).not.toHaveBeenCalled();
  });

  test('__autoTranslate:false short-circuits everything and strips the flag', async () => {
    const body = { title: 'Hello', title_is: null, __autoTranslate: false };
    await autoTranslateFields(body, PAIRS);
    expect(body).not.toHaveProperty('__autoTranslate');
    expect(body.title_is).toBeNull();
    expect(translate).not.toHaveBeenCalled();
  });

  test('__autoTranslate:true is treated as default and stripped', async () => {
    translate.mockResolvedValueOnce('Halló');
    const body = { title: 'Hello', title_is: null, __autoTranslate: true };
    await autoTranslateFields(body, PAIRS);
    expect(body).not.toHaveProperty('__autoTranslate');
    expect(body.title_is).toBe('Halló');
  });

  test('handles multiple pairs independently', async () => {
    translate
      .mockResolvedValueOnce('Titill')
      .mockResolvedValueOnce('Lýsing í markdown');
    const body = { title: 'Title', description: '# Hi' };
    await autoTranslateFields(body, PAIRS);
    expect(body.title_is).toBe('Titill');
    expect(body.description_is).toBe('Lýsing í markdown');
  });

  test('falls through silently when translate() returns null', async () => {
    translate.mockResolvedValueOnce(null);
    const body = { title: 'Hello', title_is: null };
    await autoTranslateFields(body, PAIRS);
    // IS field stays null — graceful degradation
    expect(body.title_is).toBeNull();
  });

  test('does not mutate when body is null/undefined', async () => {
    await expect(autoTranslateFields(null, PAIRS)).resolves.toBeUndefined();
    await expect(autoTranslateFields(undefined, PAIRS)).resolves.toBeUndefined();
  });
});
