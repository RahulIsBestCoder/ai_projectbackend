import mongoose, { Mongoose } from 'mongoose';

/**
 * `Connection` — owns the single MongoDB connection for the whole process.
 * Mirrors plan §15: `mongoose.connect(MONGODB_URI + DB_NAME)`, the resolved
 * Mongoose instance is stored on `global.db`. A connection failure is logged
 * but does NOT stop the process from starting (plan §8).
 */
export class Connection {
  public async connect(): Promise<Mongoose> {
    const uri = `${process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/'}${process.env.DB_NAME || 'ai_project'}`;
    console.log("🚀 ~ Connection ~ connect ~ uri=================:", uri)
   
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
      mongoose.connection.useDb(process.env.DB_NAME || 'ai_project');
      // eslint-disable-next-line no-console
      console.log(`[db] connected: ${uri}`);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.log(`[db] connection error (server still starting): ${(err as Error).message}`);
    }
    return mongoose;
  }
}
