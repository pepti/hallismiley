'use strict';
// Decides whether a DESTRUCTIVE script may write to the database it is about to
// connect to. Pure (no pool, no dotenv) so the unit tier exercises it directly.
//
// Ported from icelandicstore #370 (`server/scripts/e2eTargetGuard.js`, the
// e2e-fixtures guard) and generalised into the one guard every destructive
// script here calls first (harvest 2, lane 1a, 2026-09-26). The ice incident it
// answers: data scripts are routinely run from a shell that holds a PROD or TEST
// DATABASE_URL, and in that shell NODE_ENV is unset — so a script whose only
// guard is `NODE_ENV === 'production'` runs against a live database on one
// mistyped command. seed-books-demo.js --wipe was exactly that script here.
//
// The rule is an ALLOW-list. A target passes only when ALL of these hold:
//   • nothing says this process is a deployed stack: NODE_ENV is not
//     `production`, APP_ENV is neither `production` nor `staging`, and no Azure
//     App Service marker (WEBSITE_SITE_NAME / WEBSITE_INSTANCE_ID) is set;
//   • every database host is local — localhost, 127.0.0.1 or ::1. A libpq
//     `?host=` parameter overrides the URL host in node-postgres, so it is
//     judged too; an Azure Flexible Server host (*.postgres.database.azure.com)
//     is named in the refusal so nobody mistakes it for a typo;
//   • every database name (the path, plus any `?dbname=` / `?database=`
//     override) matches the caller's `namePattern` — `_test` by default, e.g.
//     `_replay` for books-replay — OR the caller passed `allowDevDb` (a script's
//     explicit `--allow-dev-db` flag) and the name is not one reserved for real
//     records (see RESERVED_NAME below).
// Anything unparseable is refused.
//
// APP_ENV=test is deliberately NOT refused here (ice's e2e guard does refuse
// it): a downstream's local dev .env sets APP_ENV=test to paint the TEST badge,
// and the Azure TEST stack is caught by the App Service markers and the
// non-local host instead.
//
// Known limit (same as ice's): the port is not judged, so a `localhost:<port>`
// tunnel to a remote server passes the host test. The name rule is what covers
// that case — a live database is not called `…_test`, and `--allow-dev-db`
// still refuses the reserved names.

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const AZURE_PG_HOST = /\.postgres\.database\.azure\.com$/i;
const DEPLOYED_APP_ENVS = new Set(['production', 'staging']);

// Names that hold real records even on a laptop, which `--allow-dev-db` never
// unlocks: the private books instance (`<company>_books`, docs/BOOKS-PARALLEL-RUN.md
// §0 — "a separate database that no seed script is ever pointed at"), its
// restore drill, an ops database, and anything called prod/production/live.
const RESERVED_NAME = /(^|_)(books|books_restore|ops|prod|production|live)(_|$)/i;

// A plain identifier: what a dev database is called. Rejects quoting games.
const PLAIN_NAME = /^[A-Za-z0-9_]+$/;

function refuse(reason) {
  return { ok: false, reason };
}

/**
 * @param {object} opts
 * @param {string} opts.databaseUrl  the connection string the pool is (or will be) built with
 * @param {object} [opts.env]        the environment to judge (process.env)
 * @param {RegExp} [opts.namePattern] names always allowed on a local host (default: `_test` suffix)
 * @param {boolean} [opts.allowDevDb] the caller's explicit `--allow-dev-db`: admit any
 *                                    plain, non-reserved name on a local host
 * @returns {{ok:true, host:string, database:string} | {ok:false, reason:string}}
 */
function checkTarget({ databaseUrl, env = {}, namePattern = /_test$/, allowDevDb = false } = {}) {
  const nodeEnv = String(env.NODE_ENV || '').trim().toLowerCase();
  const appEnv  = String(env.APP_ENV  || '').trim().toLowerCase();

  if (nodeEnv === 'production') return refuse('NODE_ENV is "production"');
  if (DEPLOYED_APP_ENVS.has(appEnv)) {
    return refuse(`APP_ENV is "${appEnv}" — that is a deployed stack`);
  }
  // Azure App Service sets these on every instance, whatever the app settings say.
  if (env.WEBSITE_SITE_NAME || env.WEBSITE_INSTANCE_ID) {
    return refuse('this process is running inside Azure App Service');
  }

  if (!databaseUrl) return refuse('DATABASE_URL is not set');

  let url;
  try {
    url = new URL(String(databaseUrl));
  } catch {
    return refuse('DATABASE_URL is not a parseable URL');
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) {
    return refuse('DATABASE_URL is not a postgres:// URL');
  }

  const hosts = [url.hostname.replace(/^\[|\]$/g, ''), ...url.searchParams.getAll('host')]
    .map(h => h.toLowerCase());
  const azure = hosts.find(h => AZURE_PG_HOST.test(h));
  if (azure !== undefined) return refuse(`database host "${azure}" is an Azure database server`);
  const foreign = hosts.find(h => !LOCAL_HOSTS.has(h));
  if (foreign !== undefined) return refuse(`database host "${foreign || '(none)'}" is not local`);

  let name;
  try {
    name = decodeURIComponent(url.pathname.replace(/^\//, ''));
  } catch {
    return refuse('DATABASE_URL has an undecodable database name');
  }
  const names = [name, ...url.searchParams.getAll('dbname'), ...url.searchParams.getAll('database')];
  for (const n of names) {
    if (!n) return refuse('DATABASE_URL names no database');
    if (namePattern.test(n)) continue;
    if (!allowDevDb) {
      return refuse(`database "${n}" does not match ${namePattern} (pass --allow-dev-db for the local dev database)`);
    }
    if (!PLAIN_NAME.test(n)) return refuse(`database "${n}" is not a plain identifier`);
    if (RESERVED_NAME.test(n)) {
      return refuse(`database "${n}" holds real records (books/ops/prod) — --allow-dev-db never unlocks it`);
    }
  }

  return { ok: true, host: hosts[0], database: name };
}

/**
 * The call every destructive script makes before its first query: check, and on
 * a refusal print the reason and exit 1. The pool connects lazily, so a refused
 * run never opens a connection to the database it was pointed at.
 */
function assertSafeTarget(opts, { label = 'script', exit = (code) => process.exit(code), write = (s) => process.stderr.write(s) } = {}) {
  const res = checkTarget(opts);
  if (res.ok) return res;
  write(`[${label}] REFUSING TO RUN: ${res.reason}.\n`);
  write(`[${label}] This script deletes or rewrites rows, so it only runs against a local test database`
    + ' (or the local dev database with --allow-dev-db). Nothing was written.\n');
  exit(1);
  return res;
}

module.exports = { checkTarget, assertSafeTarget, LOCAL_HOSTS, RESERVED_NAME };
