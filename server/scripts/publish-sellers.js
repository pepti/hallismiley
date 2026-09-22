#!/usr/bin/env node
// Publish the seller area from OPS to the public instance (D-020).
//
//   npm run publish:sellers              → build, sign, POST to SELLER_PUBLISH_URL
//   npm run publish:sellers -- --dry-run → build only; print the counts
//   npm run publish:sellers -- --out f   → build and write the JSON to f (no POST)
//
// Env: SELLER_PUBLISH_URL (the public instance's origin, e.g.
// https://orangesmiley.is) and SELLER_PUBLISH_SECRET (≥ 32 chars, the same
// value on both instances; generate with `openssl rand -hex 32`).
//
// One way, by construction: this script READS the ops DB and SENDS; the public
// instance has no route that can reach back. Run it after issuing the month's
// commission statements (they are due by the 7th, D-003) and whenever the
// pipeline has moved; a scheduled run comes when ops is on Azure.
require('dotenv').config({ path: require('path').join(__dirname, '../../.env'), quiet: true });

const fs = require('fs');
const { pool } = require('../config/database');
const { instanceRole } = require('../config/instanceRole');
const { buildSnapshot } = require('../services/sellerPublish/snapshot');
const signature = require('../services/sellerPublish/signature');

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? null : (process.argv[i + 1] || '');
}

async function main() {
  if (instanceRole() === 'public') {
    throw new Error('Refusing to publish FROM a public instance — run this on ops.');
  }
  const dryRun = process.argv.includes('--dry-run');
  const out = arg('--out');

  const snap = await buildSnapshot(pool);
  const summary = `sellers=${snap.sellers.length} leads=${snap.leads.length} `
    + `accounts=${snap.accounts.length} statements=${snap.statements.length}`;

  if (dryRun) {
    console.log(`[dry-run] ${summary} — nothing sent`);
    for (const s of snap.sellers) {
      const views = ['leads', 'accounts', 'commission'].filter(v => s[`can_${v}`]).join(', ');
      console.log(`  ${s.email}  (${views})`);
    }
    return;
  }
  const body = Buffer.from(JSON.stringify(snap), 'utf8');
  if (out) {
    fs.writeFileSync(out, body);
    console.log(`Wrote ${out} (${body.length} bytes): ${summary}`);
    return;
  }

  const base = String(process.env.SELLER_PUBLISH_URL || '').replace(/\/+$/, '');
  const secret = signature.secretFromEnv();
  if (!/^https?:\/\//.test(base)) throw new Error('SELLER_PUBLISH_URL is not set (e.g. https://orangesmiley.is)');
  if (!base.startsWith('https://') && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) {
    throw new Error('SELLER_PUBLISH_URL must be https:// (plain http only for localhost)');
  }
  if (!secret) throw new Error(`SELLER_PUBLISH_SECRET must be at least ${signature.MIN_SECRET_LENGTH} characters`);

  const res = await fetch(`${base}/api/v1/seller-publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [signature.HEADER]: signature.sign(secret, body) },
    body,
    redirect: 'error',
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Publish refused: HTTP ${res.status} ${text.slice(0, 300)}`);
  console.log(`Published ${snap.snapshot_id}: ${summary}`);
}

if (require.main === module) {
  main()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch((err) => { console.error(err.message); pool.end().finally(() => process.exit(1)); });
}

module.exports = { main };
