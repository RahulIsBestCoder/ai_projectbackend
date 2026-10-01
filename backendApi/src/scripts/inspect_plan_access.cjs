require('dotenv').config();
const mongoose = require('mongoose');
const deadline = setTimeout(() => { console.error('Database inspection timed out'); process.exit(1); }, 15000);
async function main() {
  const planId = process.argv[2];
  if (!mongoose.Types.ObjectId.isValid(planId)) throw new Error('Valid plan id required');
  await mongoose.connect(`${process.env.MONGODB_URI}${process.env.DB_NAME || 'ai_project'}`, { serverSelectionTimeoutMS: 5000 });
  const db = mongoose.connection.db;
  const plan = await db.collection('ai_plans').findOne({ _id: new mongoose.Types.ObjectId(planId) }, { projection: { project_id: 1, status: 1 } });
  console.log('plan', JSON.stringify(plan));
  if (plan?.project_id) {
    const id = String(plan.project_id);
    console.log('project', JSON.stringify(await db.collection('projects').findOne({ _id: new mongoose.Types.ObjectId(id) }, { projection: { name: 1, owner_id: 1, is_deleted: 1 } })));
    console.log('members', JSON.stringify(await db.collection('project_members').find({ project_id: { $in: [id, new mongoose.Types.ObjectId(id)] } }, { projection: { user_id: 1, is_deleted: 1, deleted_at: 1 } }).toArray()));
  }
  console.log('users', JSON.stringify(await db.collection('users').find({}, { projection: { user_id: 1, is_active: 1, is_deleted: 1 } }).limit(30).toArray()));
}
main().catch(e => { console.error(e.name); process.exitCode = 1; }).finally(async () => { await mongoose.disconnect(); clearTimeout(deadline); });
