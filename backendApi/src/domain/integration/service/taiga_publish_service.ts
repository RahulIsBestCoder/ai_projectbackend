import { IntegrationModel } from '../models/integration_model';
import { TaigaMappingModel } from '../models/taiga_mapping_model';
import { TaigaUserMappingModel } from '../models/taiga_user_mapping_model';
import { AiPlanModel } from '../../ai_intelligence/models/ai_plan_model';
import { TaigaClient } from './taiga_client';
import { IPublishStageResult, ITaigaMetadata } from '../interface/taiga_publish_interface';
import { IServiceResult } from '../../../helper/common_interface';

const BATCH_SIZE = 20;
const EXISTING_SPRINTS_MESSAGE = 'TAIGA_SPRINTS_EXIST: This Taiga project already has sprints. Sprint creation is disabled for this project.';

/**
 * Plan statuses that may be pushed to Taiga. `acceptPlan` writes `accepted`;
 * `draft` must be accepted first. `approved` / `published` are kept for parity.
 */
const PUBLISHABLE_PLAN_STATUSES = ['accepted', 'approved', 'published'];

/** Result of the per-sprint walk (milestone = sprint, plus its story and tasks). */
interface ISprintTreeResult {
  warnings: Array<{ source_id: string; type: string; value: string }>;
  /** The sprint milestone (also reported as `sprints` in `IPublishResult`). */
  milestones: IPublishStageResult;
  user_stories: IPublishStageResult;
  tasks: IPublishStageResult;
}

/**
 * `TaigaPublishService` - plan -> Taiga publish pipeline (sprint-level mapping).
 *
 * Taiga structure produced for a plan:
 *   1 milestone + 1 user story per sprint, and that sprint's tasks under the story.
 * `plan.milestones[]` / `plan.deadlines[]` stay local - pushing them would duplicate
 * the sprint milestones.
 *
 * Idempotency: `taiga_mappings` keyed by (project_id, plan_id, entity_type, external_id),
 * where `external_id` reuses the `plan_execution_items.ref_key` convention written by
 * `acceptPlan`: `sprint-N` / `story_sprint-N` / `sprint-N-task-M`.
 */
export class TaigaPublishService {
  private readonly _integrationModel = new IntegrationModel();
  private readonly _mappingModel = new TaigaMappingModel();
  private readonly _userMappingModel = new TaigaUserMappingModel();
  private readonly _planModel = new AiPlanModel();
  private logName = 'taiga_publish_service';

  private log(msg: string, data?: any, level: 'INFO' | 'ERROR' = 'INFO'): void {
    try {
      if (level === 'ERROR') global.logs.writelog(this.logName, data, 'ERROR');
      else global.logs.writelog(this.logName, data);
    } catch { /* never break publish */ }
  }

  /* ==================== plan-scoped entry point (the "Create in Taiga" button) ==================== */

