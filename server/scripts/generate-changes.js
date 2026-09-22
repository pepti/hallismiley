#!/usr/bin/env node
'use strict';

/**
 * Stamp the most recent changes into server/changes.json so the running
 * container can list "what arrived in this build" on Admin → Monitoring
 * (ported from icelandicstore, ice #209).
 *
 * This script runs on the BUILD HOST, from the CI/deploy workflow, before
 * `docker build` — not inside the Dockerfile, because the build context carries
 * no .git directory and `COPY server/` picks the output file up anyway. The same
 * image is promoted between channels, so the list is a fact about the bytes,
 * never about the environment (see scripts/generate-version.js).
 *
 * Merge commits are skipped (--no-merges), so on a repo that merges feature
 * branches locally the list is the individual commits; on a squash-merge repo
 * one subject == one PR title and the "(#NNN)" suffix becomes a PR link.
 *
 * Opt-out per change — OFF by default, everything is published unless marked:
 *   - `[internal]` anywhere in the subject, or
 *   - a `Customer-visible: no` line in the commit body.
 * Marked commits are dropped here and never enter the image; the count is
 * printed so the omission is visible in the build log rather than silent.
 *
 * Absent git / any failure writes `{ changes: [] }` and exits 0 — this is
 * diagnostic data, and a build must never fail over it. The output is
 * gitignored: it is a build artifact, not a source file.
 */

const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const OUT   = path.join(__dirname, '..', 'changes.json');
const LIMIT = Number(process.env.CHANGES_LIMIT) || 30;

const HIDE_TITLE   = /\[internal\]/i;
const HIDE_TRAILER = /^\s*customer-visible\s*:\s*(no|false|0)\s*$/im;

// PR number from the squash-merge suffix GitHub appends: "… (#203)".
function parsePr(subject) {
  const m = /\(#(\d+)\)\s*$/.exec(subject || '');
  return m ? Number(m[1]) : null;
}

function isHidden(subject, body) {
  return HIDE_TITLE.test(subject || '') || HIDE_TRAILER.test(body || '');
}

function readLog(limit) {
  const raw = execFileSync('git', [
    'log', `-n${limit}`, '--no-merges',
    '--format=%H%x1f%cI%x1f%s%x1f%b%x1e',
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });

  return raw.split('\x1e').map(s => s.replace(/^\s+/, '')).filter(Boolean).map(rec => {
    const [sha, date, subject, body] = rec.split('\x1f');
    return { sha, date, subject: (subject || '').trim(), body: body || '' };
  });
}

function generate() {
  const all    = readLog(LIMIT);
  const hidden = all.filter(c => isHidden(c.subject, c.body)).length;
  const changes = all
    .filter(c => !isHidden(c.subject, c.body))
    .map(c => ({ sha: c.sha, date: c.date, subject: c.subject, pr: parsePr(c.subject) }));
  return { generatedFrom: all[0] ? all[0].sha : null, changes, hidden };
}

function main() {
  let stamp;
  try {
    stamp = generate();
  } catch (err) {
    // Stdout is the build log here; pino is not configured during a build.
    process.stdout.write(`[changes] WARN could not read git history (${err.message}) — writing an empty list\n`);
    stamp = { generatedFrom: null, changes: [], hidden: 0 };
  }
  fs.writeFileSync(OUT, JSON.stringify(stamp, null, 2) + '\n', 'utf8');
  process.stdout.write(
    `[changes] stamped ${path.relative(process.cwd(), OUT)}: ` +
    `${stamp.changes.length} change(s), hidden ${stamp.hidden} internal change(s)\n`
  );
}

if (require.main === module) main();

module.exports = { parsePr, isHidden, generate };
