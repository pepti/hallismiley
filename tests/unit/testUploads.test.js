// tests/lib/testUploads.js — test runs write uploads to their own temp folder,
// never the committed public/assets tree, and a dead run's folder is swept.
const fs = require('fs');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const uploads = require('../lib/testUploads');

describe('testUploads', () => {
  const savedBase = process.env.TEST_UPLOAD_BASE;
  afterEach(() => {
    if (savedBase === undefined) delete process.env.TEST_UPLOAD_BASE;
    else process.env.TEST_UPLOAD_BASE = savedBase;
  });

  test('workerRoots is null without a pinned base (the unit tier), per-worker folders with one', () => {
    delete process.env.TEST_UPLOAD_BASE;
    expect(uploads.workerRoots('2')).toBeNull();
    process.env.TEST_UPLOAD_BASE = uploads.baseFor(4242);
    const roots = uploads.workerRoots('2');
    expect(roots.UPLOAD_ROOT).toBe(path.join(uploads.baseFor(4242), 'w2', 'assets'));
    expect(roots.BOOKS_UPLOAD_ROOT).toBe(path.join(uploads.baseFor(4242), 'w2', 'books'));
    expect(roots.UPLOAD_ROOT.includes(path.join('public', 'assets'))).toBe(false);
  });

  test('sweepDead removes a dead run\'s folder and keeps a live one', () => {
    const dead = spawnSync(process.execPath, ['-e', '']).pid; // exited by now
    // A live process that is NOT this one: in band, process.pid is the run's
    // own globalSetup process, whose base must never be touched by a test.
    const live = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { stdio: 'ignore' });
    const deadDir = uploads.baseFor(dead);
    const liveDir = uploads.baseFor(live.pid);
    const oddDir = path.join(require('os').tmpdir(), uploads.PREFIX + '0x1F');
    fs.mkdirSync(path.join(deadDir, 'w1'), { recursive: true });
    fs.mkdirSync(liveDir, { recursive: true });
    fs.mkdirSync(oddDir, { recursive: true });
    try {
      expect(uploads.sweepDead()).toBeGreaterThanOrEqual(1);
      expect(fs.existsSync(deadDir)).toBe(false);
      expect(fs.existsSync(liveDir)).toBe(true);
      expect(fs.existsSync(oddDir)).toBe(true); // not an exact pid suffix: never ours to sweep
    } finally {
      live.kill();
      for (const d of [deadDir, liveDir, oddDir]) fs.rmSync(d, { recursive: true, force: true });
    }
  });

  test('remove only ever deletes a folder carrying the run prefix', () => {
    process.env.TEST_UPLOAD_BASE = path.join(require('os').tmpdir(), 'not-ours');
    expect(uploads.remove()).toBe(false);
  });
});
