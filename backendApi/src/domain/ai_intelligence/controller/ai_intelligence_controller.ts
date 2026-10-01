import { Request, Response } from 'express';
import { AiIntelligenceService } from '../service/ai_intelligence_service';
import { ProjectModel } from '../../project/models/project_model';

/**
 * `AiIntelligenceController` – Handles AI chat, provider queries, and project-scoped intelligence.
 */
/*
 * @Developer: Sougata Bauri
 * @Date: 2026-09-27
 * @Function: AiIntelligenceController
 */
export class AiIntelligenceController {
  private readonly _service = new AiIntelligenceService();
  private readonly _projectModel = new ProjectModel();

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: chat
   */
  public chat = async (req: Request, res: Response): Promise<void> => {
    try {
      const { prompt, project_id, provider, model, history } = req.body;
      if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 16000) {
        global.Helpers.badRequestStatusBuild(res, 'Prompt must contain 1-16000 characters');
        return;
      }

      let context: any;
      const result = await this._service.generateChatResponse({ prompt, project_id, provider, model, history }, value => { context = value; });
      global.Helpers.successStatusBuild(res, { response: result, context }, 'AI response generated successfully');
    } catch (error: any) {
      global.logs.writelog('chat', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, error.message || 'Something went wrong');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: generateChatSummary
   */
  public generateChatSummary = async (req: Request, res: Response): Promise<void> => {
    try {
      const { session_id, project_id } = req.body || {};
      const result = await this._service.generateChatSummary({ session_id, project_id });
      global.Helpers.successStatusBuild(res, result, 'Chat summary generated successfully');
    } catch (error: any) {
      global.logs.writelog('generateChatSummary', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, error.message || 'Something went wrong');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: getChatSummary
   */
  public getChatSummary = async (req: Request, res: Response): Promise<void> => {
    try {
      const { session_id, project_id } = req.query as any;
      const result = await this._service.getChatSummary({ session_id, project_id });
      global.Helpers.successStatusBuild(res, result, 'Chat summary fetched successfully');
    } catch (error: any) {
      global.logs.writelog('getChatSummary', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, error.message || 'Something went wrong');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: getProviders
   */
  public getProviders = async (req: Request, res: Response): Promise<void> => {
    try {
      const providers = await this._service.getAvailableProviders();
      global.Helpers.successStatusBuild(res, providers, 'Providers fetched successfully');
    } catch (error: any) {
      global.logs.writelog('getProviders', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: getModels
   */
  public getModels = async (req: Request, res: Response): Promise<void> => {
    try {
      const models = await this._service.getAvailableModels(req.query.provider as string | undefined);
      global.Helpers.successStatusBuild(res, models, 'Models fetched successfully');
    } catch (error: any) {
      global.logs.writelog('getModels', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, error.message || 'Something went wrong');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: switchProvider
   */
  public switchProvider = async (req: Request, res: Response): Promise<void> => {
    try {
      const { provider, model } = req.body;
      if (!provider) {
        global.Helpers.badRequestStatusBuild(res, 'provider is required (gemini, groq, deepseek, ollama, or nvidia)');
        return;
      }
      if (typeof model !== 'string' || !model.trim()) {
        global.Helpers.badRequestStatusBuild(res, 'model is required');
        return;
      }
      const ret = await this._service.switchActiveProvider(provider, model);
      if (ret.status) {
        global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      } else {
        global.Helpers.badRequestStatusBuild(res, ret.status_message);
      }
    } catch (error: any) {
      global.logs.writelog('switchProvider', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: getTokenUsage
   */
  public getTokenUsage = async (req: Request, res: Response): Promise<void> => {
    try {
      const { provider, project_id, window_ms } = req.query as any;
      const ret = await this._service.getTokenUsage({
        provider,
        project_id,
        window_ms: window_ms ? Number(window_ms) : undefined,
      });
      if (ret.status) {
        global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      } else {
        global.Helpers.badRequestStatusBuild(res, ret.status_message);
      }
    } catch (error: any) {
      global.logs.writelog('getTokenUsage', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: analyzeProject
   */
  public analyzeProject = async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectId } = req.params;
      const { prompt } = req.body;
      if (!projectId) {
        global.Helpers.badRequestStatusBuild(res, 'Project ID is required');
        return;
      }

      const result = await this._service.analyzeProject(projectId, prompt);
      global.Helpers.successStatusBuild(res, result, 'Project analysis completed successfully');
    } catch (error: any) {
      global.logs.writelog('analyzeProject', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, error.message || 'Something went wrong');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: generateSummary
   */
  public generateSummary = async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectId } = req.params;
      if (!projectId) {
        global.Helpers.badRequestStatusBuild(res, 'Project ID is required');
        return;
      }

      const result = await this._service.generateSummary(projectId);
      global.Helpers.successStatusBuild(res, result, 'Project summary generated successfully');
    } catch (error: any) {
      global.logs.writelog('generateSummary', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, error.message || 'Something went wrong');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: generateInsights
   */
  public generateInsights = async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectId } = req.params;
      if (!projectId) {
        global.Helpers.badRequestStatusBuild(res, 'Project ID is required');
        return;
      }

      const result = await this._service.generateInsights(projectId);
      global.Helpers.successStatusBuild(res, result, 'Project insights generated successfully');
    } catch (error: any) {
      global.logs.writelog('generateInsights', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, error.message || 'Something went wrong');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: generateRecommendations
   */
  public generateRecommendations = async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectId } = req.params;
      if (!projectId) {
        global.Helpers.badRequestStatusBuild(res, 'Project ID is required');
        return;
      }

      const result = await this._service.generateRecommendations(projectId);
      global.Helpers.successStatusBuild(res, result, 'Recommendations generated successfully');
    } catch (error: any) {
      global.logs.writelog('generateRecommendations', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, error.message || 'Something went wrong');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: generateReport
   */
  public generateReport = async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectId } = req.params;
      if (!projectId) {
        global.Helpers.badRequestStatusBuild(res, 'Project ID is required');
        return;
      }

      const result = await this._service.generateReport(projectId);
      global.Helpers.successStatusBuild(res, result, 'Project report generated successfully');
    } catch (error: any) {
      global.logs.writelog('generateReport', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, error.message || 'Something went wrong');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: getProjectSessions
   */
  public getProjectSessions = async (req: Request, res: Response): Promise<void> => {
    try {
      const { projectId } = req.params;
      if (!projectId) {
        global.Helpers.badRequestStatusBuild(res, 'Project ID is required');
        return;
      }

      const sessions = await this._service.getProjectSessions(projectId);
      global.Helpers.successStatusBuild(res, sessions, 'Project sessions fetched successfully');
    } catch (error: any) {
      global.logs.writelog('getProjectSessions', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, error.message || 'Something went wrong');
    }
  };

  // Keep existing CRUD methods for DB insights

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: createInsight
   */
  public createInsight = async (req: Request, res: Response): Promise<void> => {
    try {
      const ret = await this._service.createInsight(req.body);
      global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
    } catch (error) {
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: getInsight
   */
  public getInsight = async (req: Request, res: Response): Promise<void> => {
    try {
      const ret = await this._service.getInsight(req.params.id);
      global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
    } catch (error) {
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: updateInsight
   */
  public updateInsight = async (req: Request, res: Response): Promise<void> => {
    try {
      const ret = await this._service.updateInsight(req.params.id, req.body);
      global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
    } catch (error) {
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: deleteInsight
   */
  public deleteInsight = async (req: Request, res: Response): Promise<void> => {
    try {
      const ret = await this._service.deleteInsight(req.params.id);
      global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
    } catch (error) {
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: generatePlan
   */
  public generatePlan = async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await this._service.generatePlan(req.body);
      global.Helpers.successStatusBuild(res, result, 'AI sprint plan generated successfully');
    } catch (error: any) {
      global.logs.writelog('generatePlan', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, error.message || 'Something went wrong');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: listPlans
   */
  public listPlans = async (req: Request, res: Response): Promise<void> => {
    try {
      const projectId = (req.query.project_id as string) || undefined;
      // If a project_id is supplied, ensure the project exists before returning plans.
      if (projectId) {
        const project = await this._projectModel.findByAny({ _id: projectId, is_deleted: false });
        if (!project) {
          global.Helpers.badRequestStatusBuild(res, `Project with id ${projectId} not found`);
          return;
        }
      }
      const plans = await this._service.listPlans(projectId);
      global.Helpers.successStatusBuild(res, plans, 'Plans fetched successfully');
    } catch (error: any) {
      global.logs.writelog('listPlans', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, error.message || 'Something went wrong');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: getPlan
   */
  public getPlan = async (req: Request, res: Response): Promise<void> => {
    try {
      const plan = await this._service.getPlan(req.params.id);
      global.Helpers.successStatusBuild(res, plan, 'Plan fetched successfully');
    } catch (error: any) {
      global.logs.writelog('getPlan', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, error.message || 'Something went wrong');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: acceptPlan
   */
  public acceptPlan = async (req: Request, res: Response): Promise<void> => {
    try {
      const resync = req.query.resync === 'true' || req.body?.resync === true;
      const ret = await this._service.acceptPlan(req.params.id, resync);
      if (ret.status) {
        global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      } else {
        global.Helpers.badRequestStatusBuild(res, ret.status_message);
      }
    } catch (error: any) {
      global.logs.writelog('acceptPlan', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, error.message || 'Something went wrong');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: getPlanExecution
   */
  public getPlanExecution = async (req: Request, res: Response): Promise<void> => {
    try {
      const ret = await this._service.getPlanExecution(req.params.id);
      if (ret.status) {
        global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      } else {
        global.Helpers.badRequestStatusBuild(res, ret.status_message);
      }
    } catch (error: any) {
      global.logs.writelog('getPlanExecution', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, error.message || 'Something went wrong');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: toggleExecutionItem
   */
  public toggleExecutionItem = async (req: Request, res: Response): Promise<void> => {
    try {
      const ret = await this._service.toggleExecutionItem(req.params.id, req.params.itemId, req.body.is_completed === true);
      if (ret.status) {
        global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      } else {
        global.Helpers.badRequestStatusBuild(res, ret.status_message);
      }
    } catch (error: any) {
      global.logs.writelog('toggleExecutionItem', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, error.message || 'Something went wrong');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: rebuildProjectContext
   */
  public rebuildProjectContext = async (req: Request, res: Response): Promise<void> => {
    try {
      const ret = await this._service.rebuildProjectContext(req.params.projectId, 'manual');
      if (ret.status) {
        global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      } else {
        global.Helpers.badRequestStatusBuild(res, ret.status_message);
      }
    } catch (error: any) {
      global.logs.writelog('rebuildProjectContext', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, error.message || 'Something went wrong');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: getProjectContext
   */
  public getProjectContext = async (req: Request, res: Response): Promise<void> => {
    try {
      const ret = await this._service.getProjectContext(req.params.projectId);
      if (ret.status) {
        global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      } else {
        global.Helpers.badRequestStatusBuild(res, ret.status_message);
      }
    } catch (error: any) {
      global.logs.writelog('getProjectContext', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, error.message || 'Something went wrong');
    }
  };
}
