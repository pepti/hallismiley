/**
 * leadsController.parseLeadId — the one place a lead id's shape is decided
 * (rk-feed, 2026-09-23). The engine's leads.id is SERIAL; a product whose
 * table predates the engine's 097 (rekstrarkerfid) holds TEXT uuids. Both
 * shapes pass through as the STRING they arrived as (the model compares
 * `id::text`), everything else is null → 400 before any query. The inbox view
 * mirrors this by never coercing `dataset.id` (AdminLeadsView).
 */
const { parseLeadId } = require('../../server/controllers/leadsController');

describe('parseLeadId', () => {
  test('a positive integer passes through as the string it was', () => {
    expect(parseLeadId('1')).toBe('1');
    expect(parseLeadId('42')).toBe('42');
    expect(parseLeadId(7)).toBe('7');
    expect(parseLeadId(' 12 ')).toBe('12');
  });

  test('a uuid passes through, lower-cased', () => {
    expect(parseLeadId('8D3E1C2A-4B5F-4E6D-9A7B-0C1D2E3F4A5B')).toBe('8d3e1c2a-4b5f-4e6d-9a7b-0c1d2e3f4a5b');
    expect(parseLeadId('8d3e1c2a-4b5f-4e6d-9a7b-0c1d2e3f4a5b')).toBe('8d3e1c2a-4b5f-4e6d-9a7b-0c1d2e3f4a5b');
  });

  test('anything else is null', () => {
    for (const bad of ['0', '-1', '01', '1.5', '1e3', 'abc', '', null, undefined, '12abc',
      '8d3e1c2a-4b5f-4e6d-9a7b', 'g' + '8d3e1c2a-4b5f-4e6d-9a7b-0c1d2e3f4a5b'.slice(1), '1'.repeat(19)]) {
      expect(parseLeadId(bad)).toBeNull();
    }
  });
});
