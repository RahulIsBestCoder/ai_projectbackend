import dotenv from 'dotenv';
import mongoose from 'mongoose';
dotenv.config();

async function main(): Promise<void> {
  if (!process.env.MONGODB_URI) throw new Error('MONGODB_URI is required');
  await mongoose.connect(`${process.env.MONGODB_URI}${process.env.DB_NAME || 'ai_project'}`, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db!;
  const active = { is_deleted: { $ne: true }, deleted_at: null };
  const users = await db.collection('users').find({ ...active, is_active: { $ne: false }, user_status: { $ne: 0 } }).toArray();
  const projects = await db.collection('projects').find(active).toArray();
  const permissions = await db.collection('permissions').find(active).toArray();
  const now = new Date();
  const audit = { is_deleted: false, deleted_at: null, updated_at: now };
  await db.collection('roles').updateOne({ name: 'super_admin' }, { $set: audit, $setOnInsert: { created_at: now } }, { upsert: true });
  const role = (await db.collection('roles').findOne({ name: 'super_admin' }))!;
  for (const permission of permissions) {
    await db.collection('role_permissions').updateOne({ role_id: role._id, permission_id: permission._id }, { $set: audit, $setOnInsert: { created_at: now } }, { upsert: true });
  }
  let verifiedMemberships = 0;
  let verifiedRoles = 0;
  for (const user of users) {
    await db.collection('user_roles').updateOne({ user_id: { $in: [user._id, String(user._id)] }, role_id: role._id }, {
      $set: { ...audit, user_id: user._id, role_id: role._id }, $setOnInsert: { created_at: now },
    }, { upsert: true });
    if (await db.collection('user_roles').findOne({ user_id: user._id, role_id: role._id, ...active })) verifiedRoles++;
    const identities = [user._id, String(user._id)];
    if (user.user_id) identities.push(user.user_id);
    for (const project of projects) {
      await db.collection('project_members').updateOne({ project_id: { $in: [project._id, String(project._id)] }, user_id: { $in: identities } }, {
        $set: { ...audit, project_id: String(project._id), user_id: String(user._id), role: 'project_manager' },
        $setOnInsert: { created_at: now },
      }, { upsert: true });
      if (await db.collection('project_members').findOne({ project_id: String(project._id), user_id: String(user._id), role: 'project_manager', ...active })) verifiedMemberships++;
    }
  }
  const verifiedPermissions = await db.collection('role_permissions').countDocuments({ role_id: role._id, permission_id: { $in: permissions.map(p => p._id) }, ...active });
  console.log(JSON.stringify({ database: db.databaseName, users: users.length, projects: projects.length, verifiedRoles, verifiedMemberships, verifiedPermissions }, null, 2));
  if (verifiedRoles !== users.length || verifiedMemberships !== users.length * projects.length || verifiedPermissions < permissions.length) throw new Error('Grant verification failed');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
