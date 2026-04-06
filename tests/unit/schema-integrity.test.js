/**
 * Schema integrity test.
 *
 * Parses every SQL table reference in controller files (FROM, INTO, UPDATE …,
 * JOIN …) and asserts that each referenced table actually exists in the
 * migration schema.  This prevents the class of bug where a controller queries
 * a dropped or never-created table (e.g. the party_invites regression).
 */

const fs   = require('fs');
const path = require('path');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Words that appear after FROM/INTO/UPDATE/JOIN but are NOT table names. */
const SQL_KEYWORDS = new Set([
  'select', 'insert', 'delete', 'create', 'drop', 'alter', 'truncate',
  'where', 'set', 'on', 'and', 'or', 'not', 'in', 'is', 'null', 'true',
  'false', 'case', 'when', 'then', 'else', 'end', 'with', 'as', 'by',
  'asc', 'desc', 'limit', 'offset', 'returning', 'conflict', 'do',
  'nothing', 'excluded', 'values', 'default', 'cascade', 'restrict',
  'exists', 'distinct', 'all', 'any', 'some', 'between', 'like', 'ilike',
  'similar', 'regexp', 'escape', 'overlaps', 'at', 'time', 'zone',
  'inner', 'outer', 'left', 'right', 'full', 'cross', 'lateral', 'natural',
  'using', 'each', 'row', 'for', 'of', 'to', 'from', 'into', 'update',
  'join', 'table', 'index', 'trigger', 'function', 'procedure', 'view',
  'sequence', 'constraint', 'primary', 'foreign', 'key', 'references',
  'unique', 'check', 'column', 'if', 'only', 'row', 'no',
]);

/**
 * Returns the final set of live table names from schema.js:
 *   created tables  minus  explicitly dropped tables.
 */
function getSchemaTableNames() {
  const schemaPath = path.join(__dirname, '../../server/config/schema.js');
  const src = fs.readFileSync(schemaPath, 'utf8');

  const created = new Set();
  const dropped = new Set();

  const reCreate = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;
  let m;
  while ((m = reCreate.exec(src)) !== null) {
    created.add(m[1].toLowerCase());
  }

  const reDrop = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?(\w+)/gi;
  while ((m = reDrop.exec(src)) !== null) {
    dropped.add(m[1].toLowerCase());
  }

  return new Set([...created].filter(t => !dropped.has(t)));
}

/**
 * Returns { file: string, table: string }[] for every table name that
 * appears after FROM / INTO / UPDATE / JOIN in any controller file.
 */
function getControllerTableRefs() {
  const controllersDir = path.join(__dirname, '../../server/controllers');
  const files = fs.readdirSync(controllersDir)
    .filter(f => f.endsWith('.js'))
    .map(f => ({ name: f, src: fs.readFileSync(path.join(controllersDir, f), 'utf8') }));

  const refs = [];
  // Case-sensitive: SQL in controllers uses uppercase keywords; prose uses lowercase.
  // This avoids matching "from disk", "from downtown" etc. in comments/strings.
  const re = /\b(?:FROM|INTO|UPDATE|JOIN)\s+(\w+)/g;

  for (const { name, src } of files) {
    let m;
    while ((m = re.exec(src)) !== null) {
      const table = m[1].toLowerCase();
      if (!SQL_KEYWORDS.has(table)) {
        refs.push({ file: name, table });
      }
    }
  }

  return refs;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('Schema integrity: controller table references', () => {
  let schemaTables;
  let controllerRefs;

  beforeAll(() => {
    schemaTables  = getSchemaTableNames();
    controllerRefs = getControllerTableRefs();
  });

  test('schema.js defines at least the core tables', () => {
    const expected = ['users', 'user_sessions', 'projects', 'site_content', 'news_articles'];
    for (const t of expected) {
      expect(schemaTables).toContain(t);
    }
  });

  test('schema.js defines all party tables', () => {
    expect(schemaTables).toContain('party_rsvps');
    expect(schemaTables).toContain('party_guestbook');
    expect(schemaTables).toContain('party_photos');
  });

  test('schema.js does NOT include the dropped party_invites table', () => {
    expect(schemaTables).not.toContain('party_invites');
  });

  test('every table referenced in controllers exists in the schema', () => {
    const missing = controllerRefs.filter(({ table }) => !schemaTables.has(table));

    if (missing.length > 0) {
      const detail = missing
        .map(({ file, table }) => `  ${file}: "${table}"`)
        .join('\n');
      throw new Error(
        `Controllers reference tables that do not exist in schema.js:\n${detail}`
      );
    }

    expect(missing).toHaveLength(0);
  });

  test('no controller references the dropped party_invites table', () => {
    const bad = controllerRefs.filter(({ table }) => table === 'party_invites');

    if (bad.length > 0) {
      const detail = bad.map(({ file }) => `  ${file}`).join('\n');
      throw new Error(
        `party_invites was dropped but is still referenced in:\n${detail}`
      );
    }

    expect(bad).toHaveLength(0);
  });
});
