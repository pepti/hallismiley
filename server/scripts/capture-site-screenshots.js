// Captures screenshots of key site pages using Playwright and saves them to
// public/assets/projects/portfolio/. Also seeds them into the project_media
// table for the "Halli Smiley — Portfolio Platform" project.
//
// Run: node server/scripts/capture-site-screenshots.js
// Requires: server running at http://localhost:3000 (or set BASE_URL env var)
// Idempotent: safe to run multiple times.
require('dotenv').config();
const { chromium } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { pool } = require('../config/database');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const OUTPUT_DIR = path.join(__dirname, '../../public/assets/projects/portfolio');
const DB_PATH_PREFIX = '/assets/projects/portfolio/';

const PROJECT_TITLE = 'Halli Smiley — Portfolio Platform';

// Pages to capture in order. The first one becomes the cover image.
const PAGES = [
  {
    name: 'homepage',
    url: '/',
    file: 'screenshot-homepage.jpg',
    caption: 'Homepage — featured projects and hero section',
    waitFor: '.lol-nav',
  },
  {
    name: 'projects',
    url: '/#/projects',
    file: 'screenshot-projects.jpg',
    caption: 'Projects gallery — filterable grid view',
    waitFor: '.projects-grid, .lol-projects',
  },
  {
    name: 'project-detail',
    url: '/#/projects',
    file: 'screenshot-project-detail.jpg',
    caption: 'Stofan Bakhús — project detail with media gallery',
    waitFor: '.project-card',
    action: async page => {
      // Click the Stofan Bakhús project card to open the detail modal/page
      const card = page.locator('.project-card').filter({ hasText: 'Stofan' }).first();
      if (await card.count() > 0) {
        await card.click();
        await page.waitForTimeout(800);
      }
    },
  },
  {
    name: 'signup',
    url: '/#/signup',
    file: 'screenshot-signup.jpg',
    caption: 'Sign-up page — invite-code registration flow',
    waitFor: 'form, .signup-view, #app',
  },
  {
    name: 'profile',
    url: '/#/profile',
    file: 'screenshot-profile.jpg',
    caption: 'User profile — avatar, bio, and social links',
    waitFor: '.profile-view, #app',
  },
  {
    name: 'party',
    url: '/#/party',
    file: 'screenshot-party.jpg',
    caption: "Birthday party hub — invite-only event page (unauthenticated view)",
    waitFor: '.party-view, .party-page, #app',
  },
];

async function ensureOutputDir() {
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    console.log(`Created directory: ${OUTPUT_DIR}`);
  }
}

async function captureScreenshots() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
  });

  const results = [];

  for (const page_def of PAGES) {
    const page = await context.newPage();
    try {
      console.log(`  Capturing: ${page_def.name} (${page_def.url})`);
      await page.goto(`${BASE_URL}${page_def.url}`, {
        waitUntil: 'networkidle',
        timeout: 15_000,
      });

      // Wait for a key element to appear
      try {
        await page.waitForSelector(page_def.waitFor, { timeout: 5_000 });
      } catch {
        // If selector not found, continue anyway — partial render is fine
      }

      // Run any page-specific action (e.g. click to open a modal)
      if (page_def.action) {
        await page_def.action(page);
      }

      await page.waitForTimeout(400); // brief settle

      const outPath = path.join(OUTPUT_DIR, page_def.file);
      await page.screenshot({
        path: outPath,
        type: 'jpeg',
        quality: 85,
        fullPage: false,
      });

      console.log(`    Saved: ${outPath}`);
      results.push({ ...page_def, saved: true });
    } catch (err) {
      console.warn(`    Failed to capture ${page_def.name}: ${err.message}`);
      results.push({ ...page_def, saved: false });
    } finally {
      await page.close();
    }
  }

  await browser.close();
  return results.filter(r => r.saved);
}

async function seedMedia(captured) {
  // Find or create project
  const { rows: existing } = await pool.query(
    'SELECT id, title FROM projects WHERE title = $1',
    [PROJECT_TITLE]
  );

  if (existing.length === 0) {
    console.error(`Project "${PROJECT_TITLE}" not found in database.`);
    console.error('Run the portfolio-update script first to create/update the project.');
    process.exit(1);
  }

  const projectId = existing[0].id;
  console.log(`Found project "${existing[0].title}" (id=${projectId})`);

  let inserted = 0;
  let skipped = 0;

  for (let i = 0; i < captured.length; i++) {
    const item = captured[i];
    const filePath = `${DB_PATH_PREFIX}${item.file}`;
    const sortOrder = i + 1;

    const { rows: existingMedia } = await pool.query(
      'SELECT id FROM project_media WHERE project_id = $1 AND file_path = $2',
      [projectId, filePath]
    );

    if (existingMedia.length > 0) {
      skipped++;
      continue;
    }

    await pool.query(
      `INSERT INTO project_media (project_id, file_path, media_type, sort_order, caption)
       VALUES ($1, $2, $3, $4, $5)`,
      [projectId, filePath, 'image', sortOrder, item.caption || null]
    );
    inserted++;
  }

  console.log(`Media: ${inserted} inserted, ${skipped} already existed.`);

  // Set cover image to the first screenshot (homepage)
  if (captured.length > 0) {
    const coverPath = `${DB_PATH_PREFIX}${captured[0].file}`;
    await pool.query('UPDATE projects SET image_url = $1 WHERE id = $2', [
      coverPath,
      projectId,
    ]);
    console.log(`Cover image set to: ${coverPath}`);
  }
}

async function main() {
  console.log(`Capturing screenshots from ${BASE_URL} ...`);
  await ensureOutputDir();

  const captured = await captureScreenshots();

  if (captured.length === 0) {
    console.error('No screenshots captured. Is the server running?');
    process.exit(1);
  }

  console.log(`\nSeeding ${captured.length} screenshots into project_media...`);
  await seedMedia(captured);

  await pool.end();
  console.log('Done.');
}

main().catch(err => {
  console.error('Script failed:', err.message);
  process.exit(1);
});
