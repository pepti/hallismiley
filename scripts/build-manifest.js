#!/usr/bin/env node
'use strict';

// Builds a release-channel manifest — the document every deployed instance
// polls to learn what it could become.
//
//   { "version": "1.4.2",
//     "imageDigest": "sha256:…",
//     "publishedAt": "2026-08-10T03:00:00.000Z",
//     "minCompatibleVersion": "1.3.0",
//     "changelogMd": "…",
//     "critical": false }
//
// The digest is the load-bearing field and it is REQUIRED: the platform pulls
// by digest, never by tag, so a manifest cannot point at "whatever :stable
// happens to mean today". Promotion retags an existing digest; it never
// rebuilds. Same bytes on canary and on stable, or the soak proved nothing.
//
// Usage:
//   node scripts/build-manifest.js --digest=sha256:… --channel=stable [options]
//
//   --version=X.Y.Z            default: version in package.json
//   --channel=stable|canary    required
//   --digest=sha256:<64 hex>   required
//   --published-at=ISO         default: now
//   --min-compatible=X.Y.Z     oldest version that can upgrade FROM this release
//   --critical                 mark as a security release (may bypass the window)
//   --changelog=PATH           default: CHANGELOG.md
//   --out=PATH                 default: stdout

const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CHANNELS = ['stable', 'canary'];
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;

function parseArgs(argv) {
  const out = { critical: false };
  for (const raw of argv.slice(2)) {
    const [key, ...rest] = raw.replace(/^--/, '').split('=');
    const value = rest.join('=');
    switch (key) {
      case 'version':        out.version = value; break;
      case 'channel':        out.channel = value; break;
      case 'digest':         out.digest = value; break;
      case 'published-at':   out.publishedAt = value; break;
      case 'min-compatible': out.minCompatible = value; break;
      case 'changelog':      out.changelog = value; break;
      case 'out':            out.out = value; break;
      case 'critical':       out.critical = value === '' || value === 'true'; break;
      default:
        throw new Error(`Unrecognised argument --${key}`);
    }
  }

  if (!out.version) {
    out.version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  }
  if (!CHANNELS.includes(out.channel)) throw new Error(`--channel must be one of ${CHANNELS.join(', ')}`);
  // Refusing a tag here is the whole point: a tag is mutable, a digest is not.
  if (!DIGEST_RE.test(out.digest || '')) throw new Error('--digest=sha256:<64 hex chars> is required');
  if (!SEMVER_RE.test(out.version)) throw new Error(`--version must be semver (got "${out.version}")`);
  if (out.minCompatible && !SEMVER_RE.test(out.minCompatible)) {
    throw new Error(`--min-compatible must be semver (got "${out.minCompatible}")`);
  }
  if (out.publishedAt && Number.isNaN(Date.parse(out.publishedAt))) {
    throw new Error(`--published-at must be an ISO 8601 timestamp (got "${out.publishedAt}")`);
  }
  return out;
}

/**
 * Pull one release's section out of a Keep a Changelog file.
 * A missing section is not fatal — an instance showing "no notes for this
 * release" is better than a release that cannot be published.
 */
function extractChangelog(md, version) {
  if (typeof md !== 'string') return '';
  const lines = md.split(/\r?\n/);
  // Matches "## [1.4.2] — 2026-08-10" and "## 1.4.2", dash style irrelevant.
  const isHeadingFor = (line, v) => {
    const m = /^##\s+\[?([0-9][^\]\s]*)\]?/.exec(line.trim());
    return m ? m[1] === v : false;
  };
  const start = lines.findIndex(l => isHeadingFor(l, version));
  if (start === -1) return '';
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s+/.test(lines[i].trim())) { end = i; break; }
  }
  return lines.slice(start, end).join('\n').replace(/\s+$/, '') + '\n';
}

function build(args) {
  const changelogPath = path.resolve(ROOT, args.changelog || 'CHANGELOG.md');
  let changelogMd;
  try {
    changelogMd = extractChangelog(fs.readFileSync(changelogPath, 'utf8'), args.version);
  } catch {
    // No CHANGELOG at all is the same non-event as no section for this version.
    changelogMd = '';
  }

  const manifest = {
    version:     args.version,
    imageDigest: args.digest,
    publishedAt: new Date(args.publishedAt || Date.now()).toISOString(),
    changelogMd,
    critical:    Boolean(args.critical),
  };
  // Only present when the release actually constrains the upgrade path — an
  // absent field means "reachable from anything", which is the common case.
  if (args.minCompatible) manifest.minCompatibleVersion = args.minCompatible;
  return manifest;
}

function main() {
  const args = parseArgs(process.argv);
  const manifest = build(args);
  const json = JSON.stringify(manifest, null, 2) + '\n';
  if (args.out) {
    fs.writeFileSync(path.resolve(ROOT, args.out), json, 'utf8');
    console.log(`[manifest] ${args.channel}: ${manifest.version} @ ${manifest.imageDigest.slice(0, 19)}… → ${args.out}`);
  } else {
    process.stdout.write(json);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(`[manifest] ${err.message}`);
    process.exit(1);
  }
}

module.exports = { parseArgs, build, extractChangelog };
