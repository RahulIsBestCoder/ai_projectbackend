import { AiIntelligenceModel } from '../models/ai_intelligence_model';
import { AiPlanModel } from '../models/ai_plan_model';
import { AiSessionModel } from '../models/ai_session_model';
import { IInsightCreate, IInsightUpdate, IAgentResponse, IProjectContext, IPlanGenerate, ISprintPlan } from '../interface/ai_intelligence_interface';
import { IServiceResult } from '../../../helper/common_interface';
import { GoogleProvider } from '../providers/google_provider';
import { IAiProvider } from '../providers/base_provider';
import { ProviderFactory } from '../providers/provider_factory';
import { AnalyticsModel } from '../../analytics/models/analytics_model';
import { RiskPredictionModel } from '../../risk_prediction/models/risk_prediction_model';
import { ProjectModel } from '../../project/models/project_model';

/**
 * `AiIntelligenceService` – Business logic for AI Intelligence and cached insights.
 * Implements context-aware intelligence, project analysis, summaries, insights,
 * recommendations, and automated reporting.
 */
export class AiIntelligenceService {
  private readonly _insightModel = new AiIntelligenceModel();
  private readonly _sessionModel = new AiSessionModel();
  private readonly _analyticsModel = new AnalyticsModel();
  private readonly _riskModel = new RiskPredictionModel();
  private readonly _projectModel = new ProjectModel();
  private readonly _planModel = new AiPlanModel();
  private readonly _aiProvider: IAiProvider;
  private readonly logName = 'ai_intelligence_service';

  constructor() {
    // Use ProviderFactory for multi-vendor support (Phase 5)
    this._aiProvider = ProviderFactory.getDefaultProvider();
  }

  private initLog(): void {
    /* parity with plan convention */
  }

  private log(method: string, msg: unknown, severity = 'INFO'): void {
    global.logs.writelog(`${this.logName}.${method}`, msg, severity);
  }

  /**
   * Assemble project context from analytics, risk, and project data.
   */
  private async assembleProjectContext(projectId: string): Promise<IProjectContext> {
    this.log('assembleProjectContext', `Assembling context for project: ${projectId}`);

    const project = await this._projectModel.findByAny({ _id: projectId, is_deleted: false });
    if (!project) {
      throw new Error('Project not found.');
    }

    const analyticsData = await this._analyticsModel.findAllByAny({
      project_id: projectId,
      is_deleted: false,
    });

    const riskData = await this._riskModel.findAllByAny({
      project_id: projectId,
      is_deleted: false,
    });

    const healthMetrics = analyticsData.filter((a: any) => a.metric_type === 'health');
    const healthScore = healthMetrics.length > 0
      ? healthMetrics.reduce((sum: number, m: any) => sum + (m.value || 0), 0) / healthMetrics.length
      : undefined;

    const velocityMetrics = analyticsData.filter((a: any) => a.metric_type === 'velocity');
    const velocity = velocityMetrics.length > 0
      ? velocityMetrics.reduce((sum: number, m: any) => sum + (m.value || 0), 0) / velocityMetrics.length
      : undefined;

    const risks = riskData.filter((r: any) => r.kind === 'risk');
    const predictions = riskData.filter((r: any) => r.kind === 'prediction');
    const highRisks = risks.filter((r: any) => r.risk_level === 'HIGH');
    const mediumRisks = risks.filter((r: any) => r.risk_level === 'MEDIUM');
    const overallRiskLevel = highRisks.length > 0 ? 'HIGH' : mediumRisks.length > 0 ? 'MEDIUM' : 'LOW';

    const blockers: string[] = [];
    risks.forEach((r: any) => {
      if (r.factors && Array.isArray(r.factors)) {
        blockers.push(...r.factors);
      }
    });

    const sprintMetrics = analyticsData.filter((a: any) => a.metric_type === 'sprint');
    const completionMetrics = analyticsData.filter((a: any) => a.metric_type === 'completion_rate');

    const context: IProjectContext = {
      project: {
        id: projectId,
        name: project.name || 'Unknown Project',
        description: project.description || '',
        status: project.status === 1 ? 'active' : 'inactive',
      },
      analytics: {
        metrics: analyticsData.map((a: any) => ({
          metric_type: a.metric_type,
          value: a.value,
          breakdown: a.breakdown || {},
          period: a.period || 'daily',
        })),
        health_score: healthScore,
        velocity: velocity,
      },
      risks: {
        risk_level: overallRiskLevel,
        factors: blockers,
        predictions: predictions.map((p: any) => ({
          kind: p.kind,
          risk_level: p.risk_level,
          confidence_score: p.confidence_score || 0,
          summary: p.summary || '',
        })),
      },
      blockers: blockers,
      sprint_data: {
        current_sprint: sprintMetrics.length > 0 ? sprintMetrics[sprintMetrics.length - 1]?.breakdown?.sprint_name : undefined,
        velocity: velocity,
        completion_rate: completionMetrics.length > 0
          ? completionMetrics[completionMetrics.length - 1]?.value
          : undefined,
      },
    };

    this.log('assembleProjectContext', 'Context assembled successfully');
    return context;
  }

