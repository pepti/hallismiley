'use strict';

// The self-update ledger (migration 081). One row per release this instance has
// heard about, on the channel it heard about it from.
//
// The state machine, and who moves it:
//
//   available ──manual/auto apply──► applying ──post-boot verify──► applied
//        │                              │
//        │ auto, window computed        └──grace period expired──► failed ──► (rollback)
//        ▼
//   scheduled ──window opens──► applying
//        │
//        └──admin dismisses──► dismissed
//
// Transitions are guarded IN SQL (`WHERE status = …`), not in JavaScript. Two
// requests racing to apply the same update is the whole reason: the guard makes
// the second one a no-op that returns no row, instead of a second deployment
// trigger for an instance that is already restarting.

const db = require('../config/database');

const STATUSES = ['available', 'scheduled', 'applying', 'applied', 'failed', 'dismissed'];
// The states an admin (or the scheduler) can still act on.
const ACTIONABLE = ['available', 'scheduled'];

/**
 * Record a release seen in a manifest. Idempotent by (channel, version) — the
 * hourly re-check of an unchanged manifest must not grow the table or reset
 * anything an operator has since done to the row.
 *
 * Re-publishing a version with a NEW digest updates the row, but only while it
 * is still actionable: once a version has been applied or has failed, its row
 * is history, and history does not get rewritten by a manifest edit.
 */
async function recordAvailable({ version, imageDigest, channel, changelogMd = null, detail = {} }) {
  const { rows } = await db.query(
    `INSERT INTO system_updates (version, image_digest, channel, changelog_md, detail)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     ON CONFLICT (channel, version) DO UPDATE
       SET image_digest = EXCLUDED.image_digest,
           changelog_md = EXCLUDED.changelog_md,
           detail       = EXCLUDED.detail,
           updated_at   = NOW()
       WHERE system_updates.status = ANY($6::text[])
     RETURNING *`,
    [version, imageDigest, channel, changelogMd, JSON.stringify(detail), ACTIONABLE]
  );
  if (rows[0]) return rows[0];
  // The conflict target existed but the guard declined the update (it is
  // applied/failed/dismissed). Hand back what is actually there.
  return findByVersion(channel, version);
}

async function findByVersion(channel, version) {
  const { rows } = await db.query(
    `SELECT * FROM system_updates WHERE channel = $1 AND version = $2`, [channel, version]
  );
  return rows[0] || null;
}

async function findById(id) {
  const { rows } = await db.query(`SELECT * FROM system_updates WHERE id = $1`, [id]);
  return rows[0] || null;
}

/** The newest release still awaiting a decision on this channel. */
async function latestActionable(channel) {
  const { rows } = await db.query(
    `SELECT * FROM system_updates
      WHERE channel = $1 AND status = ANY($2::text[])
      ORDER BY discovered_at DESC, id DESC
      LIMIT 1`,
    [channel, ACTIONABLE]
  );
  return rows[0] || null;
}

/** The row a restart must verify against, if this instance was mid-update. */
async function currentApplying() {
  const { rows } = await db.query(
    `SELECT * FROM system_updates WHERE status = 'applying'
      ORDER BY updated_at DESC, id DESC LIMIT 1`
  );
  return rows[0] || null;
}

async function listRecent(limit = 25) {
  const capped = Math.min(Math.max(Number(limit) || 25, 1), 100);
  const { rows } = await db.query(
    `SELECT * FROM system_updates ORDER BY discovered_at DESC, id DESC LIMIT $1`, [capped]
  );
  return rows;
}

/** Merge keys into detail without clobbering what is already there. */
async function mergeDetail(id, patch) {
  const { rows } = await db.query(
    `UPDATE system_updates SET detail = detail || $2::jsonb, updated_at = NOW()
      WHERE id = $1 RETURNING *`,
    [id, JSON.stringify(patch || {})]
  );
  return rows[0] || null;
}

/**
 * Guarded transition. Returns null when the row was not in `from` — which is
 * the caller's signal that someone else got there first.
 */
async function transition(id, from, to, { patch = {}, appliedAt = false, previousDigest } = {}) {
  const sets = [`status = $3`, `detail = detail || $4::jsonb`, `updated_at = NOW()`];
  const params = [id, from, to, JSON.stringify(patch || {})];
  if (appliedAt) sets.push(`applied_at = NOW()`);
  if (previousDigest !== undefined) {
    params.push(previousDigest);
    sets.push(`previous_digest = $${params.length}`);
  }
  const { rows } = await db.query(
    `UPDATE system_updates SET ${sets.join(', ')}
      WHERE id = $1 AND status = ANY($2::text[])
      RETURNING *`,
    params
  );
  return rows[0] || null;
}

const markScheduled = (id, scheduledFor) =>
  transition(id, ['available', 'scheduled'], 'scheduled', { patch: { scheduledFor } });

// previous_digest is captured here, before the swap, because after the swap it
// is unrecoverable — and it is the only input an assisted rollback has.
const markApplying = (id, previousDigest, patch = {}) =>
  transition(id, ACTIONABLE, 'applying', { previousDigest, patch });

const markApplied = (id) =>
  transition(id, ['applying'], 'applied', { appliedAt: true });

const markFailed = (id, reason, patch = {}) =>
  transition(id, ['applying', 'scheduled'], 'failed', { patch: { ...patch, failureReason: reason } });

const markDismissed = (id) =>
  transition(id, ACTIONABLE, 'dismissed');

module.exports = {
  STATUSES, ACTIONABLE,
  recordAvailable, findById, findByVersion, latestActionable, currentApplying, listRecent,
  mergeDetail, transition,
  markScheduled, markApplying, markApplied, markFailed, markDismissed,
};
