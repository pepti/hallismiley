// Inserts the Stofan Bakhús carpentry project into the database
// Run: node server/scripts/seed-stofan-bakhus.js
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

async function seed() {
  // Idempotency — skip if a project with this exact title already exists
  const { rows: existing } = await pool.query(
    'SELECT id FROM projects WHERE title = $1',
    [PROJECT.title]
  );
  if (existing.length > 0) {
    console.log(`Project "${PROJECT.title}" already exists (id=${existing[0].id}). Skipping.`);
    await pool.end();
    return;
  }

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

  console.log(`Inserted "${rows[0].title}" with id=${rows[0].id}`);
  await pool.end();
}

seed().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