  /**
   * Build a compact, deterministic prompt from project context.
   * Never sends full raw DB payloads to the model.
   */
  private buildContextPrompt(context: IProjectContext, userPrompt?: string): string {
    const lines: string[] = [
      'You are a Project Intelligence Assistant analyzing project data.',
      '',
      '## Project Overview',
      `- Name: ${context.project.name}`,
      `- Status: ${context.project.status}`,
      `- Description: ${context.project.description}`,
      '',
      '## Health & Analytics',
    ];

    if (context.analytics.health_score !== undefined) {
      lines.push(`- Health Score: ${context.analytics.health_score.toFixed(1)}/100`);
    }
    if (context.analytics.velocity !== undefined) {
      lines.push(`- Velocity: ${context.analytics.velocity.toFixed(1)}`);
    }

    const keyMetrics = context.analytics.metrics.slice(0, 5);
    if (keyMetrics.length > 0) {
      lines.push('- Key Metrics:');
      keyMetrics.forEach((m) => {
        lines.push(`  - ${m.metric_type}: ${m.value}`);
      });
    }

    lines.push('', '## Risk Assessment');
    lines.push(`- Overall Risk Level: ${context.risks.risk_level}`);

    if (context.risks.factors.length > 0) {
      lines.push('- Risk Factors:');
      context.risks.factors.slice(0, 5).forEach((f) => {
        lines.push(`  - ${f}`);
      });
    }

    if (context.blockers.length > 0) {
      lines.push('- Blockers:');
      context.blockers.slice(0, 5).forEach((b) => {
        lines.push(`  - ${b}`);
      });
    }

    if (context.sprint_data.current_sprint) {
      lines.push('', '## Sprint Data');
      lines.push(`- Current Sprint: ${context.sprint_data.current_sprint}`);
      if (context.sprint_data.completion_rate !== undefined) {
        lines.push(`- Completion Rate: ${context.sprint_data.completion_rate}%`);
      }
    }

    if (userPrompt) {
      lines.push('', '## User Question');
      lines.push(userPrompt);
    }

    lines.push('', 'Provide a structured JSON response with the following format:');
    lines.push('{"summary": "brief project summary", "insights": [{"title": "...", "description": "...", "severity": "low|medium|high", "evidence": ["..."]}], "recommendations": [{"action": "...", "priority": "low|medium|high"}], "confidence": 0.0-1.0}');

    return lines.join('\n');
  }

