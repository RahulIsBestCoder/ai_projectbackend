import { Request, Response } from 'express';
import { AiIntelligenceService } from '../service/ai_intelligence_service';

/**
 * `AiIntelligenceController` – Handles AI chat, provider queries, and project-scoped intelligence.
 */
export class AiIntelligenceController {
  private readonly _service = new AiIntelligenceService();

  /**
   * Basic AI chat endpoint.
   * POST /ai/chat
   */
  public chat = async (req: Request, res: Response): Promise<void> => {
    try {
      const { prompt, project_id } = req.body;
      if (!prompt) {
        global.Helpers.badRequestStatusBuild(res, 'Prompt is required');
        return;
      }

      const result = await this._service.generateChatResponse({ prompt, project_id });
      global.Helpers.successStatusBuild(res, { response: result }, 'AI response generated successfully');
    } catch (error: any) {
      global.logs.writelog('chat', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, error.message || 'Something went wrong');
    }
  };

  /**
   * Generate (or regenerate) the AI summary of a chat conversation.
   * POST /ai/chat/summary
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

  /**
   * Fetch the stored chat summary (no regeneration).
   * GET /ai/chat/summary?session_id=... | ?project_id=...
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

  /**
   * Get available AI providers.
   * GET /ai/providers
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

  /**
   * Get available AI models.
   * GET /ai/models
   */
  public getModels = async (req: Request, res: Response): Promise<void> => {
    try {
      const models = await this._service.getAvailableModels();
      global.Helpers.successStatusBuild(res, models, 'Models fetched successfully');
    } catch (error: any) {
      global.logs.writelog('getModels', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong');
    }
  };

  /**
   * Analyze project and return structured insights.
   * POST /projects/:projectId/ai/analyze
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

  /**
   * Generate project summary.
   * POST /projects/:projectId/ai/summary
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

  /**
   * Generate actionable insights for the project.
   * POST /projects/:projectId/ai/insights
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

  /**
   * Generate prioritized recommendations.
   * POST /projects/:projectId/ai/recommendations
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

  /**
   * Generate comprehensive project report.
   * POST /projects/:projectId/ai/reports
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

  /**
   * Get cached insights for a project.
   * GET /projects/:projectId/ai/sessions
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

  public createInsight = async (req: Request, res: Response): Promise<void> => {
    try {
      const ret = await this._service.createInsight(req.body);
      global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
    } catch (error) {
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong');
    }
  };

  public getInsight = async (req: Request, res: Response): Promise<void> => {
    try {
      const ret = await this._service.getInsight(req.params.id);
      global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
    } catch (error) {
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong');
    }
  };

  public updateInsight = async (req: Request, res: Response): Promise<void> => {
    try {
      const ret = await this._service.updateInsight(req.params.id, req.body);
      global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
    } catch (error) {
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong');
    }
  };

  public deleteInsight = async (req: Request, res: Response): Promise<void> => {
    try {
      const ret = await this._service.deleteInsight(req.params.id);
      global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
    } catch (error) {
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong');
    }
  };

  /**
   * Generate an AI sprint/deadline plan from a project description.
   * POST /plans  (also mounted as POST /ai/plans)
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

  /**
   * List generated plans (optionally filtered by project).
   * GET /plans?project_id=...
   */
  public listPlans = async (req: Request, res: Response): Promise<void> => {
    try {
      const plans = await this._service.listPlans((req.query.project_id as string) || undefined);
      global.Helpers.successStatusBuild(res, plans, 'Plans fetched successfully');
    } catch (error: any) {
      global.logs.writelog('listPlans', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, error.message || 'Something went wrong');
    }
  };

  /**
   * Fetch a single generated plan by id.
   * GET /plans/:id
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
}
