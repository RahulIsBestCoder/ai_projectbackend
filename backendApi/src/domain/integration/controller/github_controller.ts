import { Request, Response } from 'express';
import { IntegrationService } from '../service/integration_service';
import { GitHubSourceSyncService } from '../service/github_source_sync_service';
import { githubClient } from '../service/github_client';
import { GitHubCodeContextService } from '../../ai_intelligence/service/github_code_context_service';
import { AiIntelligenceService } from '../../ai_intelligence/service/ai_intelligence_service';
import { Types } from 'mongoose';
import {
  SyncScope, acquireGitHubSyncLock, computeCentralNextSyncAvailableAt,
  isGitHubSyncInProgress, markCentralAiSync, releaseGitHubSyncLock, syncCooldownResponse,
  syncCooldownSeconds, syncInProgressResponse,
} from '../../../helper/github_sync_guard';

/*
 * @Developer: Sougata Bauri
 * @Date: 2026-09-27
 * @Function: GitHubController
 */
export class GitHubController {
  private readonly integrations = new IntegrationService();

  public connect = async (req: Request, res: Response): Promise<void> => {
    try {
      const { owner, repositoryName, token, branch } = req.body;
      if (typeof owner !== 'string' || typeof repositoryName !== 'string' || typeof token !== 'string'
        || typeof branch !== 'string' || !branch.trim()) throw new Error('Provide owner, repositoryName, token, and branch.');
      const request = githubClient(owner, repositoryName, token);
      const repository = await request('');
      const selectedBranch = branch.trim();
      await request(`/branches/${encodeURIComponent(selectedBranch)}`);
      const existing = await global.db.connection.db!.collection('integrations').findOne({
        project_id: req.params.projectId, provider: 'github', repository_name: repository.full_name, is_deleted: false,
      });
      const connection = existing
        ? await this.integrations.updateIntegration(String(existing._id), { token, branch: selectedBranch })
        : await this.integrations.createIntegration({ project_id: req.params.projectId, provider: 'github',
          repository_name: repository.full_name, repository_url: repository.html_url, token,
          branch: selectedBranch, status: 1 });
      if (!connection.status) throw new Error(connection.status_message);
      const integrationId = String(connection.data_sets._id);
      const result = await this.integrations.syncIntegration(integrationId);
      if (!result.status) global.Helpers.badRequestStatusBuild(res, result.status_message, { integrationId, status: 'failed' });
      else global.Helpers.successStatusBuild(res, { integrationId, ...result.data_sets }, result.status_message);
    } catch (error: any) { global.Helpers.badRequestStatusBuild(res, error.message || 'GitHub connection failed.'); }
  };

