/**
 * Inspect work item sources currently stored in MongoDB.
 *
 * Usage (from repo root):
 *   npx ts-node src/scripts/find_work_item_sources.ts
 *
 * Boot pattern matches other src/scripts/*.ts files: dotenv + mongoose.connect().
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';

async function main(): Promise<void> {
  const uri = `${process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/'}${process.env.DB_NAME || 'ai_project'}`;
  console.log('Connecting to:', uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'));
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    const db = mongoose.connection.db;
    if (!db) {
      console.log('DB connection not available.');
      return;
    }

    const collection = db.collection('work_items');

    const total = await collection.countDocuments({ is_deleted: false });
    console.log('work_items.total (is_deleted=false):', total);

    const bySource = await collection
      .aggregate([
        { $match: { is_deleted: false } },
        { $group: { _id: '$source', count: { $sum: 1 } } },
        { $sort: { count: -1 } },
      ])
      .toArray();

    console.log('\nwork_items.by_source:');
    for (const row of bySource) {
      const label = row._id ?? '(missing)';
      console.log(`  ${label.toString().padEnd(12)}: ${row.count}`);
    }

    const allItems = await collection
      .aggregate([
        { $match: { is_deleted: false } },
        {
          $project: {
            external_id: 1,
            source: 1,
            title: 1,
            type: 1,
            status: 1,
            project_id: 1,
            integration_id: 1,
            sprint_id: 1,
          },
        },
        { $sort: { external_id: 1 } },
      ])
      .toArray();

    const taigaItems = allItems.filter(
      (w: any) =>
        w.source === 'taiga' ||
        (typeof w.external_id === 'string' && w.external_id.startsWith('taiga-'))
    );

    console.log('\ntaiga-origin work items (source=taiga OR external_id starting with taiga-):', taigaItems.length);
    if (taigaItems.length) {
      console.log('\nexample taiga-origin work items:');
      for (const w of taigaItems.slice(0, 20)) {
        console.log(
          JSON.stringify({
            _id: w._id,
            project_id: w.project_id,
            integration_id: w.integration_id,
            source: w.source,
            external_id: w.external_id,
            type: w.type,
            status: w.status,
            title: w.title,
            sprint_id: w.sprint_id,
          })
        );
      }
      if (taigaItems.length > 20) {
        console.log(`...and ${taigaItems.length - 20} more`);
      }
    }

    const missingSource = await collection.countDocuments({ is_deleted: false, source: { $exists: false } });
    const emptySource = await collection.countDocuments({ is_deleted: false, source: '' });
    console.log('\nwork_items with missing source:', missingSource);
    console.log('work_items with empty source:', emptySource);
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.log('Error:', error);
  process.exitCode = 1;
});
