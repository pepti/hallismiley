'use strict';

// ── Build identity ───────────────────────────────────────────────────────────
//
// Reads server/version.json, stamped at image build by scripts/generate-version.js
// and never written at runtime. Everything downstream — the update checker's
// "is the manifest newer than me?", the post-boot "did the update actually
// land?" check, the admin status card — reads this one frozen object.
//
// A missing file is the normal local-development case, not an error: a clean
// checkout runs `npm start` with no build step. It resolves to a dev identity
// whose version is literally "dev", which no version comparison will ever
// consider upgradeable — a dev box must never decide it is out of date against
// a production release channel.

const fs   = require('fs');
const path = require('path');

const VERSION_FILE = path.join(__dirname, '..', 'version.json');
// Recent changes, written by server/scripts/generate-changes.js on the build
// host (see that file for the opt-out rule). Absent in a checkout, absent when
// the workflow forgot the step — both read as an empty list, never a guess.
const CHANGES_FILE = path.join(__dirname, '..', 'changes.json');

const DEV_BUILD = {
  version: 'dev',
  gitSha:  'dev',
  builtAt: null,
  channel: 'dev',
};

function readBuildInfo(file = VERSION_FILE) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return { ...DEV_BUILD };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A corrupt stamp is a broken build, but claiming a wrong version is worse
    // than claiming none: fall back to the dev identity, which is never
    // considered upgradeable.
    return { ...DEV_BUILD };
  }
  return {
    version: typeof parsed.version === 'string' && parsed.version ? parsed.version : DEV_BUILD.version,
    gitSha:  typeof parsed.gitSha  === 'string' && parsed.gitSha  ? parsed.gitSha  : DEV_BUILD.gitSha,
    builtAt: typeof parsed.builtAt === 'string' && parsed.builtAt ? parsed.builtAt : DEV_BUILD.builtAt,
    channel: typeof parsed.channel === 'string' && parsed.channel ? parsed.channel : DEV_BUILD.channel,
  };
}

const buildInfo = Object.freeze(readBuildInfo());

function readChanges(file = CHANGES_FILE) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  if (!raw || !Array.isArray(raw.changes)) return [];
  return raw.changes
    .filter(c => c && typeof c.subject === 'string')
    .map(c => Object.freeze({
      sha:     typeof c.sha  === 'string' ? c.sha  : 'unknown',
      date:    typeof c.date === 'string' ? c.date : 'unknown',
      subject: c.subject,
      pr:      Number.isInteger(c.pr) ? c.pr : null,
    }));
}

/** The changes this build carries, newest first — the "Latest updates" card (ice #209). */
const changes = Object.freeze(readChanges());

/** True when this process has no stamped build — a local checkout, not a release. */
const isDevBuild = buildInfo.version === DEV_BUILD.version;

/** Short sha for display. Never used for comparison — digests are. */
function shortSha(sha = buildInfo.gitSha) {
  return String(sha || '').slice(0, 12);
}

module.exports = { buildInfo, isDevBuild, shortSha, readBuildInfo, VERSION_FILE, DEV_BUILD, changes, readChanges, CHANGES_FILE };
