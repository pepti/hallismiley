#!/usr/bin/env node
/**
 * Merge the per-shard Jest coverage maps and enforce jest.config.js's GLOBAL
 * coverage floor on the merged result.
 *
 * CI splits the Jest suite across parallel shard jobs (ci.yml `test-shard`).
 * One shard exercises roughly a third of the code, so it cannot meet the floor
 * by itself — each shard runs with `--coverageThreshold='{}'` and uploads its
 * `coverage-final.json`; the aggregator job runs this script over all of them.
 * The floor is read from jest.config.js rather than repeated here, so there is
 * still exactly one place to ratchet it.
 *
 * Usage: node scripts/merge-coverage.js <dir> [expectedShardCount]
 *   <dir> is searched recursively for coverage-final.json files.
 */
const fs = require('fs');
const path = require('path');
const { createCoverageMap } = require('istanbul-lib-coverage');

const out = msg => process.stdout.write(`${msg}\n`);
const fail = msg => { process.stderr.write(`::error::${msg}\n`); process.exit(1); };

function findReports(dir) {
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...findReports(full));
    else if (entry.name === 'coverage-final.json') found.push(full);
  }
  return found.sort();
}

function main() {
  const [dir, expectedArg] = process.argv.slice(2);
  if (!dir || !fs.existsSync(dir)) fail(`coverage directory "${dir}" does not exist`);

  const reports = findReports(dir);
  // A shard whose artifact went missing would silently LOWER nothing and hide
  // nothing — but it would also mean the floor was checked on partial data.
  // Fail closed instead of certifying a number nobody measured.
  const expected = Number(expectedArg) || 0;
  if (reports.length === 0 || (expected && reports.length !== expected)) {
    fail(`expected ${expected || 'at least 1'} coverage-final.json under ${dir}, found ${reports.length}`);
  }

  const map = createCoverageMap({});
  for (const file of reports) {
    map.merge(JSON.parse(fs.readFileSync(file, 'utf8')));
    out(`merged ${path.relative(dir, file)}`);
  }

  const summary = map.getCoverageSummary();
  for (const key of ['lines', 'statements', 'functions', 'branches']) {
    const { pct, covered, total } = summary[key];
    out(`${key.padEnd(10)} ${String(pct).padStart(6)} %  (${covered}/${total})`);
  }

  // The shards run with thresholds OFF, so anything this script does not
  // enforce is enforced nowhere in CI. It only understands positive-percentage
  // GLOBAL floors — refuse anything else rather than silently dropping it.
  const threshold = require('../jest.config.js').coverageThreshold || {};
  const unsupported = Object.keys(threshold).filter(key => key !== 'global');
  if (unsupported.length) {
    fail(`jest.config.js coverageThreshold has keys this script does not enforce (${unsupported.join(', ')}) — `
      + 'CI shards run with thresholds off, so they would be checked nowhere. Teach scripts/merge-coverage.js about them first.');
  }
  const floors = threshold.global || {};
  const badFloors = Object.entries(floors).filter(([key, floor]) => !summary[key] || !(floor > 0));
  if (badFloors.length) fail(`unsupported global floor(s): ${JSON.stringify(Object.fromEntries(badFloors))}`);

  // pct is the string 'Unknown' when a metric's total is 0 — an empty map must
  // fail the floor, not slip past a string-to-number comparison.
  if (!(summary.lines.total > 0)) fail('merged coverage map is empty — the shards measured nothing');
  const misses = Object.entries(floors)
    .filter(([key, floor]) => !(Number(summary[key].pct) >= floor))
    .map(([key, floor]) => `${key} ${summary[key].pct}% is below the ${floor}% floor`);
  if (misses.length) fail(`coverage threshold not met: ${misses.join('; ')}`);
  out(`coverage floor met: ${JSON.stringify(floors)}`);
}

main();
