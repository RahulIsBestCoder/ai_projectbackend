import dotenv from 'dotenv';
import mongoose from 'mongoose';
dotenv.config();

async function main(): Promise<void> {
  const [projectId, email, mode] = process.argv.slice(2);
  if (!mongoose.Types.ObjectId.isValid(projectId) || !email) throw new Error('Usage: grant_project_access <projectId> <email>');
  await mongoose.connect(`${process.env.MONGODB_URI}${process.env.DB_NAME || 'ai_project'}`, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db!;
  const project = await db.collection('projects').findOne({ _id: new mongoose.Types.ObjectId(projectId), is_deleted: false });
  if (!project) throw new Error('Project not found.');
  const user = await db.collection('users').findOne({ email: email.trim().toLowerCase(), is_deleted: { $ne: true } });
  if (!user) throw new Error('User not found.');
  if (user.is_active === false || user.user_status === 0) throw new Error('User is inactive.');
  const existing = await db.collection('project_members').findOne({
    project_id: { $in: [projectId, new mongoose.Types.ObjectId(projectId)] },
    user_id: { $in: [String(user._id), user._id, user.user_id, String(user.user_id)] },
    is_deleted: { $ne: true },
  });
  if (mode === '--check') {
    console.log(JSON.stringify({ project: { id: projectId, name: project.name, owner_id: project.owner_id },
      user: { id: String(user._id), user_id: user.user_id, email: user.email, role: user.role, is_active: user.is_active },
      membership: existing || null }, null, 2));
    return;
  }
  await db.collection('project_members').updateOne(
    { project_id: projectId, user_id: String(user._id) },
    { $set: { project_id: projectId, user_id: String(user._id), role: 'project_manager', is_deleted: false,
      deleted_at: null, updated_at: new Date() }, $setOnInsert: { created_at: new Date() } },
    { upsert: true },
  );
  const membership = await db.collection('project_members').findOne({ project_id: projectId, user_id: String(user._id), is_deleted: false });
  console.log(JSON.stringify({ project: { id: projectId, name: project.name }, user: { id: String(user._id), email: user.email }, membership }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
