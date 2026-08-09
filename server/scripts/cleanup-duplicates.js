// Removes duplicate projects created by running the seed script multiple times.
// For each title that appears more than once, keeps the row with the LOWEST id
// and deletes the rest (along with their project_media rows).
// Run: node server/scripts/cleanup-duplicates.js
require('dotenv').config();
const { query, pool } = require('../config/database');

async function main() {
  // Find all titles that have more than one row
  const { rows: dupes } = await query(`
    SELECT title, COUNT(*) AS cnt, MIN(id) AS keep_id, ARRAY_AGG(id ORDER BY id) AS all_ids
    FROM projects
    GROUP BY title
    HAVING COUNT(*) > 1
    ORDER BY title
  `);

  if (dupes.length === 0) {
    console.log('No duplicate projects found. Nothing to do.');
    await pool.end();
    return;
  }

  console.log(`Found ${dupes.length} title(s) with duplicates:\n`);

  for (const row of dupes) {
    const deleteIds = row.all_ids.filter(id => id !== row.keep_id);
    console.log(`  Title : "${row.title}"`);
    console.log(`  Keep  : id=${row.keep_id}`);
    console.log(`  Delete: ids=${deleteIds.join(', ')} (${deleteIds.length} duplicate(s))`);

    // Delete child media rows first (FK constraint)
    const mediaResult = await query(
      `DELETE FROM project_media WHERE project_id = ANY($1::int[])`,
      [deleteIds]
    );
    if (mediaResult.rowCount > 0) {
      console.log(`  -> Deleted ${mediaResult.rowCount} project_media row(s)`);
    }

    // Delete the duplicate project rows
    const projResult = await query(
      `DELETE FROM projects WHERE id = ANY($1::int[])`,
      [deleteIds]
    );
    console.log(`  -> Deleted ${projResult.rowCount} project row(s)`);
    console.log('');
  }

  // Final count
  const { rows: [{ cnt }] } = await query(`SELECT COUNT(*) AS cnt FROM projects`);
  console.log(`Done. ${cnt} project(s) remain in the database.`);

  await pool.end();
}

main().catch(err => {
  console.error('Error:', err.message);
  pool.end();
  process.exit(1);
});