  /**
   * Create (or sync) an accepted plan inside its Taiga project.
   *
   * `mode: 'create'` fails fast when anything is already mapped (no partial creation);
   * `mode: 'sync'` creates what is missing and PATCHes what is already mapped.
   * `opts.projectId` constrains the plan lookup for the project-scoped alias routes.
   */
  public async createPlanInTaiga(planId: string, opts: { mode?: 'create' | 'sync'; integrationId?: string; projectId?: string; allowUnassigned?: boolean } = {}): Promise<IServiceResult> {
    const mode: 'create' | 'sync' = opts.mode === 'sync' ? 'sync' : 'create';
    const publishId = `create_${Date.now()}`;
    const startedAt = new Date();
    try {
      const planFilter: any = { _id: planId, is_deleted: false };
      if (opts.projectId) planFilter.project_id = opts.projectId;
      const plan: any = await this._planModel.findByAny(planFilter);
      if (!plan) return global.Helpers.makeBadServiceStatus('Plan not found.');

      const gateError = this.assertPlanPublishable(plan);
      if (gateError) return global.Helpers.makeBadServiceStatus(gateError);

      const projectId = String(plan.project_id || '').trim();
      if (!projectId) return global.Helpers.makeBadServiceStatus('Plan has no project. Generate the plan for a project to publish it to Taiga.');

      const integ: any = await this.resolveIntegration(projectId, opts.integrationId);
      if (!integ) return global.Helpers.makeBadServiceStatus('Connect Taiga for this project first.');
      if (integ.provider !== 'taiga') return global.Helpers.makeBadServiceStatus('Not a Taiga provider.');

      const client = await this.buildClient(integ);
      let taigaProject: any;
      try { taigaProject = await this.resolveTaigaProject(client, integ); }
      catch (err: any) { return global.Helpers.makeBadServiceStatus(`Taiga project not found or not accessible: ${err?.message || err}`); }
      const taigaProjectId = taigaProject?.id;
      if (!taigaProjectId) return global.Helpers.makeBadServiceStatus('Taiga project returned no id.');
      if (await client.hasSprints(taigaProjectId)) return global.Helpers.makeBadServiceStatus(EXISTING_SPRINTS_MESSAGE);
      const slug = taigaProject?.slug || this.parseSlug(integ);

      let metadata: ITaigaMetadata;
      try {
        const raw = await client.getMetadata(taigaProjectId);
        metadata = {
          projectId: taigaProjectId,
          slug,
          users: raw.users || [],
          priorities: raw.priorities || [],
          severities: raw.severities || [],
          taskTypes: raw.taskTypes || [],
          taskStatuses: raw.taskStatuses || [],
          userStoryStatuses: raw.userStoryStatuses || [],
          points: raw.points || [],
        };
      } catch (err: any) { return global.Helpers.makeBadServiceStatus(`Fetch metadata failed: ${err?.message || err}`); }

      const planData = plan.plan || {};
      const sprints: any[] = Array.isArray(planData.sprints) ? planData.sprints : [];
      if (!sprints.length) return global.Helpers.makeBadServiceStatus('PLAN_HAS_NO_SPRINTS: the plan has no sprints to publish.');

      if (mode === 'create') {
        const existing = await this.collectExistingEntities(projectId, planId, sprints);
        if (existing.length > 0) {
          const summary = existing.map((e) => `${e.entity_type} '${e.external_id}'`).join(', ');
          return global.Helpers.makeBadServiceStatus(
            `ALREADY_EXISTS: The following entities already exist in Taiga: ${summary}. Delete them or run mode: 'sync' to update them.`
          );
        }
      }

      const userMappings = await this._userMappingModel.findAllByAny({ project_id: projectId });
      const tree = await this.publishSprintTree(client, projectId, planId, taigaProjectId, sprints, metadata, userMappings, mode === 'sync', opts.allowUnassigned !== false);
      const hasFailures = [tree.milestones, tree.user_stories, tree.tasks].some((r) => r.failed > 0);
      const status: 'completed' | 'partial' = hasFailures ? 'partial' : 'completed';

      try {
        await this._planModel.updateAnyRecord({ _id: planId }, {
          ...(hasFailures ? {} : { status: 'published', published_at: new Date() }), publish_status: status,
          taiga_project_id: taigaProjectId, updated_at: new Date(),
        });
      } catch (err: any) { this.log('createPlanInTaiga', `Mark published failed: ${err?.message || err}`, 'ERROR'); }

      const mappings = await this._mappingModel.findAllByAny({ project_id: projectId, plan_id: planId });
      const result: any = {
        // Documented contract (docs/taiga_plan_publish_ui.md): status + summary + mappings.
        sync_id: publishId,
        status, dry_run: false, mode, plan_id: planId,
        taiga_project: { id: taigaProjectId, slug, name: taigaProject?.name || null },
        summary: {
          milestones: this.stageCounts(tree.milestones),
          user_stories: this.stageCounts(tree.user_stories),
          tasks: this.stageCounts(tree.tasks),
        },
        mappings: this.toMappingSummary(mappings),
        warnings: tree.warnings,
        errors: this.toErrorSummary([tree.milestones, tree.user_stories, tree.tasks]),
        started_at: startedAt, finished_at: new Date(),
        // Legacy publish shape, kept for the existing publish-to-taiga consumers.
        publish_id: publishId, taiga_project_id: taigaProjectId, taiga_project_slug: slug,
        // Sprint-level mapping: the sprint IS the milestone, so both keys report the same stage.
        milestones: tree.milestones, sprints: tree.milestones,
        user_stories: tree.user_stories, tasks: tree.tasks,
      };
      this.log('createPlanInTaiga', `Plan ${planId} -> Taiga project ${taigaProjectId}: ${status} (mode ${mode}).`);
      return global.Helpers.makeSuccessServiceStatus(`Plan ${status} in Taiga.`, result);
    } catch (err: any) {
      this.log('createPlanInTaiga', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus(`Create in Taiga failed: ${err?.message || 'unknown'}`);
    }
  }

  /* ==================== legacy / project-scoped entry points (delegating) ==================== */

  /**
   * `createInTaiga` - one-shot creation for the project-scoped "Create in Taiga" route.
   * Delegates to `createPlanInTaiga` with `mode: 'create'` (fails if anything already exists).
   */
  public async createInTaiga(projectId: string, planId: string, integrationId?: string): Promise<IServiceResult> {
    return this.createPlanInTaiga(planId, { mode: 'create', integrationId, projectId });
  }

  /**
   * `publishPlan` - legacy project-scoped publish. `create_missing` / `update_existing`
   * are both satisfied by `mode: 'sync'` (create what is missing, update what is mapped).
   */
  public async publishPlan(projectId: string, planId: string, integrationId: string, _options: { create_missing?: boolean; update_existing?: boolean } = {}): Promise<IServiceResult> {
    return this.createPlanInTaiga(planId, { mode: 'sync', integrationId, projectId });
  }

  /** Preview (dry-run) counts for the current sprint-level mapping. No Taiga writes. */
  public async previewPlan(projectId: string, planId: string, integrationId?: string): Promise<IServiceResult> {
    return this.previewPlanByPlanId(planId, integrationId, projectId);
  }

  /** Preview for the plan-scoped route (project resolved from the plan). */
  public async previewPlanByPlanId(planId: string, integrationId?: string, projectId?: string): Promise<IServiceResult> {
    const startedAt = new Date();
    try {
      const filter: any = { _id: planId, is_deleted: false };
      if (projectId) filter.project_id = projectId;
      const plan: any = await this._planModel.findByAny(filter);
      if (!plan) return global.Helpers.makeBadServiceStatus('Plan not found.');
      const gateError = this.assertPlanPublishable(plan);
      if (gateError) return global.Helpers.makeBadServiceStatus(gateError);
      const resolvedProjectId = String(plan.project_id || '').trim();
      if (!resolvedProjectId) return global.Helpers.makeBadServiceStatus('Plan has no project. Generate the plan for a project to publish it to Taiga.');
      const integ: any = await this.resolveIntegration(resolvedProjectId, integrationId);
      if (!integ) return global.Helpers.makeBadServiceStatus('Connect Taiga for this project first.');

      const client = await this.buildClient(integ);
      let taigaProject: any;
      try { taigaProject = await this.resolveTaigaProject(client, integ); }
      catch (err: any) { return global.Helpers.makeBadServiceStatus(`Taiga project not found or not accessible: ${err?.message || err}`); }

      const sprints: any[] = Array.isArray(plan.plan?.sprints) ? plan.plan.sprints : [];
      if (!taigaProject?.id) return global.Helpers.makeBadServiceStatus('Taiga project returned no id.');
      if (await client.hasSprints(taigaProject.id)) return global.Helpers.makeBadServiceStatus(EXISTING_SPRINTS_MESSAGE);
      const existing = new Set((await this.collectExistingEntities(resolvedProjectId, planId, sprints)).map((e) => `${e.entity_type}:${e.external_id}`));
      const isExisting = (entityType: string, externalId: string) => existing.has(`${entityType}:${externalId}`);

      let milestoneCreate = 0, milestoneUpdate = 0, storyCreate = 0, storyUpdate = 0, taskCreate = 0, taskUpdate = 0;
      /** role -> first task key that needs it (drives the `USER_ROLE_UNMAPPED` warnings). */
      const missingRoles = new Map<string, string>();
      const userMappings = await this._userMappingModel.findAllByAny({ project_id: resolvedProjectId });
      const mappedRoles = new Set(userMappings.map((m: any) => m.role));

      sprints.forEach((sp: any, sIdx: number) => {
        const sprintKey = this.sprintExternalId(sp, sIdx);
        const storyKey = this.storyExternalId(sp, sIdx);
        if (isExisting('sprint', sprintKey)) milestoneUpdate++; else milestoneCreate++;
        if (isExisting('user_story', storyKey)) storyUpdate++; else storyCreate++;
        (Array.isArray(sp.tasks) ? sp.tasks : []).forEach((task: any, tIdx: number) => {
          const taskKey = this.taskExternalId(task, sIdx, tIdx);
          if (isExisting('task', taskKey)) taskUpdate++; else taskCreate++;
          if (task.assignee_role && !mappedRoles.has(task.assignee_role) && !missingRoles.has(task.assignee_role)) {
            missingRoles.set(task.assignee_role, taskKey);
          }
        });
      });

      const resolvedSlug = taigaProject?.slug || this.parseSlug(integ);
      const result: any = {
        // Documented contract (docs/taiga_plan_publish_ui.md) — a dry run writes nothing.
        sync_id: `TAIGA-SYNC-${Date.now()}`,
        status: 'completed', dry_run: true, mode: 'create', plan_id: planId,
        taiga_project: { id: taigaProject?.id || null, slug: resolvedSlug, name: taigaProject?.name || null },
        summary: {
          // Sprint-level mapping: 1 milestone + 1 user story per sprint.
          milestones: { created: milestoneCreate, updated: milestoneUpdate, skipped: 0, failed: 0 },
          user_stories: { created: storyCreate, updated: storyUpdate, skipped: 0, failed: 0 },
          tasks: { created: taskCreate, updated: taskUpdate, skipped: 0, failed: 0 },
        },
        mappings: [],
        warnings: Array.from(missingRoles.entries()).map(([role, sourceId]) => ({ source_id: sourceId, type: 'USER_ROLE_UNMAPPED', value: role })),
        errors: [],
        started_at: startedAt, finished_at: new Date(),
        // Legacy preview shape, kept for the existing publish-to-taiga/preview consumers.
        milestones: { create: milestoneCreate, update: milestoneUpdate, skip: 0 },
        sprints: { create: milestoneCreate, update: milestoneUpdate, skip: 0 },
        user_stories: { create: storyCreate, update: storyUpdate, skip: 0 },
        tasks: { create: taskCreate, update: taskUpdate, skip: 0 },
        missing_assignee_mappings: Array.from(missingRoles.keys()),
        taiga_project_id: taigaProject?.id || null,
        taiga_project_slug: resolvedSlug,
      };
      return global.Helpers.makeSuccessServiceStatus('Preview ready.', result);
    } catch (err: any) {
      this.log('previewPlan', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus(`Preview failed: ${err?.message || 'unknown'}`);
    }
  }

  /**
   * Sync status for `GET /v1/plans/:planId/taiga-sync`.
   * Reads `ai_plans` publish state plus the per-entity `taiga_mappings` summary.
   */
  public async getPlanSyncStatus(planId: string): Promise<IServiceResult> {
    try {
      const plan: any = await this._planModel.findByAny({ _id: planId, is_deleted: false });
      if (!plan) return global.Helpers.makeBadServiceStatus('Plan not found.');
      const projectId = String(plan.project_id || '').trim();
      const mappings: any[] = projectId
        ? await this._mappingModel.findAllByAny({ project_id: projectId, plan_id: planId })
        : [];
      const lastSyncedAt = mappings.reduce((latest: Date | null, m: any) => {
        const at = m.last_synced_at ? new Date(m.last_synced_at) : null;
        return at && (!latest || at > latest) ? at : latest;
      }, null);
      const countType = (entityType: string) => mappings.filter((m) => m.entity_type === entityType).length;
      const failed = mappings.filter((m) => m.sync_status === 'failed');
      return global.Helpers.makeSuccessServiceStatus('Taiga sync status.', {
        plan_id: planId,
        plan_published: plan.status === 'published',
        status: plan.publish_status || (plan.status === 'published' ? 'completed' : 'idle'),
        publish_status: plan.publish_status || null,
        published_at: plan.published_at || null,
        taiga_project_id: plan.taiga_project_id || null,
        last_sync_at: lastSyncedAt,
        summary: {
          milestones: countType('sprint'),
          user_stories: countType('user_story'),
          tasks: countType('task'),
        },
        failed_count: failed.length,
        failed: failed.map((m) => ({ source_id: m.external_id, entity_type: m.entity_type, error: m.last_error || null })),
      });
    } catch (err: any) {
      this.log('getPlanSyncStatus', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus(`Status check failed: ${err?.message || 'unknown'}`);
    }
  }

  /**
   * Retry the plan's Taiga sync. Phase 0 re-runs in `sync` mode (create missing +
   * update mapped); Phase 2 narrows this to only rows whose `sync_status` is not `success`.
   */
  public async retryPlanSync(planId: string): Promise<IServiceResult> {
    return this.createPlanInTaiga(planId, { mode: 'sync' });
  }

  /** Connection test. Resolves the Taiga project by id (`repository_name`) or slug. */
  public async testConnection(projectId: string, integrationId: string): Promise<IServiceResult> {
    try {
      const integ: any = await this._integrationModel.findByAny({ _id: integrationId, project_id: projectId, is_deleted: false });
      if (!integ) return global.Helpers.makeBadServiceStatus('Integration not found.');
      const client = await this.buildClient(integ);
      const project = await this.resolveTaigaProject(client, integ);
      if (!project?.id) return global.Helpers.makeBadServiceStatus('Taiga project not found or not accessible.');
      return global.Helpers.makeSuccessServiceStatus('Connected to Taiga.', {
        connected: true, taiga_project_id: project.id, project_name: project.name, slug: project.slug || this.parseSlug(integ),
      });
    } catch (err: any) { return global.Helpers.makeBadServiceStatus(`Connection failed: ${err?.message || 'unknown'}`); }
  }

  public async getStatus(projectId: string): Promise<IServiceResult> {
    try {
      const integrations = await this._integrationModel.findAllByAny({ project_id: projectId, provider: 'taiga', is_deleted: false });
      if (!integrations.length) return global.Helpers.makeSuccessServiceStatus('No Taiga integration.', { connected: false, taiga_project_id: null, plan_published: false, last_sync_at: null, sync_status: 'idle' });
      const integ = integrations[0];
      const client = await this.buildClient(integ);
      const project = await this.resolveTaigaProject(client, integ);
      if (!project?.id) return global.Helpers.makeBadServiceStatus('Taiga project returned no id.');
      const hasSprints = await client.hasSprints(project.id);
      const plans = await this._planModel.findAllByAny({ project_id: projectId, status: 'published', is_deleted: false });
      return global.Helpers.makeSuccessServiceStatus('Taiga status.', { connected: true, taiga_project_id: project.id, has_sprints: hasSprints, can_create_sprints: !hasSprints, creation_blocked_reason: hasSprints ? EXISTING_SPRINTS_MESSAGE : null, plan_published: plans.length > 0, last_sync_at: integ.last_sync_at || null, sync_status: integ.sync_status || 'idle' });
    } catch (err: any) { return global.Helpers.makeBadServiceStatus(`Status check failed: ${err?.message || 'unknown'}`); }
  }

  /* ==================== internals ==================== */

  /** Per-sprint walk: milestone (= the sprint) -> user story -> tasks, in strict order. */
  private async publishSprintTree(
    client: TaigaClient, projectId: string, planId: string, taigaProjectId: number,
    sprints: any[], metadata: ITaigaMetadata, userMappings: any[], updateExisting: boolean, allowUnassigned = true,
  ): Promise<ISprintTreeResult> {
    const milestones = this.emptyStage();
    const stories = this.emptyStage();
    const tasks = this.emptyStage();
    const warnings: ISprintTreeResult['warnings'] = [];

    const roleToUser = new Map<string, number>();
    for (const m of userMappings) roleToUser.set(m.role, m.taiga_user_id);
    const taskStatus = metadata.taskStatuses.find((s) => !s.is_closed) || metadata.taskStatuses[0];
    const storyStatuses = metadata.userStoryStatuses || [];
    const storyStatus = storyStatuses.find((s) => !s.is_closed) || storyStatuses[0];
    const defaultPriority = metadata.priorities.find((p) => p.name?.toLowerCase() === 'medium') || metadata.priorities[0];

    for (let i = 0; i < sprints.length; i += BATCH_SIZE) {
      const batch = sprints.slice(i, i + BATCH_SIZE);
      await Promise.all(batch.map(async (sp: any, idx: number) => {
        const sIdx = i + idx;
        const sprintKey = this.sprintExternalId(sp, sIdx);
        const storyKey = this.storyExternalId(sp, sIdx);
        const taskList: any[] = Array.isArray(sp.tasks) ? sp.tasks : [];
        const sprintName = sp.name || `Sprint ${sIdx + 1}`;

        // ---- 1. milestone (the sprint) ----
        let milestoneId: number | undefined;
        try {
          const existing = await this._mappingModel.findByAny({ project_id: projectId, plan_id: planId, entity_type: 'sprint', external_id: sprintKey });
          const payload: any = {
            name: sprintName,
            description: sp.goal || sp.description || '',
            estimated_start: sp.start_date || '',
            estimated_finish: sp.end_date || sp.deadline || '',
          };
          if (existing && existing.taiga_id) {
            milestoneId = existing.taiga_id;
            if (updateExisting) {
              await client.updateMilestone(existing.taiga_id, payload);
              await this._mappingModel.updateAnyRecord({ _id: existing._id }, { name: payload.name, taiga_milestone_id: milestoneId, sync_status: 'success', last_error: null, last_synced_at: new Date(), updated_at: new Date() });
              milestones.updated++;
            }
          } else {
            const created = await client.createMilestone(taigaProjectId, payload);
            milestoneId = created.id;
            await this.saveCreatedMapping(existing, {
              project_id: projectId, plan_id: planId, entity_type: 'sprint', external_id: sprintKey,
              taiga_id: created.id, taiga_ref: created.ref, name: created.name,
              taiga_project_id: taigaProjectId, taiga_milestone_id: created.id,
              sync_status: 'success', last_synced_at: new Date(),
            });
            milestones.created++;
          }
        } catch (err: any) {
          const message = err?.message || 'unknown';
          milestones.failed++;
          milestones.errors.push({ external_id: sprintKey, type: 'sprint', error: message });
          await this.markMappingFailed(projectId, planId, 'sprint', sprintKey, message, { taiga_project_id: taigaProjectId, name: sprintName });
          // Strict dependency: without the milestone the story and tasks would be orphaned.
          stories.failed++;
          stories.errors.push({ external_id: storyKey, type: 'user_story', error: `Skipped: parent milestone failed (${message}).` });
          for (let tIdx = 0; tIdx < taskList.length; tIdx++) {
            tasks.failed++;
            tasks.errors.push({ external_id: this.taskExternalId(taskList[tIdx], sIdx, tIdx), type: 'task', error: `Skipped: parent milestone failed (${message}).` });
          }
          return;
        }

        // ---- 2. user story (the sprint) ----
        let storyId: number | undefined;
        try {
          const existing = await this._mappingModel.findByAny({ project_id: projectId, plan_id: planId, entity_type: 'user_story', external_id: storyKey });
          const payload: any = { subject: sprintName, description: sp.goal || sp.description || '', milestone: milestoneId };
          if (storyStatus?.id) payload.status = storyStatus.id;
          // Taiga points require a role-id -> point-id dictionary. The plan only
          // has a sprint total, so preserve it without inventing role estimates.
          const plannedPoints = sp.planned_points ?? sp.points;
          if (plannedPoints != null) {
            payload.description = `${payload.description}\n\nPlanned points: ${plannedPoints}`.trim();
          }
          if (existing && existing.taiga_id) {
            storyId = existing.taiga_id;
            if (updateExisting) {
              await client.updateUserStory(existing.taiga_id, payload);
              await this._mappingModel.updateAnyRecord({ _id: existing._id }, { name: payload.subject, taiga_milestone_id: milestoneId, sync_status: 'success', last_error: null, last_synced_at: new Date(), updated_at: new Date() });
              stories.updated++;
            }
          } else {
            const created = await client.createUserStory(taigaProjectId, payload);
            storyId = created.id;
            await this.saveCreatedMapping(existing, {
              project_id: projectId, plan_id: planId, entity_type: 'user_story', external_id: storyKey,
              taiga_id: created.id, taiga_ref: created.ref, name: created.subject,
              taiga_project_id: taigaProjectId, taiga_milestone_id: milestoneId,
              sync_status: 'success', last_synced_at: new Date(),
            });
            stories.created++;
          }
        } catch (err: any) {
          const message = err?.message || 'unknown';
          stories.failed++;
          stories.errors.push({ external_id: storyKey, type: 'user_story', error: message });
          await this.markMappingFailed(projectId, planId, 'user_story', storyKey, message, { taiga_project_id: taigaProjectId, taiga_milestone_id: milestoneId, name: sprintName });
          for (let tIdx = 0; tIdx < taskList.length; tIdx++) {
            tasks.failed++;
            tasks.errors.push({ external_id: this.taskExternalId(taskList[tIdx], sIdx, tIdx), type: 'task', error: `Skipped: parent user story failed (${message}).` });
          }
          return;
        }

        // ---- 3. tasks of the sprint, under its user story ----
        for (let tIdx = 0; tIdx < taskList.length; tIdx++) {
          const task = taskList[tIdx];
          const taskKey = this.taskExternalId(task, sIdx, tIdx);
          try {
            const existing = await this._mappingModel.findByAny({ project_id: projectId, plan_id: planId, entity_type: 'task', external_id: taskKey });
            let assignedTo: number | undefined;
            if (task.assignee_role) {
              assignedTo = roleToUser.get(task.assignee_role);
              if (!assignedTo) {
                if (!allowUnassigned) throw new Error(`ASSIGNEE_MAPPING_MISSING: No Taiga user mapped to role '${task.assignee_role}'.`);
                warnings.push({ source_id: taskKey, type: 'USER_ROLE_UNMAPPED', value: task.assignee_role });
              }
            }
            const description = task.estimate_hours
              ? `${task.description || ''}\n\nEstimate: ${task.estimate_hours}h`.trim()
              : (task.description || '');
            const payload: any = {
              subject: task.title || task.name || 'Untitled task',
              description,
              milestone: milestoneId,
              user_story: storyId,
              us_order: tIdx,
              taskboard_order: tIdx,
            };
            if (defaultPriority?.id) payload.priority = defaultPriority.id;
            if (taskStatus?.id) payload.status = taskStatus.id;
            if (assignedTo) payload.assigned_to = assignedTo;
            // NOTE: Taiga `points` belong on the User Story, never on a Task.
            if (existing && existing.taiga_id) {
              if (updateExisting) {
                await client.updateTask(existing.taiga_id, payload);
                await this._mappingModel.updateAnyRecord({ _id: existing._id }, { name: payload.subject, taiga_milestone_id: milestoneId, taiga_user_story_id: storyId, sync_status: 'success', last_error: null, last_synced_at: new Date(), updated_at: new Date() });
                tasks.updated++;
              }
            } else {
              const created = await client.createTask(taigaProjectId, payload);
              await this.saveCreatedMapping(existing, {
                project_id: projectId, plan_id: planId, entity_type: 'task', external_id: taskKey,
                taiga_id: created.id, taiga_ref: created.ref, name: created.subject,
                taiga_project_id: taigaProjectId, taiga_milestone_id: milestoneId, taiga_user_story_id: storyId,
                sync_status: 'success', last_synced_at: new Date(),
              });
              tasks.created++;
            }
          } catch (err: any) {
            const message = err?.message || 'unknown';
            tasks.failed++;
            tasks.errors.push({ external_id: taskKey, type: 'task', error: message });
            await this.markMappingFailed(projectId, planId, 'task', taskKey, message, { taiga_project_id: taigaProjectId, taiga_milestone_id: milestoneId, taiga_user_story_id: storyId });
          }
        }
      }));
    }
    return { milestones, user_stories: stories, tasks, warnings };
  }

  /** Every mapping key the plan touches - used for the `create` fail-fast check. */
  private async collectExistingEntities(projectId: string, planId: string, sprints: any[]): Promise<Array<{ external_id: string; entity_type: string }>> {
    const keys: Array<{ external_id: string; entity_type: string }> = [];
    sprints.forEach((sp: any, sIdx: number) => {
      keys.push({ external_id: this.sprintExternalId(sp, sIdx), entity_type: 'sprint' });
      keys.push({ external_id: this.storyExternalId(sp, sIdx), entity_type: 'user_story' });
      (Array.isArray(sp.tasks) ? sp.tasks : []).forEach((task: any, tIdx: number) => {
        keys.push({ external_id: this.taskExternalId(task, sIdx, tIdx), entity_type: 'task' });
      });
    });
    const found: Array<{ external_id: string; entity_type: string }> = [];
    for (let i = 0; i < keys.length; i += BATCH_SIZE) {
      const batch = keys.slice(i, i + BATCH_SIZE);
      const rows = await Promise.all(batch.map((k) => this._mappingModel.findByAny({ project_id: projectId, plan_id: planId, entity_type: k.entity_type, external_id: k.external_id })));
      rows.forEach((row: any, idx: number) => { if (row?.taiga_id) found.push(batch[idx]); });
    }
    return found;
  }

  private async saveCreatedMapping(existing: any, data: any): Promise<void> {
    if (existing) {
      await this._mappingModel.updateAnyRecord({ _id: existing._id }, { ...data, last_error: null, updated_at: new Date() });
    } else {
      await this._mappingModel.addNewRecord(data);
    }
  }

  /** Persist a failed entity so a later `retry` can find it (creates the row when missing). */
  private async markMappingFailed(projectId: string, planId: string, entityType: string, externalId: string, message: string, extra: any = {}): Promise<void> {
    try {
      const existing = await this._mappingModel.findByAny({ project_id: projectId, plan_id: planId, entity_type: entityType, external_id: externalId });
      if (existing) {
        await this._mappingModel.updateAnyRecord({ _id: existing._id }, { ...extra, sync_status: 'failed', last_error: message, updated_at: new Date() });
      } else {
        await this._mappingModel.addNewRecord({ project_id: projectId, plan_id: planId, entity_type: entityType, external_id: externalId, ...extra, sync_status: 'failed', last_error: message });
      }
    } catch (err: any) { this.log('markMappingFailed', err?.message || err, 'ERROR'); }
  }

  /** `sprint-N` - identical to `acceptPlan`'s `plan_execution_items.ref_key` (1-based). */
  private sprintExternalId(sp: any, sprintIdx: number): string {
    return String(sp?.sprint_id || sp?.id || `sprint-${sprintIdx + 1}`);
  }

  /** `story_sprint-N` - the sprint's single User Story (sprint-level mapping). */
  private storyExternalId(sp: any, sprintIdx: number): string {
    return `story_${this.sprintExternalId(sp, sprintIdx)}`;
  }

  /** `sprint-N-task-M` - identical to `acceptPlan`'s task ref_key (1-based). */
  private taskExternalId(task: any, sprintIdx: number, taskIdx: number): string {
    return String(task?.task_id || task?.id || `sprint-${sprintIdx + 1}-task-${taskIdx + 1}`);
  }

  private emptyStage(): IPublishStageResult {
    return { created: 0, updated: 0, failed: 0, errors: [] };
  }

  /** Documented `summary.<entity>` counters for a stage. */
  private stageCounts(stage: IPublishStageResult): { created: number; updated: number; skipped: number; failed: number } {
    return { created: stage.created, updated: stage.updated, skipped: 0, failed: stage.failed };
  }

  /** Documented `errors[]` flattened across the stages. */
  private toErrorSummary(stages: IPublishStageResult[]): Array<{ source_id: string; entity_type: string; error: string }> {
    const out: Array<{ source_id: string; entity_type: string; error: string }> = [];
    for (const stage of stages) {
      for (const e of stage.errors) out.push({ source_id: e.external_id, entity_type: e.type, error: e.error });
    }
    return out;
  }

  /** Documented `mappings[]`: internal source key -> Taiga object. */
  private toMappingSummary(mappings: any[]): Array<{ source_type: string; source_id: string; taiga_type: string; taiga_id: number; taiga_ref?: number }> {
    const taigaType: Record<string, string> = { sprint: 'milestone', user_story: 'userstory', task: 'task' };
    return mappings.map((m) => ({
      source_type: m.entity_type,
      source_id: m.external_id,
      taiga_type: taigaType[m.entity_type] || m.entity_type,
      taiga_id: m.taiga_id,
      taiga_ref: m.taiga_ref,
    }));
  }

  private assertPlanPublishable(plan: any): string | null {
    const status = String(plan?.status || '').toLowerCase();
    if (PUBLISHABLE_PLAN_STATUSES.includes(status)) return null;
    return `PLAN_NOT_ACCEPTED: accept the plan before publishing to Taiga (current: ${plan?.status || 'unknown'}).`;
  }

  /** The project's Taiga integration: the requested one, else the first `taiga` provider row. */
  private async resolveIntegration(projectId: string, integrationId?: string): Promise<any> {
    if (integrationId) {
      const byId: any = await this._integrationModel.findByAny({ _id: integrationId, project_id: projectId, is_deleted: false });
      if (byId) return byId;
    }
    const rows: any[] = await this._integrationModel.findAllByAny({ project_id: projectId, provider: 'taiga', is_deleted: false });
    return rows[0] || null;
  }

  private async buildClient(integ: any): Promise<TaigaClient> {
    const base = this.taigaApiBase(integ.repository_url);
    const authenticate = integ.username && integ.password ? async () => {
      const token = await new TaigaClient('', base).auth(integ.username, integ.password);
      try { await this._integrationModel.updateAnyRecord({ _id: integ._id }, { token, updated_at: new Date() }); } catch { /* non-fatal */ }
      return token;
    } : undefined;
    if (integ.token) return new TaigaClient(integ.token, base, authenticate);
    if (authenticate) return new TaigaClient(await authenticate(), base, authenticate);
    throw new Error('Taiga integration has no token or username/password.');
  }

  /** Integrations may store a browser project URL rather than an API base. */
  private taigaApiBase(repositoryUrl?: string): string {
    if (!repositoryUrl?.trim()) return 'https://api.taiga.io/api/v1';
    const url = new URL(repositoryUrl.trim());
    if (url.hostname === 'tree.taiga.io' || url.hostname === 'api.taiga.io') {
      return 'https://api.taiga.io/api/v1';
    }
    const pathname = url.pathname.replace(/\/+$/, '');
    if (/\/api\/v1$/.test(pathname)) return `${url.origin}${pathname}`;
    const projectAt = pathname.indexOf('/project/');
    if (projectAt >= 0) return `${url.origin}${pathname.slice(0, projectAt)}/api/v1`;
    return `${url.origin}${pathname}/api/v1`;
  }

  /**
   * Resolve the Taiga project. `connect` stores the Taiga **project id** in
   * `repository_name` and the API base in `repository_url`, so the id is tried first
   * and `by_slug` is the fallback for rows written by older flows.
   */
  private async resolveTaigaProject(client: TaigaClient, integ: any): Promise<any> {
    const ref = this.taigaProjectRef(integ);
    if (ref.id) {
      const byId = await client.getProject(ref.id).catch((err: any) => {
        if (err.status === 404) return null;
        throw err;
      });
      if (byId?.id) return byId;
    }
    const slug = ref.slug || this.parseSlug(integ);
    if (!slug) throw new Error('No Taiga project id or slug on the integration.');
    return client.projectBySlug(slug);
  }

  private taigaProjectRef(integ: any): { id?: number; slug?: string } {
    const name = String(integ?.repository_name ?? '').trim();
    if (/^\d+$/.test(name)) return { id: Number(name) };
    const fromUrl = String(integ?.repository_url ?? '').match(/\/project\/([^/?#]+)/);
    if (fromUrl) return { slug: decodeURIComponent(fromUrl[1]) };
    const fromName = name.match(/\/project\/([^/?#]+)/);
    if (fromName) return { slug: decodeURIComponent(fromName[1]) };
    const slug = this.parseSlug(integ);
    return slug ? { slug } : {};
  }

  /** Slug only from an explicit `.../project/<slug>` URL or a bare slug in `repository_name`. */
  private parseSlug(integ: any): string {
    for (const src of [String(integ?.repository_url || ''), String(integ?.repository_name || '')]) {
      const m = src.match(/(?:^|\/)project\/([^/?#]+)/);
      if (m) return decodeURIComponent(m[1]);
    }
    const name = String(integ?.repository_name || '').trim();
    if (!name || /^\d+$/.test(name) || /^https?:/i.test(name)) return '';
    return name;
  }
}
