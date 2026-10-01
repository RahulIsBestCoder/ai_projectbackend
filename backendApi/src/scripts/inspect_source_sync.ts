import dotenv from 'dotenv';
import mongoose from 'mongoose';
dotenv.config();
async function main() {
  await mongoose.connect(`${process.env.MONGODB_URI}${process.env.DB_NAME || 'ai_project'}`, { serverSelectionTimeoutMS: 10000 });
  const db = mongoose.connection.db!;
  console.log(JSON.stringify({ database: db.databaseName,
    sourceFiles: await db.collection('github_source_files').countDocuments({}),
    syncs: await db.collection('github_syncs').find({}).project({ status: 1, branch: 1, mode: 1, sourceScopeVersion: 1, filesAdded: 1, filesIgnored: 1, error: 1, completedAt: 1 }).sort({ startedAt: -1 }).limit(8).toArray(),
    repositories: await db.collection('github_repositories').find({}).project({ repositoryFullName: 1, branch: 1, syncStatus: 1, updatedAt: 1 }).toArray(),
  }, null, 2));
}
main().catch(err => { console.error(err.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
