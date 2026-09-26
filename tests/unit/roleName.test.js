'use strict';

// Display names → slugs for admin roles (server/utils/roleName.js). Ported from
// icelandicstore #421 (tests/unit/companyRoleName.test.js), adapted to the
// engine's built-in roles and its folded back-office deny-list (harvest 2 G1/G4).
const {
  NAME_RE, RESERVED_SLUGS, cleanLabel, labelProblem, slugCandidates, slugReserved, labelKey,
} = require('../../server/utils/roleName');

describe('cleanLabel', () => {
  test('trims and collapses whitespace', () => {
    expect(cleanLabel('  Bókari   á   skrifstofu ')).toBe('Bókari á skrifstofu');
  });

  test('drops invisible and direction-override characters', () => {
    const rlo = String.fromCharCode(0x202e);
    const zwsp = String.fromCharCode(0x200b);
    expect(cleanLabel(`Bók${zwsp}ari${rlo}`)).toBe('Bókari');
  });

  test('NFKC folds full-width look-alikes to the plain letter', () => {
    expect(cleanLabel('Ｂókari')).toBe('Bókari');
  });

  test('non-strings are empty', () => {
    expect(cleanLabel(undefined)).toBe('');
    expect(cleanLabel(42)).toBe('');
  });
});

describe('labelProblem', () => {
  test('an ordinary Icelandic name is fine', () => {
    for (const l of ['Bókari', 'Innkaupandi', 'Þjónustuver & sala', 'Ö2', 'Sölumaður']) expect(labelProblem(l)).toBeNull();
  });

  test('no letter, too short, too long, or outside Latin script → 400', () => {
    expect(labelProblem('()')).toMatchObject({ status: 400 });
    expect(labelProblem('B')).toMatchObject({ status: 400 });
    expect(labelProblem('x'.repeat(31))).toMatchObject({ status: 400 });
    expect(labelProblem('Бухгалтер')).toMatchObject({ status: 400 }); // Cyrillic
    const cyrillicO = String.fromCharCode(0x043e);
    expect(labelProblem(`B${cyrillicO}kari`)).toMatchObject({ status: 400 }); // one homoglyph is enough
    // Digits are 0-9 only: an Arabic-Indic three is not one of them.
    expect(labelProblem(`Bx${String.fromCharCode(0x0663)}`)).toMatchObject({ status: 400 });
  });

  test('back-office and built-in names are reserved (409), whatever the case, accents or spacing', () => {
    for (const l of ['Admin', 'ADMINISTRATOR', 'Admin 2', 'Administration', 'admin-sala', 'Stjórnandi',
      'Stjórnendur', 'starfsmaður', 'Starfsfólk', 'Kerfi', 'Kerfisstjóri', 'Staff', 'System', 'Root',
      'Owner', 'Support', 'Moderator', 'User', 'Notandi', 'Super user']) {
      expect(labelProblem(l)).toMatchObject({ status: 409, key: 'errors.admin.roleNameReserved' });
    }
  });
});

describe('slugReserved (the legacy { name } create)', () => {
  test('built-ins and folded back-office names', () => {
    for (const s of ['admin', 'moderator', 'user', 'staff', 'kerfi', 'stjornandi', 'administrator', 'admin-2', 'root']) {
      expect(slugReserved(s)).toBe(true);
    }
    for (const s of ['shopkeeper', 'bokari', 'solumadur']) expect(slugReserved(s)).toBe(false);
  });
});

describe('labelKey', () => {
  test('case, accents and punctuation fold away', () => {
    expect(labelKey('Bókari')).toBe(labelKey('bokari!'));
    expect(labelKey('Sölu-fólk')).toBe(labelKey('solufolk'));
  });
});

describe('slugCandidates', () => {
  test('folds Icelandic letters and numbers the rest', () => {
    const c = slugCandidates('Þjónustuver á Akureyri');
    expect(c[0]).toBe('thjonustuver-a-akureyri');
    expect(c[1]).toBe('thjonustuver-a-akureyri-2');
    expect(c[2]).toBe('thjonustuver-a-akureyri-3');
  });

  test('every candidate matches the name rule and none is reserved', () => {
    for (const label of ['Bókari', 'x'.repeat(30), '!!', 'Ö', 'Manager']) {
      for (const s of slugCandidates(label)) {
        expect(s).toMatch(NAME_RE);
        expect([...RESERVED_SLUGS]).not.toContain(s);
        expect(slugReserved(s)).toBe(false);
      }
    }
  });

  test('a label that folds to almost nothing starts from "role"', () => {
    expect(slugCandidates('!!')[0]).toBe('role');
  });
});
