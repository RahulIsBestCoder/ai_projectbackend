import { reportWindow, ratePerWeek, featureProgress, titlesMatch, sprintsMatch } from '../../reporting/service/report_metrics';
import { planningCalendar, schedulePlan, validPlanShape, validatePlanInput, projectPlanDeadline } from './plan_schedule';
import { AiIntelligenceModel } from '../models/ai_intelligence_model';
import { AiPlanModel } from '../models/ai_plan_model';
import { PlanExecutionModel } from '../models/plan_execution_model';
import { AiSessionModel } from '../models/ai_session_model';
import { IInsightCreate, IInsightUpdate, IAgentResponse, IProjectContext, IPlanGenerate, IPlanTaskScope, ITeamBreakdown, ITeamSuggestion, ISprintPlan, IPlanExecutionItemCreate, IProjectContextSnapshot, ProjectContextTrigger, PROJECT_CONTEXT_MAX_LINES, PROJECT_CONTEXT_MAX_CHARS } from '../interface/ai_intelligence_interface';
import { IServiceResult } from '../../../helper/common_interface';
import { GoogleProvider } from '../providers/google_provider';
import { IAiProvider } from '../providers/base_provider';
import { AiTokenUsageModel } from '../models/ai_token_usage_model';
import { ProviderFactory } from '../providers/provider_factory';
import { AnalyticsModel } from '../../analytics/models/analytics_model';
import { RiskPredictionModel } from '../../risk_prediction/models/risk_prediction_model';
import { ProjectModel } from '../../project/models/project_model';
import { GitHubCodeContextService } from './github_code_context_service';
import { investigateRepository, RepositoryReader } from './repository_reader';
import { CodeEvidenceSearch } from './rag/code_evidence_search';
import { codeSearchTerms } from './rag/code_search';
import { SCORING_RULES_ENDPOINTS, scoringRulesContext } from './scoring_rules';
import { AI_CONTEXT_CONFIG } from '../../../configuration/context.config';
import { RagRetrievalService, RetrievalResult } from './rag_retrieval_service';
import { RagService } from './rag/rag_service';
import { buildTaigaSprintSummary } from '../../reporting/service/taiga_sprint_summary';
import { OrganizationService } from '../../organization/service/organization_service';
import mongoose from 'mongoose';

// Plan-vs-repository analysis: tasks per AI call, and source excerpts searched for each task.
const TASK_BATCH = 10;
const TASK_EVIDENCE_FILES = 2;
const TASK_EVIDENCE_CHARS = 2400;


