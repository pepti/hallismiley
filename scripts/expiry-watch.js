#!/usr/bin/env node
// The weekly expiry watch — the judging half of
// .github/workflows/secret-cert-watch.yml. Ported from icelandicstore #90
// (the workflow's inline bash scan), moved into a script so the date
// arithmetic, the thresholds and the "no expiry stamp" rule are unit-tested
// (tests/unit/expiryWatch.test.js) instead of living in untestable YAML.
//
// Two things go quietly stale on a fleet instance:
//   1. TLS certificates on the public hostnames. App Service managed
//      certificates renew themselves ~45 days before expiry, so a certificate
//      INSIDE the warning window (21 days) means renewal failed.
//   2. Key Vault secrets. Every secret is set with `--expires` (+180 days,
//      docs/DEPLOYMENT.md §6); inside 30 days it is due for rotation, and a
//      secret with NO expiry stamp is a finding in itself — nothing would ever
//      remind anyone to rotate it.
//
// Inputs (environment, never shell-interpolated — the workflow hands them over
// as env vars):
//   WATCH_HOSTS          hostnames, space- or comma-separated (`host` or
//                        `host:port`); empty = the TLS half is skipped
//   SECRETS_JSON         path to a JSON array of { vault, name, expires,
//                        enabled } — what `az keyvault secret list` returns,
//                        tagged with the vault; unset = the vault half is skipped
//   TLS_WARN_DAYS        default 21
//   SECRET_WARN_DAYS     default 30
//   FINDINGS_FILE        where to write the findings (one `subject|message`
//                        line each) — the workflow's email step reads it
//   GITHUB_OUTPUT        set by Actions; `found=true|false` is appended
//
// Exit code: 0 whether or not something was found (the workflow emails first,
// then fails the run in its own step); 2 on bad input. Metadata only — a
// secret's VALUE is never requested (the deploy identity holds Key Vault
// Reader, which cannot read values).
'use strict';

const fs = require('fs');
const tls = require('tls');

const DAY_MS = 86_400_000;
// A DNS name, optionally with a port. Anything else is refused rather than
// handed to tls.connect — the list comes from a repository variable.
const HOST_RE = /^(?=.{1,253}(?::\d{1,5})?$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?$/i;

/** Whole days from `now` until `when` (negative once past), or null if unparseable. */
function daysUntil(when, now) {
  const t = when instanceof Date ? when.getTime() : Date.parse(String(when));
  if (!Number.isFinite(t)) return null;
  return Math.floor((t - now.getTime()) / DAY_MS);
}

/** WATCH_HOSTS → [{ host, port }]; throws on an entry that is not a hostname. */
function parseHosts(raw) {
  const out = [];
  for (const entry of String(raw || '').split(/[\s,]+/).filter(Boolean)) {
    if (!HOST_RE.test(entry)) throw new Error(`WATCH_HOSTS entry "${entry}" is not a hostname`);
    const [host, port] = entry.split(':');
    const p = port ? Number(port) : 443;
    if (!(p >= 1 && p <= 65535)) throw new Error(`WATCH_HOSTS entry "${entry}" has a bad port`);
    out.push({ host: host.toLowerCase(), port: p });
  }
  return out;
}

/** Judge one certificate reading ({ host, validTo, authorized, error }). */
function judgeCert(reading, { warnDays, now }) {
  const subject = `tls/${reading.host}`;
  if (reading.error) return { subject, message: `could not read the certificate (${reading.error})` };
  const days = daysUntil(reading.validTo, now);
  if (days === null) return { subject, message: `unreadable expiry date "${reading.validTo}"` };
  if (days < 0) return { subject, message: `certificate EXPIRED ${-days}d ago (${reading.validTo})` };
  if (days < warnDays) {
    return { subject, message: `certificate expires in ${days}d (${reading.validTo}) — managed renewal may have FAILED` };
  }
  // An expired or mis-issued chain is caught above or here: a certificate the
  // runner does not trust is a finding even when its date is fine.
  if (reading.authorized === false) {
    return { subject, message: `certificate not trusted: ${reading.authorizationError || 'unknown reason'}` };
  }
  return null;
}

/** Judge one vault secret ({ vault, name, expires, enabled }). */
function judgeSecret(secret, { warnDays, now }) {
  if (secret.enabled === false) return null; // a disabled secret serves nothing
  const subject = `${secret.vault}/${secret.name}`;
  if (secret.expires === null || secret.expires === undefined || secret.expires === '' || secret.expires === 'None') {
    return { subject, message: 'no expiry stamp — set one with `az keyvault secret set-attributes --expires`' };
  }
  const days = daysUntil(secret.expires, now);
  if (days === null) return { subject, message: `unreadable expiry "${secret.expires}"` };
  if (days < 0) return { subject, message: `EXPIRED ${-days}d ago (${secret.expires})` };
  if (days < warnDays) return { subject, message: `expires in ${days}d (${secret.expires}) — rotate it` };
  return null;
}

/** Read a host's leaf certificate. Never rejects: failures become { error }. */
function readCert({ host, port }, { timeoutMs = 10_000 } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    // rejectUnauthorized:false so an EXPIRED certificate can still be read and
    // reported with its date; trust is judged from socket.authorized instead.
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate();
      done({
        host,
        validTo: cert && cert.valid_to,
        authorized: socket.authorized,
        authorizationError: socket.authorizationError ? String(socket.authorizationError) : null,
        error: cert && cert.valid_to ? null : 'no certificate presented',
      });
      socket.end();
    });
    socket.setTimeout(timeoutMs, () => { done({ host, error: `timed out after ${timeoutMs} ms` }); socket.destroy(); });
    socket.on('error', (err) => done({ host, error: err.code || err.message }));
  });
}

