import { Request, Response, NextFunction } from 'express';
import { Types, mongo } from 'mongoose';

/**
 * Id variants that may identify the user in `owner_id` / `user_id` fields
 * (string or ObjectId, token user_id or users._id). Null when the user is
 * missing or inactive.
 */
export const resolveUserIds = async (db: mongo.Db, userId: unknown): Promise<any[] | null> => {
  const identities: any[] = [{ user_id: userId }];
  if (Types.ObjectId.isValid(String(userId))) identities.push({ _id: new Types.ObjectId(String(userId)) });
  const user = await db.collection('users').findOne({ $or: identities });
  if (!user || user.is_active === false || user.user_status === 0 || user.deleted_at || user.is_deleted) return null;
  return [userId, String(userId), String(user._id), user._id];
};

/** Project availability is shared by all signed-in users. */
export const hasProjectAccess = async (db: mongo.Db, _userIds: any[], projectId: string): Promise<boolean> => {
  if (!Types.ObjectId.isValid(projectId)) return false;
  const project = await db.collection('projects').findOne({ _id: new Types.ObjectId(projectId), is_deleted: false });
  return Boolean(project);
};

/** All non-deleted projects are available to every active user. */
export const getAccessibleProjectIds = async (db: mongo.Db, userId: unknown): Promise<string[] | null> => {
  if (!await resolveUserIds(db, userId)) return null;
  const projects = await db.collection('projects').find({ is_deleted: false }).project({ _id: 1 }).toArray();
  return projects.map(project => String(project._id));
};
/** Sync is available to any authenticated, active user for an existing project. */
export const requireSyncAccess = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const db = global.db.connection.db!;
    const userId = req.body?.loginDetails?.verifiedData?.user_id;
    if (!userId) {
      global.Helpers.unauthorizedStatusBuild(res, 'Authorization token missing');
      return;
    }
    let projectId = req.params.projectId;
    if (!projectId) {
      if (!Types.ObjectId.isValid(req.params.id)) {
        res.status(400).json({ message: 'Invalid integration ID.' });
        return;
      }
      const integration = await db.collection('integrations').findOne({
        _id: new Types.ObjectId(req.params.id), is_deleted: false,
      });
      projectId = integration?.project_id;
    }
    if (!projectId || !Types.ObjectId.isValid(projectId)) {
      res.status(404).json({ message: 'Project or integration not found.' });
      return;
    }
    const userIds = await resolveUserIds(db, userId);
    if (!userIds) {
      res.status(403).json({ message: 'Active user required.' });
      return;
    }
    const project = await db.collection('projects').findOne(
      { _id: new Types.ObjectId(projectId) },
      { projection: { owner_id: 1, name: 1, is_deleted: 1 } },
    );
    if (!project || (project as any).is_deleted) {
      res.status(404).json({ message: 'Project not found.' });
      return;
    }
    next();
  } catch (error) {
    global.logs.writelog('requireSyncAccess', error, 'ERROR');
    res.status(500).json({ message: 'Unable to verify project access.' });
  }
};
