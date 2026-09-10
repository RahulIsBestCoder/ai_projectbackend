const mongoose = require('mongoose');
async function main() {
  await mongoose.connect('mongodb+srv://sougata:Rahul%40123@cluster0.1vx1l.mongodb.net/ai_project', { serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;
  const projs = await db.collection('projects').find({}).toArray();
  const ids = new Set(projs.map(p => String(p._id)));
  console.log('projects:', ids.size);
  const cols = ['integrations', 'git_intelligence', 'work_items', 'sprints', 'commits',
    'pull_requests', 'git_releases', 'analytics_snapshots', 'risk_predictions',
    'ai_insights', 'ai_conversations', 'notifications', 'reports', 'milestones',
    'dependencies', 'sync_history', 'project_members'];
  for (const c of cols) {
    const total = await db.collection(c).countDocuments({});
    let missing = 0, orphan = 0;
    const found = new Set();
    const cur = db.collection(c).find({}, { projection: { project_id: 1 } });
    while (await cur.hasNext()) {
      const d = await cur.next();
      if (d.project_id === undefined || d.project_id === null) { missing++; continue; }
      found.add(String(d.project_id));
      if (!ids.has(String(d.project_id))) orphan++;
    }
    console.log(c.padEnd(20), 'total=' + String(total).padEnd(6),
      'missing_project_id=' + String(missing).padEnd(4),
      'orphan=' + String(orphan).padEnd(4),
      'distinct_projects=' + found.size);
  }
  // integration provider spread
  const byProvider = await db.collection('integrations').aggregate([
    { $group: { _id: '$provider', n: { $sum: 1 } } }, { $sort: { _id: 1 } },
  ]).toArray();
  console.log('integrations by provider:', byProvider.map(r => r._id + '=' + r.n).join(', '));
  await mongoose.disconnect();
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
