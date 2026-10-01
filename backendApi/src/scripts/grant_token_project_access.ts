import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { jWT_helper } from '../helper/jwt_helper';
dotenv.config();

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8').trim().replace(/^Bearer\s+/i, '');
}

async function main(): Promise<void> {
  const projectId = process.argv[2];
  if (!mongoose.Types.ObjectId.isValid(projectId)) throw new Error('Valid project id required.');
  const token = await readStdin();
  const verified = new jWT_helper().verifyToken(token);
  if (verified.error) throw new Error(`Token rejected: ${verified.message}`);
  const tokenUserId = String(verified.verifiedData?.user_id || '');
  if (!tokenUserId) throw new Error('Token has no user_id.');
  await mongoose.connect(`${process.env.MONGODB_URI}${process.env.DB_NAME || 'ai_project'}`, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db!;
  const project = await db.collection('projects').findOne({ _id: new mongoose.Types.ObjectId(projectId), is_deleted: false });
  if (!project) throw new Error('Project not found.');
  const identities: any[] = [{ user_id: tokenUserId }];
  if (mongoose.Types.ObjectId.isValid(tokenUserId)) identities.push({ _id: new mongoose.Types.ObjectId(tokenUserId) });
  const user = await db.collection('users').findOne({ $or: identities });
  if (!user || user.is_active === false || user.user_status === 0 || user.is_deleted || user.deleted_at) throw new Error('Token user is missing or inactive.');
  await db.collection('project_members').updateOne(
    { project_id: projectId, user_id: String(user._id) },
    { $set: { project_id: projectId, user_id: String(user._id), role: 'project_manager', is_deleted: false,
      deleted_at: null, updated_at: new Date() }, $setOnInsert: { created_at: new Date() } }, { upsert: true },
  );
  const membership = await db.collection('project_members').findOne({ project_id: projectId, user_id: String(user._id), is_deleted: false });
  console.log(JSON.stringify({ project: { id: projectId, name: project.name },
    user: { id: String(user._id), user_id: user.user_id, email: user.email },
    membership: { id: String(membership?._id), role: membership?.role } }, null, 2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