/**
 * `AiIntelligenceService` - Business logic for AI Intelligence and cached insights.
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
  private readonly _planExecModel = new PlanExecutionModel();
  private readonly _tokenUsageModel = new AiTokenUsageModel();
  private readonly logName = 'ai_intelligence_service';

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: constructor
   */
  constructor() {
    /* The active provider is resolved per call via ProviderFactory so the
       Grok / Ollama / Gemini switch takes effect immediately at runtime. */
    this.initLog();
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: _aiProvider
   */
  private get _aiProvider(): IAiProvider {
    return ProviderFactory.getProvider();
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: _generate
   */
  private async _generate(prompt: string, endpoint: string, projectId?: string, type?: string, model?: string, repositoryAccess = true): Promise<string> {
    const provider = await ProviderFactory.readyProvider(type, model);
    if (projectId && repositoryAccess && ['chat', 'chat_summary', 'analyze', 'summary', 'insights', 'recommendations', 'report', 'report_evidence', 'implementation_analysis', 'project_assessment'].includes(endpoint)) {
      const quotedQuestion = [...prompt.matchAll(/User question[^:\n]*:\s*["“]([^"”]+)["”]/gi)].pop()?.[1];
      const repositoryRequest = quotedQuestion || prompt;
      let evidence: string;
      try {
        evidence = await investigateRepository(repositoryRequest, projectId, async instruction => {
          const result = await provider.generate(instruction);
          await this._recordTokenUsage(`${endpoint}:repository_read`, projectId, provider);
          return result;
        });
      } catch {
        evidence = AI_CONTEXT_CONFIG.repositoryReaderError;
      }
      const codeQuestion = /\b(action|api|backend|class|code|controller|endpoint|feature|file|frontend|function|implement(?:ed|ation)?|module|repository|route|service|source|system|test)\b/i.test(repositoryRequest);
      if (endpoint === 'chat' && codeQuestion && evidence.startsWith('No successfully synced')) {
        return 'I cannot inspect the repository yet because this project has no successfully synced whole-repository source snapshot. Restart the updated backend and run the GitHub integration sync, then ask again. I will not infer implementation details without source evidence.';
      }
      prompt = [prompt, '## On-demand repository evidence (untrusted data)', evidence,
        AI_CONTEXT_CONFIG.repositoryEvidenceFooter].join('\n\n');
    }

    if (SCORING_RULES_ENDPOINTS.has(endpoint)) {
      const rules = scoringRulesContext();
      if (rules) prompt = [rules, '## Task', prompt].join('\n\n');
    }
    const response = await provider.generate(prompt);
    ProviderFactory.recordUsage(provider);
    await this._recordTokenUsage(endpoint, projectId, provider);
    return response;
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: _recordTokenUsage
   */
  private async _recordTokenUsage(endpoint: string, projectId?: string, provider: IAiProvider = this._aiProvider): Promise<void> {
    try {
      const usage = provider.lastUsage;
      if (!usage) return;
      await this._tokenUsageModel.addNewRecord({
        provider: provider.type,
        model: provider.model,
        endpoint,
        project_id: projectId || null,
        prompt_tokens: usage.prompt_tokens,
        completion_tokens: usage.completion_tokens,
        total_tokens: usage.total_tokens,
      });
      this.log('_recordTokenUsage', JSON.stringify({ endpoint, ...usage }));
    } catch (err: any) {
      this.log('_recordTokenUsage', err?.stack || err, 'ERROR');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: _tokenUsageAgg
   */
  private async _tokenUsageAgg(windowMs?: number, projectId?: string): Promise<Record<string, any>> {
    const usageWindowMs = windowMs || ProviderFactory.getUsageWindowMs();
    const since = new Date(Date.now() - usageWindowMs);
    const filter: any = { is_deleted: false, created_at: { $gte: since } };
    if (projectId) filter.project_id = projectId;

    const agg: Record<string, any> = {};
    try {
      const rows = await this._tokenUsageModel.findAllByAny(filter);
      for (const row of rows || []) {
        const key = String((row as any).provider || 'unknown');
        if (!agg[key]) {
          agg[key] = {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            requests: 0,
            window_ms: usageWindowMs,
            window_start: since,
          };
        }
        agg[key].prompt_tokens += Number((row as any).prompt_tokens) || 0;
        agg[key].completion_tokens += Number((row as any).completion_tokens) || 0;
        agg[key].total_tokens += Number((row as any).total_tokens) || 0;
        agg[key].requests += 1;
      }
    } catch (err: any) {
      this.log('_tokenUsageAgg', err?.stack || err, 'ERROR');
    }
    return agg;
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: _generateTeamBreakdown
   */
  private async _generateTeamBreakdown(payload: IPlanGenerate): Promise<ITeamBreakdown | null> {
    try {
      const total = payload.team_size;
      const prompt = AI_CONTEXT_CONFIG.teamBreakdownPrompt(total, payload.description || '');
      const raw = await this._generate(prompt, 'team_breakdown', payload.project_id);
      // Attempt to parse JSON – the AI may output surrounding text, so extract the first JSON block.
      // Use a cross‑line pattern compatible with older TS targets.
      const jsonMatch = raw?.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return parsed as ITeamBreakdown;
      }
      return null;
    } catch (e) {
      this.log('_generateTeamBreakdown', e, 'ERROR');
      return null;
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: initLog
   */
  private initLog(): void {
    /* parity with plan convention */
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: log
   */
  private log(method: string, msg: unknown, severity = 'INFO'): void {
    global.logs.writelog(`${this.logName}.${method}`, msg, severity);
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: assembleProjectContext
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
      plan: await this._fetchLatestPlanContext(projectId),
    };

    this.log('assembleProjectContext', 'Context assembled successfully');
    return context;
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: _fetchLatestPlanContext
   */
  private async _fetchLatestPlanContext(projectId: string): Promise<IProjectContext['plan'] | null> {
    try {
      const plan = await this._planModel.findByAny({ project_id: projectId, is_deleted: false });
      if (!plan || plan.status !== 'accepted') return null;

      const items = await this._planExecModel.findAllByAny({ plan_id: plan._id, is_deleted: false });

      if (!items) return null;

      return {
        name: plan.plan?.plan_name || 'Unnamed Plan',
        summary: plan.plan?.summary || '',
        items: items.map((item: any) => ({
          title: item.title,
          kind: item.kind,
          status: item.status === 'completed' ? 'completed' : 'pending',
          description: item.description,
        })),
      };
    } catch (err: any) {
      this.log('_fetchLatestPlanContext', err?.stack || err, 'ERROR');
      return null;
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: buildContextPrompt
   */
  private buildContextPrompt(context: IProjectContext, userPrompt?: string): string {
    const lines: string[] = [
      AI_CONTEXT_CONFIG.systemPersona,
      '',
      AI_CONTEXT_CONFIG.headers.overview,
      `- Name: ${context.project.name}`,
      `- Status: ${context.project.status}`,
      `- Description: ${context.project.description}`,
      '',
      AI_CONTEXT_CONFIG.headers.health,
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

    lines.push('', AI_CONTEXT_CONFIG.headers.risk);
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
      lines.push('', AI_CONTEXT_CONFIG.headers.sprint);
      lines.push(`- Current Sprint: ${context.sprint_data.current_sprint}`);
      if (context.sprint_data.completion_rate !== undefined) {
        lines.push(`- Completion Rate: ${context.sprint_data.completion_rate}%`);
      }
    }

    if (context.plan) {
      lines.push('', AI_CONTEXT_CONFIG.headers.plan);
      lines.push(`- Plan Name: ${context.plan.name}`);
      lines.push(`- Summary: ${context.plan.summary}`);
      lines.push('- Plan Items:');
      context.plan.items.forEach(item => {
        const statusIcon = item.status === 'completed' ? '[X]' : '[ ]';
        lines.push(`  ${statusIcon} ${item.kind}: ${item.title}`);
      });
    }

    if (userPrompt) {
      lines.push('', AI_CONTEXT_CONFIG.headers.question);
      lines.push(userPrompt);
    }

    lines.push(...AI_CONTEXT_CONFIG.analysisResponseFormat);

    return lines.join("\n");
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: parseAgentResponse
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

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: generateChatResponse
   */
  public async generateChatResponse(payload: { prompt: string; project_id?: string; provider?: string; model?: string; history?: Array<{role: string, content: string}> }, onContext?: (context: RetrievalResult) => void): Promise<string> {
    const history = (Array.isArray(payload.history) ? payload.history : [])
      .filter(item => item && ['user', 'assistant'].includes(item.role) && typeof item.content === 'string')
      .slice(-12).map(item => ({ role: item.role, content: item.content.slice(0, 4000) }));
    const isSmallTalk = RagRetrievalService.isSmallTalk(payload.prompt);
    let context: any = { evidence: [], limitations: [], mode: 'none' };
    if (payload.project_id && !isSmallTalk) {
      const project = await this._projectModel.findByAny({ _id: payload.project_id, is_deleted: false });
      if (!project) throw new Error('Project not found.');
      // Recent user turns help resolve follow-ups such as "where is that implemented?"
      const priorUserQuestions = history.filter(item => item.role === 'user').map(item => item.content);
      const isFollowUp = /^(elaborate|explain(?: more)?|more(?: details)?|why|how so|go on|continue)[!.?\s]*$/i.test(payload.prompt.trim());
      const query = isFollowUp && priorUserQuestions.length
        ? `${priorUserQuestions[priorUserQuestions.length - 1]} ${payload.prompt}`
        : [payload.prompt, ...priorUserQuestions.slice(-2)].join(' ');
      context = await new RagService().execute(payload.project_id, query, project);
    }
    const rules = !isSmallTalk && /health|risk|deadline|forecast|probability|score/i.test(payload.prompt)
      ? scoringRulesContext() : null;
    // Greetings and thanks are standalone turns. Prior project history can otherwise
    // make the provider continue an unrelated risk/status answer instead of greeting.
    const prompt = AI_CONTEXT_CONFIG.chatPrompt(payload.prompt, isSmallTalk ? [] : history, context, rules);
    onContext?.(context);
    return this._generate(prompt, 'chat', payload.project_id, payload.provider, payload.model, false);
  }
  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: _findConversation
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
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: _heuristicConversationSummary
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

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: generateChatSummary
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
      const prompt = AI_CONTEXT_CONFIG.chatSummaryPrompt(transcript);
      let summaryText: string;
      let summarySource = 'heuristic';
      try {
        summaryText = await this._generate(prompt, 'chat_summary', (doc as any).project_id);
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

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: getChatSummary
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

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: analyzeProject
   */
  public async analyzeProject(projectId: string, userPrompt?: string): Promise<IAgentResponse> {
    this.initLog();
    this.log('analyzeProject', `Analyzing project: ${projectId}`);
    try {
      const context = await this.assembleProjectContext(projectId);
      const prompt = this.buildContextPrompt(context, userPrompt || 'Analyze the current project status and identify key issues.');
      
      const response = await this._generate(prompt, 'analyze', projectId);
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

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: generateSummary
   */
  public async generateSummary(projectId: string): Promise<IAgentResponse> {
    this.initLog();
    this.log('generateSummary', `Generating summary for project: ${projectId}`);
    try {
      const context = await this.assembleProjectContext(projectId);
      const prompt = this.buildContextPrompt(context, 'Provide a comprehensive summary of the project current state, progress, and key highlights.');
      
      const response = await this._generate(prompt, 'summary', projectId);
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

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: generateInsights
   */
  public async generateInsights(projectId: string): Promise<IAgentResponse> {
    this.initLog();
    this.log('generateInsights', `Generating insights for project: ${projectId}`);
    try {
      const context = await this.assembleProjectContext(projectId);
      const prompt = this.buildContextPrompt(context, 'Identify key insights, patterns, and anomalies in the project data. Focus on actionable observations.');
      
      const response = await this._generate(prompt, 'insights', projectId);
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

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: generateRecommendations
   */
  public async generateRecommendations(projectId: string): Promise<IAgentResponse> {
    this.initLog();
    this.log('generateRecommendations', `Generating recommendations for project: ${projectId}`);
    try {
      const context = await this.assembleProjectContext(projectId);
      const prompt = this.buildContextPrompt(context, 'Generate prioritized recommendations to improve project outcomes. Include specific actions, expected impact, and priority levels.');
      
      const response = await this._generate(prompt, 'recommendations', projectId);
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

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: generateReport
   */
  public async generateReport(projectId: string, request: Record<string, unknown> = {}): Promise<Record<string, any>> {
    this.initLog();
    this.log('generateReport', `Generating report for project: ${projectId}`);
    const { facts, sources } = await this._assembleProjectFacts(projectId);
    const reportType: 'project' | 'sprint' = request.report_type === 'sprint' ? 'sprint' : 'project';
    const requestedSprintId = reportType === 'sprint' ? String(request.sprint_id || '').trim() : '';
    const allowedScope = ['project', 'analytics', 'risks', 'sprints', 'work_items', 'plan', 'plan_execution', 'repository'];
    const requestedScope = Array.isArray(request.scope)
      ? request.scope.map(item => String(item).trim().toLowerCase()).filter(item => allowedScope.includes(item))
      : allowedScope;
    const scope = requestedScope.length ? Array.from(new Set(requestedScope)) : allowedScope;
    const selectedFacts: any = {};
    if (scope.some(item => ['project', 'analytics', 'risks'].includes(item))) {
      selectedFacts.base = {
        ...(scope.includes('project') ? { project: facts.base.project } : {}),
        ...(scope.includes('analytics') ? { analytics: facts.base.analytics } : {}),
        ...(scope.includes('risks') ? { risks: facts.base.risks, blockers: facts.base.blockers } : {}),
      };
    }
    if (scope.includes('sprints')) selectedFacts.sprints = facts.sprints;
    if (scope.includes('work_items')) selectedFacts.work_items = facts.work_items;
    if (scope.includes('plan')) selectedFacts.plan = facts.plan;
    if (scope.includes('plan_execution')) selectedFacts.plan_execution = facts.plan_execution;
    if (scope.includes('repository')) selectedFacts.code = facts.code;
    const sourceScope: Record<string, string> = { plans: 'plan', github_source_files: 'repository' };
    const selectedSources = sources.filter(source => scope.includes(sourceScope[source] || source));
    const db = global.db.connection.db!;
    const now = new Date();
    let selectedSprint: any = null;
    if (reportType === 'sprint') {
      if (!requestedSprintId) throw new Error('SPRINT_REQUIRED');
      const sprintKeys: any[] = [{ id: requestedSprintId }, { sprint_id: requestedSprintId }];
      if (mongoose.Types.ObjectId.isValid(requestedSprintId)) sprintKeys.push({ _id: new mongoose.Types.ObjectId(requestedSprintId) });
      const numericMilestone = Number(requestedSprintId);
      if (Number.isFinite(numericMilestone)) sprintKeys.push({ taiga_milestone_id: numericMilestone });
      selectedSprint = await db.collection('sprints').findOne({
        project_id: projectId, is_deleted: { $ne: true }, $or: sprintKeys,
      });
      if (!selectedSprint) throw new Error('SPRINT_NOT_FOUND');
    }
    const sprintStart = selectedSprint?.start_date ? new Date(selectedSprint.start_date) : null;
    const sprintEnd = selectedSprint?.end_date ? new Date(selectedSprint.end_date) : null;
    const activityWindow = reportWindow(now, selectedSprint?.start_date, selectedSprint?.end_date);
    const { since, until } = activityWindow;
    const [repositories, commits, pullRequests, prediction, plans, projectMembers, allTaigaTasks, taigaBugItems, githubIntegrations, allReportSprints] = await Promise.all([
      db.collection('github_repositories').find({ projectId, isActive: true }).project({
        _id: 0, integrationId: 1, repositoryFullName: 1, branch: 1, category: 1, syncStatus: 1, updatedAt: 1, githubUpdatedAt: 1,
      }).toArray(),
      db.collection('commits').find({ project_id: projectId, is_deleted: { $ne: true }, committed_at: { $gte: since, $lt: until } })
        .project({ _id: 0, committed_at: 1, additions: 1, deletions: 1, author_email: 1, author_name: 1 }).sort({ committed_at: 1 }).toArray(),
      db.collection('pull_requests').find({ project_id: projectId, is_deleted: { $ne: true }, created_at: { $gte: since, $lt: until } })
        .project({ _id: 0, status: 1, created_at: 1, merged_at: 1 }).sort({ created_at: 1 }).toArray(),
      db.collection('risk_predictions').findOne({ project_id: projectId, kind: 'prediction', risk_key: 'deadline', is_deleted: { $ne: true } }, { sort: { updated_at: -1, created_at: -1 } }),
      this._planModel.findAllByAny({ project_id: projectId, is_deleted: false }),
      db.collection('project_members').find({ project_id: projectId, is_deleted: { $ne: true } })
        .project({ _id: 0, user_id: 1, role: 1, project_role: 1 }).toArray(),
      db.collection('taiga_tasks').find({ project_id: projectId, is_deleted: { $ne: true } })
        .project({ _id: 0, assigned_to_id: 1, assigned_to_username: 1, assigned_to_full_name: 1, is_closed: 1, type: 1, tags: 1,
          taiga_task_id: 1, subject: 1, integration_id: 1, taiga_project_id: 1, taiga_milestone_id: 1, taiga_milestone_slug: 1,
          status_name: 1, is_blocked: 1, synced_at: 1 }).toArray(),
      db.collection('work_items').find({ project_id: projectId, source: 'taiga', type: 'bug', is_deleted: { $ne: true } })
        .project({ _id: 0, assignee_id: 1, status: 1 }).toArray(),
      db.collection('integrations').find({ project_id: projectId, provider: 'github', is_deleted: { $ne: true } })
        .project({ _id: 1, category: 1, repository_name: 1 }).toArray(),
      db.collection('sprints').find({ project_id: projectId, is_deleted: { $ne: true } })
        .project({ name: 1, taiga_milestone_id: 1, start_date: 1, end_date: 1, planned_points: 1, completed_points: 1, status: 1 }).toArray(),
    ]);
    const selectedMilestoneId = selectedSprint?.taiga_milestone_id == null ? null : String(selectedSprint.taiga_milestone_id);
    const taigaTasks = reportType === 'sprint'
      ? allTaigaTasks.filter((task: any) => selectedMilestoneId !== null && String(task.taiga_milestone_id) === selectedMilestoneId)
      : allTaigaTasks;
    const reportSprints = reportType === 'sprint' ? [selectedSprint] : allReportSprints;
    if (reportType === 'sprint') {
      const byStatus: Record<string, { count: number }> = {};
      for (const task of taigaTasks) {
        const key = String(task.is_closed ? 'closed' : task.status_name || 'new').trim().toLowerCase().replace(/[\s-]+/g, '_');
        byStatus[key] = { count: (byStatus[key]?.count || 0) + 1 };
      }
      const completed = taigaTasks.filter((task: any) => task.is_closed).length;
      facts.work_items = {
        total: taigaTasks.length,
        done_percent: taigaTasks.length ? Math.round(completed / taigaTasks.length * 1000) / 10 : 0,
        by_status: byStatus,
      };
      facts.sprints = { current: selectedSprint, selected: selectedSprint, rows: [selectedSprint] };
      selectedFacts.base = { project: facts.base.project };
      selectedFacts.work_items = facts.work_items;
      selectedFacts.sprints = facts.sprints;
      delete selectedFacts.plan;
      delete selectedFacts.plan_execution;
      delete selectedFacts.code;
    }
    selectedFacts.report_scope = reportType === 'sprint' ? {
      type: 'sprint', sprint_id: requestedSprintId, sprint_name: selectedSprint.name,
      start_date: selectedSprint.start_date || null, end_date: selectedSprint.end_date || null,
      instruction: 'Report only on this sprint. Do not present whole-project progress as sprint progress.',
    } : { type: 'project' };
    const normalizeIdentity = (value: any) => String(value || '').trim().toLowerCase();
    const employeesByKey = new Map<string, any>();
    const ensureEmployee = (keyValue: any, nameValue: any, emailValue = '') => {
      const key = normalizeIdentity(keyValue || nameValue || emailValue);
      if (!key) return null;
      if (!employeesByKey.has(key)) employeesByKey.set(key, {
        employeeId: key, name: String(nameValue || emailValue || keyValue), email: String(emailValue || ''),
        designation: 'Team member', departmentId: 'unassigned', department: 'Unassigned',
        gitCommits: 0, gitAdditions: 0, gitDeletions: 0, taigaTasksAssigned: 0, taigaTasksCompleted: 0,
        taigaBugsAssigned: 0, taigaBugsSolved: 0,
      });
      return employeesByKey.get(key);
    };
    for (const commit of commits) {
      const employee = ensureEmployee(commit.author_email || commit.author_name, commit.author_name, commit.author_email);
      if (employee) { employee.gitCommits++; employee.gitAdditions += Number(commit.additions) || 0; employee.gitDeletions += Number(commit.deletions) || 0; }
    }
    const isBug = (task: any) => normalizeIdentity(task.type) === 'bug' || (task.tags || []).some((tag: any) => normalizeIdentity(tag) === 'bug');
    const taskByAssignee = new Map<string, any>(taigaTasks.filter((task: any) => task.assigned_to_id != null)
      .map((task: any) => [normalizeIdentity(task.assigned_to_id), task] as [string, any]));
    for (const task of taigaTasks) {
      const employee = ensureEmployee(task.assigned_to_username || task.assigned_to_id || task.assigned_to_full_name,
        task.assigned_to_full_name || task.assigned_to_username || task.assigned_to_id);
      if (employee) { employee.taigaTasksAssigned++; if (task.is_closed) employee.taigaTasksCompleted++; }
    }
    const bugRows = reportType === 'project' && taigaBugItems.length ? taigaBugItems.map((item: any) => ({
      ...(taskByAssignee.get(normalizeIdentity(item.assignee_id)) || {}), ...item,
      is_closed: ['done', 'completed', 'closed'].includes(normalizeIdentity(item.status)),
    })) : taigaTasks.filter(isBug);
    for (const task of bugRows) {
      const employee = ensureEmployee(task.assigned_to_username || task.assigned_to_id || task.assigned_to_full_name,
        task.assigned_to_full_name || task.assigned_to_username || task.assigned_to_id);
      if (employee) { employee.taigaBugsAssigned++; if (task.is_closed) employee.taigaBugsSolved++; }
    }
    const memberIds = projectMembers.map((member: any) => String(member.user_id || '')).filter(Boolean);
    const memberObjectIds = memberIds.filter(id => mongoose.Types.ObjectId.isValid(id)).map(id => new mongoose.Types.ObjectId(id));
    const memberUserQuery: any = { $or: [{ user_id: { $in: memberIds } }, { _id: { $in: [...memberIds, ...memberObjectIds] } }] };
    const users = memberIds.length ? await db.collection('users').find(memberUserQuery)
      .project({ _id: 1, user_id: 1, full_name: 1, first_name: 1, last_name: 1, email: 1, role: 1, department_id: 1, designation: 1, github_username: 1, taiga_username: 1 }).toArray() : [];
    const departmentRows = await db.collection('departments').find({}).project({ _id: 1, name: 1 }).toArray();
    const departmentNames = new Map(departmentRows.map((row: any) => [String(row._id), String(row.name || 'Unassigned')]));
    for (const user of users) {
      const fullName = user.full_name || [user.first_name, user.last_name].filter(Boolean).join(' ');
      const identities = [user.email, user.github_username, user.taiga_username, fullName, user._id, user.user_id].map(normalizeIdentity).filter(Boolean);
      
      // Explicit identity merging for known duplicates
      const identityMap: Record<string, string> = {
        'pallabmsspl': 'pallab biswas',
        'pallab biswas': 'pallab biswas'
      };

      const matches = [...employeesByKey.entries()].filter(([key, row]) => {
        const normalizedKey = identityMap[key] || key;
        const noreplyLogin = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/.exec(normalizeIdentity(row.email))?.[1];
        return identities.includes(normalizedKey) || identities.includes(normalizeIdentity(row.name))
          || identities.includes(normalizeIdentity(row.email)) || Boolean(noreplyLogin && identities.includes(noreplyLogin));
      });
      let employee = matches[0]?.[1];
      if (!employee) employee = ensureEmployee(user.email || user._id || user.user_id, fullName, user.email);
      // A developer may commit with both a corporate email and a GitHub noreply
      // address. Collapse every matching identity before calculating ratings.
      for (const [key, duplicate] of matches.slice(1)) {
        employee.gitCommits += duplicate.gitCommits; employee.gitAdditions += duplicate.gitAdditions; employee.gitDeletions += duplicate.gitDeletions;
        employee.taigaTasksAssigned += duplicate.taigaTasksAssigned; employee.taigaTasksCompleted += duplicate.taigaTasksCompleted;
        employee.taigaBugsAssigned += duplicate.taigaBugsAssigned; employee.taigaBugsSolved += duplicate.taigaBugsSolved;
        employeesByKey.delete(key);
      }
      if (employee) {
        employee.employeeId = String(user._id || user.user_id || employee.employeeId); employee.name = String(fullName || employee.name);
        employee.email = String(user.email || employee.email); employee.designation = String(user.designation || user.role || 'Team member');
        employee.departmentId = String(user.department_id || 'unassigned');
        employee.department = String(departmentNames.get(String(user.department_id)) || user.department_id || 'Unassigned');
      }
    }
    // Keep only developers with actual activity (commits or Taiga tasks) to avoid showing inactive members
    const employeeRows = [...new Set(employeesByKey.values())].filter(e => e.gitCommits > 0 || e.taigaTasksAssigned > 0);
    const rateEmployee = (employee: any) => {
      const changedLines = employee.gitAdditions + employee.gitDeletions;
      const commitScore = Math.min(50, employee.gitCommits / 2);
      const codeScore = Math.min(20, Math.log10(changedLines + 1) * 6);
      const taskScore = employee.taigaTasksAssigned
        ? 25 * employee.taigaTasksCompleted / employee.taigaTasksAssigned : 0;
      const breadthScore = employee.gitCommits > 0 && employee.taigaTasksAssigned > 0 ? 5
        : employee.gitCommits > 0 || employee.taigaTasksAssigned > 0 ? 3 : 0;
      const score = Math.round(Math.min(100, commitScore + codeScore + taskScore + breadthScore));
      const rating = score >= 85 ? 'Exceptional' : score >= 70 ? 'Strong' : score >= 50 ? 'Good'
        : score >= 30 ? 'Developing' : 'Limited evidence';
      return { score, rating, basis: 'COMMITS_CODE_CHANGES_AND_TAIGA_COMPLETION' };
    };
    for (const employee of employeeRows) {
      const rating = rateEmployee(employee);
      employee.activityScore = rating.score;
      employee.activityRating = rating.rating;
      employee.ratingBasis = rating.basis;
    }
    const departmentMap = new Map<string, any>();
    for (const employee of employeeRows) {
      if (!departmentMap.has(employee.departmentId)) departmentMap.set(employee.departmentId, { departmentId: employee.departmentId, department: employee.department, employees: [], gitCommits: 0, taigaTasksAssigned: 0, taigaTasksCompleted: 0, taigaBugsAssigned: 0, taigaBugsSolved: 0 });
      const department = departmentMap.get(employee.departmentId);
      department.employees.push(employee); department.gitCommits += employee.gitCommits;
      department.taigaTasksAssigned += employee.taigaTasksAssigned; department.taigaTasksCompleted += employee.taigaTasksCompleted;
      department.taigaBugsAssigned += employee.taigaBugsAssigned; department.taigaBugsSolved += employee.taigaBugsSolved;
    }
    const employeeWorking = { departments: [...departmentMap.values()].sort((a, b) => a.department.localeCompare(b.department)),
      totals: { employees: employeeRows.length, gitCommits: employeeRows.reduce((sum, row) => sum + row.gitCommits, 0),
        taigaTasksAssigned: employeeRows.reduce((sum, row) => sum + row.taigaTasksAssigned, 0), taigaTasksCompleted: employeeRows.reduce((sum, row) => sum + row.taigaTasksCompleted, 0),
        taigaBugsAssigned: employeeRows.reduce((sum, row) => sum + row.taigaBugsAssigned, 0), taigaBugsSolved: employeeRows.reduce((sum, row) => sum + row.taigaBugsSolved, 0) } };
    const integrationCategories = new Map(githubIntegrations.map((row: any) => [String(row._id), String(row.category || 'other')]));
    const repositoryPortfolio = repositories.map((repository: any) => {
      const declared = String(repository.category || integrationCategories.get(String(repository.integrationId)) || '').toLowerCase();
      const repoName = String(repository.repositoryFullName || '').toLowerCase();
      const category = ['frontend', 'ui'].includes(declared) || /front[-_ ]?end|\bui\b|web[-_ ]?app/.test(repoName) ? 'frontend'
        : declared === 'backend' || /back[-_ ]?end|\bapi\b|server/.test(repoName) ? 'backend' : declared || 'other';
      return { repositoryFullName: repository.repositoryFullName, branch: repository.branch, category, syncStatus: repository.syncStatus };
    });
    const weekKey = (value: any) => {
      const date = new Date(value); if (Number.isNaN(date.getTime())) return null;
      const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
      monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
      return monday.toISOString().slice(0, 10);
    };
    const activity = new Map<string, { commits: number; pull_requests: number; merged_pull_requests: number; additions: number; deletions: number }>();
    const bucket = (key: string) => { if (!activity.has(key)) activity.set(key, { commits: 0, pull_requests: 0, merged_pull_requests: 0, additions: 0, deletions: 0 }); return activity.get(key)!; };
    for (const commit of commits) { const key = weekKey(commit.committed_at); if (key) { const row = bucket(key); row.commits++; row.additions += Number(commit.additions) || 0; row.deletions += Number(commit.deletions) || 0; } }
    for (const pr of pullRequests) { const key = weekKey(pr.created_at); if (key) { const row = bucket(key); row.pull_requests++; if (pr.status === 'merged' || pr.merged_at) row.merged_pull_requests++; } }
    const weeklyActivity = [...activity.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, row]) => ({ week, ...row }));
    const mergedPrs = pullRequests.filter((pr: any) => pr.status === 'merged' || pr.merged_at).length;
    let implementation: any = null;
    if (reportType === 'project' && scope.includes('repository') && scope.includes('plan')) {
      try { implementation = await this.analyzeImplementation(projectId); }
      catch (err: any) { implementation = { available: false, reason: err?.message || 'Plan/repository comparison unavailable.' }; }
    }
    const planRows: any[] = Array.isArray(plans) ? plans : [];
    const latestPlan: any = planRows.slice().sort((a, b) => new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime())[0];
    const deadline = reportType === 'sprint' && sprintEnd ? sprintEnd : projectPlanDeadline(latestPlan);
    const executionPct = reportType === 'sprint' ? NaN : Number(facts.plan_execution?.percent);
    const taigaPct = Number(facts.work_items?.done_percent);
    const implementationPct = implementation?.coverage?.incomplete === false && implementation?.unclearItems === 0 ? Number(implementation.progressPercent) : NaN;
    // Product rule: a plan item ticked by a user IS completed, and that outranks
    // repository verification. Unticked work still falls back to repo/Taiga evidence.
    const completionBasis = Number.isFinite(executionPct) ? 'plan_execution_checklist'
      : Number.isFinite(implementationPct) ? 'verified_plan_vs_repository' : 'taiga_work_items';
    const completionPct = Math.max(0, Math.min(100, Math.round((Number.isFinite(executionPct) ? executionPct : Number.isFinite(implementationPct) ? implementationPct : taigaPct || 0) * 10) / 10));
    const remainingPct = Math.round((100 - completionPct) * 10) / 10;
    const startValue = reportType === 'sprint' ? selectedSprint?.start_date : latestPlan?.input?.start_date || latestPlan?.plan?.sprints?.[0]?.start_date;
    const start = startValue ? new Date(startValue) : null;
    const elapsedPct = start && deadline && deadline > start ? Math.max(0, Math.min(100, Math.round(((now.getTime() - start.getTime()) / (deadline.getTime() - start.getTime())) * 1000) / 10)) : null;
    const predictedConfidence = reportType === 'project' && prediction?.confidence_score != null ? Number(prediction.confidence_score) : NaN;
    const scheduleDelta = elapsedPct == null ? 0 : completionPct - elapsedPct;
    const deadlineConfidence = Math.max(0, Math.min(100, Math.round((Number.isFinite(predictedConfidence) ? predictedConfidence * 100 : 65) + Math.max(-35, Math.min(25, scheduleDelta * 0.6)))));
    const completedForForecast = ['done', 'completed', 'closed'].reduce((sum, status) => sum + (Number(facts.work_items?.by_status?.[status]?.count) || 0), 0);
    const remainingTasks = Math.max(0, (Number(facts.work_items?.total) || 0) - completedForForecast);
    const activeDevelopers = employeeRows.filter((row: any) => row.gitCommits > 0 || row.taigaTasksAssigned > 0).length;
    const taigaEfficiency = employeeWorking.totals.taigaTasksAssigned
      ? Math.round(employeeWorking.totals.taigaTasksCompleted / employeeWorking.totals.taigaTasksAssigned * 1000) / 10 : null;
    const elapsedDays = start && now > start ? Math.max(1, (now.getTime() - start.getTime()) / 86400000) : null;
    const progressPerWeek = elapsedDays && completionPct > 0 ? Math.round(completionPct / elapsedDays * 7 * 100) / 100 : null;
    const completedPerWeek = elapsedDays ? ratePerWeek(completedForForecast, elapsedDays) || 0 : 0;
    const estimatedDaysRemaining = progressPerWeek && progressPerWeek > 0 ? Math.ceil(remainingPct / progressPerWeek * 7)
      : completedPerWeek > 0 && remainingTasks > 0 ? Math.ceil(remainingTasks / completedPerWeek * 7) : null;
    const predictedCompletionDate = estimatedDaysRemaining == null ? null : new Date(now.getTime() + estimatedDaysRemaining * 86400000);
    const daysToDeadline = deadline ? Math.ceil((deadline.getTime() - now.getTime()) / 86400000) : null;
    const deadlineReachable = deadline && predictedCompletionDate ? predictedCompletionDate.getTime() < deadline.getTime() + 86400000 : null;
    const forecastProbability = deadline && estimatedDaysRemaining !== null ? Math.max(0, Math.min(100, Math.round(deadlineConfidence
      + (deadlineReachable === true ? 8 : deadlineReachable === false ? -15 : 0)
      + (taigaEfficiency == null ? 0 : (taigaEfficiency - 60) * 0.15)))) : null;
    const deliveryForecast = {
      targetSubmissionDate: deadline?.toISOString() || null,
      predictedCompletionDate: predictedCompletionDate?.toISOString() || (reportType === 'project' ? prediction?.predicted_date : null) || null,
      deadlineReachable,
      deadlineProbability: forecastProbability,
      remainingWorkPercent: remainingPct,
      remainingTasks,
      activeDevelopers,
      teamProgressPerWeek: progressPerWeek,
      commitsPerDeveloperPerWeek: activeDevelopers ? Math.round((ratePerWeek(commits.length, activityWindow.days) || 0) / activeDevelopers * 100) / 100 : null,
      taigaCompletionEfficiency: taigaEfficiency,
      estimatedDaysRemaining,
      daysToDeadline,
      repositoryCoverage: {
        frontend: repositoryPortfolio.filter((row: any) => row.category === 'frontend').length,
        backend: repositoryPortfolio.filter((row: any) => row.category === 'backend').length,
        other: repositoryPortfolio.filter((row: any) => !['frontend', 'backend'].includes(row.category)).length,
        combinedAnalysis: true,
      },
      calculationBasis: progressPerWeek ? 'observed_project_progress_rate' : completedPerWeek > 0 ? 'taiga_completion_rate' : 'insufficient_velocity_data',
    };
    const metrics = {
      repositories: { total: repositories.length, synced: repositories.filter((repo: any) => repo.syncStatus === 'success').length, items: repositoryPortfolio },
      progress: { complete_percent: completionPct, remaining_percent: remainingPct, basis: completionBasis,
        plan_execution_percent: Number.isFinite(executionPct) ? executionPct : null, taiga_done_percent: Number.isFinite(taigaPct) ? taigaPct : null,
        repository_verified_percent: Number.isFinite(implementationPct) ? implementationPct : null, implementation_analysis: implementation },
      deadline: { date: deadline?.toISOString() || null, elapsed_percent: elapsedPct, meeting_confidence_percent: deadline ? deadlineConfidence : null,
        prediction: prediction ? { summary: prediction.summary, confidence_score: prediction.confidence_score,
          predicted_date: prediction.predicted_date, target_date: prediction.target_date } : null },
      git: { window_days: activityWindow.days, commits: commits.length, commit_rate_per_week: ratePerWeek(commits.length, activityWindow.days),
        pull_requests: pullRequests.length, merged_pull_requests: mergedPrs, merge_rate_percent: pullRequests.length ? Math.round((mergedPrs / pullRequests.length) * 1000) / 10 : 0,
        weekly_activity: weeklyActivity },
    };
    selectedFacts.latest_metrics = metrics;
    selectedFacts.employee_working = employeeWorking;
    selectedFacts.delivery_forecast = deliveryForecast;
    selectedFacts.repository_portfolio = repositoryPortfolio;
    const evidenceInstruction = AI_CONTEXT_CONFIG.reportEvidencePrompt(selectedFacts, implementation);
    let layer1Evidence: any = { evidence_summary: 'Deterministic project facts only.', findings: [], feature_assessment: [], data_quality: { confidence_percent: 50, limitations: [] } };
    let layer1Error: string | null = null;
    try {
      const layer1Response = await this._generate(evidenceInstruction, 'report_evidence', projectId, undefined, undefined, true);
      layer1Evidence = JSON.parse(layer1Response.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    } catch (err: any) {
      layer1Error = err?.message || 'Evidence agent failed.';
      layer1Evidence.data_quality.limitations.push(layer1Error);
      this.log('generateReport.layer1', layer1Error, 'WARN');
    }
    const reportInstruction = AI_CONTEXT_CONFIG.finalReportPrompt(
      scope, String(request.content || 'Comprehensive project report'), selectedFacts, layer1Evidence,
    );
    let result: IAgentResponse;
    let aiStatus = 'unknown';
    let featureAssessment: any[] = [];
    let generatedBy: 'ai' | 'heuristic' = 'ai';
    let generationError: string | null = null;
    try {
      const response = await this._generate(reportInstruction, 'report_json', projectId, undefined, undefined, false);
      const parsed = JSON.parse(response.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
      aiStatus = ['on_track', 'at_risk', 'off_track', 'unknown'].includes(parsed.status) ? parsed.status : 'unknown';
      const featureRows = Array.isArray(parsed.feature_assessment) && parsed.feature_assessment.length
        ? parsed.feature_assessment : Array.isArray(layer1Evidence.feature_assessment) ? layer1Evidence.feature_assessment : [];
      const findingRows = Array.isArray(parsed.findings) && parsed.findings.length
        ? parsed.findings : Array.isArray(layer1Evidence.findings) ? layer1Evidence.findings : [];
      featureAssessment = featureRows.map((item: any) => ({
        feature: String(item.feature || ''),
        status: ['implemented', 'partial', 'not_implemented', 'unknown'].includes(item.status) ? item.status : 'unknown',
        evidence: Array.isArray(item.evidence) ? item.evidence.map(String) : [],
      }));
      result = {
        summary: String(parsed.executive_summary || ''),
        insights: findingRows.map((item: any) => ({
          title: String(item.title || ''), description: String(item.detail || ''),
          severity: ['low', 'medium', 'high'].includes(item.severity) ? item.severity : 'medium',
          evidence: Array.isArray(item.evidence) ? item.evidence.map(String) : [],
        })),
        recommendations: (Array.isArray(parsed.recommendations) ? parsed.recommendations : []).map((item: any) => ({
          action: String(item.action || ''), priority: ['low', 'medium', 'high'].includes(item.priority) ? item.priority : 'medium',
          owner: item.owner ? String(item.owner) : undefined, due_date: item.due_date ? String(item.due_date) : undefined,
          expected_impact: item.expected_impact ? String(item.expected_impact) : undefined,
        })),
        confidence: Math.max(0, Math.min(1, Number(parsed.confidence_percent) / 100 || 0)), generated_at: new Date(),
      };
    } catch (err: any) {
      generatedBy = 'heuristic';
      generationError = err?.message || 'AI report generation failed.';
      result = {
        summary: this._deterministicProjectContext(selectedFacts),
        insights: [],
        recommendations: [],
        confidence: 1,
        generated_at: new Date(),
      };
      this.log('generateReport', `AI unavailable; saved factual report (${generationError}).`, 'WARN');
    }

    const visuals = [
      { id: 'work_completion', type: 'pie', title: 'Work completion', labels: ['Complete', 'Remaining'], datasets: [{ label: 'Percent', data: [completionPct, remainingPct] }] },
      { id: 'plan_vs_actual', type: 'bar', title: 'Completion by evidence source', labels: ['Plan checklist', 'Taiga work', 'Repository verified'], datasets: [{ label: 'Complete %', data: [metrics.progress.plan_execution_percent, metrics.progress.taiga_done_percent, metrics.progress.repository_verified_percent] }] },
      { id: 'git_activity', type: 'line', title: 'Weekly Git activity', labels: weeklyActivity.map(row => row.week), datasets: [
        { label: 'Commits', data: weeklyActivity.map(row => row.commits) }, { label: 'Pull requests', data: weeklyActivity.map(row => row.pull_requests) },
        { label: 'Merged PRs', data: weeklyActivity.map(row => row.merged_pull_requests) },
      ] },
      { id: 'pull_request_merge', type: 'pie', title: 'Pull request merge rate', labels: ['Merged', 'Not merged'], datasets: [{ label: 'Pull requests', data: [mergedPrs, pullRequests.length - mergedPrs] }] },
      { id: 'code_changes', type: 'bar', title: 'Weekly code changes', labels: weeklyActivity.map(row => row.week), datasets: [
        { label: 'Lines added', data: weeklyActivity.map(row => row.additions) }, { label: 'Lines deleted', data: weeklyActivity.map(row => row.deletions) },
      ] },
      { id: 'taiga_work_status', type: 'pie', title: 'Taiga work status', labels: Object.keys(facts.work_items?.by_status || {}),
        datasets: [{ label: 'Work items', data: Object.values(facts.work_items?.by_status || {}).map((row: any) => row.count) }] },
    ];
    const byStatus = facts.work_items?.by_status || {};
    const statusCount = (names: string[]) => names.reduce((sum, name) => sum + (Number(byStatus[name]?.count) || 0), 0);
    const totalTasks = Number(facts.work_items?.total) || 0;
    const completedTasks = statusCount(['done', 'completed', 'closed']);
    const currentSprint = facts.sprints?.current || null;
    const analytics = reportType === 'sprint' ? [] : facts.base?.analytics?.metrics || [];
    const healthRows = analytics.filter((row: any) => row.metric_type === 'health' || row.metric_type === 'health_score');
    const velocityRows = analytics.filter((row: any) => row.metric_type === 'velocity');
    const currentHealth = reportType === 'sprint' ? NaN : Number(facts.base?.analytics?.health_score);
    const previousHealth = healthRows.length > 1 ? Number(healthRows[healthRows.length - 2].value) : null;
    const currentVelocity = Number(reportType === 'sprint' ? currentSprint?.completed_points : facts.base?.analytics?.velocity ?? currentSprint?.completed_points);
    const previousVelocity = velocityRows.length > 1 ? Number(velocityRows[velocityRows.length - 2].value) : null;
    const trend = (current: number, previous: number | null) => previous == null || !Number.isFinite(current) ? 'unknown' : current > previous ? 'improving' : current < previous ? 'declining' : 'stable';
    const riskRows = (reportType === 'sprint' ? [] : facts.base?.risks?.predictions || []).map((risk: any) => ({
      title: String(risk.summary || risk.kind || 'Project risk'), severity: String(risk.risk_level || 'medium').toLowerCase(),
      probability: Number(risk.confidence_score) || 0, impact: String(risk.summary || ''), status: 'open', recommendation: '',
    }));
    // Task assessment rows come from stored data, not from the AI, so every generation lists the same tasks:
    // whole-project report = every planned task of the accepted plan (Taiga tasks when there is no plan);
    // sprint report = the planned tasks of the matching plan sprint plus every other Taiga task in that sprint.
    // Plan tasks are matched only to Taiga tasks of the same sprint.
    // Progress per task = plan checklist ticked 35% + Taiga tasks closed 35% + repository code evidence 30%.
    let planSprintItems: any[] = [];
    let planTaskItems: any[] = [];
    try {
      const acceptedPlans: any[] = await this._planModel.findAllByAny({ project_id: projectId, status: 'accepted', is_deleted: false });
      const accepted = acceptedPlans.sort((a, b) => new Date(b.accepted_at || 0).getTime() - new Date(a.accepted_at || 0).getTime())[0];
      if (accepted) {
        const items: any[] = await this._planExecModel.findAllByAny({ plan_id: String(accepted._id), is_deleted: false });
        planSprintItems = items.filter(item => item.kind === 'sprint').sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
        const sprintOrder = new Map(planSprintItems.map((item, index) => [item.ref_key, index]));
        planTaskItems = items.filter(item => item.kind === 'task')
          .sort((a, b) => (sprintOrder.get(a.parent_key) ?? 0) - (sprintOrder.get(b.parent_key) ?? 0) || (a.sequence || 0) - (b.sequence || 0));
      }
    } catch (err: any) { this.log('generateReport.planTasks', err?.message || err, 'WARN'); }
    if (reportType === 'sprint') {
      const planSprint = planSprintItems.find(item => sprintsMatch(item, selectedSprint));
      planTaskItems = planSprint ? planTaskItems.filter(item => item.parent_key === planSprint.ref_key) : [];
    }
    // Per-task code evidence: plan-vs-repository analysis (ids "<sprint>:<task>"), cited quotes verified against source.
    let taskEvidence: any = implementation;
    if (!taskEvidence && planTaskItems.length && scope.includes('repository')) {
      try { taskEvidence = await this.analyzeImplementation(projectId); } catch { taskEvidence = null; }
    }
    const evidenceByKey = new Map<string, any>((taskEvidence?.items || []).map((item: any) => {
      const [sprintIndex, taskIndex] = String(item.id || '').split(':');
      return [`sprint-${sprintIndex}-task-${taskIndex}`, item];
    }));
    const codeScore: Record<string, number> = { IMPLEMENTED: 100, PARTIAL: 50 };
    const sprintTitle = new Map(planSprintItems.map(item => [item.ref_key, item.title]));
    const milestoneOf = (task: any) => task?.taiga_milestone_id == null ? '' : String(task.taiga_milestone_id);
    const taigaSprintCandidates: any[] = reportType === 'sprint' ? [selectedSprint] : allReportSprints;
    const taigaSprintFor = new Map<string, any>(planSprintItems.map(item => [item.ref_key, taigaSprintCandidates.find((sprint: any) => sprintsMatch(item, sprint)) || null]));
    const usedTaiga = new Set<any>();
    const planTaskRows = planTaskItems.map(item => {
      const taigaSprint = taigaSprintFor.get(item.parent_key);
      const pool = milestoneOf(taigaSprint) ? taigaTasks.filter((task: any) => milestoneOf(task) === milestoneOf(taigaSprint)) : taigaTasks;
      const matched = pool.filter((task: any) => titlesMatch(task.subject, item.title));
      matched.forEach((task: any) => usedTaiga.add(task));
      return { name: item.title, sprint: sprintTitle.get(item.parent_key) || null, source: 'plan', planDone: item.is_completed === true, matched, code: evidenceByKey.get(item.ref_key) };
    });
    const taigaSprintName = new Map<string, string>(allReportSprints.map((sprint: any) => [milestoneOf(sprint), sprint.name]));
    const taigaRows = reportType === 'sprint' || !planTaskRows.length
      ? taigaTasks.filter((task: any) => !usedTaiga.has(task)).map((task: any) => ({
        name: String(task.subject || 'Untitled task'), sprint: taigaSprintName.get(milestoneOf(task)) || (reportType === 'sprint' ? selectedSprint.name : null),
        source: 'taiga', planDone: false, matched: [task], code: null,
      }))
      : [];
    const taskRows = [...planTaskRows, ...taigaRows];
    const byFeature = taskRows.map((row: any, index: number) => {
      const closed = row.matched.filter((task: any) => task.is_closed).length;
      const signals = {
        plan: row.planDone ? 100 : 0,
        taiga: row.matched.length ? Math.round(closed / row.matched.length * 1000) / 10 : 0,
        repository: codeScore[row.code?.status] ?? 0,
      };
      const result = featureProgress(signals);
      const citations = (row.code?.evidence || []).map((citation: any) => String(citation.evidenceId || '').split(':').slice(2).join(':')).filter(Boolean);
      return {
        featureId: `T${String(index + 1).padStart(3, '0')}`, featureName: row.name, sprintName: row.sprint, source: row.source,
        plannedTasks: row.matched.length, completedTasks: closed,
        progress: result.progress, status: result.status, signals,
        evidence: citations.length ? [...new Set<string>(citations)] : row.code?.explanation ? [String(row.code.explanation)] : [],
      };
    });
    // Departments (repository types + QA/Testing) are taken from the same service the
    // GET /v1/departments endpoint uses, so the saved report and the Departments page agree.
    const departmentWorkforce = reportType === 'project' ? await this._departmentWorkforce(projectId) : null;
    const report = {
      report: {
        schemaVersion: 'project-report.v1',
        title: reportType === 'sprint'
          ? `${facts.base?.project?.name || 'Project'} - ${selectedSprint.name} Report`
          : `${facts.base?.project?.name || 'Project'} - Latest Project Report`,
        project: { id: projectId, name: facts.base?.project?.name || 'Project' },
        type: reportType === 'sprint' ? 'sprint_review' : 'latest_project_review',
        sprint: reportType === 'sprint' ? { id: requestedSprintId, name: selectedSprint.name, milestoneId: selectedSprint.taiga_milestone_id || null } : null,
        period: reportType === 'sprint'
          ? { type: 'sprint', label: selectedSprint.name, startDate: start?.toISOString() || null, endDate: until.toISOString() }
          : { type: 'latest', label: 'Latest available project data', startDate: start?.toISOString() || null, endDate: now.toISOString() },
        status: 'completed', generatedAt: (result.generated_at || new Date()).toISOString(), generatedBy,
        generationError, evidenceGenerationError: layer1Error, sources: selectedSources, repositoryCount: repositories.length,
      },
      executiveSummary: { summary: result.summary, overallProgress: completionPct, completedTasks, totalTasks, completionRate: totalTasks ? Math.round(completedTasks / totalTasks * 1000) / 10 : 0, remainingProgress: remainingPct },
      healthAndTrend: {
        overallHealth: Number.isFinite(currentHealth) ? currentHealth >= 75 ? 'healthy' : currentHealth >= 50 ? 'attention' : 'critical' : 'unknown',
        healthScore: Number.isFinite(currentHealth) ? currentHealth : null, trend: trend(currentHealth, previousHealth), previousScore: previousHealth,
        currentScore: Number.isFinite(currentHealth) ? currentHealth : null,
        factors: analytics.slice(0, 8).map((row: any) => ({ name: row.metric_type, score: Number(row.value) || 0,
          status: Number(row.value) >= 75 ? 'good' : Number(row.value) >= 50 ? 'attention' : 'critical' })),
      },
      velocityAndSprint: { sprintName: currentSprint?.name || null, plannedPoints: Number(currentSprint?.planned_points) || 0,
        completedPoints: Number(currentSprint?.completed_points) || 0, velocity: Number.isFinite(currentVelocity) ? currentVelocity : null,
        completionRate: currentSprint?.planned_points ? Math.round(Number(currentSprint.completed_points || 0) / Number(currentSprint.planned_points) * 1000) / 10 : 0,
        previousVelocity, velocityTrend: trend(currentVelocity, previousVelocity) },
      risksAndPredictions: { overallRisk: reportType === 'sprint' ? 'unknown' : String(facts.base?.risks?.risk_level || 'unknown').toLowerCase(),
        deadlineRisk: deliveryForecast.deadlineProbability == null ? 'unknown' : deliveryForecast.deadlineProbability >= 75 ? 'low' : deliveryForecast.deadlineProbability >= 50 ? 'medium' : 'high',
        risks: riskRows, predictions: { deadlineProbability: deliveryForecast.deadlineProbability == null ? null : deliveryForecast.deadlineProbability / 100,
          expectedCompletionDate: deliveryForecast.predictedCompletionDate,
          delayProbability: deliveryForecast.deadlineProbability == null ? null : 1 - deliveryForecast.deadlineProbability / 100 } },
      deliveryForecast,
      workBreakdown: { totalTasks, completed: completedTasks, inProgress: statusCount(['in_progress', 'active']), blocked: statusCount(['blocked']),
        notStarted: statusCount(['todo', 'new', 'planned']), byFeature,
        featureProgressBasis: 'Rows are the planned sprint tasks (whole report: all planned tasks; sprint report: the planned tasks of this sprint plus its other Taiga tasks, marked Taiga only). Taiga tasks are matched to plan tasks within the same sprint. Progress = plan checklist ticked (35%) + matching Taiga tasks closed (35%) + repository code evidence (30%; implemented = full, partial = half) = 100%. A signal with no data counts as 0%.',
        byDepartment: employeeWorking.departments.map((department: any) => ({
          department: department.department, totalTasks: department.taigaTasksAssigned, completedTasks: department.taigaTasksCompleted,
          progress: department.taigaTasksAssigned ? Math.round(department.taigaTasksCompleted / department.taigaTasksAssigned * 1000) / 10 : 0,
        })) },
      employeeWorking,
      departmentWorkforce,
      taigaSprintSummary: buildTaigaSprintSummary(taigaTasks, reportSprints),
      planAndActual: { plan: reportType === 'sprint' ? null : facts.plan, checkedExecution: reportType === 'sprint' ? null : facts.plan_execution, implementationAnalysis: implementation,
        completePercent: completionPct, remainingPercent: remainingPct, calculationBasis: completionBasis },
      repositoryActivity: metrics.repositories,
      gitActivity: metrics.git,
      aiNarrative: { summary: result.summary,
        whatWentWell: result.insights.filter(item => item.severity === 'low').map(item => item.description),
        whatNeedsAttention: result.insights.filter(item => item.severity !== 'low').map(item => item.description),
        recommendations: result.recommendations },
      visualData: visuals,
    };

    try {
      await this._insightModel.addNewRecord({
        type: 'report',
        project_id: projectId,
        provider: 'google',
        model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
        prompt: reportInstruction,
        response: JSON.stringify(report),
        context_meta: { risk_level: facts.base?.risks?.risk_level, report_type: reportType, sprint_id: requestedSprintId || null, generated_by: generatedBy, scope },
        cached: true,
      });
    } catch (err: any) { this.log('generateReport.cache', err?.stack || err, 'ERROR'); }
    return report;
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-30
   * @Function: _departmentWorkforce
   * @Description: Departments (repository types plus QA/Testing) for the report's
   *               project. Reuses OrganizationService.listDepartments so the saved
   *               report carries exactly what GET /v1/departments returns.
   */
  private async _departmentWorkforce(projectId: string): Promise<any | null> {
    try {
      const db = global.db.connection.db!;
      const projectKeys: any[] = [{ project_id: projectId }];
      if (mongoose.Types.ObjectId.isValid(projectId)) projectKeys.push({ _id: new mongoose.Types.ObjectId(projectId) });
      const project = await db.collection('projects').findOne({ $or: projectKeys }, { projection: { organization_id: 1 } });
      const organizationId = String(project?.organization_id || '');
      const result: any = await new OrganizationService().listDepartments(organizationId || undefined, [projectId]);
      if (!result?.status || !result.data_sets) return null;
      const source: any = result.data_sets;
      return {
        organization_id: source.organization_id || null,
        active_window_days: source.active_window_days ?? null,
        source: source.source || 'commits_by_repository_category',
        total_employees: Number(source.total_employees) || 0,
        unlinked_repository_count: Number(source.unlinked_repository_count) || 0,
        departments: (source.rows || []).map((row: any) => ({
          id: String(row.id || ''),
          name: String(row.name || 'Unassigned'),
          color: String(row.color || '#4f46e5'),
          description: String(row.description || ''),
          member_count: Number(row.member_count) || 0,
          active_count: Number(row.active_count) || 0,
          commit_count: Number(row.commit_count) || 0,
          additions: Number(row.additions) || 0,
          deletions: Number(row.deletions) || 0,
          teams: (row.teams || []).map((team: any) => String(team)),
          repositories: (row.repositories || []).slice(0, 6).map((repository: any) => ({
            id: String(repository.id || ''), name: repository.name ? String(repository.name) : null,
            linked: Boolean(repository.linked), project_name: repository.project_name ? String(repository.project_name) : null,
          })),
          tasks: row.tasks ? { created: Number(row.tasks.created) || 0, closed: Number(row.tasks.closed) || 0 } : null,
          issue_count: Number(row.issue_count) || 0,
          open_issue_count: Number(row.open_issue_count) || 0,
          closed_issue_count: Number(row.closed_issue_count) || 0,
          efficiency: row.efficiency ? { method: row.efficiency.method, reported: Number(row.efficiency.reported) || 0,
            closed: Number(row.efficiency.closed) || 0, percent: row.efficiency.percent == null ? null : Number(row.efficiency.percent) } : null,
          employees: (row.employees || []).slice(0, 8).map((employee: any) => ({
            id: String(employee.id || ''), name: String(employee.name || employee.email || 'Unknown'),
            login: employee.login ? String(employee.login) : null, role: employee.role ? String(employee.role) : null,
            commits: Number(employee.commits) || 0, additions: Number(employee.additions) || 0, deletions: Number(employee.deletions) || 0,
            active: Boolean(employee.active), last_commit_at: employee.last_commit_at || null,
            tasks_created: Number(employee.tasks?.created) || 0, tasks_closed: Number(employee.tasks?.closed) || 0,
            reporting_role: employee.reporting_role || null, efficiency_eligible: employee.efficiency_eligible ?? null,
            issues: employee.issues ? { reported: Number(employee.issues.reported) || 0, open: Number(employee.issues.open) || 0,
              closed: Number(employee.issues.closed) || 0, last_reported_at: employee.issues.last_reported_at || null } : null,
          })),
        })),
      };
    } catch (err: any) {
      this.log('_departmentWorkforce', err?.stack || err, 'ERROR');
      return null;
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: getAvailableModels
   */
  public async getAvailableModels(provider?: string): Promise<string[]> {
    this.initLog();
    const type = ProviderFactory.getProvider(provider).type;
    this.log('getAvailableModels', ['Fetching available models for active provider : ', type]);
    try {
      return await ProviderFactory.getProvider(type).getModels();
    } catch (err: any) {
      this.log(
        'getAvailableModels',
        `Live model list failed for "${type}" (${err?.message || err}).`,
        'WARN'
      );
      throw err;
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: getAvailableProviders
   */
  public async getAvailableProviders(): Promise<any[]> {
    this.initLog();
    this.log('getAvailableProviders', 'Fetching provider tabs with token usage');
    try {
      const agg = await this._tokenUsageAgg();
      const active = ProviderFactory.getActiveType();
      const usageWindowMs = ProviderFactory.getUsageWindowMs();
      return await Promise.all(ProviderFactory.getProviderConfigs().map(async (cfg) => ({
        ...cfg,
        ...await ProviderFactory.health(cfg.type),
        is_active: cfg.type === active,
        usage_window_ms: usageWindowMs,
        token_usage_5h: agg[cfg.type] || {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          requests: 0,
          window_ms: usageWindowMs,
          window_start: new Date(Date.now() - usageWindowMs),
        },
        last_usage: ProviderFactory.getLastUsage(cfg.type),
      })));
    } catch (err: any) {
      this.log('getAvailableProviders', err?.stack || err, 'ERROR');
      throw err;
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: switchActiveProvider
   */
  public async switchActiveProvider(type: string, model?: string): Promise<IServiceResult> {
    this.initLog();
    this.log('switchActiveProvider', ['Request : ', type]);
    try {
      const checked = await ProviderFactory.readyProvider(type, model);
      const ok = ProviderFactory.setActiveProvider(checked.type, checked.model);
      if (!ok) {
        return global.Helpers.makeBadServiceStatus(`Unknown provider "${type}". Supported: gemini, groq, deepseek, ollama, nvidia.`);
      }
      const provider = ProviderFactory.getProvider();
      this.log('switchActiveProvider', `Active AI provider switched to ${provider.name}`);
      return global.Helpers.makeSuccessServiceStatus(`AI provider switched to ${provider.name}.`, {
        provider: provider.type,
        name: provider.name,
        model: provider.model,
        usage_window_ms: ProviderFactory.getUsageWindowMs(),
        token_usage_5h: (await this._tokenUsageAgg())[provider.type] || null,
      });
    } catch (err: any) {
      this.log('switchActiveProvider', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus(err?.message || 'AI provider connection failed.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: getTokenUsage
   */
  public async getTokenUsage(payload: { provider?: string; project_id?: string; window_ms?: number } = {}): Promise<IServiceResult> {
    this.initLog();
    this.log('getTokenUsage', ['Request : ', payload]);
    try {
      const usageWindowMs = payload.window_ms || ProviderFactory.getUsageWindowMs();
      const agg = await this._tokenUsageAgg(usageWindowMs, payload.project_id);

      if (payload.provider) {
        const single = agg[payload.provider] || {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          requests: 0,
          window_ms: usageWindowMs,
          window_start: new Date(Date.now() - usageWindowMs),
        };
        return global.Helpers.makeSuccessServiceStatus('Token usage fetched successfully.', single);
      }

      const tabs = ProviderFactory.getProviderConfigs().map((cfg) => ({
        provider: cfg.type,
        name: cfg.name,
        model: cfg.model,
        is_active: cfg.is_active,
        configured: cfg.configured,
        token_usage_5h: agg[cfg.type] || {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
          requests: 0,
        },
      }));

      const total = Object.values(agg).reduce(
        (sum: any, t: any) => ({
          prompt_tokens: sum.prompt_tokens + t.prompt_tokens,
          completion_tokens: sum.completion_tokens + t.completion_tokens,
          total_tokens: sum.total_tokens + t.total_tokens,
          requests: sum.requests + t.requests,
        }),
        { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, requests: 0 },
      );

      return global.Helpers.makeSuccessServiceStatus('Token usage fetched successfully.', {
        usage_window_ms: usageWindowMs,
        window_hours: Math.round((usageWindowMs / 3600000) * 10) / 10,
        tabs,
        total,
      });
    } catch (err: any) {
      this.log('getTokenUsage', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: getProjectSessions
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
   * @Date: 2026-09-27
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
   * @Date: 2026-09-27
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
   * @Date: 2026-09-27
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
   * @Date: 2026-09-27
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

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: buildPlanningPrompt
   */
  private buildPlanningPrompt(payload: IPlanGenerate): string {
    const teamBreakdown = payload.team_breakdown;
    const calendar = planningCalendar(payload);
    const teamSize = calendar.teamSize;
    const features = payload.features || [];
    const featureCount = features.length || 10;
    const optimalDuration = Math.round(calendar.weeks * 100) / 100;
    const sprintWeeks = calendar.sprintWeeks;
    const sprintCount = calendar.count;

    const lines: string[] = [
      "You are an expert agile delivery planner. Create a detailed sprint execution plan.",
      "",
      "## PROJECT INFORMATION",
      `Project: ${payload.project_name || "Untitled Project"}`,
      `Description: ${payload.description.trim()}`,
      "",
      "## TEAM CONFIGURATION",
      `Total Team Size: ${teamSize} people`,
    ];

    if (teamBreakdown) {
      const depts: string[] = [];
      if (teamBreakdown.ui) depts.push(`UI: ${teamBreakdown.ui}`);
      if (teamBreakdown.backend) depts.push(`Backend: ${teamBreakdown.backend}`);
      if (teamBreakdown.app) depts.push(`App: ${teamBreakdown.app}`);
      if (teamBreakdown.others) depts.push(`Others: ${teamBreakdown.others}`);
      lines.push(`Team Breakdown: ${depts.join(", ")}`);
    }

    lines.push(
      `Duration: ${optimalDuration} weeks`,
      `Sprint Length: ${sprintWeeks} weeks`,
      `Number of Sprints: ${sprintCount}`,
    );

    if (payload.start_date) lines.push(`Start Date: ${payload.start_date}`);
    if (payload.deadline) lines.push(`Deadline: ${payload.deadline} (MUST complete by this date)`);
    if (payload.rules) lines.push("", "## RULES (MUST FOLLOW STRICTLY)", payload.rules);
    if (payload.constraints && payload.constraints.length > 0) {
      lines.push("", "## CONSTRAINTS (MANDATORY)");
      payload.constraints.forEach((c, i) => lines.push(`${i + 1}. ${c}`));
    }
    if (features.length > 0) {
      lines.push("", "## FEATURES TO IMPLEMENT (ALL MUST BE INCLUDED IN PLAN)");
      features.forEach((f, i) => lines.push(`${i + 1}. ${f}`));
      lines.push("", `Total Features: ${features.length} - EVERY feature MUST be assigned to a sprint.`);
    }
    lines.push(
      "",
      "## PLANNING INSTRUCTIONS",
      `1. Divide ALL ${features.length || featureCount} features across exactly ${sprintCount} sprints.`,
      `Calendar: ${new Date(calendar.start).toISOString().slice(0, 10)} to ${new Date(calendar.end).toISOString().slice(0, 10)} inclusive. Shorten only the final sprint when necessary.`,
      "Capacity: at most 6 productive hours per weekday per person. Respect department staffing; flag infeasible scope instead of assuming extra staff.",
      "Keep prerequisites before dependent work. Include estimates; list uncertain estimates and uncovered features as risks.",
      "2. Group related features together.",
      "3. Each sprint should have 3-8 tasks.",
      "4. Assign tasks to appropriate team departments.",
      "5. Create milestones and list risks.",
      "",
      "Respond with a detailed plan.",
    );
    return lines.join("\n");
  }
  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: buildPurificationPrompt
   */
  private buildPurificationPrompt(planningOutput: string, payload: IPlanGenerate): string {
    const calendar = planningCalendar(payload);
    const features = payload.features || [];
    const featureList = features.length > 0 ? features.join(", ") : "No specific features provided";
    const teamBreakdown = payload.team_breakdown;
    const teamSize = payload.team_size || (teamBreakdown
      ? (teamBreakdown.ui || 0) + (teamBreakdown.backend || 0) + (teamBreakdown.app || 0) + (teamBreakdown.others || 0)
      : 4);
    return `You are a JSON formatting expert. Convert the following plan into a valid JSON object.

## ORIGINAL PLAN OUTPUT
${planningOutput}

## PROJECT CONTEXT
- Features: ${featureList}
- Team Size: ${teamSize}
- Duration: ${calendar.weeks} weeks
- Sprint Length: ${calendar.sprintWeeks} weeks
- Required sprint count: ${calendar.count}
- Dates are assigned by the server. Do not invent dates.
${payload.deadline ? `- Deadline: ${payload.deadline}` : ""}
${payload.rules ? `- Rules: ${payload.rules}` : ""}

## REQUIRED JSON STRUCTURE
Convert the plan above into this exact JSON structure:

{
  "plan_name": "string",
  "summary": "string",
  "sprints": [
    {
      "name": "Sprint 1",
      "goal": "sprint goal",
      "planned_points": 40,
      "tasks": [
        {
          "title": "string",
          "description": "string",
          "type": "story|task|bug",
          "priority": "low|medium|high|critical",
          "assignee_role": "frontend|backend|fullstack|qa|devops|design",
          "estimate_hours": 8,
          "story_points": 5
        }
      ]
    }
  ],
  "milestones": [{ "name": "string", "description": "string" }],
  "deadlines": [{ "label": "string", "date": "YYYY-MM-DD" }],
  "risks": [{ "description": "string", "severity": "low|medium|high", "mitigation": "string" }],
  "assumptions": ["string"]
}

## RULES
1. Include ALL features from the project context in the sprints
2. Each feature should be a task in the appropriate sprint
3. Assign tasks to appropriate departments (UI, Backend, App, Others)
4. Ensure the JSON is valid and complete
5. Respond with ONLY the JSON object (no markdown fences)

Respond with ONLY the JSON object.`;
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: buildDynamicFallbackPlan
   */
  private buildDynamicFallbackPlan(payload: IPlanGenerate): ISprintPlan {
    const features = payload.features?.length ? payload.features : [
      'Confirm requirements and acceptance criteria', 'Design architecture and implementation approach',
      'Implement the agreed project scope', 'Test, review, and prepare release',
    ];
    const teamBreakdown = payload.team_breakdown;
    const topic = String(payload.project_name || payload.description || "Project").trim().slice(0, 80);
    const calendar = planningCalendar(payload);
    const teamSize = calendar.teamSize;
    const durationWeeks = Math.round(calendar.weeks * 100) / 100;
    const sprintWeeks = calendar.sprintWeeks;
    const sprintCount = calendar.count;
    const deptRoles: Record<string, string[]> = {
      ui: ["frontend", "design", "fullstack"],
      backend: ["backend", "fullstack", "devops"],
      app: ["frontend", "fullstack", "qa"],
      others: ["qa", "devops", "fullstack"],
    };
    const priorityGroups: Record<string, string[]> = { "P0": [], "P1": [], "P2": [], "P3": [], "P4": [], "P5": [], "other": [] };
    features.forEach((feature) => {
      const priority = feature.match(/^P[0-5]/)?.[0] || "other";
      priorityGroups[priority] = priorityGroups[priority] || [];
      priorityGroups[priority].push(feature);
    });
    const orderedFeatures = [...priorityGroups["P0"], ...priorityGroups["P1"], ...priorityGroups["P2"], ...priorityGroups["P3"], ...priorityGroups["P4"], ...priorityGroups["P5"], ...priorityGroups["other"]];
    const sprints = Array.from({ length: sprintCount }, (_, i) => {
      const startIdx = Math.floor((i / sprintCount) * orderedFeatures.length);
      const endIdx = Math.floor(((i + 1) / sprintCount) * orderedFeatures.length);
      const sprintFeatures = orderedFeatures.slice(startIdx, endIdx);
      const tasks = sprintFeatures.map((feature, t) => {
        let assigneeRole = "fullstack";
        if (teamBreakdown) {
          const fl = feature.toLowerCase();
          if (fl.includes("ui") || fl.includes("design") || fl.includes("frontend") || fl.includes("banner") || fl.includes("cms") || fl.includes("seo")) {
            assigneeRole = teamBreakdown.ui ? deptRoles.ui[t % deptRoles.ui.length] : "fullstack";
          } else if (fl.includes("api") || fl.includes("backend") || fl.includes("database") || fl.includes("auth") || fl.includes("payment") || fl.includes("order")) {
            assigneeRole = teamBreakdown.backend ? deptRoles.backend[t % deptRoles.backend.length] : "fullstack";
          } else if (fl.includes("app") || fl.includes("mobile") || fl.includes("deep link") || fl.includes("push")) {
            assigneeRole = teamBreakdown.app ? deptRoles.app[t % deptRoles.app.length] : "fullstack";
          } else if (fl.includes("test") || fl.includes("qa") || fl.includes("report") || fl.includes("lead") || fl.includes("expense")) {
            assigneeRole = teamBreakdown.others ? deptRoles.others[t % deptRoles.others.length] : "qa";
          } else {
            const depts = ["ui", "backend", "app", "others"].filter(d => teamBreakdown[d as keyof ITeamBreakdown]);
            if (depts.length > 0) {
              const dept = depts[t % depts.length];
              assigneeRole = deptRoles[dept][t % deptRoles[dept].length];
            }
          }
        }
        return {
          title: feature.length > 80 ? feature.substring(0, 77) + "..." : feature,
          description: `Implement: ${feature}`,
          type: "task",
          priority: i === sprintCount - 1 ? "high" : i === 0 ? "high" : "medium",
          assignee_role: assigneeRole,
          estimate_hours: 8,
          story_points: 5,
        };
      });
      return {
        index: i + 1,
        name: `Sprint ${i + 1}`,
        goal: `Implement ${sprintFeatures.length} features for ${topic}`,
        planned_points: teamSize * 8,
        tasks,
      };
    });
    const assumptions: string[] = [
      `Team of ${teamSize} available full-time.`,
      `${sprintWeeks}-week sprints.`,
    ];
    if (teamBreakdown) {
      const depts: string[] = [];
      if (teamBreakdown.ui) depts.push(`UI: ${teamBreakdown.ui}`);
      if (teamBreakdown.backend) depts.push(`Backend: ${teamBreakdown.backend}`);
      if (teamBreakdown.app) depts.push(`App: ${teamBreakdown.app}`);
      if (teamBreakdown.others) depts.push(`Others: ${teamBreakdown.others}`);
      assumptions.push(`Team breakdown by department: ${depts.join(", ")}.`);
    }
    if (payload.rules) assumptions.push(`Rules followed: ${payload.rules}`);
    if (payload.deadline) assumptions.push(`Project deadline: ${payload.deadline}.`);
    assumptions.push(`Total features to implement: ${features.length}.`);
    return {
      plan_name: `Sprint Plan - ${topic}`,
      summary: `Dynamic ${sprintCount}-sprint plan (${durationWeeks} weeks, ${sprintWeeks}-week sprints) covering ${features.length} features.`,
      total_duration_weeks: durationWeeks,
      sprints,
      milestones: [
        { name: "Foundation Complete", description: "Core architecture and setup done" },
        { name: "Feature Development", description: "Main features implemented" },
        { name: "Testing & QA", description: "Quality assurance complete" },
        ...(payload.deadline ? [{ name: "Project Deadline", description: "Final delivery", date: payload.deadline }] : []),
        { name: "Project Release", description: "Production deployment" },
      ],
      risks: [
        { description: "Scope creep across sprints", severity: "medium", mitigation: "Freeze sprint scope at planning." },
        { description: "Single points of failure in staffing", severity: "medium", mitigation: "Pair reviewers on critical modules." },
        { description: `Large feature count (${features.length}) may cause delays`, severity: "high", mitigation: "Prioritize and defer lower-priority items if needed." },
      ],
      assumptions,
      generated_by: "dynamic-fallback",
    };
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: buildPlanPrompt
   */
  private buildPlanPrompt(payload: IPlanGenerate): string {
    // Calculate team size from breakdown if provided
    const teamBreakdown = payload.team_breakdown;
    const calculatedTeamSize = teamBreakdown
      ? (teamBreakdown.ui || 0) + (teamBreakdown.backend || 0) + (teamBreakdown.app || 0) + (teamBreakdown.others || 0)
      : 0;
    const teamSize = payload.team_size || calculatedTeamSize || 4;

    const durationWeeks = payload.duration_weeks || 8;
    const sprintWeeks = payload.sprint_length_weeks || 2;
    const sprintCount = Math.max(1, Math.round(durationWeeks / sprintWeeks));

    const lines: string[] = [
      'You are an expert agile delivery planner. Create a realistic sprint execution plan for the project described below.',
      '',
      '## Project Input',
      `Description: ${payload.description.trim()}`,
    ];
    if (payload.project_name) lines.push(`Project name: ${payload.project_name}`);

    // Team information
    if (teamBreakdown) {
      const depts: string[] = [];
      if (teamBreakdown.ui) depts.push(`UI: ${teamBreakdown.ui}`);
      if (teamBreakdown.backend) depts.push(`Backend: ${teamBreakdown.backend}`);
      if (teamBreakdown.app) depts.push(`App: ${teamBreakdown.app}`);
      if (teamBreakdown.others) depts.push(`Others: ${teamBreakdown.others}`);
      lines.push(`Team breakdown: ${depts.join(', ')} (Total: ${teamSize})`);
    } else if (payload.team_size) {
      lines.push(`Team size: ${payload.team_size} people`);
    } else {
      lines.push('Team size: Not specified - you decide the optimal team size based on project complexity');
    }

    if (payload.start_date) lines.push(`Planned start date: ${payload.start_date} (YYYY-MM-DD)`);
    if (payload.deadline) lines.push(`Project deadline: ${payload.deadline} (YYYY-MM-DD) - the plan MUST complete by this date`);
    if (!payload.duration_weeks) {
      lines.push('Duration: Not specified - you decide the optimal duration based on project complexity and scope');
    } else {
      lines.push(`Total duration: ${durationWeeks} weeks`);
    }
    if (!payload.sprint_length_weeks) {
      lines.push('Sprint length: Not specified - you decide the optimal sprint length (1-4 weeks) based on project needs');
    } else {
      lines.push(`Sprint length: ${sprintWeeks} weeks (exactly ${sprintCount} sprints)`);
    }
    if (payload.rules) {
      lines.push(`Rules to follow: ${payload.rules}`);
    }
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
      '- Dates are computed by the system - do NOT include start_date/end_date/deadline fields in the JSON.',
      '- Keep every string value plain text (no newlines inside strings).',
    );
    if (teamBreakdown) {
      lines.push(`- Distribute tasks across departments: UI (${teamBreakdown.ui || 0}), Backend (${teamBreakdown.backend || 0}), App (${teamBreakdown.app || 0}), Others (${teamBreakdown.others || 0}). Assign tasks to the appropriate department based on the task type.`);
    }
    if (!payload.team_size && !teamBreakdown) {
      lines.push('- Team size was not specified - assume a reasonable team size based on project complexity and mention it in assumptions.');
    }
    if (payload.rules) {
      lines.push('- Follow the provided rules strictly when making all planning decisions.');
    }
    if (payload.deadline) {
      lines.push(`- The plan MUST fit within the deadline (${payload.deadline}). Work backwards from this date to determine sprint count and duration.`);
    }
    return lines.join('\n');
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: suggestTeamWithAi
   */
  private async suggestTeamWithAi(payload: IPlanGenerate): Promise<ITeamSuggestion[]> {
    const featureCount = payload.features?.length || 0;
    const featureSummary = featureCount > 0
      ? `Total features to implement: ${featureCount}. ${payload.features?.slice(0, 5).join('; ')}${featureCount > 5 ? '...' : ''}`
      : 'No explicit feature list provided.';

    const description = payload.description?.trim() || 'No description provided.';
    const projectName = payload.project_name || 'Untitled Project';
    const hasDeadline = !!payload.deadline;
    const hasDuration = !!payload.duration_weeks;
    const hasTeamSize = !!payload.team_size;
    const hasTeamBreakdown = !!payload.team_breakdown;

    // Build task scope summary if provided
    let taskScopeSummary = '';
    if (payload.task_scope && payload.task_scope.length > 0) {
      const totalEstimated = payload.task_scope.reduce((sum: number, t: IPlanTaskScope) => sum + (t.estimate_hours || 0), 0);
      const totalActual = payload.task_scope.reduce((sum: number, t: IPlanTaskScope) => sum + (t.actual_hours || 0), 0);
      const uniqueAssignees = [...new Set(payload.task_scope.map((t: IPlanTaskScope) => t.assignee))];
      const taskLines = payload.task_scope
        .slice(0, 20)
        .map((t: IPlanTaskScope) => `- ${t.task}: ${t.assignee} (${t.estimate_hours}h est, ${t.actual_hours}h actual)${t.category ? ` [${t.category}]` : ''}`)
        .join('\n');
      taskScopeSummary = `\n\n## TASK-LEVEL SCOPE (provided by user)\nTotal tasks: ${payload.task_scope.length}\nTotal estimated hours: ${totalEstimated}\nTotal actual/committed hours: ${totalActual}\nUnique assignees: ${uniqueAssignees.join(', ')}\n\nTask breakdown:\n${taskLines}${payload.task_scope.length > 20 ? '\n... (truncated)' : ''}`;
    }

    const prompt = `
You are an experienced technical lead and staffing planner. Recommend a team composition for the following project.

PROJECT: ${projectName}
DESCRIPTION: ${description}
${featureSummary}${taskScopeSummary}

DEADLINE: ${hasDeadline ? payload.deadline : 'Not specified'}
DURATION (weeks): ${hasDuration ? payload.duration_weeks : 'Not specified'}
EXISTING TEAM SIZE: ${hasTeamSize ? payload.team_size : 'Not specified'}
EXISTING TEAM BREAKDOWN: ${hasTeamBreakdown ? JSON.stringify(payload.team_breakdown) : 'Not specified'}

Please propose an ideal team composition. Return ONLY a JSON array with this shape:
[
  {
    "suggested_team_size": <number>,
    "breakdown": {
      "ui": <number>,
      "backend": <number>,
      "app": <number>,
      "others": <number>
    },
    "rationale": "short explanation of why this team size and distribution makes sense",
    "role_hints": [
      { "role": "backend", "count": <number> },
      { "role": "frontend", "count": <number> },
      { "role": "app", "count": <number> },
      { "role": "devops", "count": <number> },
      { "role": "qa", "count": <number> }
    ]
  }
]

Consider:
- The number of features and their complexity.
- Any task-level scope/estimates provided (total hours, assignees, categories).
- The described architecture (multi-module backend, catalog, customers, orders, admin, growth features, etc.).
- Any deadline or duration constraints.
- A realistic distribution between backend, frontend/UI, app, and supporting roles (devops/qa/others).
- If the user already provided a team_size or team_breakdown, you may reference it but still return a fresh suggestion.

IMPORTANT: The deadline is ${hasDeadline ? payload.deadline : 'NOT SPECIFIED'}. ${hasDeadline ? 'The plan MUST deliver by this deadline. Adjust team size and sprint distribution accordingly.' : 'You may suggest an optimal timeline.'}

Return ONLY the JSON array. No markdown, no commentary.
`.trim();

    const text = await this._generate(prompt, 'team_suggestion', payload.project_id);
    if (!text) return [];

    try {
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((item: any) => ({
          suggested_team_size: item.suggested_team_size || 0,
          breakdown: {
            ui: item.breakdown?.ui || 0,
            backend: item.breakdown?.backend || 0,
            app: item.breakdown?.app || 0,
            others: item.breakdown?.others || 0,
          },
          rationale: item.rationale || 'AI-generated suggestion',
          role_hints: (item.role_hints || []).map((r: any) => ({
            role: r.role || 'unassigned',
            count: r.count || undefined,
          })),
        }));
      }
    } catch {
      // If parsing fails, fall back to heuristic.
    }

    // Fallback: compute a basic heuristic suggestion if AI fails.
    return this.computeTeamSuggestionsFallback(payload);
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: computeTeamSuggestionsFallback
   */
  private computeTeamSuggestionsFallback(payload: IPlanGenerate): ITeamSuggestion[] {
    const featureCount = payload.features?.length || 0;
    const baseSize = Math.max(1, Math.ceil(featureCount / 3));
    const lower = (payload.description || '').toLowerCase();
    const complexityBoost = (lower.includes('complex') || lower.includes('enterprise') || lower.includes('large'))
      ? 2
      : (lower.includes('medium') ? 1 : 0);
    const suggestedSize = Math.max(1, baseSize + complexityBoost);

    const backend = Math.max(1, Math.floor(suggestedSize * 0.35));
    const frontend = Math.max(1, Math.floor(suggestedSize * 0.25));
    const app = Math.max(1, Math.floor(suggestedSize * 0.15));
    const devops = Math.max(0, Math.min(1, Math.ceil(suggestedSize * 0.1)));
    const qa = Math.max(0, Math.min(1, Math.ceil(suggestedSize * 0.1)));

    return [
      {
        suggested_team_size: suggestedSize,
        breakdown: {
          backend,
          ui: frontend,
          app,
          others: devops + qa,
        },
        rationale: `Fallback estimate: ${featureCount} features, team of ${suggestedSize} recommended based on scope complexity.`,
        role_hints: [
          { role: 'backend', count: backend },
          { role: 'frontend', count: frontend },
          { role: 'app', count: app },
          { role: 'devops', count: devops || undefined },
          { role: 'qa', count: qa || undefined },
        ],
      },
    ];
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
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
      if (!validPlanShape(parsed)) return null;
      return parsed as ISprintPlan;
    } catch {
      return null;
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: normalizePlanDates
   */
  private normalizePlanDates(plan: ISprintPlan, payload: IPlanGenerate): ISprintPlan {
    return schedulePlan(plan, payload);
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: buildFallbackPlan
   */
  private buildFallbackPlan(payload: IPlanGenerate, reason: string): ISprintPlan {
    const DAY = 86400000;
    const sprintWeeks = payload.sprint_length_weeks || 2;
    const topic = String(payload.project_name || payload.description || 'Project').trim().slice(0, 80);

    // Calculate team size from breakdown if provided
    const teamBreakdown = payload.team_breakdown;
    const calculatedTeamSize = teamBreakdown
      ? (teamBreakdown.ui || 0) + (teamBreakdown.backend || 0) + (teamBreakdown.app || 0) + (teamBreakdown.others || 0)
      : 0;
    const teamSize = payload.team_size || calculatedTeamSize || 4;

    // Calculate duration from deadline if duration_weeks not provided
    let durationWeeks = payload.duration_weeks;
    if (!durationWeeks && payload.deadline && payload.start_date) {
      const startDate = new Date(payload.start_date);
      const endDate = new Date(payload.deadline);
      if (!Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime())) {
        const diffMs = endDate.getTime() - startDate.getTime();
        durationWeeks = Math.max(1, Math.round(diffMs / (7 * DAY)));
      }
    } else if (!durationWeeks && payload.deadline) {
      const startDate = new Date();
      const endDate = new Date(payload.deadline);
      if (!Number.isNaN(endDate.getTime())) {
        const diffMs = endDate.getTime() - startDate.getTime();
        durationWeeks = Math.max(1, Math.round(diffMs / (7 * DAY)));
      }
    }
    durationWeeks = durationWeeks || 8;

    const sprintCount = Math.max(1, Math.round(durationWeeks / sprintWeeks));

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

    // Department-based roles mapping
    const deptRoles: Record<string, string[]> = {
      ui: ['frontend', 'design', 'fullstack'],
      backend: ['backend', 'fullstack', 'devops'],
      app: ['frontend', 'fullstack', 'qa'],
      others: ['qa', 'devops', 'fullstack'],
    };

    const sprints = Array.from({ length: sprintCount }, (_, i) => {
      const phase = phases[Math.min(phases.length - 1, Math.floor((i / sprintCount) * phases.length))];
      return {
        index: i + 1,
        name: `Sprint ${i + 1}`,
        goal: `${phase.goal} - ${topic}`,
        planned_points: teamSize * 8,
        tasks: phase.tasks.map((title, t) => {
          // Assign department based on task type and breakdown
          let assigneeRole = 'fullstack';
          if (teamBreakdown) {
            if (title.toLowerCase().includes('ui') || title.toLowerCase().includes('design') || title.toLowerCase().includes('frontend')) {
              assigneeRole = teamBreakdown.ui ? deptRoles.ui[t % deptRoles.ui.length] : 'fullstack';
            } else if (title.toLowerCase().includes('api') || title.toLowerCase().includes('backend') || title.toLowerCase().includes('data')) {
              assigneeRole = teamBreakdown.backend ? deptRoles.backend[t % deptRoles.backend.length] : 'fullstack';
            } else if (title.toLowerCase().includes('test') || title.toLowerCase().includes('qa')) {
              assigneeRole = teamBreakdown.others ? deptRoles.others[t % deptRoles.others.length] : 'qa';
            } else {
              const depts = ['ui', 'backend', 'app', 'others'].filter(d => teamBreakdown[d as keyof ITeamBreakdown]);
              if (depts.length > 0) {
                const dept = depts[t % depts.length];
                assigneeRole = deptRoles[dept][t % deptRoles[dept].length];
              }
            }
          }
          return {
            title,
            description: `Fallback task ${t + 1} for ${phase.goal.toLowerCase()}.`,
            type: 'task',
            priority: i === sprintCount - 1 ? 'high' : 'medium',
            assignee_role: assigneeRole,
            estimate_hours: 8,
            story_points: 5,
          };
        }),
      };
    });

    const assumptions: string[] = [
      `Team of ${teamSize} available full-time.`,
      `${sprintWeeks}-week sprints starting from the requested start date.`,
    ];

    // Add team breakdown to assumptions if provided
    if (teamBreakdown) {
      const depts: string[] = [];
      if (teamBreakdown.ui) depts.push(`UI: ${teamBreakdown.ui}`);
      if (teamBreakdown.backend) depts.push(`Backend: ${teamBreakdown.backend}`);
      if (teamBreakdown.app) depts.push(`App: ${teamBreakdown.app}`);
      if (teamBreakdown.others) depts.push(`Others: ${teamBreakdown.others}`);
      assumptions.push(`Team breakdown by department: ${depts.join(', ')}.`);
    }

    // Add rules to assumptions if provided
    if (payload.rules) {
      assumptions.push(`Rules followed: ${payload.rules}`);
    }

    // Add deadline to assumptions if provided
    if (payload.deadline) {
      assumptions.push(`Project deadline: ${payload.deadline}.`);
    }

    return {
      plan_name: `Sprint Plan - ${topic}`,
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
      assumptions,
      generated_by: 'heuristic-fallback',
    };
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: generatePlan
   */
  public async generatePlan(payload: IPlanGenerate): Promise<{ id: any; generated_by: string; model: string; input: IPlanGenerate; plan: ISprintPlan }> {
    this.initLog();
    this.log('generatePlan', ['Request : ', payload]);

    validatePlanInput(payload);
    // Pin the default start once so long AI requests cannot cross calendar days.
    payload = { ...payload, start_date: payload.start_date || new Date().toISOString().slice(0, 10) };
    const planningPrompt = this.buildPlanningPrompt(payload);
    let provider = 'google';
    let model = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    let plan: ISprintPlan | null = null;

    try {
      // Layer 1: Generate comprehensive plan with full context
      this.log('generatePlan', 'Layer 1: Generating comprehensive plan...');
      const planningOutput = await this._generate(planningPrompt, 'plan_layer1', payload.project_id);

      // Layer 2: Purify the output into required JSON structure
      this.log('generatePlan', 'Layer 2: Purifying output into JSON...');
      const purificationPrompt = this.buildPurificationPrompt(planningOutput, payload);
      const purifiedOutput = await this._generate(purificationPrompt, 'plan_layer2', payload.project_id);

      plan = this.parsePlanResponse(purifiedOutput);
      if (!plan) {
        this.log('generatePlan', 'Layer 2 failed; trying Layer 1 output directly.', 'WARN');
        plan = this.parsePlanResponse(planningOutput);
      }
      if (!plan) {
        this.log('generatePlan', 'Both AI layers failed; using dynamic fallback.', 'WARN');
      }
    } catch (err: any) {
      this.log('generatePlan', `AI error: ${err?.message || err}; using dynamic fallback.`, 'INFO');
    }

    if (!plan) {
      provider = 'dynamic-fallback';
      model = 'rule-based';
      plan = this.buildDynamicFallbackPlan(payload);
    }

    // If the request did not include a team_breakdown, ask the AI to generate one.
    if (!payload.team_breakdown) {
      const aiBreakdown = await this._generateTeamBreakdown(payload);
      if (aiBreakdown) {
        (plan as any).team_breakdown = aiBreakdown;
      } else {
        // Fallback to equal distribution if AI generation fails.
        const total = payload.team_size ?? 3;
        const perDept = Math.floor(total / 4);
        const remainder = total - perDept * 4;
        (plan as any).team_breakdown = {
          ui: perDept,
          backend: perDept,
          app: perDept,
          others: perDept + remainder,
        } as any;
      }
    } else {
      // Ensure we do not echo back a user‑provided breakdown.
      if ((plan as any).team_breakdown) {
        delete (plan as any).team_breakdown;
      }
    }

    // If the user requested a team suggestion, compute it using AI and embed it in the response.
    if (payload.ask_team_suggestion === true) {
      const suggestions = await this.suggestTeamWithAi(payload);
      if (suggestions && suggestions.length > 0) {
        (plan as any).team_suggestions = suggestions;
      }
    }

    plan = this.normalizePlanDates(plan, payload);

    const record = await this._planModel.addNewRecord({
      project_id: payload.project_id || null,
      title: plan.plan_name,
      input: payload,
      plan,
      provider,
      model,
      prompt: planningPrompt,
    });

    this.log('generatePlan', `Plan stored as ${record?._id}`);
    if (payload.project_id) await this.rebuildProjectContext(payload.project_id, 'plan_create');
    return { id: record?._id, generated_by: provider, model, input: payload, plan };
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
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
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
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

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: _rollupExecution
   */
  private _rollupExecution(items: any[]): any {
    const kinds = ['sprint', 'task', 'milestone', 'deadline', 'dependency'];
    const byKind: Record<string, { total: number; completed: number }> = {};
    for (const k of kinds) byKind[k] = { total: 0, completed: 0 };

    let total = 0;
    let completed = 0;
    for (const it of items) {
      const key = String(it.kind);
      if (!byKind[key]) byKind[key] = { total: 0, completed: 0 };
      byKind[key].total += 1;
      total += 1;
      if (it.is_completed) {
        byKind[key].completed += 1;
        completed += 1;
      }
    }

    const percent = total > 0 ? Math.round((completed / total) * 1000) / 10 : 0;
    return { by_kind: byKind, total, completed, percent };
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: acceptPlan
   */
  public async acceptPlan(planId: string, resync = false): Promise<IServiceResult> {
    this.initLog();
    this.log('acceptPlan', ['Request:', JSON.stringify({ planId, resync })]);
    try {
      // FIRST, GET THE EXISTING PLAN RECORD
      const plan = await this._planModel.findByAny({ _id: planId, is_deleted: false });
      this.log('Find existing plan result:', JSON.stringify(plan));
      if (!plan) {
        this.log('Plan not found:', planId, 'ERROR');
        return global.Helpers.makeBadServiceStatus('Plan not found.');
      }

      if (plan.status === 'accepted' && !resync) {
        return global.Helpers.makeBadServiceStatus('Plan already accepted.');
      }

      // SOFT-CLEAR PREVIOUS EXECUTION ITEMS ON RE-SYNC
      if (resync) {
        await this._planExecModel.updateAnyRecord({ plan_id: planId }, { is_deleted: true, deleted_at: new Date() });
      }

      // BUILD EXECUTION ITEMS FROM THE ACCEPTED PLAN
      const sprintPlan: ISprintPlan = plan.plan || {};
      const projectId = plan.project_id || undefined;
      const rows: IPlanExecutionItemCreate[] = [];

      const sprints = Array.isArray(sprintPlan.sprints) ? sprintPlan.sprints : [];
      sprints.forEach((sprint, sIdx) => {
        const i = sIdx + 1;
        const sprintKey = `sprint-${i}`;
        rows.push({
          plan_id: planId,
          project_id: projectId,
          kind: 'sprint',
          ref_key: sprintKey,
          title: sprint.name,
          description: sprint.goal,
          sequence: i,
          meta: {
            goal: sprint.goal,
            start_date: sprint.start_date,
            end_date: sprint.end_date,
            deadline: sprint.deadline,
            planned_points: sprint.planned_points,
          },
        });

        const tasks = Array.isArray(sprint.tasks) ? sprint.tasks : [];
        tasks.forEach((task, tIdx) => {
          const t = tIdx + 1;
          rows.push({
            plan_id: planId,
            project_id: projectId,
            kind: 'task',
            ref_key: `${sprintKey}-task-${t}`,
            parent_key: sprintKey,
            title: task.title,
            description: task.description,
            sequence: t,
            meta: {
              type: task.type,
              priority: task.priority,
              assignee_role: task.assignee_role,
              estimate_hours: task.estimate_hours,
              story_points: task.story_points,
            },
          });
        });

        // Sequential sprint dependency (planner orders sprints foundation-first).
        if (i > 1) {
          const prev = sprints[sIdx - 1];
          rows.push({
            plan_id: planId,
            project_id: projectId,
            kind: 'dependency',
            ref_key: `dependency-${i}`,
            parent_key: sprintKey,
            title: `${sprint.name} depends on ${prev.name}`,
            sequence: i,
            meta: { depends_on_key: `sprint-${i - 1}` },
          });
        }
      });

      const milestones = Array.isArray(sprintPlan.milestones) ? sprintPlan.milestones : [];
      milestones.forEach((milestone, mIdx) => {
        const m = mIdx + 1;
        rows.push({
          plan_id: planId,
          project_id: projectId,
          kind: 'milestone',
          ref_key: `milestone-${m}`,
          title: milestone.name,
          description: milestone.description,
          sequence: m,
          meta: { date: milestone.date },
        });
      });

      const deadlines = Array.isArray(sprintPlan.deadlines) ? sprintPlan.deadlines : [];
      deadlines.forEach((deadline, dIdx) => {
        const d = dIdx + 1;
        rows.push({
          plan_id: planId,
          project_id: projectId,
          kind: 'deadline',
          ref_key: `deadline-${d}`,
          title: deadline.label,
          sequence: d,
          meta: { date: deadline.date },
        });
      });

      if (rows.length === 0) {
        return global.Helpers.makeBadServiceStatus('Plan has no items to accept.');
      }

      await this._planExecModel.addBulkRecord(rows);
      this.log('Add new plan execution items result:', JSON.stringify({ count: rows.length }));

      await this._planModel.updateAnyRecord({ _id: planId }, { status: 'accepted', accepted_at: new Date(), updated_at: new Date() });

      // REBUILD THE PROJECT CONTEXT - best-effort, must not fail the accept
      if (projectId) {
        const ctxRet = await this.rebuildProjectContext(projectId, 'plan_accept');
        if (!ctxRet.status) {
          this.log('acceptPlan', ['Project context rebuild skipped:', ctxRet.status_message], 'WARN');
        }
      }

      return global.Helpers.makeSuccessServiceStatus('Plan accepted.', { plan_id: planId, status: 'accepted', items_created: rows.length });
    } catch (err: any) {
      this.log('acceptPlan', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: getPlanExecution
   */
  public async getPlanExecution(planId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getPlanExecution', ['Request : ', planId]);
    try {
      const plan = await this._planModel.findByAny({ _id: planId, is_deleted: false });
      if (!plan) {
        this.log('Plan not found:', planId, 'ERROR');
        return global.Helpers.makeBadServiceStatus('Plan not found.');
      }

      // GET PLAN EXECUTION ITEMS
      const items = await this._planExecModel.findAllByAny({ plan_id: planId, is_deleted: false });
      const bySequence = (a: any, b: any) => (a.sequence || 0) - (b.sequence || 0);

      const sprints = items
        .filter((it: any) => it.kind === 'sprint')
        .sort(bySequence)
        .map((sprint: any) => ({
          _id: sprint._id,
          ref_key: sprint.ref_key,
          title: sprint.title,
          description: sprint.description,
          meta: sprint.meta || {},
          is_completed: sprint.is_completed,
          completed_at: sprint.completed_at || null,
          tasks: items
            .filter((it: any) => it.kind === 'task' && it.parent_key === sprint.ref_key)
            .sort(bySequence),
          dependencies: items
            .filter((it: any) => it.kind === 'dependency' && it.parent_key === sprint.ref_key)
            .sort(bySequence),
        }));

      const milestones = items.filter((it: any) => it.kind === 'milestone').sort(bySequence);
      const deadlines = items.filter((it: any) => it.kind === 'deadline').sort(bySequence);
      const progress = this._rollupExecution(items);

      this.log('Plan execution response:', JSON.stringify({ count: items.length, percent: progress.percent }));
      return global.Helpers.makeSuccessServiceStatus('Plan execution fetched.', {
        plan: {
          _id: plan._id,
          title: plan.title,
          status: plan.status || 'draft',
          accepted_at: plan.accepted_at || null,
          project_id: plan.project_id || null,
        },
        progress,
        sprints,
        milestones,
        deadlines,
      });
    } catch (err: any) {
      this.log('getPlanExecution', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: toggleExecutionItem
   */
  public async toggleExecutionItem(planId: string, itemId: string, isCompleted: boolean): Promise<IServiceResult> {
    this.initLog();
    this.log('toggleExecutionItem', ['Request:', JSON.stringify({ planId, itemId, isCompleted })]);
    try {
      // CHECK IF EXECUTION ITEM EXISTS
      const item = await this._planExecModel.findByAny({ _id: itemId, plan_id: planId, is_deleted: false });
      this.log('Find existing execution item result:', JSON.stringify(item));
      if (!item) {
        this.log('Execution item not found:', itemId, 'ERROR');
        return global.Helpers.makeBadServiceStatus('Execution item not found.');
      }

      await this._planExecModel.updateAnyRecord(
        { _id: itemId },
        { is_completed: isCompleted, completed_at: isCompleted ? new Date() : null, updated_at: new Date() }
      );
      this.log('Update execution item result:', JSON.stringify({ itemId, isCompleted }));

      // REBUILD PROJECT CONTEXT - Ensure AI chat knows about the completion
      const plan = await this._planModel.findByAny({ _id: planId, is_deleted: false });
      if (plan?.project_id) {
        const ctxRet = await this.rebuildProjectContext(plan.project_id, 'plan_item_update');
        if (!ctxRet.status) {
          this.log('toggleExecutionItem', ['Project context rebuild skipped:', ctxRet.status_message], 'WARN');
        }
      }

      const items = await this._planExecModel.findAllByAny({ plan_id: planId, is_deleted: false });

      const progress = this._rollupExecution(items);

      return global.Helpers.makeSuccessServiceStatus('Execution item updated.', {
        item_id: itemId,
        kind: item.kind,
        is_completed: isCompleted,
        progress,
      });
    } catch (err: any) {
      this.log('toggleExecutionItem', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: _assembleProjectFacts
   */
  private async _assembleProjectFacts(projectId: string): Promise<{ facts: any; sources: string[] }> {
    const base = await this.assembleProjectContext(projectId);
    const db = global.db.connection.db!;
    const sources = ['project', 'analytics', 'risks', 'sprints', 'work_items'];

    // SPRINTS ROLL-UP
    const sprintDocs = await db
      .collection('sprints')
      .find({ project_id: projectId, is_deleted: { $ne: true } })
      .sort({ start_date: -1 })
      .toArray();
    const sprintByStatus: Record<string, number> = { planned: 0, active: 0, completed: 0 };
    for (const s of sprintDocs) {
      const key = String(s.status || 'planned');
      sprintByStatus[key] = (sprintByStatus[key] || 0) + 1;
    }
    const currentSprintDoc = sprintDocs.find((s: any) => s.status === 'active') || sprintDocs[0] || null;
    const sprints = {
      total: sprintDocs.length,
      by_status: sprintByStatus,
      current: currentSprintDoc
        ? {
            name: currentSprintDoc.name,
            status: currentSprintDoc.status,
            start_date: currentSprintDoc.start_date,
            end_date: currentSprintDoc.end_date,
            planned_points: currentSprintDoc.planned_points || 0,
            completed_points: currentSprintDoc.completed_points || 0,
          }
        : null,
    };

    // WORK ITEMS ROLL-UP
    const wiRows = await db
      .collection('work_items')
      .aggregate([
        { $match: { project_id: projectId, is_deleted: { $ne: true } } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            points: { $sum: { $ifNull: ['$story_points', 0] } },
          },
        },
      ])
      .toArray();
    const wiByStatus: Record<string, { count: number; points: number }> = {};
    let wiTotal = 0;
    let wiPointsTotal = 0;
    let wiDone = 0;
    let wiPointsDone = 0;
    for (const r of wiRows) {
      const key = String(r._id);
      wiByStatus[key] = { count: r.count, points: r.points };
      wiTotal += r.count;
      wiPointsTotal += r.points;
      if (key === 'done') {
        wiDone += r.count;
        wiPointsDone += r.points;
      }
    }
    const round1 = (n: number) => Math.round(n * 10) / 10;
    const workItems = {
      total: wiTotal,
      by_status: wiByStatus,
      points_total: wiPointsTotal,
      points_done: wiPointsDone,
      done_percent: wiTotal > 0 ? round1((wiDone / wiTotal) * 100) : 0,
    };

    // LATEST PLAN + ACCEPTED PLAN-EXECUTION PROGRESS
    let planExecution: any = null;
    let planSummary: any = null;
    const allPlans = await this._planModel.findAllByAny({ project_id: projectId, is_deleted: false });
    if (Array.isArray(allPlans) && allPlans.length > 0) {
      const latestPlan = allPlans.slice().sort((a: any, b: any) =>
        new Date(b.updated_at || b.created_at || 0).getTime() - new Date(a.updated_at || a.created_at || 0).getTime())[0];
      planSummary = {
        title: latestPlan.title,
        status: latestPlan.status || 'draft',
        sprints: Array.isArray(latestPlan.plan?.sprints) ? latestPlan.plan.sprints.length : 0,
      };
      sources.push('plans');
    }
    const acceptedPlans = await this._planModel.findAllByAny({ project_id: projectId, status: 'accepted', is_deleted: false });
    if (Array.isArray(acceptedPlans) && acceptedPlans.length > 0) {
      const latest = acceptedPlans
        .slice()
        .sort((a: any, b: any) => new Date(b.accepted_at || 0).getTime() - new Date(a.accepted_at || 0).getTime())[0];
      const items = await this._planExecModel.findAllByAny({ plan_id: String(latest._id), is_deleted: false });
      const rollup = this._rollupExecution(items);
      planExecution = { plan_title: latest.title, percent: rollup.percent, by_kind: rollup.by_kind };
      sources.push('plan_execution');
    }

    const code = await new GitHubCodeContextService().build(projectId);
    if (code.repositories.length) sources.push('github_source_files');
    const codeSummary = { coverage: code.coverage, repositories: code.repositories,
      domains: [...new Set(code.files.map((file: any) => file.path.split('/')[1]))] };
    return { facts: { base, sprints, work_items: workItems, plan: planSummary, plan_execution: planExecution, code: codeSummary }, sources };
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: _projectFactLines
   */
  private _projectFactLines(facts: any): string[] {
    const b = facts.base || {};
    const day = (d: any) => {
      if (!d) return '?';
      const dt = new Date(d);
      return Number.isNaN(dt.getTime()) ? '?' : dt.toISOString().slice(0, 10);
    };
    const lines: string[] = [];
    lines.push(`Project: ${b.project?.name || 'Unknown'} (${b.project?.status || 'unknown'})`);
    if (b.project?.description) lines.push(`Description: ${String(b.project.description).slice(0, 300)}`);
    if (b.analytics?.health_score !== undefined) lines.push(`Health score: ${Number(b.analytics.health_score).toFixed(1)}/100`);
    if (b.analytics?.velocity !== undefined) lines.push(`Velocity: ${Number(b.analytics.velocity).toFixed(1)}`);
    const metrics = Array.isArray(b.analytics?.metrics) ? b.analytics.metrics.slice(0, 5) : [];
    for (const m of metrics) lines.push(`Metric ${m.metric_type}: ${m.value}`);
    lines.push(`Risk level: ${b.risks?.risk_level || 'LOW'}`);
    const factors = Array.isArray(b.risks?.factors) ? b.risks.factors.slice(0, 3) : [];
    for (const f of factors) lines.push(`Risk factor: ${f}`);
    const blockers = Array.isArray(b.blockers) ? b.blockers.slice(0, 3) : [];
    for (const bl of blockers) lines.push(`Blocker: ${bl}`);

    const s = facts.sprints || {};
    lines.push(`Sprints: ${s.total || 0} total (planned ${s.by_status?.planned || 0}, active ${s.by_status?.active || 0}, completed ${s.by_status?.completed || 0})`);
    if (s.current) {
      lines.push(`Current sprint: ${s.current.name} [${s.current.status}] ${day(s.current.start_date)} to ${day(s.current.end_date)}, points ${s.current.completed_points}/${s.current.planned_points}`);
    }

    const w = facts.work_items || {};
    const wiParts = Object.entries(w.by_status || {}).map(([k, v]: any) => `${k} ${v.count}`);
    lines.push(`Work items: ${w.total || 0} total${wiParts.length ? ' (' + wiParts.join(', ') + ')' : ''}, ${w.done_percent || 0}% done, points ${w.points_done || 0}/${w.points_total || 0}`);

    if (facts.plan_execution) {
      const pe = facts.plan_execution;
      const kindParts = Object.entries(pe.by_kind || {})
        .filter(([, v]: any) => v.total > 0)
        .map(([k, v]: any) => `${k} ${v.completed}/${v.total}`);
      lines.push(`Accepted plan "${pe.plan_title}": ${pe.percent}% complete${kindParts.length ? ' (' + kindParts.join(', ') + ')' : ''}`);
    } else if (facts.plan) {
      lines.push(`Latest plan "${facts.plan.title}": ${facts.plan.status}, ${facts.plan.sprints} sprints`);
    }
    if (facts.code?.repositories?.length) {
      lines.push(`Source snapshot: ${facts.code.coverage.totalFiles} domain files; evidence ${facts.code.coverage.incomplete ? 'incomplete' : 'available'}.`);
      lines.push(`Code domains: ${facts.code.domains.join(', ')}. File presence does not establish feature completion.`);
    }
    return lines;
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: assessProjectHealth
   */
  public async assessProjectHealth(projectId: string, provider?: string, model?: string): Promise<IServiceResult> {
    this.initLog();
    try {
      const { facts, sources } = await this._assembleProjectFacts(projectId);
      const prompt = AI_CONTEXT_CONFIG.projectAssessmentPrompt(facts);
      const raw = await this._generate(prompt, 'project_assessment', projectId, provider, model, true);
      const parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
      const score = (value: any): number | null => typeof value === 'number' && Number.isFinite(value)
        ? Math.max(0, Math.min(100, Math.round(value * 10) / 10)) : null;
      const assessment = {
        health: score(parsed.health), quality: score(parsed.quality),
        confidence_percent: score(parsed.confidence_percent) ?? 0,
        summary: String(parsed.summary || ''),
        limitations: Array.isArray(parsed.limitations) ? parsed.limitations.map(String) : [],
        evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String) : [],
        sources,
      };
      const now = new Date();
      await global.db.connection.db!.collection('analytics_snapshots').insertMany(['health', 'quality'].map(metric => ({
        project_id: projectId, metric_type: metric, value: assessment[metric as 'health' | 'quality'],
        breakdown: { basis: 'ai_combined_project_assessment', confidence_percent: assessment.confidence_percent,
          summary: assessment.summary, limitations: assessment.limitations, evidence: assessment.evidence, sources },
        period: 'daily', calculation_version: 'ai-combined-v1', captured_at: now,
        created_at: now, updated_at: now, is_deleted: false,
      })));
      await this._projectModel.updateAnyRecord({ _id: projectId }, {
        health_score: assessment.health, ai_assessed_at: now, updated_at: now,
      });
      return global.Helpers.makeSuccessServiceStatus('Combined AI project assessment saved.', { ...assessment, assessed_at: now });
    } catch (err: any) {
      this.log('assessProjectHealth', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus(err?.message || 'AI project assessment failed.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: analyzeImplementation
   */
  public async analyzeImplementation(projectId: string, planId?: string): Promise<any> {
    if (planId !== undefined && typeof planId !== 'string') throw new Error('planId must be a string.');
    const filter: any = { project_id: projectId, is_deleted: false };
    if (planId) filter._id = planId;
    else filter.status = 'accepted';
    const plans: any[] = await this._planModel.findAllByAny(filter);
    const plan = plans.sort((first, second) => new Date(second.accepted_at || second.created_at).getTime() - new Date(first.accepted_at || first.created_at).getTime())[0];
    if (!plan) throw new Error('No matching project plan found; accept a plan or provide planId.');
    const tasks: any[] = [];
    for (const [sprintIndex, sprint] of (plan.plan?.sprints || []).entries()) {
      for (const [taskIndex, task] of (sprint.tasks || []).entries()) {
        tasks.push({ id: `${sprintIndex + 1}:${taskIndex + 1}`, sprint: sprint.name, sprintIndex: sprintIndex + 1,
          title: task.title, description: task.description || '', storyPoints: task.story_points, estimateHours: task.estimate_hours });
      }
    }
    if (!tasks.length) throw new Error('The selected plan has no defined tasks to analyze.');
    const positive = (value: any) => typeof value === 'number' && Number.isFinite(value) && value > 0;
    const weighting = tasks.every(task => positive(task.storyPoints)) ? 'storyPoints'
      : tasks.every(task => positive(task.estimateHours)) ? 'estimateHours' : 'equal';
    for (const task of tasks) task.weight = weighting === 'equal' ? 1 : task[weighting];
    const builder = new GitHubCodeContextService();
    // Snapshot status only; source evidence is searched per task below instead of taking
    // the first files of each repository in path order.
    const snapshot = await builder.build(projectId, { includeFiles: false });
    const search = new CodeEvidenceSearch(new RepositoryReader(), projectId);
    const filesById = new Map<string, any>();
    const evidenceFor = async (task: any): Promise<string[]> => {
      const terms = codeSearchTerms(`${task.title} ${task.description}`, 3);
      // Plan descriptions are AI-written; their identifiers are not trusted to exist in the code.
      const excerpts = await search.search(terms, { files: TASK_EVIDENCE_FILES, snippetChars: TASK_EVIDENCE_CHARS, preferIdentifiers: false });
      return excerpts.map(excerpt => {
        const evidenceId = `${excerpt.repositoryId}:${excerpt.branch}:${excerpt.path}`;
        const file = filesById.get(evidenceId) || { evidenceId, repositoryId: excerpt.repositoryId, branch: excerpt.branch, path: excerpt.path, content: '', truncated: true };
        if (!file.content.includes(excerpt.text)) file.content += `${file.content ? '\n...\n' : ''}${excerpt.text}`;
        filesById.set(evidenceId, file);
        return evidenceId;
      });
    };
    const response: any = { items: [] };
    const warnings: string[] = [];
    if (!snapshot.repositories.some((repository: any) => repository.status === 'success')) warnings.push('No successful source snapshot is available.');
    else for (let offset = 0; offset < tasks.length; offset += TASK_BATCH) {
      const batch = tasks.slice(offset, offset + TASK_BATCH);
      const label = `Tasks ${offset + 1}-${offset + batch.length}`;
      try {
        const batchIds = new Set<string>();
        const evidenceIds = await Promise.all(batch.map(task => evidenceFor(task)));
        const batchTasks = batch.map((task, index) => {
          evidenceIds[index].forEach(id => batchIds.add(id));
          return { id: task.id, sprint: task.sprint, title: task.title, description: task.description, searchedEvidenceIds: evidenceIds[index] };
        });
        if (!batchIds.size) { warnings.push(`${label}: no matching source files were found and remain UNCLEAR.`); continue; }
        const batchContext = { ...snapshot, sourceFilter: 'excerpts found by searching each task title and description',
          files: [...batchIds].map(id => filesById.get(id)) };
        // Evidence is supplied above, so the generic repository investigation is skipped.
        const raw = await this._generate(AI_CONTEXT_CONFIG.implementationAnalysisPrompt(batchTasks, batchContext),
          'implementation_analysis', projectId, undefined, undefined, false);
        const parsed = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
        if (!Array.isArray(parsed.items)) throw new Error('Invalid analysis response.');
        response.items.push(...parsed.items);
      } catch {
        warnings.push(`${label} could not be analyzed and remain UNCLEAR.`);
      }
    }
    const context = { ...snapshot, files: [...filesById.values()],
      coverage: { ...snapshot.coverage, includedFiles: filesById.size, incomplete: true, method: 'targeted_search_per_task' } };
    const result = builder.normalizeAnalysis(tasks, response, context);
    const sprints = [...new Set(tasks.map(task => task.sprintIndex))].map(sprintIndex => {
      const scoped = tasks.filter(task => task.sprintIndex === sprintIndex);
      return { sprintIndex, name: scoped[0].sprint, ...builder.normalizeAnalysis(scoped, response, context) };
    });
    return { planId: String(plan._id), projectId, weighting, ...result, sprints, warnings, generatedAt: new Date() };
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: _buildProjectContextPrompt
   */
  private _buildProjectContextPrompt(facts: any): string {
    return [
      'Write a dense project-context briefing for an AI assistant that will answer questions about this project.',
      'Plain text only. No markdown headings, no preamble, no closing remarks.',
      'Use short "Label: value" lines grouped logically.',
      `Maximum ${PROJECT_CONTEXT_MAX_LINES} lines and ${PROJECT_CONTEXT_MAX_CHARS} characters.`,
      'Include only the facts listed below. Do not invent numbers or status.',
      '',
      'FACTS:',
      ...this._projectFactLines(facts),
    ].join('\n');
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: _deterministicProjectContext
   */
  private _deterministicProjectContext(facts: any): string {
    return this._projectFactLines(facts).join('\n');
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: _capContextText
   */
  private _capContextText(raw: string): string {
    let t = String(raw || '').replace(/\r\n/g, '\n').trim();
    let lines = t.split('\n').map((l) => l.replace(/\s+$/, ''));
    if (lines.length > PROJECT_CONTEXT_MAX_LINES) lines = lines.slice(0, PROJECT_CONTEXT_MAX_LINES);
    t = lines.join('\n');
    if (t.length > PROJECT_CONTEXT_MAX_CHARS) t = t.slice(0, PROJECT_CONTEXT_MAX_CHARS).replace(/\s+$/, '');
    return t;
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: _contextSnapshot
   */
  private _contextSnapshot(
    text: string,
    sources: string[],
    trigger: ProjectContextTrigger,
    generatedBy: 'ai' | 'heuristic' = 'heuristic',
  ): IProjectContextSnapshot {
    const capped = this._capContextText(text);
    return {
      text: capped,
      generated_by: generatedBy,
      sources,
      line_count: capped ? capped.split('\n').length : 0,
      char_count: capped.length,
      trigger,
      updated_at: new Date(),
    };
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: rebuildProjectContext
   */
  public async rebuildProjectContext(projectId: string, trigger: ProjectContextTrigger): Promise<IServiceResult> {
    this.initLog();
    this.log('rebuildProjectContext', ['Request:', JSON.stringify({ projectId, trigger })]);
    try {
      // FIRST, GET THE PROJECT RECORD
      const project = await this._projectModel.findByAny({ _id: projectId, is_deleted: false });
      if (!project) {
        this.log('Project not found:', projectId, 'ERROR');
        return global.Helpers.makeBadServiceStatus('Project not found.');
      }

      // ASSEMBLE RAW FACTS FROM PROJECT SOURCES
      const { facts, sources } = await this._assembleProjectFacts(projectId);

      const db = global.db.connection.db!;
      const [repositoryCount, commitCount, pullRequestCount] = await Promise.all([
        db.collection('git_intelligence').countDocuments({ project_id: projectId, is_deleted: { $ne: true } }),
        db.collection('commits').countDocuments({ project_id: projectId, is_deleted: { $ne: true } }),
        db.collection('pull_requests').countDocuments({ project_id: projectId, is_deleted: { $ne: true } }),
      ]);
      const code = facts.code || {};
      const gitText = [
        `Git repositories: ${repositoryCount}`,
        `Git commits: ${commitCount}`,
        `Git pull requests: ${pullRequestCount}`,
        `Source files: ${code.coverage?.totalFiles || 0}`,
        `Source evidence: ${code.coverage?.incomplete ? 'incomplete' : 'available'}`,
        ...(code.repositories || []).map((repository: any) =>
          `Repository: ${repository.fullName || repository.repository || repository.repositoryId} [${repository.branch || 'default'}] ${repository.status || ''}`.trim()),
      ].join('\n');
      const sprint = facts.sprints || {};
      const work = facts.work_items || {};
      const taigaText = [
        `Taiga sprints: ${sprint.total || 0}`,
        `Taiga sprint status: planned ${sprint.by_status?.planned || 0}, active ${sprint.by_status?.active || 0}, completed ${sprint.by_status?.completed || 0}`,
        sprint.current ? `Current sprint: ${sprint.current.name} [${sprint.current.status}]` : 'Current sprint: none',
        `Taiga work items: ${work.total || 0}`,
        `Taiga completion: ${work.done_percent || 0}%`,
        `Taiga story points: ${work.points_done || 0}/${work.points_total || 0}`,
      ].join('\n');
      const plan = facts.plan_execution;
      const planText = plan
        ? [`Plan: ${plan.plan_title}`, `Plan completion: ${plan.percent}%`,
            ...Object.entries(plan.by_kind || {}).map(([kind, value]: any) => `Plan ${kind}: ${value.completed}/${value.total}`)].join('\n')
        : facts.plan
          ? `Plan: ${facts.plan.title}\nPlan status: ${facts.plan.status}\nPlan sprints: ${facts.plan.sprints}`
          : 'Plan: no saved plan';
      const gitContext = this._contextSnapshot(gitText, ['git_intelligence', 'commits', 'pull_requests', 'github_source_files'], trigger);
      const taigaContext = this._contextSnapshot(taigaText, ['sprints', 'work_items'], trigger);
      const planContext = this._contextSnapshot(planText, plan ? ['plans', 'plan_execution'] : ['plans'], trigger);

      // GENERATE THE COMPACT CONTEXT (AI, WITH DETERMINISTIC FALLBACK)
      // Context refresh is part of sync and must be fast and reliable. Keep AI
      // generation for chat itself; persist a deterministic factual memory here.
      let text = this._deterministicProjectContext(facts);
      const generatedBy: 'heuristic' = 'heuristic';

      // ENFORCE THE 50-LINE / 2500-CHAR CAP
      text = this._capContextText(text);

      // PERSIST ON THE PROJECT
      const snapshot: IProjectContextSnapshot = {
        text,
        generated_by: generatedBy,
        sources,
        line_count: text ? text.split('\n').length : 0,
        char_count: text.length,
        trigger,
        updated_at: new Date(),
      };
      const contextBundle = { ...snapshot, git: gitContext, taiga: taigaContext, plan: planContext, combined: snapshot };
      await this._projectModel.updateAnyRecord({ _id: projectId }, { project_context: contextBundle, updated_at: new Date() });
      this.log('Rebuild project context result:', JSON.stringify({ generatedBy, line_count: snapshot.line_count, char_count: snapshot.char_count }));

      return global.Helpers.makeSuccessServiceStatus('Project contexts updated.', contextBundle);
    } catch (err: any) {
      this.log('rebuildProjectContext', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-27
   * @Function: getProjectContext
   */
  public async getProjectContext(projectId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getProjectContext', ['Request : ', projectId]);
    try {
      const project = await this._projectModel.findByAny({ _id: projectId, is_deleted: false });
      if (!project) {
        this.log('Project not found:', projectId, 'ERROR');
        return global.Helpers.makeBadServiceStatus('Project not found.');
      }
      return global.Helpers.makeSuccessServiceStatus('Project context fetched.', project.project_context || null);
    } catch (err: any) {
      this.log('getProjectContext', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }
}
