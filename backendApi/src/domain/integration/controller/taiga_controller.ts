/**
 * `TaigaController` — Thin controller for the Taiga publish pipeline.
 *
 * Handles: connect, test-connection, status, publish, preview.
 * All logic lives in `TaigaPublishService` — this class just parses
 * requests and delegates. No existing controller methods are modified.
 */
import { Request, Response } from 'express';
import { TaigaPublishService } from '../service/taiga_publish_service';
import { IConnectRequest, ICreateRequest, IPublishRequest } from '../interface/taiga_publish_interface';

/*
 * @Developer: Sougata Bauri
 * @Date: 2026-09-27
 * @Function: TaigaController
 */
export class TaigaController {
  private readonly _service = new TaigaPublishService();
  private initLog(): void { /* parity */ }

  /**
   * POST /v1/projects/:projectId/taiga/connect
   */
  public connect = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `taigaConnect${global.Helpers.getTraceID(req.body)}`;
    try {
      const projectId = req.params.projectId;
      const body: IConnectRequest = req.body || {};
      if (!body.token && !(body.username && body.password)) {
        global.Helpers.badRequestStatusBuild(res, 'Provide either token or username+password.');
        return;
      }
      if (!body.project_id && !body.base_url) {
        global.Helpers.badRequestStatusBuild(res, 'Provide project_id or base_url.');
        return;
      }
      const param: any = {
        project_id: projectId, provider: 'taiga',
        repository_name: String(body.project_id || body.base_url || '').trim(),
        repository_url: body.base_url || undefined,
        token: body.token || undefined,
        username: body.username || undefined, password: body.password || undefined,
        category: 'other', status: 1,
      };
      const { IntegrationService } = require('../service/integration_service');
      const intService = new IntegrationService();
      const ret = await intService.createIntegration(param);
      if (ret.status) global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      else global.Helpers.badRequestStatusBuild(res, ret.status_message, ret.data_sets);
    } catch (error: any) {
      global.logs.writelog(trace, error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Failed to connect Taiga integration.');
    }
  };

  /**
   * POST /v1/projects/:projectId/taiga/test-connection
   */
  public testConnection = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    try {
      const projectId = req.params.projectId;
      const integrationId = req.body?.integrationId || req.body?.integration_id;
      if (!integrationId) {
        global.Helpers.badRequestStatusBuild(res, 'integrationId is required.');
        return;
      }
      const ret = await this._service.testConnection(projectId, integrationId);
      if (ret.status) global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      else global.Helpers.badRequestStatusBuild(res, ret.status_message);
    } catch (error: any) {
      global.logs.writelog('taigaTestConnection', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Connection test failed.');
    }
  };

  /**
   * GET /v1/projects/:projectId/taiga/status
   */
  public status = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    try {
      const ret = await this._service.getStatus(req.params.projectId);
      if (ret.status) global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      else global.Helpers.badRequestStatusBuild(res, ret.status_message);
    } catch (error: any) {
      global.logs.writelog('taigaStatus', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Status check failed.');
    }
  };

  /**
   * POST /v1/projects/:projectId/plans/:planId/publish-to-taiga
   */
  public publish = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    try {
      const projectId = req.params.projectId;
      const planId = req.params.planId;
      const body: IPublishRequest = req.body || {};
      const integrationId = body.integrationId || body.integration_id;
      if (!integrationId) {
        global.Helpers.badRequestStatusBuild(res, 'integrationId is required (Taiga integration).');
        return;
      }
      const ret = await this._service.publishPlan(projectId, planId, integrationId, {
        create_missing: body.create_missing, update_existing: body.update_existing,
      });
      if (ret.status) global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      else global.Helpers.badRequestStatusBuild(res, ret.status_message, ret.data_sets);
    } catch (error: any) {
      global.logs.writelog('taigaPublish', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Publish failed.');
    }
  };

