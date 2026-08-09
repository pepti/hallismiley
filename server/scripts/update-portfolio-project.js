// Updates the "Portfolio API" project in the database with polished title,
// description, and tech stack. Safe to run multiple times (idempotent).
//
// Run: node server/scripts/update-portfolio-project.js
require('dotenv').config();
const { pool } = require('../config/database');

const OLD_TITLE = 'Portfolio API';
const PROJECT = {
  title: 'Halli Smiley — Portfolio Platform',
  description: `A full-stack web platform built from the ground up to showcase carpentry craftsmanship and software engineering work. Features a custom CMS with inline admin editing, a multi-role user system with session-based authentication, an invite-only event hub with real-time countdown, and a complete media gallery with lightbox. Designed with a distinctive dark theme inspired by premium gaming interfaces, the platform delivers a seamless single-page experience without relying on any frontend framework.

Engineered for production from day one — the codebase includes structured logging with Pino, Prometheus metrics, circuit breakers, CI/CD with 398+ automated tests across unit, integration, and end-to-end suites, and a comprehensive observability stack. Every component, from the Lucia-powered auth system to the admin-controlled site content, was hand-crafted to demonstrate full-stack craftsmanship at every layer of the stack.`,
  tools_used: [
    'Node.js',
    'Express',
    'PostgreSQL',
    'Lucia Auth',
    'Vanilla JS SPA',
    'Pino',
    'Prometheus',
    'Sentry',
    'Docker',
    'GitHub Actions',
    'Playwright',
    'ESLint',
    'oslo',
  ],
  year: 2025,
  category: 'tech',
  featured: true,
};

async function update() {
  // Try to find by old title first, then by new title (idempotent)
  let { rows } = await pool.query(
    'SELECT id, title FROM projects WHERE title = $1 OR title = $2',
    [OLD_TITLE, PROJECT.title]
  );

  if (rows.length === 0) {
    console.error(`Project not found (tried "${OLD_TITLE}" and "${PROJECT.title}").`);
    console.error('Run seed.js first to create the initial projects.');
    process.exit(1);
  }

  // If multiple rows (shouldn't happen), pick the one matching old title first
  const row =
    rows.find(r => r.title === OLD_TITLE) ||
    rows.find(r => r.title === PROJECT.title);

  const projectId = row.id;
  console.log(`Found project "${row.title}" (id=${projectId})`);

  await pool.query(
    `UPDATE projects
     SET title       = $1,
         description = $2,
         tools_used  = $3,
         year        = $4,
         category    = $5,
         featured    = $6,
         updated_at  = NOW()
     WHERE id = $7`,
    [
      PROJECT.title,
      PROJECT.description,
      PROJECT.tools_used,
      PROJECT.year,
      PROJECT.category,
      PROJECT.featured,
      projectId,
    ]
  );

  console.log(`Updated project id=${projectId} → "${PROJECT.title}"`);
  await pool.end();
}

update().catch(err => {
  console.error('Update failed:', err.message);
  process.exit(1);
});