  public sync = async (req: Request, res: Response): Promise<void> => {
    try {
      const db = global.db.connection.db!;
      const projectId = req.params.projectId;
      const filter: any = { project_id: projectId, provider: 'github', is_deleted: false };
      const integrationId = req.body?.integrationId;
      if (integrationId !== undefined && typeof integrationId !== 'string') throw new Error('integrationId must be a string.');
      const connections = await db.collection('integrations').find(filter).toArray();
      if (!connections.length) {
        global.Helpers.badRequestStatusBuild(res, 'Connect a GitHub repository first.', { code: 'NO_GITHUB_INTEGRATION' });
        return;
      }
      const selected = integrationId ? connections.filter(connection => String(connection._id) === integrationId) : connections;
      if (!selected.length) throw new Error('No matching GitHub integration found for this project.');
      // The header AI Sync button sends trigger "central" and has its own env cooldown.
      const scope: SyncScope = req.body?.trigger === 'central' ? 'central' : 'ai';

      if (await isGitHubSyncInProgress(db, projectId)) { syncInProgressResponse(res); return; }
      const lockToken = await acquireGitHubSyncLock(db, projectId);
      if (!lockToken) { syncInProgressResponse(res); return; }

      try {
        // Only AI Sync (trigger "central") carries a time delay. Plain GitHub /
        // Taiga data syncs are never rate-limited — only the in-progress lease applies.
        if (scope === 'central') {
          const nextAvailableAt = computeCentralNextSyncAvailableAt(await db.collection('projects')
            .findOne({ _id: new Types.ObjectId(projectId) }, { projection: { central_ai_sync_last_at: 1 } }));
          if (nextAvailableAt) {
            syncCooldownResponse(res, nextAvailableAt, 'central');
            return;
          }
        }

        const results: any[] = [];
        for (const connection of selected) {
          try {
            const result = await this.integrations.syncIntegration(String(connection._id));
            results.push({ integrationId: String(connection._id), status: result.status ? result.data_sets?.status || 'success' : 'failed',
              message: result.status_message, ...result.data_sets });
          } catch (error: any) {
            results.push({ integrationId: String(connection._id), status: 'failed', message: error.message || 'GitHub sync failed.' });
          }
        }
        const status = results.every(result => result.status === 'failed') ? 'failed'
          : results.every(result => result.status === 'success') ? 'success' : 'partial';
        if (status === 'failed') {
          global.Helpers.badRequestStatusBuild(res, 'GitHub sync failed.', { status, results });
          return;
        }
        let nextSyncAvailableAt: Date | null = null;
        let cooldownSeconds = 0;
        if (scope === 'central') {
          const syncedAt = new Date();
          await markCentralAiSync(db, projectId, syncedAt);
          nextSyncAvailableAt = computeCentralNextSyncAvailableAt({ central_ai_sync_last_at: syncedAt });
          cooldownSeconds = syncCooldownSeconds('central');
        }
        global.Helpers.successStatusBuild(res, {
          status, results, scope,
          next_sync_available_at: nextSyncAvailableAt ? nextSyncAvailableAt.toISOString() : null,
          cooldown_seconds: cooldownSeconds,
        }, 'GitHub sync completed.');
      } finally {
        await releaseGitHubSyncLock(db, projectId, lockToken).catch(() => undefined);
      }
    } catch (error: any) { global.Helpers.badRequestStatusBuild(res, error.message || 'GitHub sync failed.'); }
  };

  public status = async (req: Request, res: Response): Promise<void> => {
    try {
      const db = global.db.connection.db!;
      const projectId = req.params.projectId;
      const [repositories, inProgress, project] = await Promise.all([
        new GitHubSourceSyncService().status(projectId),
        isGitHubSyncInProgress(db, projectId),
        db.collection('projects').findOne({ _id: new Types.ObjectId(projectId) }, { projection: { central_ai_sync_last_at: 1 } }),
      ]);
      const centralNextSyncAvailableAt = computeCentralNextSyncAvailableAt(project);
      global.Helpers.successStatusBuild(res, {
        repositories,
        in_progress: inProgress,
        // Plain GitHub/Taiga data syncs carry no time delay.
        next_sync_available_at: null,
        cooldown_seconds: 0,
        central_next_sync_available_at: centralNextSyncAvailableAt ? centralNextSyncAvailableAt.toISOString() : null,
        central_cooldown_seconds: syncCooldownSeconds('central'),
      }, 'GitHub sync status fetched.');
    } catch (error: any) { global.Helpers.badRequestStatusBuild(res, error.message || 'Unable to fetch sync status.'); }
  };

  public context = async (req: Request, res: Response): Promise<void> => {
    try {
      global.Helpers.successStatusBuild(res, await new GitHubCodeContextService().build(req.params.projectId), 'GitHub code context fetched.');
    } catch (error: any) { global.Helpers.badRequestStatusBuild(res, error.message || 'Unable to build code context.'); }
  };

  public analyze = async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await new AiIntelligenceService().analyzeImplementation(req.params.projectId, req.body?.planId);
      global.Helpers.successStatusBuild(res, result, 'Implementation analysis completed.');
    } catch (error: any) { global.Helpers.badRequestStatusBuild(res, error.message || 'Implementation analysis failed.'); }
  };
}
