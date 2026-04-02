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
  {
    title: 'Built-in Walnut Bookcase',
    description: 'Floor-to-ceiling built-in bookcase with adjustable shelves, integrated lighting, and a rolling library ladder. Designed to match existing Victorian trim work.',
    category: 'carpentry',
    year: 2023,
    tools_used: ['Track saw', 'Pocket screw jig', 'Router table', 'Brad nailer'],
    image_url: null,
    featured: false,
  },
  {
    title: 'Cherry Wood Rocking Chair',
    description: 'Classic Windsor-style rocking chair turned and carved from American cherry. Steam-bent back bow. One of a limited set of three made over winter.',
    category: 'carpentry',
    year: 2022,
    tools_used: ['Lathe', 'Steam bending setup', 'Draw knife', 'Spokeshave', 'Travisher'],
    image_url: null,
    featured: true,
  },
  {
    title: 'Timber Frame Garden Studio',
    description: 'Traditional timber frame outbuilding using locally sourced Douglas fir. All joinery done with hand tools — no metal fasteners in the frame.',
    category: 'carpentry',
    year: 2021,
    tools_used: ['Framing chisels', 'Slick', 'Timber scribe', 'Come-along', 'Auger bits'],
    image_url: null,
    featured: false,
  },
  {
    title: 'Maple Kitchen Cabinets',
    description: 'Full set of face-frame kitchen cabinets in hard maple with inset doors and drawers. Soft-close hardware throughout. Painted SW Alabaster with a lacquer topcoat.',
    category: 'carpentry',
    year: 2020,
    tools_used: ['Cabinet saw', 'Dovetail jig', 'Spray gun', 'Random orbital sander'],
    image_url: null,
    featured: false,
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
  {
    title: 'CNC Toolpath Generator',
    description: 'Browser-based SVG-to-G-code toolpath generator for my CNC router. Supports pocket cuts, profile cuts, and drill operations. Exports directly to the machine controller.',
    category: 'tech',
    year: 2023,
    tools_used: ['TypeScript', 'SVG parsing', 'G-code', 'Canvas API', 'Vite'],
    image_url: null,
    featured: false,
  },
  {
    title: 'Joinery Pattern Library',
    description: 'Parametric CAD-like tool for generating and printing joinery layout diagrams (dovetails, box joints, mortise-and-tenon) with configurable dimensions.',
    category: 'tech',
    year: 2022,
    tools_used: ['JavaScript', 'Canvas API', 'CSS Grid', 'Printable CSS'],
    image_url: null,
    featured: false,
  },
  {
    title: 'Smart Dust Collector Controller',
    description: 'Raspberry Pi controller that monitors current draw from shop tools via CT clamps and automatically powers the dust collector on/off. REST API for manual overrides.',
    category: 'tech',
    year: 2021,
    tools_used: ['Python', 'Raspberry Pi', 'MQTT', 'Node.js', 'React', 'GPIO'],
    image_url: null,
    featured: false,
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
