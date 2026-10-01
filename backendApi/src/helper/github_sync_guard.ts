import { randomUUID } from 'crypto';
import { Response } from 'express';
import { Types, mongo } from 'mongoose';
import { helperConfig } from './helper_config';

/**
 * Sync cooldowns, in minutes, from env (read per request, so no restart is needed):
 *  - `central` → CENTRAL_AI_SYNC_COOLDOWN_MINUTES: the header "AI Sync" button only.
 *  - `ai`      → AI_SYNC_COOLDOWN_MINUTES: AI assessment refresh that also syncs sources.
 * Both default to 15; 0 disables that restriction. Failed syncs never start a cooldown.
 *
 * Plain GitHub / Taiga data syncs (project sync, integration sync) do NOT run AI,
 * so they carry NO time delay: they are only guarded against concurrent runs
 * (409 SYNC_IN_PROGRESS) via `withSyncLease` and are never rate-limited (429).
 */
export type SyncScope = 'ai' | 'central';

const DEFAULT_COOLDOWN_MINUTES = 15;
/** Project-level lease so concurrent clicks cannot run the in-request sync twice. */
const SYNC_LOCK_MS = 10 * 60 * 1000;
const COOLDOWN_STATUSES = new Set(['success', 'partial']);

const minutesFromEnv = (key: string): number => {
  const raw = process.env[key];
  const minutes = raw == null || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : DEFAULT_COOLDOWN_MINUTES;
};

export const syncCooldownMs = (scope: SyncScope = 'ai'): number =>
  minutesFromEnv(scope === 'central' ? 'CENTRAL_AI_SYNC_COOLDOWN_MINUTES' : 'AI_SYNC_COOLDOWN_MINUTES') * 60 * 1000;

export const syncCooldownSeconds = (scope: SyncScope = 'ai'): number => Math.round(syncCooldownMs(scope) / 1000);

/**
 * `ai` scope: newest(last_sync_at where sync_status ∈ {success, partial}) + cooldown.
 * Null when no cooldown is running.
 */
export const computeNextSyncAvailableAt = (
  integrations: any[],
  now = new Date(),
  cooldownMs = syncCooldownMs('ai'),
): Date | null => {
  if (cooldownMs <= 0) return null;
  const newest = integrations.reduce((max: number, integration: any) => {
    if (!COOLDOWN_STATUSES.has(integration?.sync_status) || !integration?.last_sync_at) return max;
    const time = new Date(integration.last_sync_at).getTime();
    return Number.isFinite(time) && time > max ? time : max;
  }, 0);
  if (!newest) return null;
  const next = newest + cooldownMs;
  return next > now.getTime() ? new Date(next) : null;
};

/** `central` scope: the project's last successful header AI Sync + cooldown. */
export const computeCentralNextSyncAvailableAt = (project: any, now = new Date()): Date | null => {
  const cooldownMs = syncCooldownMs('central');
  const last = project?.central_ai_sync_last_at ? new Date(project.central_ai_sync_last_at).getTime() : NaN;
  if (cooldownMs <= 0 || !Number.isFinite(last)) return null;
  const next = last + cooldownMs;
  return next > now.getTime() ? new Date(next) : null;
};

export const markCentralAiSync = async (db: mongo.Db, projectId: string, at = new Date()): Promise<void> => {
  await db.collection('projects').updateOne({ _id: new Types.ObjectId(projectId) }, { $set: { central_ai_sync_last_at: at } });
};

/** True while a project-level sync lease or any repository source-sync lock is live. */
export const isGitHubSyncInProgress = async (db: mongo.Db, projectId: string, now = new Date()): Promise<boolean> => {
  const [repository, project] = await Promise.all([
    db.collection('github_repositories').findOne({ projectId, lockUntil: { $gt: now } }, { projection: { _id: 1 } }),
    Types.ObjectId.isValid(projectId)
      ? db.collection('projects').findOne(
        { _id: new Types.ObjectId(projectId), github_sync_lock_until: { $gt: now } }, { projection: { _id: 1 } },
      )
      : null,
  ]);
  return Boolean(repository || project);
};

/** Atomically take the project sync lease. Returns the lease token, or null if another sync holds it. */
export const acquireGitHubSyncLock = async (db: mongo.Db, projectId: string): Promise<string | null> => {
  const token = randomUUID();
  const now = new Date();
  const locked = await db.collection('projects').findOneAndUpdate(
    {
      _id: new Types.ObjectId(projectId),
      is_deleted: false,
      $or: [{ github_sync_lock_until: { $exists: false } }, { github_sync_lock_until: null }, { github_sync_lock_until: { $lte: now } }],
    },
    { $set: { github_sync_lock_token: token, github_sync_lock_until: new Date(now.getTime() + SYNC_LOCK_MS) } },
    { returnDocument: 'after' },
  );
  return locked ? token : null;
};

