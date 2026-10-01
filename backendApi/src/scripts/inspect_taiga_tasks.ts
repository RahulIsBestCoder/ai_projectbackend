/**
 * Inspect the new taiga_tasks collection.
 *
 * Usage (from repo root):
 *   npx ts-node src/scripts/inspect_taiga_tasks.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import mongoose from 'mongoose';

async function main(): Promise<void> {
  const uri = `${process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/'}${process.env.DB_NAME || 'ai_project'}`;
  console.log('Connecting to:', uri.replace(/\/\/[^:]+:[^@]+@/, '//***:***@'));
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });

  try {
    const db = mongoose.connection.db;
    if (!db) {
      console.log('DB connection not available.');
      return;
    }

    const collection = db.collection('taiga_tasks');
    const count = await collection.countDocuments();
    console.log('taiga_tasks.count:', count);

    if (count > 0) {
      const sample = await collection.find({}).sort({ taiga_task_id: 1 }).limit(20).toArray();
      console.log('\ntaiga_tasks.sample:');
      for (const doc of sample) {
        console.log(
          JSON.stringify({
            _id: doc._id?.toString(),
            project_id: doc.project_id,
            integration_id: doc.integration_id,
            external_id: doc.external_id,
            taiga_task_id: doc.taiga_task_id,
            taiga_project_id: doc.taiga_project_id,
            taiga_project_slug: doc.taiga_project_slug,
            taiga_milestone_id: doc.taiga_milestone_id,
            taiga_milestone_slug: doc.taiga_milestone_slug,
            user_story_id: doc.user_story_id,
            user_story_ref: doc.user_story_ref,
            user_story_subject: doc.user_story_subject,
            ref: doc.ref,
            subject: doc.subject,
            description: doc.description,
            status: doc.status,
            status_name: doc.status_name,
            status_color: doc.status_color,
            is_closed: doc.is_closed,
            is_blocked: doc.is_blocked,
            blocked_note: doc.blocked_note,
            owner_id: doc.owner_id,
            owner_username: doc.owner_username,
            owner_full_name: doc.owner_full_name,
            assigned_to_id: doc.assigned_to_id,
            assigned_to_username: doc.assigned_to_username,
            assigned_to_full_name: doc.assigned_to_full_name,
            created_date: doc.created_date,
            modified_date: doc.modified_date,
            finished_date: doc.finished_date,
            due_date: doc.due_date,
            due_date_status: doc.due_date_status,
            total_comments: doc.total_comments,
            us_order: doc.us_order,
            taskboard_order: doc.taskboard_order,
            attachments_count: doc.attachments_count,
            tags: doc.tags,
            synced_at: doc.synced_at?.toISOString(),
            created_at: doc.created_at?.toISOString(),
            updated_at: doc.updated_at?.toISOString(),
            is_deleted: doc.is_deleted,
          })
        );
      }
    } else {
      console.log('\nNo taiga_tasks documents found.');
    }
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.log('Error:', error);
  process.exitCode = 1;
});
