'use strict';

// Phone + Icelandic postcode rules (ported from icelandicstore #399). The
// server validators (checkout address, contact form, signup/profile phone) and
// the client forms must refuse exactly the same values, so both twins run
// through one corpus here.

const server = require('../../server/utils/contactFormat');
const client = require('../../public/js/utils/contactFormat.js');

const ZIPS = [
  // [zip, country, valid]
  ['101', 'IS', true], ['600', '', true], [' 220 ', 'is', true], ['900', undefined, true],
  ['1', 'IS', false], ['9', '', false], ['1010', 'IS', false], ['101 Reykjavík', 'IS', false],
  ['IS-101', undefined, false], ['', 'IS', false], ['abc', null, false],
  // Abroad the postcode is free text.
  ['SW1A 1AA', 'GB', true], ['10115', 'DE', true], ['1', 'DK', true], ['2100', 'dk', true],
];

const PHONES = [
  ['5551234', true], ['+354 555 1234', true], ['(555) 123-4567', true], ['555.1234', true],
  ['+44 20 7946 0958', true],
  ['123', false], ['phone', false], ['555-1234 ext 9', false], ['+354 555 1234 5678 9012 3', false],
  [5551234, false], [null, false],
];

describe('isValidZip (server == client)', () => {
  test.each(ZIPS)('%p in %p → %p', (zip, country, want) => {
    expect(server.isValidZip(zip, country)).toBe(want);
    expect(client.isValidZip(zip, country)).toBe(want);
  });
});

describe('isValidPhone (server == client)', () => {
  test.each(PHONES)('%p → %p', (phone, want) => {
    expect(server.isValidPhone(phone)).toBe(want);
    expect(client.isValidPhone(phone)).toBe(want);
  });

  test('the two twins carry the same regular expressions', () => {
    expect(client.PHONE_RE.source).toBe(server.PHONE_RE.source);
    expect(client.IS_ZIP_RE.source).toBe(server.IS_ZIP_RE.source);
  });

  test('validate.js uses the shared phone rule, not a private copy', () => {
    const src = require('fs').readFileSync(require.resolve('../../server/middleware/validate.js'), 'utf8');
    expect(src).not.toMatch(/const PHONE_RE\s*=/);
    expect(src).toMatch(/require\('\.\.\/utils\/contactFormat'\)/);
  });
});
