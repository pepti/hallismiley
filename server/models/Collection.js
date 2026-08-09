// Repository for collections + the product_collections join.
// Parameterised queries throughout (A03). Collections are admin-managed groups
// of products, distinct from the free-text `category`.
const db = require('../config/database');

const COLUMNS = 'id, slug, title, description, active, created_at, updated_at';

class Collection {
  static async findAll({ activeOnly = false } = {}) {
    const where = activeOnly ? 'WHERE active = TRUE' : '';
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM collections ${where} ORDER BY title ASC`
    );
    return rows;
  }

  static async findById(id) {
    const { rows } = await db.query(
      `SELECT ${COLUMNS} FROM collections WHERE id = $1`,
      [String(id)]
    );
    return rows[0] || null;
  }

  static async create({ slug, title, description = null, active = true }) {
    const { rows } = await db.query(
      `INSERT INTO collections (slug, title, description, active)
       VALUES ($1, $2, $3, $4)
       RETURNING ${COLUMNS}`,
      [String(slug), String(title), description || null, Boolean(active)]
    );
    return rows[0];
  }

  static async update(id, data) {
    const allowed = ['slug', 'title', 'description', 'active'];
    const bool = new Set(['active']);
    const sets = [];
    const params = [];
    for (const f of allowed) {
      if (data[f] === undefined) continue;
      let v = data[f];
      if (bool.has(f)) v = Boolean(v);
      params.push(v);
      sets.push(`${f} = $${params.length}`);
    }
    if (sets.length === 0) return Collection.findById(id);
    params.push(String(id));
    const { rows } = await db.query(
      `UPDATE collections SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING ${COLUMNS}`,
      params
    );
    return rows[0] || null;
  }

  // Collections a product belongs to (slim: id/slug/title for the form chips).
  static async listForProduct(productId) {
    const { rows } = await db.query(
      `SELECT c.id, c.slug, c.title
         FROM collections c
         JOIN product_collections pc ON pc.collection_id = c.id
        WHERE pc.product_id = $1
        ORDER BY c.title ASC`,
      [String(productId)]
    );
    return rows;
  }

  // Bulk variant — avoids N+1 on the admin product list.
  static async listForProducts(productIds) {
    if (!productIds || productIds.length === 0) return [];
    const { rows } = await db.query(
      `SELECT pc.product_id, c.id, c.slug, c.title
         FROM collections c
         JOIN product_collections pc ON pc.collection_id = c.id
        WHERE pc.product_id = ANY($1::text[])
        ORDER BY c.title ASC`,
      [productIds.map(String)]
    );
    return rows;
  }

  // Replace a product's collection membership with the given id list (transactional).
  static async setForProduct(productId, collectionIds) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM product_collections WHERE product_id = $1', [String(productId)]);
      for (const cid of (collectionIds || [])) {
        await client.query(
          `INSERT INTO product_collections (product_id, collection_id)
           VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [String(productId), String(cid)]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return Collection.listForProduct(productId);
  }
}

module.exports = Collection;
