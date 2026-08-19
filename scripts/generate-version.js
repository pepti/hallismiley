#!/usr/bin/env node
'use strict';

// Stamps server/version.json — the app's answer to "what exactly am I?".
//
// This runs at IMAGE BUILD time, never at runtime. A running container must not
// be able to change its own identity: the whole update mechanism compares the
// running version against a published manifest, so a version that could drift
// after boot would make "did the update land?" unanswerable.
//
// Inputs, all optional, all env vars (Docker exposes build ARGs to RUN as env):
//   APP_VERSION      — defaults to the version in package.json
//   GIT_SHA          — defaults to `git rev-parse HEAD`, else "unknown"
//   BUILT_AT         — defaults to now, ISO 8601
//   RELEASE_CHANNEL  — stable | canary | dev (defaults to "dev")
//
// The file is generated, never committed (.gitignore). Its absence is normal:
// server/config/version.js falls back to a dev identity, so `npm start` from a
// clean checkout works without a build step.

const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const OUT  = path.join(ROOT, 'server', 'version.json');

function gitSha() {
  if (process.env.GIT_SHA) return process.env.GIT_SHA.trim();
  try {
    // execFileSync (not exec) — no shell, so nothing here is interpolated.
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    // No .git in the build context is the normal Docker case.
    return 'unknown';
  }
}

function packageVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function build() {
  return {
    version:  process.env.APP_VERSION || packageVersion(),
    gitSha:   gitSha(),
    builtAt:  process.env.BUILT_AT || new Date().toISOString(),
    channel:  process.env.RELEASE_CHANNEL || 'dev',
  };
}

function main() {
  const info = build();
  fs.writeFileSync(OUT, JSON.stringify(info, null, 2) + '\n', 'utf8');
  // A build script is one of the explicitly allowed console.log sites (pino is
  // for the server); this line is the build log's record of what it stamped.
  console.log(`[version] ${OUT} ← ${info.version} ${info.gitSha.slice(0, 12)} (${info.channel}) @ ${info.builtAt}`);
}

if (require.main === module) main();

module.exports = { build, OUT };
