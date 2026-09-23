#!/usr/bin/env node
// Verifies that every locale JSON file has exactly the same key set, and that
// every statically-referenced key in the frontend actually exists. The pair
// diff alone cannot catch a key missing from BOTH languages — that's how
// `adminCompanyRoles.unassigned` rendered raw in production (t() falls back to
// the key itself). Exits non-zero on mismatch with a readable diff.
//
//   node scripts/check-i18n-keys.js

'use strict';

const fs   = require('fs');
const path = require('path');

// Pairs of (baseline, other) JSON files that must stay in lockstep.
const PAIRS = [
  {
    label: 'public/js/i18n',
    en: 'public/js/i18n/en.json',
    is: 'public/js/i18n/is.json',
  },
  {
    label: 'server/i18n',
    en: 'server/i18n/en.json',
    is: 'server/i18n/is.json',
  },
  // Product overlays (D-021): product-owned, merged over the engine table at
  // load time. Same lockstep rule; a product must not redefine an engine key
  // by accident (checked below), and the used-key scan sees both tables.
  {
    label: 'public/js/i18n (product overlay)',
    en: 'public/js/i18n/product.en.json',
    is: 'public/js/i18n/product.is.json',
    overlayOf: 'public/js/i18n/en.json',
  },
  {
    label: 'server/i18n (product overlay)',
    en: 'server/i18n/product.en.json',
    is: 'server/i18n/product.is.json',
    overlayOf: 'server/i18n/en.json',
  },
];

function loadJson(rel) {
  const full = path.resolve(__dirname, '..', rel);
  try {
    return JSON.parse(fs.readFileSync(full, 'utf8'));
  } catch (err) {
    console.error(`✗ Failed to read/parse ${rel}: ${err.message}`);
    process.exit(1);
  }
}

function diff(enKeys, isKeys) {
  const onlyEn = enKeys.filter(k => !isKeys.includes(k));
  const onlyIs = isKeys.filter(k => !enKeys.includes(k));
  return { onlyEn, onlyIs };
}

function findEmptyValues(obj) {
  return Object.keys(obj).filter(k => {
    const v = obj[k];
    return typeof v === 'string' && v.trim().length === 0;
  });
}

// ── used-key scan ────────────────────────────────────────────────────────────
// Collect key literals the frontend references and assert each resolves in
// public/js/i18n/en.json (the t() fallback locale). Only static literals are
// checked — dynamic keys ('companyPerm.' + id) don't match the regexes and
// their call sites guard with `t(key) === key` themselves.

const SRC_ROOT = path.resolve(__dirname, '..', 'public', 'js');
const SKIP_DIRS = new Set(['vendor', 'i18n']); // minified libs; the loader itself

// Literal keys that are allowed to be absent (probe-style lookups where the
// caller treats "t() returned the key" as a signal). Currently none.
const MISSING_OK = new Set([]);

// t('some.key') / t("some.key")  and  labelKey: '…' / descKey: '…' indirection.
// The lookahead after the closing quote skips concatenations like
// t('adminOrders.col' + name) — those build keys dynamically and their prefix
// alone is legitimately absent from the locale files.
const USAGE_RES = [
  /\bt\(\s*'([a-z0-9_$]+(?:\.[a-z0-9_$-]+)+)'(?=\s*[,)])/gi,
  /\bt\(\s*"([a-z0-9_$]+(?:\.[a-z0-9_$-]+)+)"(?=\s*[,)])/gi,
  /\b(?:labelKey|descKey)\s*:\s*'([a-z0-9_$]+(?:\.[a-z0-9_$-]+)+)'(?=\s*[,}\r\n])/gi,
  /\b(?:labelKey|descKey)\s*:\s*"([a-z0-9_$]+(?:\.[a-z0-9_$-]+)+)"(?=\s*[,}\r\n])/gi,
];

function* walkJs(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walkJs(path.join(dir, entry.name));
    } else if (entry.name.endsWith('.js')) {
      yield path.join(dir, entry.name);
    }
  }
}

function findUndefinedUsedKeys(enMessages) {
  const missing = new Map(); // key -> first "file:line" seen
  for (const file of walkJs(SRC_ROOT)) {
    const src = fs.readFileSync(file, 'utf8');
    for (const re of USAGE_RES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src)) !== null) {
        const key = m[1];
        if (key in enMessages || MISSING_OK.has(key) || missing.has(key)) continue;
        const line = src.slice(0, m.index).split('\n').length;
        missing.set(key, `${path.relative(path.resolve(__dirname, '..'), file)}:${line}`);
      }
    }
  }
  return missing;
}

let failed = false;

for (const pair of PAIRS) {
  const en = loadJson(pair.en);
  const is = loadJson(pair.is);
  const enKeys = Object.keys(en).sort();
  const isKeys = Object.keys(is).sort();

  const { onlyEn, onlyIs } = diff(enKeys, isKeys);
  const emptyEn = findEmptyValues(en);
  const emptyIs = findEmptyValues(is);

  // An overlay key that also exists in the engine table overrides it at load
  // time — that is how a product puts its own brand and copy into engine
  // screens without editing the engine file. Reported, never failed.
  const overrides = pair.overlayOf ? enKeys.filter(k => k in loadJson(pair.overlayOf)) : [];

  const ok = !onlyEn.length && !onlyIs.length && !emptyEn.length && !emptyIs.length;

  const overrideNote = pair.overlayOf ? ` (${overrides.length} override engine keys)` : '';
  console.log(`${ok ? '✓' : '✗'} ${pair.label} — en: ${enKeys.length} keys, is: ${isKeys.length} keys${overrideNote}`);
  if (onlyEn.length) {
    console.log(`  ⚠ only in en:\n    - ${onlyEn.slice(0, 50).join('\n    - ')}${onlyEn.length > 50 ? `\n    - … (+${onlyEn.length - 50} more)` : ''}`);
    failed = true;
  }
  if (onlyIs.length) {
    console.log(`  ⚠ only in is:\n    - ${onlyIs.slice(0, 50).join('\n    - ')}${onlyIs.length > 50 ? `\n    - … (+${onlyIs.length - 50} more)` : ''}`);
    failed = true;
  }
  if (emptyEn.length) {
    console.log(`  ⚠ empty values in en:\n    - ${emptyEn.join('\n    - ')}`);
    failed = true;
  }
  if (emptyIs.length) {
    console.log(`  ⚠ empty values in is:\n    - ${emptyIs.join('\n    - ')}`);
    failed = true;
  }
}

const publicEn = { ...loadJson(PAIRS[0].en), ...loadJson(PAIRS[2].en) };
const undefinedUsed = findUndefinedUsedKeys(publicEn);
if (undefinedUsed.size) {
  console.log(`✗ public/js — ${undefinedUsed.size} referenced key(s) missing from en.json:`);
  for (const [key, where] of undefinedUsed) {
    console.log(`  ⚠ ${key}  (${where})`);
  }
  failed = true;
} else {
  console.log('✓ public/js — every statically-referenced key exists in en.json');
}

if (failed) {
  console.error('\n✗ i18n key check failed — see messages above.');
  process.exit(1);
}
console.log('\n✓ All locale files are in sync.');
