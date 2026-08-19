'use strict';

// The smallest semver that answers the only question the updater asks: "is the
// published release newer than the one I am running?"
//
// Deliberately not a dependency. The full spec is large, most of it is range
// syntax we never use, and a supply-chain dependency inside the mechanism that
// decides which code to run next is exactly the wrong place to add one.
//
// Supported: MAJOR.MINOR.PATCH with an optional -prerelease and +build.
// Precedence follows semver.org §11: numeric identifiers compare numerically,
// alphanumerics lexically, a prerelease is LOWER than its release, and build
// metadata is ignored entirely.

const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

/** @returns {{major,minor,patch,prerelease:string[]}|null} — null if not semver. */
function parse(version) {
  if (typeof version !== 'string') return null;
  const m = SEMVER_RE.exec(version.trim());
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ? m[4].split('.') : [],
  };
}

function isValid(version) { return parse(version) !== null; }

function comparePreIdentifiers(a, b) {
  const aNum = /^\d+$/.test(a);
  const bNum = /^\d+$/.test(b);
  if (aNum && bNum) return Number(a) - Number(b);
  // Numeric identifiers always have lower precedence than alphanumeric ones.
  if (aNum) return -1;
  if (bNum) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparePrerelease(a, b) {
  // No prerelease outranks any prerelease: 1.0.0 > 1.0.0-rc.1.
  if (!a.length && !b.length) return 0;
  if (!a.length) return 1;
  if (!b.length) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === undefined) return -1;   // a shorter set of identifiers is lower
    if (b[i] === undefined) return 1;
    const c = comparePreIdentifiers(a[i], b[i]);
    if (c !== 0) return c < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * @returns {number|null} -1 | 0 | 1, or null when either side is not semver —
 * callers MUST treat null as "cannot compare", never as "equal". The dev build
 * (version "dev") lands here on purpose, so a developer's checkout can never
 * conclude it is out of date against a release channel.
 */
function compare(a, b) {
  const pa = parse(a);
  const pb = parse(b);
  if (!pa || !pb) return null;
  for (const key of ['major', 'minor', 'patch']) {
    if (pa[key] !== pb[key]) return pa[key] < pb[key] ? -1 : 1;
  }
  return comparePrerelease(pa.prerelease, pb.prerelease);
}

/** True only when both parse AND a is strictly newer. Unknown ⇒ false. */
function isNewer(a, b) { return compare(a, b) === 1; }

/** True only when both parse AND a is at least b. Unknown ⇒ false. */
function gte(a, b) {
  const c = compare(a, b);
  return c === 0 || c === 1;
}

module.exports = { parse, isValid, compare, isNewer, gte };
