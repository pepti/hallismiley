// CSV cell escaping: the two jobs it does, and the negative-number case that broke.
const { csvCell, toCsv } = require('../../server/utils/csv');

describe('csvCell — formula neutralisation', () => {
  it('neutralises the real injection vectors', () => {
    // These evaluate in Excel/Sheets and are attacker-reachable through guest names and
    // supplier names typed off a paper invoice. A leading apostrophe forces literal text.
    expect(csvCell('=HYPERLINK("http://evil.tld")')).toBe('"\'=HYPERLINK(""http://evil.tld"")"');
    expect(csvCell('+1+1')).toBe("'+1+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    // No comma/quote/newline, so neutralised but not quoted.
    expect(csvCell('=cmd|calc')).toBe("'=cmd|calc");
    // A leading tab would leave a formula character first, so it is neutralised and, being
    // a control char, also quoted.
    expect(csvCell('\t=1')).toBe('"\'\t=1"');
  });

  it('leaves a plain negative number numeric', () => {
    // The regression: a leading '-' on a NUMBER is not injection, but prefixing it turned
    // every negative balance into the text '-500 and broke numeric import. =-500 evaluates
    // to -500 in a spreadsheet anyway, so there is nothing to neutralise.
    expect(csvCell('-500')).toBe('-500');
    expect(csvCell(-500)).toBe('-500');
    expect(csvCell('-12.5')).toBe('-12.5');
    expect(csvCell('1234')).toBe('1234');
    expect(csvCell(0)).toBe('0');
  });

  it('still neutralises a "-" that is NOT a plain number', () => {
    // A minus that leads text (a range, a command) is not a number and stays neutralised.
    expect(csvCell('-1+1')).toBe("'-1+1");
    expect(csvCell('-cmd')).toBe("'-cmd");
    expect(csvCell('-1e3')).toBe("'-1e3");   // scientific notation is not our PLAIN_NUMBER
  });
});

describe('csvCell — RFC-4180 quoting', () => {
  it('quotes and doubles quotes when a cell contains a delimiter or quote', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('a;b')).toBe('"a;b"');
    expect(csvCell('he said "hi"')).toBe('"he said ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('plain')).toBe('plain');
  });

  it('handles null and undefined as empty', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
});

describe('toCsv', () => {
  it('emits a BOM, CRLF rows, and a header', () => {
    const out = toCsv(['A', 'B'], [[1, -2], ['x,y', 'z']]);
    expect(out.charCodeAt(0)).toBe(0xFEFF);
    const body = out.slice(1);
    expect(body).toBe('A,B\r\n1,-2\r\n"x,y",z\r\n');
    // The negative number survived as a number, and the comma-bearing cell got quoted.
  });
});
