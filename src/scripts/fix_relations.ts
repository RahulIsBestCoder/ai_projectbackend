const mongoose = require('mongoose');
async function main() {
  await mongoose.connect('mongodb+srv://sougata:Rahul%40123@cluster0.1vx1l.mongodb.net/ai_project', { serverSelectionTimeoutMS: 15000 });
  const db = mongoose.connection.db;
  // 1. project_id indexes on all project-scoped collections
  const indexed = [
    'integrations', 'git_intelligence', 'work_items', 'sprints', 'commits',
    'pull_requests', 'git_releases', 'analytics_snapshots', 'risk_predictions',
    'ai_insights', 'ai_conversations', 'notifications', 'reports',
    'milestones', 'dependencies', 'sync_history', 'project_members',
  ];
  for (const c of indexed) {
    await db.collection(c).createIndex({ project_id: 1 });
    console.log('index project_id ->', c);
  }
  await db.collection('sync_history').createIndex({ integration_id: 1 });
  await db.collection('git_releases').createIndex({ repository_id: 1 });
  console.log('index integration_id/repository_id done');
  // 2. drop junk collections created by mongoose name pluralization
  for (const junk of ['Ai', 'git_intelligences']) {
    try { await db.dropCollection(junk); console.log('dropped junk collection:', junk); }
    catch (e) { console.log('skip (missing):', junk); }
  }
  await mongoose.disconnect();
}
main().catch(e => { console.error('ERR:', e.message); process.exit(1); });
