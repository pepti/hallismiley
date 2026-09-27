'use strict';

/**
 * Where test runs write uploaded files (2026-09-26, Öryggisvörður finding 6).
 *
 * With no UPLOAD_ROOT the app falls back to the committed public/assets tree,
 * so every integration run left party photos, avatars, content images and
 * backgrounds in the working tree — ~1,330 gitignored stub files per repo,
 * which a local `docker build .` (COPY public/) would bake into an image.
 *
 * Now globalSetup gives each run its own base in the OS temp dir
 * (`<product>-test-uploads-<pid>`), pinned in TEST_UPLOAD_BASE for the
 * workers; tests/env.js points UPLOAD_ROOT / BOOKS_UPLOAD_ROOT at a per-worker
 * folder under it; globalTeardown removes the base; and globalSetup removes the
 * bases of runs whose process is gone (a killed run cannot clean up after
 * itself). The unit tier has no globalSetup and writes no uploads.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PRODUCT } = require('../workerDb');

const PREFIX = `${PRODUCT}-test-uploads-`;

function baseFor(pid) { return path.join(os.tmpdir(), PREFIX + pid); }

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** Removes the bases of dead runs; returns how many. */
function sweepDead() {
  let n = 0;
  let names;
  try { names = fs.readdirSync(os.tmpdir()); } catch { return 0; }
  for (const name of names) {
    if (!name.startsWith(PREFIX)) continue;
    const suffix = name.slice(PREFIX.length);
    if (!/^\d+$/.test(suffix)) continue;
    const pid = Number(suffix);
    if (pid <= 0 || pid === process.pid || pidAlive(pid)) continue;
    try { fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true }); n++; } catch { /* in use */ }
  }
  return n;
}

/** globalSetup: sweep, create this run's base, pin it for the workers. */
function prepare() {
  const swept = sweepDead();
  const base = baseFor(process.pid);
  fs.mkdirSync(base, { recursive: true });
  process.env.TEST_UPLOAD_BASE = base;
  return { base, swept };
}

/** tests/env.js: the per-worker roots, or null outside a globalSetup run. */
function workerRoots(workerId) {
  const base = process.env.TEST_UPLOAD_BASE;
  if (!base) return null;
  const root = path.join(base, `w${workerId || '1'}`);
  return { UPLOAD_ROOT: path.join(root, 'assets'), BOOKS_UPLOAD_ROOT: path.join(root, 'books') };
}

/** globalTeardown: remove this run's base. */
function remove() {
  const base = process.env.TEST_UPLOAD_BASE;
  if (!base || !path.basename(base).startsWith(PREFIX)) return false;
  fs.rmSync(base, { recursive: true, force: true });
  return true;
}

module.exports = { PREFIX, baseFor, sweepDead, prepare, workerRoots, remove };