export const releaseGitHubSyncLock = async (db: mongo.Db, projectId: string, token: string): Promise<void> => {
  await db.collection('projects').updateOne(
    { _id: new Types.ObjectId(projectId), github_sync_lock_token: token },
    { $unset: { github_sync_lock_token: '', github_sync_lock_until: '' } },
  );
};

export const syncInProgressResponse = (res: Response) =>
  global.Helpers.customStatusBuild(res, helperConfig.HTTP_STATUS_CONFLICT,
    'A sync is already running for this project.', { code: 'SYNC_IN_PROGRESS' });

export const syncCooldownResponse = (res: Response, nextAvailableAt: Date, scope: SyncScope) => {
  const retryAfterSeconds = Math.max(1, Math.ceil((nextAvailableAt.getTime() - Date.now()) / 1000));
  const minutes = Math.ceil(retryAfterSeconds / 60);
  const label = scope === 'central' ? 'AI Sync' : 'Sync';
  return global.Helpers.customStatusBuild(res, helperConfig.HTTP_STATUS_TOO_MANY_REQUESTS,
    `${label} ran recently. Try again in ${minutes} min.`, {
      code: 'SYNC_COOLDOWN',
      scope,
      next_sync_available_at: nextAvailableAt.toISOString(),
      retry_after_seconds: retryAfterSeconds,
      cooldown_seconds: syncCooldownSeconds(scope),
    });
};

/**
 * Runs `work` for a project under the shared sync lease after the `ai` cooldown check.
 * Used ONLY for AI syncs (AI assessment refresh that also syncs sources).
 * Responds 409 (already running) or 429 (AI cooldown) itself and skips `work` in that case.
 * Plain GitHub / Taiga data syncs should use `withSyncLease` (never rate-limited).
 * An unknown project runs `work` unguarded so the service returns its own "not found".
 */
export const withAiSyncGuard = async (res: Response, projectId: string, work: () => Promise<void>): Promise<void> => {
  if (!Types.ObjectId.isValid(projectId)) {
    await work();
    return;
  }
  const db = global.db.connection.db!;
  if (await isGitHubSyncInProgress(db, projectId)) {
    syncInProgressResponse(res);
    return;
  }
  const lockToken = await acquireGitHubSyncLock(db, projectId);
  if (!lockToken) {
    const exists = await db.collection('projects').countDocuments({ _id: new Types.ObjectId(projectId), is_deleted: false });
    if (!exists) await work();
    else syncInProgressResponse(res);
    return;
  }
  try {
    const integrations = await db.collection('integrations')
      .find({ project_id: projectId, is_deleted: false })
      .project({ sync_status: 1, last_sync_at: 1 }).toArray();
    const nextAvailableAt = computeNextSyncAvailableAt(integrations);
    if (nextAvailableAt) {
      syncCooldownResponse(res, nextAvailableAt, 'ai');
      return;
    }
    await work();
  } finally {
    await releaseGitHubSyncLock(db, projectId, lockToken).catch(() => undefined);
  }
};

/**
 * Runs `work` for a project under the shared sync lease WITHOUT any cooldown.
 * Used by plain GitHub / Taiga data syncs (project sync, integration sync,
 * report repository sync) that do not require AI — they are only guarded
 * against concurrent runs (409 SYNC_IN_PROGRESS) and are never rate-limited.
 * AI syncs keep the time delay via `withAiSyncGuard`.
 */
export const withSyncLease = async (res: Response, projectId: string, work: () => Promise<void>): Promise<void> => {
  if (!Types.ObjectId.isValid(projectId)) {
    await work();
    return;
  }
  const db = global.db.connection.db!;
  if (await isGitHubSyncInProgress(db, projectId)) {
    syncInProgressResponse(res);
    return;
  }
  const lockToken = await acquireGitHubSyncLock(db, projectId);
  if (!lockToken) {
    const exists = await db.collection('projects').countDocuments({ _id: new Types.ObjectId(projectId), is_deleted: false });
    if (!exists) await work();
    else syncInProgressResponse(res);
    return;
  }
  try {
    await work();
  } finally {
    await releaseGitHubSyncLock(db, projectId, lockToken).catch(() => undefined);
  }
};
