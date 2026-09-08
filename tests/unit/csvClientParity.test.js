/**
 * public/js/utils/downloadCsv.js is the browser twin of server/utils/csv.js.
 * Both neutralise spreadsheet formulas; only the server carried the PLAIN_NUMBER
 * exemption, so a client-built export (customers, orders) turned every negative
 * figure into the text '-500 while the server-built exports of the same data kept
 * it numeric. The client's own comment claimed the two were "in step".
 *
 * This pins them to one truth table so the next divergence fails here instead of
 * in a bookkeeper's spreadsheet.
 *
 * babel-jest compiles the ESM module to CJS for require() (see money.client.test.js).
 */
const { toCsvString } = require('../../public/js/utils/downloadCsv.js');
const { csvCell } = require('../../server/utils/csv');

// One value through the client writer, isolated: a single-column header row is
// exactly one escaped cell with no delimiters around it.
const clientCell = (v) => toCsvString([v], []);

describe('client CSV writer matches the server', () => {
  const CASES = [
    // [value, why it is here]
    ['-500', 'negative accounting figure — must stay numeric'],
    ['-12.5', 'negative decimal'],
    ['1234', 'plain integer'],
    ['0', 'zero'],
    ['-500.25', 'negative decimal, two places'],
    ['=SUM(A1:A9)', 'formula — must be neutralised'],
    ['=HYPERLINK("https://evil.tld","open")', 'exfiltration link'],
    ['+1', 'leading plus is a formula trigger'],
    ['@import', 'leading at is a formula trigger'],
    ['-', 'a bare hyphen is not a number'],
    ['--5', 'not a number'],
    ['12a', 'not a number'],
    ['1.2.3', 'not a number'],
    ['', 'empty'],
    ['Jón Þórsson', 'plain Icelandic text'],
    ['a,b', 'needs quoting'],
    ['say "hi"', 'embedded quotes'],
  ];

  test.each(CASES)('%s (%s)', (value) => {
    expect(clientCell(value)).toBe(csvCell(value));
  });

  test('a negative number survives as a number on both sides', () => {
    expect(clientCell('-500')).toBe('-500');
    expect(csvCell('-500')).toBe('-500');
  });

  test('a formula is still neutralised on both sides', () => {
    expect(clientCell('=SUM(A1)')).toBe("'=SUM(A1)");
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
  });

  test('null and undefined render empty on both sides', () => {
    expect(clientCell(null)).toBe(csvCell(null));
    expect(clientCell(undefined)).toBe(csvCell(undefined));
  });
});
