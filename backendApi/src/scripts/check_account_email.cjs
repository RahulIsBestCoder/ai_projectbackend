require('dotenv').config();
const mongoose = require('mongoose');
async function main() {
  await mongoose.connect(`${process.env.MONGODB_URI}${process.env.DB_NAME || 'ai_project'}`, { serverSelectionTimeoutMS: 5000 });
  const users = await mongoose.connection.db.collection('users').find(
    { email: { $regex: '^sougata\\.bauri(?:\\+[^@]*)?@massoftind\\.com$', $options: 'i' } },
    { projection: { email: 1, user_id: 1, is_deleted: 1, is_active: 1, user_status: 1, deleted_at: 1 } },
  ).toArray();
  console.log('exactFamilyMatches', JSON.stringify(users));
  const db = mongoose.connection.db;
  console.log('database', db.databaseName);
  const related = await db.collection('users').find(
    { $or: [{ email: /sougata|massoft/i }, { first_name: /sougata/i }, { full_name: /sougata/i }] },
    { projection: { email: 1, user_id: 1, is_active: 1, user_status: 1 } },
  ).toArray();
  console.log('relatedAccounts', JSON.stringify(related));
  const integration = await db.collection('integrations').findOne(
    { _id: new mongoose.Types.ObjectId('6aae8c1c24b246439e32faa1') },
    { projection: { username: 1, project_id: 1 } },
  );
  console.log('taigaLogin', JSON.stringify(integration));
  const sessions = await db.collection('user_logins').find({}, { projection: { user_id: 1, updated_at: 1, created_at: 1, is_logged_in: 1 } }).sort({ updated_at: -1, created_at: -1 }).limit(3).toArray();
  for (const session of sessions) {
    const identities = [{ user_id: session.user_id }];
    if (mongoose.Types.ObjectId.isValid(String(session.user_id))) identities.push({ _id: new mongoose.Types.ObjectId(String(session.user_id)) });
    const account = await db.collection('users').findOne({ $or: identities }, { projection: { email: 1, user_id: 1 } });
    console.log('recentAppLogin', JSON.stringify({ account, last_login: session.updated_at || session.created_at }));
  }
}
main().catch(e => { console.error(e.name); process.exitCode = 1; }).finally(() => mongoose.disconnect());
