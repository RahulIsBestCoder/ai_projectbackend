import dotenv from 'dotenv';

dotenv.config();

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

/**
 * Minimal seeder so the auth flow is testable end-to-end:
 *  - the `Web` client (required by the auth-code step)
 *  - one active user
 *
 * Run: `npm run seed`
 */
async function run(): Promise<void> {
  const uri = `${process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/'}${process.env.DB_NAME || 'ai_project'}`;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  const db = mongoose.connection;
  const now = new Date();

  await db.collection('clients').updateOne(
    { client_name: 'Web' },
    {
      $setOnInsert: {
        client_id: uuidv4(),
        client_name: 'Web',
        client_secret: uuidv4(),
        redirect_url: process.env.WEB_REDIRECT_URL || 'http://localhost:4200/auth/callback',
        status: 1,
        created_at: now,
      },
    },
    { upsert: true },
  );

  const email = process.env.SEED_USER_EMAIL || 'admin@ai_project.local';
  const password = process.env.SEED_USER_PASSWORD || 'Admin@123';
  const passwordHash = await bcrypt.hash(password, 10);

  await db.collection('users').updateOne(
    { email },
    {
      $set: { password_hash: passwordHash, user_status: 1, updated_at: now },
      $setOnInsert: {
        user_id: uuidv4(),
        first_name: 'Admin',
        last_name: 'User',
        email,
        role_id: '',
        department_id: '',
        created_at: now,
      },
    },
    { upsert: true },
  );

  // eslint-disable-next-line no-console
  console.log(`seeded: client 'Web' + user ${email} / ${password}`);
  await mongoose.disconnect();
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
