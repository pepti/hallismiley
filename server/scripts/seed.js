// Populates the database with sample projects
// Run: node server/scripts/seed.js
require('dotenv').config();
const Project = require('../models/Project');
const { pool } = require('../config/database');

const seedData = [
  // --- Carpentry Projects ---
  {
    title: 'White Oak Dining Table',
    description: 'Hand-crafted solid white oak dining table with hand-cut mortise-and-tenon joinery. Seats 8 comfortably. Finished with Danish oil for a natural, durable surface.',
    category: 'carpentry',
    year: 2023,
    tools_used: ['Table saw', 'Router', 'Hand planes', 'Chisels', 'Card scrapers'],
    image_url: null,
    featured: true,
  },

  // --- Tech Projects ---
  {
    title: 'Halli Smiley — Portfolio Platform',
    description: `A full-stack web platform built from the ground up to showcase carpentry craftsmanship and software engineering work. Features a custom CMS with inline admin editing, a multi-role user system with session-based authentication, an invite-only event hub with real-time countdown, and a complete media gallery with lightbox. Designed with a distinctive dark theme inspired by premium gaming interfaces, the platform delivers a seamless single-page experience without relying on any frontend framework.

Engineered for production from day one — the codebase includes structured logging with Pino, Prometheus metrics, circuit breakers, CI/CD with 398+ automated tests across unit, integration, and end-to-end suites, and a comprehensive observability stack. Every component, from the Lucia-powered auth system to the admin-controlled site content, was hand-crafted to demonstrate full-stack craftsmanship at every layer of the stack.`,
    category: 'tech',
    year: 2025,
    tools_used: [
      'Node.js', 'Express', 'PostgreSQL', 'Lucia Auth', 'Vanilla JS SPA',
      'Pino', 'Prometheus', 'Sentry', 'Docker', 'GitHub Actions',
      'Playwright', 'ESLint', 'oslo',
    ],
    image_url: null,
    featured: true,
  },
  {
    title: 'Workshop Inventory System',
    description: 'Offline-first PWA to track lumber stock, hardware, and tool inventory in the workshop. Uses IndexedDB with a sync layer to a lightweight REST backend.',
    category: 'tech',
    year: 2024,
    tools_used: ['JavaScript', 'IndexedDB', 'Service Workers', 'Node.js', 'Express'],
    image_url: null,
    featured: true,
  },
];

async function seed() {
  console.log('Seeding database...');
  for (const data of seedData) {
    await Project.create(data);
  }
  console.log(`Done. ${seedData.length} projects seeded.`);
  await pool.end();
}

seed().catch(err => { console.error('Seed failed:', err.message); process.exit(1); });