function readSecrets(file) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(`${file} is not a JSON array`);
  return parsed;
}

function intFrom(v, dflt) {
  if (v === undefined || v === null || String(v).trim() === '') return dflt;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error(`"${v}" is not a whole number of days`);
  return n;
}

async function run({ env = process.env, now = new Date(), log = (s) => process.stdout.write(`${s}\n`), read = readCert } = {}) {
  const tlsWarn = intFrom(env.TLS_WARN_DAYS, 21);
  const secretWarn = intFrom(env.SECRET_WARN_DAYS, 30);
  const hosts = parseHosts(env.WATCH_HOSTS);
  const findings = [];

  if (hosts.length === 0) log('TLS: no hosts to watch (WATCH_HOSTS is empty) — skipped.');
  for (const h of hosts) {
    const reading = await read(h);
    const f = judgeCert(reading, { warnDays: tlsWarn, now });
    const days = reading.validTo ? daysUntil(reading.validTo, now) : null;
    log(`TLS ${h.host}:${h.port} — ${days === null ? 'no reading' : `${days}d remaining (until ${reading.validTo})`}`);
    if (f) findings.push(f);
  }

  if (!env.SECRETS_JSON) {
    log('Key Vault: no secret list (SECRETS_JSON unset) — skipped.');
  } else {
    const secrets = readSecrets(env.SECRETS_JSON);
    log(`Key Vault: ${secrets.length} secret(s) listed.`);
    for (const s of secrets) {
      const f = judgeSecret(s, { warnDays: secretWarn, now });
      if (f) findings.push(f);
    }
  }

  const lines = findings.map((f) => `${f.subject}|${f.message}`);
  if (env.FINDINGS_FILE) fs.writeFileSync(env.FINDINGS_FILE, lines.length ? `${lines.join('\n')}\n` : '');
  if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `found=${findings.length ? 'true' : 'false'}\n`);
  if (findings.length) {
    log(`── ${findings.length} finding(s) ──`);
    for (const l of lines) log(l);
  } else {
    log('Every watched certificate and secret is inside its window.');
  }
  return findings;
}

module.exports = { daysUntil, parseHosts, judgeCert, judgeSecret, readCert, run };

if (require.main === module) {
  run().catch((err) => {
    process.stderr.write(`[expiry-watch] ${err.message}\n`);
    process.exit(2);
  });
}
