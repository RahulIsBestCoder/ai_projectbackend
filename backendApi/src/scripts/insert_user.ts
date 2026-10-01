import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

/**
 * Insert a new user into the database.
 *
 * Usage:
 *   npx ts-node src/scripts/insert_user.ts <email> <password> <first_name> <last_name>
 *
 * Example:
 *   npx ts-node src/scripts/insert_user.ts john@example.com "MyP@ssw0rd" John Doe
 *
 * Environment variables (optional, defaults below):
 *   MONGODB_URI (default: mongodb://127.0.0.1:27017/)
 *   DB_NAME     (default: ai_project)
 */
async function run(): Promise<void> {
  // Parse command line arguments
  const args = process.argv.slice(2);
  
  let email: string;
  let password: string;
  let first_name: string;
  let last_name: string;

  if (args.length >= 4) {
    [email, password, first_name, last_name] = args;
  } else if (args.length >= 2) {
    // Support email and password only (with default names)
    email = args[0];
    password = args[1];
    first_name = args[2] || 'New';
    last_name = args[3] || 'User';
  } else {
    // Use defaults from .env or fallback
    email = process.env.NEW_USER_EMAIL || 'newuser@example.com';
    password = process.env.NEW_USER_PASSWORD || 'NewUser@123';
    first_name = process.env.NEW_USER_FIRST_NAME || 'New';
    last_name = process.env.NEW_USER_LAST_NAME || 'User';
  }

  // Validate required fields
  if (!email || !password) {
    console.error('Error: email and password are required');
    console.error('Usage: npx ts-node src/scripts/insert_user.ts <email> <password> <first_name> <last_name>');
    process.exit(1);
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    console.error('Error: Invalid email format');
    process.exit(1);
  }

  // Connect to MongoDB
  const uri = `${process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/'}${process.env.DB_NAME || 'ai_project'}`;
  console.log(`Connecting to: ${uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@')}`);
  
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  const db = mongoose.connection;
  const now = new Date();

  // Hash the password
  const saltRounds = parseInt(process.env.SALT || '10', 10);
  const passwordHash = await bcrypt.hash(password, saltRounds);

  // Generate a UUID for user_id
  const userId = uuidv4();

  // Insert or update the user
  const result = await db.collection('users').updateOne(
    { email },
    {
      $set: {
        password_hash: passwordHash,
        user_status: 1,
        updated_at: now,
      },
      $setOnInsert: {
        user_id: userId,
        first_name,
        last_name,
        email,
        role_id: '',
        department_id: '',
        profile_photo: '',
        created_at: now,
      },
    },
    { upsert: true },
  );

  if (result.upsertedCount > 0) {
    console.log('\n✅ New user created successfully!');
  } else if (result.modifiedCount > 0) {
    console.log('\n✅ User updated successfully!');
  } else {
    console.log('\nℹ️  User already exists with the same credentials');
  }

  console.log('\n--- User Details ---');
  console.log(`Email:      ${email}`);
  console.log(`Password:   ${password}`);
  console.log(`First Name: ${first_name}`);
  console.log(`Last Name:  ${last_name}`);
  console.log(`User ID:    ${userId}`);
  console.log(`Status:     Active (1)`);
  console.log('\n--- Login Endpoint ---');
  console.log(`POST http://localhost:${process.env.PORT || 3000}/v1/user/login`);
  console.log(`Body: { "email": "${email}", "password": "${password}", "login_type": 1 }`);
  console.log('\n---------------------');

  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});