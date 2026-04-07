// Inserts the Arnarhraun Renovations carpentry project and its media gallery into the database.
// Run: node server/scripts/seed-arnarhraun.js
// Idempotent: safe to run multiple times.
require('dotenv').config();
const { pool } = require('../config/database');

const PROJECT = {
  title: 'Arnarhraun Renovations',
  description:
    'New kitchen, new flooring, paint, walls removed.',
  category: 'carpentry',
  year: 2024,
  tools_used: [],
  image_url: '/assets/projects/arnarhraun/img_0764.jpg',
  featured: true,
};

// All media files in filename sort order.
// sort_order matches the position in this array (1-based).
const MEDIA = [
  { file: 'img_0756.jpg', type: 'image' },
  { file: 'img_0757.jpg', type: 'image' },
  { file: 'img_0758.jpg', type: 'image' },
  { file: 'img_0760.jpg', type: 'image' },
  { file: 'img_0761.jpg', type: 'image' },
  { file: 'img_0762.jpg', type: 'image' },
  { file: 'img_0763.jpg', type: 'image' },
  { file: 'img_0764.jpg', type: 'image' },
  { file: 'img_0786.jpg', type: 'image' },
  { file: 'img_0805.jpg', type: 'image' },
  { file: 'img_0806.jpg', type: 'image' },
  { file: 'img_1071.jpg', type: 'image' },
  { file: 'img_1142.jpg', type: 'image' },
  { file: 'img_1143.jpg', type: 'image' },
  { file: 'img_1144.jpg', type: 'image' },
  { file: 'img_1278.jpg', type: 'image' },
  { file: 'img_1293.jpg', type: 'image' },
  { file: 'img_1294.jpg', type: 'image' },
  { file: 'img_1296.jpg', type: 'image' },
  { file: 'img_1297.jpg', type: 'image' },
  { file: 'img_1298.jpg', type: 'image' },
  { file: 'img_1304.jpg', type: 'image' },
  { file: 'img_1305.jpg', type: 'image' },
  { file: 'img_1309.jpg', type: 'image' },
  { file: 'img_1310.jpg', type: 'image' },
  { file: 'img_1314.jpg', type: 'image' },
  { file: 'img_1315.jpg', type: 'image' },
  { file: 'img_1319.jpg', type: 'image' },
  { file: 'img_1320.jpg', type: 'image' },
  { file: 'img_1329.jpg', type: 'image' },
  { file: 'img_1330.jpg', type: 'image' },
  { file: 'img_1331.jpg', type: 'image' },
  { file: 'img_1440.jpg', type: 'image' },
  { file: 'img_1441.jpg', type: 'image' },
  { file: 'img_1442.jpg', type: 'image' },
  { file: 'img_1443.jpg', type: 'image' },
  { file: 'img_1444.jpg', type: 'image' },
  { file: 'img_1445.jpg', type: 'image' },
  { file: 'img_1446.jpg', type: 'image' },
  { file: 'img_1448.jpg', type: 'image' },
  { file: 'img_1449.jpg', type: 'image' },
  { file: 'img_1450.jpg', type: 'image' },
  { file: 'img_1451.jpg', type: 'image' },
  { file: 'img_1452.jpg', type: 'image' },
  { file: 'img_1460.jpg', type: 'image' },
  { file: 'img_1461.jpg', type: 'image' },
  { file: 'img_1462.jpg', type: 'image' },
  { file: 'img_1463.jpg', type: 'image' },
  { file: 'img_1464.jpg', type: 'image' },
  { file: 'img_1465.jpg', type: 'image' },
  { file: 'img_1466.jpg', type: 'image' },
  { file: 'img_1795.jpg', type: 'image' },
  { file: 'img_1796.jpg', type: 'image' },
  { file: 'img_1856.jpg', type: 'image' },
  { file: 'img_1860.jpg', type: 'image' },
  { file: 'img_1861.jpg', type: 'image' },
  { file: 'img_7676.jpg', type: 'image' },
  { file: 'cdym9688.mp4', type: 'video' },
];

const BASE_PATH = '/assets/projects/arnarhraun/';

async function seed() {
  // ── 1. Get or create the project ──────────────────────────────────────────
  let projectId;

  const { rows: existing } = await pool.query(
    'SELECT id FROM projects WHERE title = $1',
    [PROJECT.title]
  );

  if (existing.length > 0) {
    projectId = existing[0].id;
    console.log(`Project "${PROJECT.title}" already exists (id=${projectId}).`);
  } else {
    const { rows } = await pool.query(
      `INSERT INTO projects (title, description, category, year, tools_used, image_url, featured)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, title`,
      [
        PROJECT.title,
        PROJECT.description,
        PROJECT.category,
        PROJECT.year,
        PROJECT.tools_used,
        PROJECT.image_url,
        PROJECT.featured,
      ]
    );
    projectId = rows[0].id;
    console.log(`Inserted "${rows[0].title}" with id=${projectId}`);
  }

  // ── 2. Seed media (idempotent — skip files already present) ───────────────
  let inserted = 0;
  let skipped  = 0;

  for (let i = 0; i < MEDIA.length; i++) {
    const { file, type } = MEDIA[i];
    const filePath   = `${BASE_PATH}${file}`;
    const sortOrder  = i + 1;

    const { rows: existingMedia } = await pool.query(
      'SELECT id FROM project_media WHERE project_id = $1 AND file_path = $2',
      [projectId, filePath]
    );

    if (existingMedia.length > 0) {
      skipped++;
      continue;
    }

    await pool.query(
      `INSERT INTO project_media (project_id, file_path, media_type, sort_order)
       VALUES ($1, $2, $3, $4)`,
      [projectId, filePath, type, sortOrder]
    );
    inserted++;
  }

  console.log(`Media: ${inserted} inserted, ${skipped} already existed.`);
}

module.exports = { seedArnarhraun: seed };

// When invoked directly: node server/scripts/seed-arnarhraun.js
if (require.main === module) {
  seed()
    .then(() => pool.end())
    .catch(err => { console.error('Seed failed:', err.message); process.exit(1); });
}
