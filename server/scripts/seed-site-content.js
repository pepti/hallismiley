// Seed default homepage content from the hardcoded values in HomeView.js.
// Safe to run multiple times — uses ON CONFLICT DO NOTHING so existing edits
// made by admins are never overwritten.

const db = require('../config/database');

const DEFAULTS = [
  { key: 'hero_subtitle',    value: 'Carpenter & Computer Scientist — Building with wood & code' },
  { key: 'hero_cta_text',    value: 'View Projects' },
  { key: 'news_heading',     value: 'Latest Work' },
  { key: 'projects_eyebrow', value: 'Browse by' },
  { key: 'projects_heading', value: 'Discipline' },
  { key: 'projects_desc',    value: 'From precision timber frames and hand-cut joinery to full-stack web applications — every project is built to last.' },
  { key: 'skills_tag',       value: 'Two Decades of' },
  { key: 'skills_title',     value: 'Craft & Code' },
  { key: 'skills_desc',      value: 'Twenty years of carpentry precision — reading grain, cutting to the line, fitting without gaps — applied to every line of code. The same principles that make a mortise-and-tenon joint last a century make software maintainable.' },
  { key: 'contact_eyebrow',  value: "Let's build something" },
  { key: 'contact_title',    value: 'Get in Touch' },
  { key: 'contact_desc',     value: "Whether it's a timber frame, a web platform, or a bespoke workshop fit-out — I'd love to hear what you're planning." },
];

async function seed() {
  console.log('Seeding site_content defaults…');
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    for (const { key, value } of DEFAULTS) {
      await client.query(
        `INSERT INTO site_content (key, value)
         VALUES ($1, $2)
         ON CONFLICT (key) DO NOTHING`,
        [key, value]
      );
    }
    await client.query('COMMIT');
    console.log(`Done — ${DEFAULTS.length} default entries seeded (skipped if already present).`);
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await db.pool.end();
  }
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
