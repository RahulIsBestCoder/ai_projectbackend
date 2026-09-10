import dotenv from 'dotenv';
dotenv.config();
import mongoose from 'mongoose';

async function run() {
  const uri = `${process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/'}${process.env.DB_NAME || 'ai_project'}`;
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });

  // Get all users and update user_id to string to match login_tokens
  const users = await mongoose.connection.collection('users').find({}).toArray();
  for (const user of users) {
    if (typeof user.user_id === 'number') {
      await mongoose.connection.collection('users').updateOne(
        { _id: user._id },
        { $set: { user_id: String(user.user_id) } }
      );
    }
  }
  console.log(`Updated ${users.length} users - user_id converted to string`);

  // Verify
  const sample = await mongoose.connection.collection('users').findOne({});
  console.log('Sample user:', { email: sample?.email, user_id: sample?.user_id, type: typeof sample?.user_id });

  await mongoose.disconnect();
  console.log('Done!');
}

run().catch((err) => { console.error(err); process.exit(1); });