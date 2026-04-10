// Inserts the Stofan Bakhús carpentry project and its media gallery into the database.
// Run: node server/scripts/seed-stofan-bakhus.js
// Idempotent: safe to run multiple times.
require('dotenv').config();
const { pool } = require('../config/database');

const PROJECT = {
  title: 'Stofan Bakhús',
  description:
    'Construction project. What made the project quite appealing is the fact that there was no other contractor involved and all interior design decisions and implementations were made by me in collaboration with the owners. Responsible for interior design, implementation, building regulation standards including: tolerance, health and security.',
  category: 'carpentry',
  year: 2016,
  tools_used: [],
  image_url: '/assets/projects/stofan-bakhus/20160423_103728.jpg',
  featured: true,
};

// All media files in chronological / filename sort order.
// sort_order matches the position in this array (1-based).
const MEDIA = [
  { file: '20160423_103728.jpg',              type: 'image' },
  { file: '20160423_103818.jpg',              type: 'image' },
  { file: '20160423_103846.jpg',              type: 'image' },
  { file: '20160511_204545.jpg',              type: 'image' },
  { file: '20160511_204553.jpg',              type: 'image' },
  { file: '20160511_204559.jpg',              type: 'image' },
  { file: '20160511_204607.jpg',              type: 'image' },
  { file: '20160511_204620.jpg',              type: 'image' },
  { file: '20160511_204637.jpg',              type: 'image' },
  { file: '20160511_204703.jpg',              type: 'image' },
  { file: '20160511_204717.jpg',              type: 'image' },
  { file: '20160511_204731.jpg',              type: 'image' },
  { file: '20160511_204829.jpg',              type: 'image' },
  { file: '20160511_204900.jpg',              type: 'image' },
  { file: '20160511_204938.jpg',              type: 'image' },
  { file: '20160511_205004.jpg',              type: 'image' },
  { file: '20160511_205037.jpg',              type: 'image' },
  { file: '20160511_205233.jpg',              type: 'image' },
  { file: '20160511_205238.jpg',              type: 'image' },
  { file: '20160511_205302.mp4',              type: 'video' },
  { file: '20160511_205907 - Copy.jpg',       type: 'image' },
  { file: '20160511_205907.jpg',              type: 'image' },
  { file: '20160511_205910.jpg',              type: 'image' },
  { file: '20160511_205914.jpg',              type: 'image' },
  { file: '20160511_205917.jpg',              type: 'image' },
  { file: '20160511_205920.jpg',              type: 'image' },
  { file: 'Snapchat-3367257921085106.jpg',    type: 'image' },
  { file: 'Snapchat-6587181982239862811.jpg', type: 'image' },
  { file: 'Snapchat-8066994157689694971.jpg', type: 'image' },
];

const BASE_PATH = '/assets/projects/stofan-bakhus/';

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

  // ── 2. Seed media (idempotent) ────────────────────────────────────────────
  // Images → project_media. Videos → project_videos (since migration 015).
  let insertedImages = 0;
  let skippedImages  = 0;
  let insertedVideos = 0;
  let skippedVideos  = 0;

  let videoOrder = 0;
  for (let i = 0; i < MEDIA.length; i++) {
    const { file, type } = MEDIA[i];
    const filePath   = `${BASE_PATH}${file}`;
    const sortOrder  = i + 1;

    if (type === 'video') {
      const { rows: existingVid } = await pool.query(
        'SELECT id FROM project_videos WHERE project_id = $1 AND file_path = $2',
        [projectId, filePath]
      );
      if (existingVid.length > 0) { skippedVideos++; videoOrder++; continue; }

      await pool.query(
        `INSERT INTO project_videos (project_id, kind, file_path, sort_order)
         VALUES ($1, 'file', $2, $3)`,
        [projectId, filePath, videoOrder]
      );
      insertedVideos++;
      videoOrder++;
      continue;
    }

    const { rows: existingMedia } = await pool.query(
      'SELECT id FROM project_media WHERE project_id = $1 AND file_path = $2',
      [projectId, filePath]
    );
    if (existingMedia.length > 0) { skippedImages++; continue; }

    await pool.query(
      `INSERT INTO project_media (project_id, file_path, media_type, sort_order)
       VALUES ($1, $2, $3, $4)`,
      [projectId, filePath, type, sortOrder]
    );
    insertedImages++;
  }

  console.log(
    `Media: ${insertedImages} images inserted, ${skippedImages} skipped; ` +
    `${insertedVideos} videos inserted, ${skippedVideos} skipped.`
  );
}

module.exports = { seedStofanBakhus: seed };

// When invoked directly: node server/scripts/seed-stofan-bakhus.js
if (require.main === module) {
  seed()
    .then(() => pool.end())
    .catch(err => { console.error('Seed failed:', err.message); process.exit(1); });
}
