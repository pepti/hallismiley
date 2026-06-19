// Repository for the in-app change-request (feedback) tool (non-prod only).
// A testing session submits one batch of items. Parent batch + child items;
// per-item open/resolved status drives the admin inbox.
const db = require('../config/database');

const BATCH_COLUMNS = `id, submitter_user_id, submitter_email, user_agent,
  item_count, submitted_at, created_at, updated_at`;
const ITEM_COLUMNS = `id, batch_id, page_url, page_label, element_selector,
  element_label, note, screenshot_path, status, created_at, updated_at`;

const MAX_ITEMS = 100;

class ChangeRequest {
  // Create a batch + all its items in one transaction.
  // items: [{ pageUrl, pageLabel, elementSelector, elementLabel, note, screenshotPath }]
  static async createBatchWithItems({
    submitterUserId = null,
    submitterEmail = null,
    userAgent = null,
    items,
  }) {
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('A change-request batch must contain at least one item');
    }
    if (items.length > MAX_ITEMS) {
      throw new Error(`Too many items in one batch (max ${MAX_ITEMS})`);
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows: batchRows } = await client.query(
        `INSERT INTO change_request_batches
           (submitter_user_id, submitter_email, user_agent, item_count)
         VALUES ($1, $2, $3, $4)
         RETURNING ${BATCH_COLUMNS}`,
        [submitterUserId, submitterEmail, userAgent, items.length]
      );
      const batch = batchRows[0];

      const insertedItems = [];
      for (const it of items) {
        const { rows } = await client.query(
          `INSERT INTO change_requests
             (batch_id, page_url, page_label, element_selector, element_label, note, screenshot_path)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING ${ITEM_COLUMNS}`,
          [
            batch.id,
            String(it.pageUrl),
            it.pageLabel != null ? String(it.pageLabel) : null,
            it.elementSelector != null ? String(it.elementSelector) : null,
            it.elementLabel != null ? String(it.elementLabel) : null,
            String(it.note),
            it.screenshotPath != null ? String(it.screenshotPath) : null,
          ]
        );
        insertedItems.push(rows[0]);
      }

      await client.query('COMMIT');
      return { batch, items: insertedItems };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // Batches newest-first, each with its items attached. An optional status
  // filter attaches only matching items and drops batches left with none.
  static async listBatches({ limit = 50, offset = 0, status = null } = {}) {
    const lim = Math.min(Number(limit) || 50, 200);
    const off = Math.max(Number(offset) || 0, 0);

    const { rows: batches } = await db.query(
      `SELECT ${BATCH_COLUMNS} FROM change_request_batches
        ORDER BY submitted_at DESC
        LIMIT $1 OFFSET $2`,
      [lim, off]
    );
    if (batches.length === 0) return [];

    const batchIds = batches.map(b => b.id);
    const params = [batchIds];
    let statusClause = '';
    if (status === 'open' || status === 'resolved') {
      params.push(status);
      statusClause = ' AND status = $2';
    }
    const { rows: items } = await db.query(
      `SELECT ${ITEM_COLUMNS} FROM change_requests
        WHERE batch_id = ANY($1)${statusClause}
        ORDER BY created_at ASC`,
      params
    );

    const byBatch = new Map();
    for (const it of items) {
      if (!byBatch.has(it.batch_id)) byBatch.set(it.batch_id, []);
      byBatch.get(it.batch_id).push(it);
    }
    return batches
      .map(b => ({ ...b, items: byBatch.get(b.id) || [] }))
      .filter(b => (status ? b.items.length > 0 : true));
  }

  static async setItemStatus(itemId, status) {
    if (!['open', 'resolved'].includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }
    const { rows } = await db.query(
      `UPDATE change_requests SET status = $1 WHERE id = $2 RETURNING ${ITEM_COLUMNS}`,
      [status, String(itemId)]
    );
    return rows[0] || null;
  }
}

module.exports = ChangeRequest;