  /**
   * Parse and validate AI response into structured format.
   */
  private parseAgentResponse(response: string): IAgentResponse {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          summary: parsed.summary || response.substring(0, 500),
          insights: parsed.insights || [],
          recommendations: parsed.recommendations || [],
          confidence: parsed.confidence || 0.5,
          generated_at: new Date(),
        };
      }
    } catch {
      // If parsing fails, wrap the raw response
    }

    return {
      summary: response,
      insights: [],
      recommendations: [],
      confidence: 0.5,
      generated_at: new Date(),
    };
  }

  /**
   * Generate chat response - basic AI chat endpoint with optional project context.
   */
  public async generateChatResponse(payload: { prompt: string; project_id?: string }): Promise<string> {
    this.initLog();
    this.log('generateChatResponse', ['Request : ', payload]);
    try {
      let systemPrompt = 'You are a Project Intelligence Assistant. Provide concise, professional, and actionable insights.';
      
      // If project_id is provided, assemble context
      if (payload.project_id) {
        const context = await this.assembleProjectContext(payload.project_id);
        systemPrompt = this.buildContextPrompt(context, payload.prompt);
      } else {
        systemPrompt = `${systemPrompt}\n\nUser: ${payload.prompt}`;
      }

      const response = await this._aiProvider.generate(systemPrompt);
      return response;
    } catch (err: any) {
      this.log('generateChatResponse', err?.stack || err, 'ERROR');
      throw err;
    }
  }

  /* ==================== chat conversation summary ==================== */

  /*
   * Locate a conversation by session_id (or the latest one for a project).
   * Checks the live-chat store (`ai_sessions`) first, then the seeded
   * conversation store (`ai_conversations`) — both share the same shape.
   */
  private async _findConversation(payload: { session_id?: string; project_id?: string }): Promise<{ doc: any; source: string } | null> {
    const db = global.db.connection.db!;
    const sessions = db.collection('ai_sessions');
    const conversations = db.collection('ai_conversations');

    if (payload.session_id) {
      const doc = await sessions.findOne({ session_id: payload.session_id, is_deleted: false });
      if (doc) return { doc, source: 'ai_sessions' };
      const seeded = await conversations.findOne({ session_id: payload.session_id, is_deleted: false });
      if (seeded) return { doc: seeded, source: 'ai_conversations' };
      return null;
    }

    if (payload.project_id) {
      const filter = { project_id: payload.project_id, is_deleted: false };
      const doc = await conversations.findOne(filter, { sort: { created_at: -1 } });
      if (doc) return { doc, source: 'ai_conversations' };
      const live = await sessions.findOne(filter, { sort: { created_at: -1 } });
      if (live) return { doc: live, source: 'ai_sessions' };
    }
    return null;
  }

  /*
   * Deterministic offline summary used when no AI key is configured.
   * Extracts user questions + naive keywords so the result is stable.
   */
  private _heuristicConversationSummary(doc: any): string {
    const messages: Array<{ role: string; content: string }> = doc.messages || [];
    const userMsgs = messages.filter((m) => m.role === 'user');
    const aiMsgs = messages.filter((m) => m.role === 'assistant');
    const questions = userMsgs.slice(0, 3).map((m) => `"${String(m.content).slice(0, 120)}"`);
    const stop = new Set(['what', 'show', 'the', 'for', 'with', 'and', 'are', 'how', 'does', 'this', 'that', 'from', 'project', 'please', 'give', 'about', 'current', 'generate', 'predict', 'completion', 'date']);
    const freq = new Map<string, number>();
    for (const m of userMsgs) {
      for (const w of String(m.content).toLowerCase().match(/[a-z]{4,}/g) || []) {
        if (!stop.has(w)) freq.set(w, (freq.get(w) || 0) + 1);
      }
    }
    const topics = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([w]) => w);
    const lines = [
      `This conversation contains ${messages.length} messages (${userMsgs.length} user, ${aiMsgs.length} assistant) about the project chat.`,
      topics.length ? `Main topics discussed: ${topics.join(', ')}.` : '',
      questions.length ? `User asked: ${questions.join('; ')}.` : '',
      aiMsgs.length ? `The assistant provided analysis and guidance on each request.` : '',
    ];
    return lines.filter(Boolean).join(' ');
  }

  /**
   * Generate (or regenerate) the AI summary of a chat conversation.
   * Uses the configured AI provider when available; falls back to a
   * deterministic heuristic summary when no API key is configured.
   * The result is persisted on the conversation document.
   */
  public async generateChatSummary(payload: { session_id?: string; project_id?: string }): Promise<any> {
    this.initLog();
    this.log('generateChatSummary', ['Request : ', payload]);
    try {
      if (!payload.session_id && !payload.project_id) {
        throw new Error('session_id or project_id is required.');
      }
      const found = await this._findConversation(payload);
      if (!found) {
        throw new Error('Conversation not found.');
      }
      const { doc, source } = found;
      const messages: Array<{ role: string; content: string }> = doc.messages || [];
      if (messages.length === 0) {
        throw new Error('Conversation has no messages to summarize.');
      }

      // Ask the provider first; fall back to the deterministic summary.
      const transcript = messages.slice(-12).map((m) => `${m.role}: ${String(m.content).slice(0, 400)}`).join('\n');
      const prompt = `Summarize the following project-intelligence chat conversation in 3-4 sentences, highlighting the questions asked and the conclusions reached:\n\n${transcript}`;
      let summaryText: string;
      let summarySource = 'heuristic';
      try {
        summaryText = await this._aiProvider.generate(prompt);
        summarySource = 'ai';
      } catch (err: any) {
        this.log('generateChatSummary', `provider unavailable (${err?.message}), using heuristic summary`);
        summaryText = this._heuristicConversationSummary(doc);
      }

      const summary = {
        text: summaryText,
        message_count: messages.length,
        user_message_count: messages.filter((m) => m.role === 'user').length,
        source: summarySource,
        generated_at: new Date(),
      };

      const db = global.db.connection.db!;
      await db.collection(source).updateOne(
        { _id: doc._id },
        { $set: { summary, context_summary: summaryText, updated_at: new Date() } }
      );

      return { session_id: doc.session_id, project_id: doc.project_id, summary };
    } catch (err: any) {
      this.log('generateChatSummary', err?.stack || err, 'ERROR');
      throw err;
    }
  }

  /**
   * Fetch the stored chat summary (no regeneration).
   */
  public async getChatSummary(payload: { session_id?: string; project_id?: string }): Promise<any> {
    this.initLog();
    this.log('getChatSummary', ['Request : ', payload]);
    try {
      if (!payload.session_id && !payload.project_id) {
        throw new Error('session_id or project_id is required.');
      }
      const found = await this._findConversation(payload);
      if (!found) {
        throw new Error('Conversation not found.');
      }
      const { doc, source } = found;
      return {
        session_id: doc.session_id,
        project_id: doc.project_id,
        summary: doc.summary || null,
        context_summary: doc.context_summary || null,
        conversation_source: source,
      };
    } catch (err: any) {
      this.log('getChatSummary', err?.stack || err, 'ERROR');
      throw err;
    }
  }

  /**
   * Analyze project and return structured insights.
   * POST /projects/:id/ai/analyze
   */
  public async analyzeProject(projectId: string, userPrompt?: string): Promise<IAgentResponse> {
    this.initLog();
    this.log('analyzeProject', `Analyzing project: ${projectId}`);
    try {
      const context = await this.assembleProjectContext(projectId);
      const prompt = this.buildContextPrompt(context, userPrompt || 'Analyze the current project status and identify key issues.');
      
      const response = await this._aiProvider.generate(prompt);
      const result = this.parseAgentResponse(response);

      // Cache the analysis result
      await this._insightModel.addNewRecord({
        type: 'analysis',
        project_id: projectId,
        provider: 'google',
        model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
        prompt: prompt,
        response: JSON.stringify(result),
        context_meta: { risk_level: context.risks.risk_level, health_score: context.analytics.health_score },
        cached: true,
      });

      return result;
    } catch (err: any) {
      this.log('analyzeProject', err?.stack || err, 'ERROR');
      throw err;
    }
  }

  /**
   * Generate project summary.
   * POST /projects/:id/ai/summary
   */
  public async generateSummary(projectId: string): Promise<IAgentResponse> {
    this.initLog();
    this.log('generateSummary', `Generating summary for project: ${projectId}`);
    try {
      const context = await this.assembleProjectContext(projectId);
      const prompt = this.buildContextPrompt(context, 'Provide a comprehensive summary of the project current state, progress, and key highlights.');
      
      const response = await this._aiProvider.generate(prompt);
      const result = this.parseAgentResponse(response);

      // Cache the summary
      await this._insightModel.addNewRecord({
        type: 'summary',
        project_id: projectId,
        provider: 'google',
        model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
        prompt: prompt,
        response: JSON.stringify(result),
        context_meta: { risk_level: context.risks.risk_level, health_score: context.analytics.health_score },
        cached: true,
      });

      return result;
    } catch (err: any) {
      this.log('generateSummary', err?.stack || err, 'ERROR');
      throw err;
    }
  }

  /**
   * Generate actionable insights for the project.
   * POST /projects/:id/ai/insights
   */
  public async generateInsights(projectId: string): Promise<IAgentResponse> {
    this.initLog();
    this.log('generateInsights', `Generating insights for project: ${projectId}`);
    try {
      const context = await this.assembleProjectContext(projectId);
      const prompt = this.buildContextPrompt(context, 'Identify key insights, patterns, and anomalies in the project data. Focus on actionable observations.');
      
      const response = await this._aiProvider.generate(prompt);
      const result = this.parseAgentResponse(response);

      await this._insightModel.addNewRecord({
        type: 'insights',
        project_id: projectId,
        provider: 'google',
        model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
        prompt: prompt,
        response: JSON.stringify(result),
        context_meta: { risk_level: context.risks.risk_level, insight_count: result.insights.length },
        cached: true,
      });

      return result;
    } catch (err: any) {
      this.log('generateInsights', err?.stack || err, 'ERROR');
      throw err;
    }
  }

  /**
   * Generate prioritized recommendations.
   * POST /projects/:id/ai/recommendations
   */
  public async generateRecommendations(projectId: string): Promise<IAgentResponse> {
    this.initLog();
    this.log('generateRecommendations', `Generating recommendations for project: ${projectId}`);
    try {
      const context = await this.assembleProjectContext(projectId);
      const prompt = this.buildContextPrompt(context, 'Generate prioritized recommendations to improve project outcomes. Include specific actions, expected impact, and priority levels.');
      
      const response = await this._aiProvider.generate(prompt);
      const result = this.parseAgentResponse(response);

      await this._insightModel.addNewRecord({
        type: 'recommendations',
        project_id: projectId,
        provider: 'google',
        model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
        prompt: prompt,
        response: JSON.stringify(result),
        context_meta: { risk_level: context.risks.risk_level, recommendation_count: result.recommendations.length },
        cached: true,
      });

      return result;
    } catch (err: any) {
      this.log('generateRecommendations', err?.stack || err, 'ERROR');
      throw err;
    }
  }

  /**
   * Generate comprehensive project report.
   * POST /projects/:id/ai/reports
   */
  public async generateReport(projectId: string): Promise<IAgentResponse> {
    this.initLog();
    this.log('generateReport', `Generating report for project: ${projectId}`);
    try {
      const context = await this.assembleProjectContext(projectId);
      const prompt = this.buildContextPrompt(context, 'Generate a comprehensive project report including: executive summary, key metrics analysis, risk assessment, progress evaluation, and strategic recommendations.');
      
      const response = await this._aiProvider.generate(prompt);
      const result = this.parseAgentResponse(response);

      await this._insightModel.addNewRecord({
        type: 'report',
        project_id: projectId,
        provider: 'google',
        model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
        prompt: prompt,
        response: JSON.stringify(result),
        context_meta: { risk_level: context.risks.risk_level, report_type: 'comprehensive' },
        cached: true,
      });

      return result;
    } catch (err: any) {
      this.log('generateReport', err?.stack || err, 'ERROR');
      throw err;
    }
  }

  /**
   * Get available AI models from the provider.
   * GET /ai/models
   */
  public async getAvailableModels(): Promise<string[]> {
    this.initLog();
    this.log('getAvailableModels', 'Fetching available models');
    try {
      const models = await this._aiProvider.getModels();
      return models;
    } catch (err: any) {
      this.log('getAvailableModels', err?.stack || err, 'ERROR');
      throw err;
    }
  }

  /**
   * Get available AI providers.
   * GET /ai/providers
   */
  public async getAvailableProviders(): Promise<any[]> {
    this.initLog();
    try {
      return ProviderFactory.getProviderConfigs();
    } catch (err: any) {
      this.log('getAvailableProviders', err?.stack || err, 'ERROR');
      throw err;
    }
  }

  /**
   * Get cached insights for a project.
   * GET /projects/:id/ai/sessions
   */
  public async getProjectSessions(projectId: string): Promise<any[]> {
    this.initLog();
    this.log('getProjectSessions', `Fetching sessions for project: ${projectId}`);
    try {
      const sessions = await this._insightModel.findAllByAny({
        project_id: projectId,
        is_deleted: false,
      });
      return sessions;
    } catch (err: any) {
      this.log('getProjectSessions', err?.stack || err, 'ERROR');
      throw err;
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: createInsight
   */
  public async createInsight(param: IInsightCreate): Promise<IServiceResult> {
// ...existing code...

    this.initLog();
    this.log('createInsight', ['Request : ', param]);
    try {
      const newInsight = await this._insightModel.addNewRecord(param);
      this.log('Add new insight result:', newInsight);
      return global.Helpers.makeSuccessServiceStatus('Insight created.', newInsight);
    } catch (err: any) {
      this.log('createInsight', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: getInsight
   */
  public async getInsight(insightId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getInsight', ['Request : ', insightId]);
    try {
      const insight = await this._insightModel.findByAny({ _id: insightId });
      if (!insight) {
        return global.Helpers.makeBadServiceStatus('Insight not found.');
      }
      return global.Helpers.makeSuccessServiceStatus('Insight fetched.', insight);
    } catch (err: any) {
      this.log('getInsight', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: updateInsight
   */
  public async updateInsight(insightId: string, param: IInsightUpdate): Promise<IServiceResult> {
    this.initLog();
    this.log('updateInsight', ['Request : ', { insightId, param }]);
    try {
      const updated = await this._insightModel.updateAnyRecord({ _id: insightId }, param);
      this.log('Update insight result:', updated);
      return global.Helpers.makeSuccessServiceStatus('Insight updated.', updated);
    } catch (err: any) {
      this.log('updateInsight', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: deleteInsight
   */
  public async deleteInsight(insightId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('deleteInsight', ['Request : ', insightId]);
    try {
      const deleted = await this._insightModel.updateAnyRecord({ _id: insightId }, { is_deleted: true });
      this.log('Delete insight result:', deleted);
      return global.Helpers.makeSuccessServiceStatus('Insight deleted.', deleted);
    } catch (err: any) {
      this.log('deleteInsight', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /* ==================== AI sprint-plan generator (POST /v1/plans) ==================== */

  /*
   * @Developer: Cline
   * @Date: 2026-09-10
   * @Function: buildPlanPrompt
   */
  private buildPlanPrompt(payload: IPlanGenerate): string {
    const durationWeeks = payload.duration_weeks || 8;
    const sprintWeeks = payload.sprint_length_weeks || 2;
    const sprintCount = Math.max(1, Math.round(durationWeeks / sprintWeeks));
    const teamSize = payload.team_size || 4;

    const lines: string[] = [
      'You are an expert agile delivery planner. Create a realistic sprint execution plan for the project described below.',
      '',
      '## Project Input',
      `Description: ${payload.description.trim()}`,
    ];
    if (payload.project_name) lines.push(`Project name: ${payload.project_name}`);
    if (payload.team_size) lines.push(`Team size: ${payload.team_size} people`);
    if (payload.start_date) lines.push(`Planned start date: ${payload.start_date} (YYYY-MM-DD)`);
    lines.push(`Total duration: ${durationWeeks} weeks`);
    lines.push(`Sprint length: ${sprintWeeks} weeks (exactly ${sprintCount} sprints)`);
    if (payload.constraints && payload.constraints.length > 0) {
      lines.push(`Constraints: ${payload.constraints.join('; ')}`);
    }
    lines.push(
      '',
      '## Required Output',
      'Respond with ONLY a single JSON object (no markdown fences, no commentary) in exactly this shape:',
      '{',
      '  "plan_name": "string",',
      '  "summary": "1-3 sentence plan summary",',
      '  "sprints": [',
      '    {',
      '      "name": "Sprint 1",',
      '      "goal": "sprint goal",',
      '      "planned_points": 40,',
      '      "tasks": [',
      '        { "title": "string", "description": "string", "type": "story|task|bug", "priority": "low|medium|high|critical", "assignee_role": "frontend|backend|fullstack|qa|devops|design", "estimate_hours": 8, "story_points": 5 }',
      '      ]',
      '    }',
      '  ],',
      '  "milestones": [ { "name": "string", "description": "string" } ],',
      '  "deadlines": [ { "label": "string" } ],',
      '  "risks": [ { "description": "string", "severity": "low|medium|high", "mitigation": "string" } ],',
      '  "assumptions": ["string"]',
      '}',
      '',
      'Rules:',
      `- Divide the work across exactly ${sprintCount} sprints, ordered by dependency (foundation first, release last).`,
      `- Each sprint needs 3-8 concrete tasks sized for a ${teamSize}-person team.`,
      '- Dates are computed by the system — do NOT include start_date/end_date/deadline fields in the JSON.',
      '- Keep every string value plain text (no newlines inside strings).',
    );
    return lines.join('\n');
  }

  /*
   * @Developer: Cline
   * @Date: 2026-09-10
   * @Function: parsePlanResponse
   */
  private parsePlanResponse(response: string): ISprintPlan | null {
    let text = String(response || '').trim();
    // Strip a markdown code fence if the model wrapped the JSON in one.
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) text = fenced[1].trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      const parsed = JSON.parse(text.slice(start, end + 1));
      if (!parsed || !Array.isArray(parsed.sprints) || parsed.sprints.length === 0) return null;
      return parsed as ISprintPlan;
    } catch {
      return null;
    }
  }

  /*
   * @Developer: Cline
   * @Date: 2026-09-10
   * @Function: normalizePlanDates
   */
  private normalizePlanDates(plan: ISprintPlan, payload: IPlanGenerate): ISprintPlan {
    const DAY = 86400000;
    const sprintWeeks = payload.sprint_length_weeks || 2;
    const parsedStart = payload.start_date ? new Date(payload.start_date) : new Date();
    const base = Number.isNaN(parsedStart.getTime()) ? new Date() : parsedStart;
    const iso = (d: Date) => d.toISOString().slice(0, 10);

    const sprints = (plan.sprints || []).map((sprint, i) => {
      const sStart = new Date(base.getTime() + i * sprintWeeks * 7 * DAY);
      const sEnd = new Date(sStart.getTime() + sprintWeeks * 7 * DAY - DAY);
      return {
        ...sprint,
        index: i + 1,
        start_date: iso(sStart),
        end_date: iso(sEnd),
        deadline: sprint.deadline || iso(sEnd),
      };
    });
    plan.sprints = sprints;

    // Spread milestone dates evenly across the sprint timeline.
    const milestones = plan.milestones || [];
    if (milestones.length > 0 && sprints.length > 0) {
      plan.milestones = milestones.map((m, i) => {
        const at = Math.min(sprints.length - 1, Math.floor(((i + 1) / (milestones.length + 1)) * sprints.length));
        return { ...m, date: m.date || sprints[at].end_date! };
      });
    }

    if (!plan.deadlines || plan.deadlines.length === 0) {
      plan.deadlines = [
        ...sprints.map((s) => ({ label: `${s.name} deadline`, date: s.end_date! })),
        ...plan.milestones!.filter((m) => m.date).map((m) => ({ label: m.name, date: m.date! })),
      ];
    }
    return plan;
  }

  /*
   * @Developer: Cline
   * @Date: 2026-09-10
   * @Function: buildFallbackPlan
   */
  private buildFallbackPlan(payload: IPlanGenerate, reason: string): ISprintPlan {
    const durationWeeks = payload.duration_weeks || 8;
    const sprintWeeks = payload.sprint_length_weeks || 2;
    const sprintCount = Math.max(1, Math.round(durationWeeks / sprintWeeks));
    const teamSize = payload.team_size || 4;
    const topic = String(payload.project_name || payload.description || 'Project').trim().slice(0, 80);

    const phases = [
      {
        goal: 'Discovery, setup & architecture',
        tasks: ['Draft requirement breakdown', 'Set up repository, CI and environments', 'Design data model & API contracts'],
      },
      {
        goal: 'Core implementation',
        tasks: ['Implement core domain logic', 'Build primary API endpoints', 'Write unit tests for core modules'],
      },
      {
        goal: 'Feature completion',
        tasks: ['Implement remaining features', 'Integrate third-party services', 'Peer review & bug fixes'],
      },
      {
        goal: 'Hardening & release',
        tasks: ['End-to-end testing & QA pass', 'Performance & security hardening', 'Release prep, docs & deployment'],
      },
    ];
    const roles = ['backend', 'frontend', 'fullstack', 'qa', 'devops'];

    const sprints = Array.from({ length: sprintCount }, (_, i) => {
      const phase = phases[Math.min(phases.length - 1, Math.floor((i / sprintCount) * phases.length))];
      return {
        index: i + 1,
        name: `Sprint ${i + 1}`,
        goal: `${phase.goal} — ${topic}`,
        planned_points: teamSize * 8,
        tasks: phase.tasks.map((title, t) => ({
          title,
          description: `Fallback task ${t + 1} for ${phase.goal.toLowerCase()}.`,
          type: 'task',
          priority: i === sprintCount - 1 ? 'high' : 'medium',
          assignee_role: roles[(i + t) % roles.length],
          estimate_hours: 8,
          story_points: 5,
        })),
      };
    });

    return {
      plan_name: `Sprint Plan — ${topic}`,
      summary: `Deterministic ${sprintCount}-sprint plan (${durationWeeks} weeks, ${sprintWeeks}-week sprints). Generated by the rule-based fallback because the AI provider was unavailable: ${reason}`,
      total_duration_weeks: durationWeeks,
      sprints,
      milestones: [
        { name: 'Architecture approved', description: 'Setup and design decisions signed off.' },
        { name: 'Feature complete', description: 'All planned features implemented.' },
        { name: 'Project release', description: 'Tested, hardened and shipped.' },
      ],
      risks: [
        { description: 'Scope creep across sprints', severity: 'medium', mitigation: 'Freeze sprint scope at planning; park new items in the backlog.' },
        { description: 'Single points of failure in staffing', severity: 'medium', mitigation: 'Pair reviewers on critical modules.' },
      ],
      assumptions: [
        `Team of ${teamSize} available full-time.`,
        `${sprintWeeks}-week sprints starting from the requested start date.`,
      ],
      generated_by: 'heuristic-fallback',
    };
  }

  /*
   * @Developer: Cline
   * @Date: 2026-09-10
   * @Function: generatePlan
   */
  public async generatePlan(payload: IPlanGenerate): Promise<{ id: any; generated_by: string; model: string; input: IPlanGenerate; plan: ISprintPlan }> {
    this.initLog();
    this.log('generatePlan', ['Request : ', payload]);

    const prompt = this.buildPlanPrompt(payload);
    let provider = 'google';
    let model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    let plan: ISprintPlan | null = null;

    try {
      const response = await this._aiProvider.generate(prompt);
      plan = this.parsePlanResponse(response);
      if (!plan) {
        this.log('generatePlan', 'AI response was not parseable plan JSON; using heuristic fallback.', 'WARN');
      }
    } catch (err: any) {
      // Provider unavailable/timeouts must never fail the request — same
      // convention as generateChatSummary's heuristic fallback.
      this.log('generatePlan', `provider unavailable (${err?.message || err}); using heuristic fallback.`, 'INFO');
    }

    if (!plan) {
      provider = 'heuristic-fallback';
      model = 'rule-based';
      plan = this.buildFallbackPlan(payload, 'AI provider unavailable or returned invalid JSON');
    }

    plan = this.normalizePlanDates(plan, payload);

    const record = await this._planModel.addNewRecord({
      project_id: payload.project_id || null,
      title: plan.plan_name,
      input: payload,
      plan,
      provider,
      model,
      prompt,
    });

    this.log('generatePlan', `Plan stored as ${record?._id}`);
    return { id: record?._id, generated_by: provider, model, input: payload, plan };
  }

  /*
   * @Developer: Cline
   * @Date: 2026-09-10
   * @Function: listPlans
   */
  public async listPlans(projectId?: string): Promise<any[]> {
    this.initLog();
    this.log('listPlans', ['Request : ', { projectId }]);
    const filter: Record<string, unknown> = { is_deleted: false };
    if (projectId) filter.project_id = projectId;
    return this._planModel.findAllByAny(filter);
  }

  /*
   * @Developer: Cline
   * @Date: 2026-09-10
   * @Function: getPlan
   */
  public async getPlan(planId: string): Promise<any> {
    this.initLog();
    this.log('getPlan', ['Request : ', planId]);
    const plan = await this._planModel.findByAny({ _id: planId, is_deleted: false });
    if (!plan) {
      throw new Error('Plan not found.');
    }
    return plan;
  }
}
