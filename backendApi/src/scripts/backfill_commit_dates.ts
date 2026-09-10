const mongoose = require('mongoose');
async function main() {
  await mongoose.connect('mongodb+srv://sougata:Rahul%40123@cluster0.1vx1l.mongodb.net/ai_project', { serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;
  // The dummy seed wrote commit timestamps as `date`; the DB dictionary and
  // all services use `committed_at`. One-time rename backfill.
  const r = await db.collection('commits').updateMany(
    { committed_at: { $exists: false } },
    { $rename: { date: 'committed_at' } }
  );
  console.log('renamed:', r.modifiedCount);
  console.log('with committed_at:', await db.collection('commits').countDocuments({ committed_at: { $exists: true } }));
  const recent = await db.collection('commits').countDocuments({ committed_at: { $gte: new Date(Date.now() - 30 * 86400000) } });
  console.log('commits in last 30d:', recent);
  await mongoose.disconnect();
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