  /**
   * POST /v1/projects/:projectId/plans/:planId/create-in-taiga
   *
   * One-shot creation for the UI "Create in Taiga" button.
   * Fails immediately if ANY entity already exists in `taiga_mappings`
   * — no partial creation, no updates.
   */
  public createInTaiga = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    try {
      const projectId = req.params.projectId;
      const planId = req.params.planId;
      const body: ICreateRequest = req.body || {};
      const integrationId = body.integrationId || body.integration_id;
      const ret = await this._service.createInTaiga(projectId, planId, integrationId);
      if (ret.status) global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      else global.Helpers.badRequestStatusBuild(res, ret.status_message, ret.data_sets);
    } catch (error: any) {
      global.logs.writelog('taigaCreateInTaiga', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Create in Taiga failed.');
    }
  };

  /**
   * POST /v1/projects/:projectId/plans/:planId/publish-to-taiga/preview
   */
  public preview = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    try {
      const projectId = req.params.projectId;
      const planId = req.params.planId;
      const integrationId = req.body?.integrationId || req.body?.integration_id;
      const ret = await this._service.previewPlan(projectId, planId, integrationId);
      if (ret.status) global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      else global.Helpers.badRequestStatusBuild(res, ret.status_message, ret.data_sets);
    } catch (error: any) {
      global.logs.writelog('taigaPreview', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Preview failed.');
    }
  };

  /* ==================== plan-scoped routes (the "Create in Taiga" button) ==================== */

  /**
   * POST /v1/plans/:planId/create-in-taiga
   *
   * Plan-scoped create/sync. The project (and therefore the Taiga integration) is
   * resolved from `ai_plans.project_id`, so the client only sends the plan id.
   * `dry_run: true` degrades to the preview (no writes anywhere).
   */
  public createInTaigaForPlan = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    try {
      const planId = String(req.params.planId || req.params.id || '');
      const body: ICreateRequest = req.body || {};
      const integrationId = body.integrationId || body.integration_id;
      const ret = body.dry_run === true
        ? await this._service.previewPlanByPlanId(planId, integrationId)
        : await this._service.createPlanInTaiga(planId, {
            mode: body.mode === 'sync' ? 'sync' : 'create',
            integrationId,
            allowUnassigned: body.allow_unassigned !== false,
          });
      if (ret.status) global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      else global.Helpers.badRequestStatusBuild(res, ret.status_message, ret.data_sets);
    } catch (error: any) {
      global.logs.writelog('taigaCreateInTaigaForPlan', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Create in Taiga failed.');
    }
  };

  /**
   * POST /v1/plans/:planId/create-in-taiga/preview
   *
   * Always a dry run - used for the confirmation dialog. No Taiga writes.
   */
  public previewForPlan = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    try {
      const planId = String(req.params.planId || req.params.id || '');
      const integrationId = req.body?.integrationId || req.body?.integration_id;
      const ret = await this._service.previewPlanByPlanId(planId, integrationId);
      if (ret.status) global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      else global.Helpers.badRequestStatusBuild(res, ret.status_message, ret.data_sets);
    } catch (error: any) {
      global.logs.writelog('taigaPreviewForPlan', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Preview failed.');
    }
  };

  /**
   * GET /v1/plans/:planId/taiga-sync
   *
   * Publish state of the plan plus the per-entity `taiga_mappings` summary.
   */
  public planSyncStatus = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    try {
      const planId = String(req.params.planId || req.params.id || '');
      const ret = await this._service.getPlanSyncStatus(planId);
      if (ret.status) global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      else global.Helpers.badRequestStatusBuild(res, ret.status_message, ret.data_sets);
    } catch (error: any) {
      global.logs.writelog('taigaPlanSyncStatus', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Status check failed.');
    }
  };

  /**
   * POST /v1/plans/:planId/taiga-sync/retry
   *
   * Resumes the plan's Taiga sync (creates what is missing, updates what is mapped).
   */
  public retryPlanSync = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    try {
      const planId = String(req.params.planId || req.params.id || '');
      const ret = await this._service.retryPlanSync(planId);
      if (ret.status) global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      else global.Helpers.badRequestStatusBuild(res, ret.status_message, ret.data_sets);
    } catch (error: any) {
      global.logs.writelog('taigaRetryPlanSync', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Retry failed.');
    }
  };
}
