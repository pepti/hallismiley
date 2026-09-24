// Every NEW ADD CONSTRAINT is re-runnable (icelandicstore #323, ported in
// harvest-ice-f-2026-09-24).
//
// Why: on 2026-09-14 a failed PROD→TEST clone left ice's TEST database holding
// a migration's objects without its schema_migrations row. Every boot re-ran
// that migration, whose bare `ADD CONSTRAINT …` failed with "already exists"
// (42710), and the container crash-looped for ~2 h. The engine's runner applies
// each migration in one transaction (server/scripts/migrate.js), so a
// half-applied migration cannot come from the runner itself — but a restore,
// a clone or a hand-applied hotfix can still produce "objects present, row
// missing", and then only a re-runnable statement boots.
//
// The rule, statically over the one list the runner applies (engine array +
// this product's array, server/config/migrationSet.js): an ADD CONSTRAINT must
// sit in a statement that checks pg_constraint / information_schema first
// (`IF NOT EXISTS (SELECT 1 FROM pg_constraint …)` inside a DO block), or
// follow a `DROP CONSTRAINT IF EXISTS` of the same name in the same migration.
//
// GRANDFATHERED lists the bare ones that were already applied everywhere when
// this test landed. An applied migration is never edited (invariant 4), so
// they stay; a fix would be a NEW guarded migration, and none is needed while
// the runner's per-migration transaction holds. The list may only shrink.
// ice's own half of this file (live re-runs of its 111/112/115) is ice-only.
const { migrations } = require('../../server/config/migrationSet');

const GRANDFATHERED = new Set([
  '070_party_photo_album: party_photos_media_type_check',
  '074_product_vat_rate: products_vat_rate_check',
]);

/** Every ADD CONSTRAINT that is neither existence-checked nor dropped first. */
function bareConstraints(list) {
  const bare = [];
  for (const m of list) {
    m.statements.forEach((sql, i) => {
      const re = /ADD\s+CONSTRAINT\s+"?(\w+)"?/gi;
      let hit;
      while ((hit = re.exec(sql))) {
        const conname = hit[1];
        const checked = /IF\s+NOT\s+EXISTS/i.test(sql) && /(pg_constraint|information_schema)/i.test(sql);
        const droppedFirst = m.statements.slice(0, i + 1).some(s =>
          new RegExp(`DROP\\s+CONSTRAINT\\s+IF\\s+EXISTS\\s+"?${conname}"?\\b`, 'i').test(s)
        );
        if (!checked && !droppedFirst) bare.push(`${m.name}: ${conname}`);
      }
    });
  }
  return bare;
}

describe('every migration', () => {
  it('adds a named constraint only behind an existence check or a DROP … IF EXISTS', () => {
    const fresh = bareConstraints(migrations).filter(b => !GRANDFATHERED.has(b));
    // A new entry here is the 2026-09-14 crash loop waiting for its trigger:
    // wrap it in DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE
    // conname = '…') THEN ALTER TABLE … ADD CONSTRAINT …; END IF; END $$, or
    // precede it with ALTER TABLE … DROP CONSTRAINT IF EXISTS ….
    expect(fresh).toEqual([]);
  });

  it('keeps the grandfathered list honest — every entry is still a bare constraint', () => {
    const bare = new Set(bareConstraints(migrations));
    expect([...GRANDFATHERED].filter(g => !bare.has(g))).toEqual([]);
  });

  it('the detector catches a bare constraint and accepts both guarded shapes', () => {
    const probe = [
      { name: 'x_bare', statements: ['ALTER TABLE t ADD CONSTRAINT t_bare CHECK (a > 0)'] },
      { name: 'x_dropped', statements: [
        'ALTER TABLE t DROP CONSTRAINT IF EXISTS t_dropped',
        'ALTER TABLE t ADD CONSTRAINT t_dropped CHECK (a > 0)',
      ] },
      { name: 'x_checked', statements: [
        `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 't_checked') THEN
           ALTER TABLE t ADD CONSTRAINT t_checked CHECK (a > 0); END IF; END $$`,
      ] },
    ];
    expect(bareConstraints(probe)).toEqual(['x_bare: t_bare']);
  });
});
