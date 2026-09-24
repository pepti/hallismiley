'use strict';

// The two small helpers behind name-only logins (2026-09-21): the username a
// person is told to type, and the one test every mail/show/export path asks
// before treating users.email as an address.
const { usernameSlug } = require('../../server/utils/username');
const {
  isPlaceholderEmail, realEmail, noEmailEmail, deviceEmail, realEmailSql, realEmailExpr,
} = require('../../server/utils/placeholderEmail');

describe('usernameSlug — Icelandic names transliterated, not stripped', () => {
  test.each([
    ['Þórður Ólafsson', 'thordurolafsson'],   // was "rurlafsson"
    ['Guðrún Ævarsdóttir', 'gudrunaevarsdottir'],
    ['Björk Guðmundsdóttir', 'bjorkgudmundsdottir'],
    ['ÞÓRA', 'thora'],
    ['Élodie Müller', 'elodiemuller'],
    ['Anna', 'anna'],
    ['anna.jons', 'anna.jons'],
    ['  --Jón-- ', 'jon'],
    ['', 'user'],
    ['日本', 'user'],
  ])('%s → %s', (name, slug) => {
    expect(usernameSlug(name)).toBe(slug);
  });

  test('is capped at 24 characters and never ends on a separator', () => {
    const s = usernameSlug('Aðalheiður Þorgerður Sveinbjarnardóttir');
    expect(s.length).toBeLessThanOrEqual(24);
    expect(s).toMatch(/^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/);
    expect(usernameSlug('abcdefghijklmnopqrstuvw.xyz')).toBe('abcdefghijklmnopqrstuvw');
  });
});

describe('placeholderEmail', () => {
  test('both reserved domains are placeholders; ordinary and look-alike addresses are not', () => {
    expect(isPlaceholderEmail(noEmailEmail('anna'))).toBe(true);
    expect(isPlaceholderEmail(deviceEmail('pressan'))).toBe(true);
    expect(isPlaceholderEmail('ANNA@NOEMAIL.INVALID ')).toBe(true);
    expect(isPlaceholderEmail('anna@example.is')).toBe(false);
    expect(isPlaceholderEmail('anna@noemail.invalid.is')).toBe(false);
    expect(isPlaceholderEmail('anna@other.invalid')).toBe(false);
    expect(isPlaceholderEmail(null)).toBe(false);
    expect(isPlaceholderEmail('')).toBe(false);
  });

  test('realEmail: the address, or null for blank / placeholder', () => {
    expect(realEmail('anna@example.is')).toBe('anna@example.is');
    expect(realEmail('anna@noemail.invalid')).toBeNull();
    expect(realEmail('x@pressan.invalid')).toBeNull();
    expect(realEmail('   ')).toBeNull();
    expect(realEmail(undefined)).toBeNull();
  });

  test('the SQL helpers name both domains and only the given column', () => {
    const sql = realEmailSql('u.email');
    expect(sql).toContain("lower(btrim(u.email)) NOT LIKE '%@noemail.invalid'");
    expect(sql).toContain("lower(btrim(u.email)) NOT LIKE '%@pressan.invalid'");
    expect(realEmailExpr('u.email')).toMatch(/^\(CASE WHEN .* THEN u\.email END\)$/);
  });
});
