import { http } from '@core/http/http';
import { fromApi, toApi } from '@core/http/case';
import { rowsOf, safeRead } from '@core/http/util';
import { AIProviderConfig, AIProviderName, SprintPlan, ProjectContextSnapshot } from '@shared/models';
import { listPlans } from './plans';
import { getAcceptedPlan } from './acceptedPlan';

const PROVIDER_NAME_MAP: Record<string, AIProviderName> = {
  gemini: 'GEMINI',
  google: 'GEMINI',
  groq: 'GROQ',
  openai: 'OPENAI',
  anthropic: 'CLAUDE',
  claude: 'CLAUDE',
  deepseek: 'DEEPSEEK',
  ollama: 'OLLAMA',
};

export interface AiChatResponse {
  conversationId: string | null;
  intent: 'metric_lookup' | 'explanation' | 'recommendation' | 'freeform' | string;
  answer: string;
  /** Back-compat alias for `answer` (older screens read `.response`). */
  response: string;
  citations: { metric: string; value: number | string }[];
}

export async function getAiModels(provider: string): Promise<{ name: string; provider: string }[]> {
  return safeRead(async () => {
    const providerKey = provider.toLowerCase();
    const res = await http.get('/ai/models', { params: { provider: providerKey } });
    const data = fromApi(res.data);
    const raw = Array.isArray(data)
      ? data
      : Array.isArray(data?.models)
        ? data.models
        : rowsOf<any>(data);
    return raw
      .map((m: any) =>
        typeof m === 'string'
          ? { name: m, provider: providerKey }
          : {
              name: String(m.name || m.model || m.id || '').trim(),
              provider: String(m.provider || m.type || providerKey).toLowerCase(),
            }
      )
      .filter((m: any) => m.name);
  }, [], `ai.models.${provider}`);
}

/**
 * `GET /v1/ai/providers` returns the backend catalog. Each item is shaped
 * `{ type: "gemini" | "groq" | "deepseek" | "ollama", name, model, is_default,
 *    is_active, configured, ... }` (camelCased by `fromApi`). Reshape into the
 * `AIProviderConfig` the settings UI renders, folding in a model name from
 * `GET /v1/ai/models` where available. Active/configured states honour the
 * backend's `is_active`/`configured` flags; only fall back to heuristics when
 * the backend does not report them.
 */
export async function getAIProviders(): Promise<AIProviderConfig[]> {
  return safeRead(
    async () => {
      const provRes = await http.get('/ai/providers');
      const raw = rowsOf<any>(provRes.data);
      // Keep every backend provider visible. The configured flag controls
      // whether it can be activated, so Groq can be configured from Settings.
      const visibleProviders = raw;
      const modelCatalogs = await Promise.all(
        visibleProviders.map((p) =>
          p.configured === false
            ? Promise.resolve([])
            : getAiModels(String(p.type || p.provider || p.name || '').toLowerCase())
        )
      );

      return visibleProviders
        .map((p, i) => {
          // The catalog identifies providers by `type` (p.name is the human label).
          const key = String(p.type || p.name || p.provider || '').toLowerCase();
          const provider = PROVIDER_NAME_MAP[key];
          if (!provider) return null;
          const catalog = (modelCatalogs[i] || []).map((m) => m.name);
          const usage = p.tokenUsage5h;
          return {
            provider,
            type: key,
            modelName: p.model || '',
            models: [...new Set(catalog)],
            active: typeof p.isActive === 'boolean' ? p.isActive : i === 0,
            apiKeySet: typeof p.configured === 'boolean' ? p.configured : false,
            reachable: p.reachable === true,
            ready: p.ready === true,
            error: p.error ? String(p.error) : null,
            isDefault: p.isDefault === true,
            tokenUsage5h: usage
              ? {
                  promptTokens: usage.promptTokens,
                  completionTokens: usage.completionTokens,
                  totalTokens: usage.totalTokens,
                  requests: usage.requests,
                }
              : undefined,
            lastUsageAt: p.lastUsage?.at || p.lastUsage?.generatedAt,
          } as AIProviderConfig;
        })
        .filter((x): x is AIProviderConfig => x !== null);
    },
    [],
    'ai.providers'
  );
}

/**
 * Switch the active AI provider on the backend — POST /v1/ai/providers/switch.
 * The endpoint expects a JSON payload `{ provider: "GEMINI" | "GROQ" | ... }`
 * and resolves it through the provider factory (gemini | groq | ollama). It
 * returns `{ provider, name, model, usage_window_ms, token_usage_5h }` inside
 * the envelope; we collapse that to `{ acknowledged: boolean }` for callers.
 */
export async function switchAIProvider(provider: AIProviderName, model: string) {
  const providerKey = provider.toLowerCase();
  const selectedModel = model.trim();
  if (!selectedModel) throw new Error('Select a model before switching provider.');
  const res = await http.post('/ai/providers/switch', {
    provider: providerKey,
    model: selectedModel,
  });
  const d = fromApi(res.data);
  return {
    provider: String(d?.provider || providerKey),
    name: String(d?.name || ''),
    model: String(d?.model || selectedModel),
  };
}

// ---------------------------------------------------------------------------
// Model preferences — GET /v1/ai/models lists what the active provider
// supports, but the backend picks models from env (GEMINI_MODEL / GROQ_MODEL /
// OLLAMA_MODEL) and has no model-switch route. The settings UI stores a
// per-provider model preference client-side (`aipi_model:<PROVIDER>`) as the
// pluggable "configured model" knob; AI calls keep using the backend's choice.
// ---------------------------------------------------------------------------

const modelPrefKey = (provider: string) => `aipi_model:${String(provider).toUpperCase()}`;

export function getModelPreference(provider: AIProviderName | string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(modelPrefKey(provider)) || null;
  } catch {
    return null;
  }
}

export function setModelPreference(provider: AIProviderName | string, model: string): void {
  if (typeof window === 'undefined' || !model?.trim()) return;
  try {
    window.localStorage.setItem(modelPrefKey(provider), model.trim());
  } catch {
    /* storage may be disabled — the preference is best effort */
  }
}

export function clearModelPreference(provider: AIProviderName | string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(modelPrefKey(provider));
  } catch {
    /* noop */
  }
}

/**
 * POST /v1/ai/chat — the backend takes `{ prompt, project_id? }` (NOT `message`)
 * and replies `dataset = { response: "<string>" }`. There is no conversation id,
 * intent, or citations. When `project_id` is set the model is prompted for a
 * JSON summary, so the string may contain a ```json block — `humaniseAiAnswer`
 * unwraps it.
 */
/**
 * Build a compact text block from the project's plan (the accepted/edited plan in
 * local storage if present, otherwise the newest saved plan from
 * `GET /v1/plans?project_id=`). Returns '' when there is no plan.
 */
export async function planContextBlock(projectId: string): Promise<string> {
  return safeRead(
    async () => {
      const saved = await listPlans(projectId);
      saved.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      const latest = saved[0];
      const accepted = getAcceptedPlan(projectId);
      const plan: SprintPlan | undefined = accepted?.plan || latest?.plan;
      if (!plan) return '';

      const input = latest?.input;
      const lines: string[] = ['## Approved Plan (source of truth for team & schedule)'];

      const meta: string[] = [];
      // Prefer the department breakdown; fall back to the legacy flat teamSize
      // (old saved plans still echo team_size in their input).
      const tb = input?.teamBreakdown;
      const tbTotal = tb
        ? Number(tb.ui ?? 0) + Number(tb.backend ?? 0) + Number(tb.app ?? 0) + Number(tb.others ?? 0)
        : 0;
      if (tb && tbTotal > 0) {
        meta.push(`Team size: ${tbTotal} people`);
        const depts = Object.entries(tb)
          .filter(([, n]) => n != null && n > 0)
          .map(([k, n]) => `${k} ${n}`)
          .join(', ');
        meta.push(`Team breakdown: ${depts}`);
      } else if (input?.teamSize != null) {
        meta.push(`Team size: ${input.teamSize} people`);
      }
      if (input?.durationWeeks != null) meta.push(`Duration: ${input.durationWeeks} weeks`);
      if (input?.sprintLengthWeeks != null) meta.push(`Sprint length: ${input.sprintLengthWeeks} weeks`);
      if (input?.startDate) meta.push(`Start: ${input.startDate}`);
      if (meta.length) lines.push(`- ${meta.join(' · ')}`);
      if (accepted) lines.push(`- Plan status: accepted (${accepted.source === 'ai' ? 'AI + edits' : 'manual'})`);
      if (plan.summary) lines.push(`- Summary: ${plan.summary}`);

      if (plan.sprints?.length) {
        lines.push(`- Sprints (${plan.sprints.length}):`);
        plan.sprints.slice(0, 10).forEach((s) => {
          const range = [s.startDate, s.endDate].filter(Boolean).join(' → ');
          const tasks = s.tasks?.length ? `, ${s.tasks.length} tasks` : '';
          lines.push(`  - ${s.name}${range ? ` (${range})` : ''}${s.goal ? ` — ${s.goal}` : ''}${tasks}`);
        });
      }
      if (plan.milestones?.length) {
        lines.push(
          `- Milestones: ${plan.milestones
            .slice(0, 6)
            .map((m) => `${m.name}${m.date ? ` (${m.date})` : ''}`)
            .join('; ')}`
        );
      }
      if (plan.deadlines?.length) {
        lines.push(
          `- Deadlines: ${plan.deadlines
            .slice(0, 6)
            .map((x) => `${x.label}${x.date ? ` (${x.date})` : ''}`)
            .join('; ')}`
        );
      }
      if (plan.assumptions?.length) {
        lines.push(`- Assumptions: ${plan.assumptions.slice(0, 5).join('; ')}`);
      }
      return lines.join('\n');
    },
    '',
    'ai.planContext'
  );
}

export async function askAiAssistant(
  prompt: string,
  projectId?: string,
  _conversationId?: string | null,
  provider?: AIProviderName | string,
  model?: string
): Promise<AiChatResponse> {
  // The backend's project context only covers analytics + risks — it never sees
  // the sprint plan. Inline the approved/latest plan so questions about team
  // size, sprints, milestones and deadlines can actually be answered.
  const planBlock = projectId ? await planContextBlock(projectId) : '';
  const finalPrompt = planBlock ? `${planBlock}\n\n${prompt}` : prompt;

  const providerKey = String(provider || '').toLowerCase();
  const selectedModel = String(model || '').trim();
  if (!providerKey || !selectedModel) {
    throw new Error('An AI provider and model must be selected before sending a message.');
  }
  const res = await http.post('/ai/chat', toApi({
    prompt: finalPrompt,
    projectId: projectId || undefined,
    provider: providerKey,
    model: selectedModel,
  }));
  const d = fromApi(res.data);
  const raw = (d.response ?? d.answer ?? '').toString();
  const answer = humaniseAiAnswer(raw);
  return {
    conversationId: null,
    intent: 'freeform',
    answer,
    response: answer,
    citations: [],
  };
}

/** The chat reply is sometimes a ```json {summary, insights[...]} blob — surface something readable. */
function humaniseAiAnswer(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const body = (fenced ? fenced[1] : trimmed).trim();
  if (body.startsWith('{') || body.startsWith('[')) {
    try {
      const obj = JSON.parse(body);
      const parts: string[] = [];
      if (obj.summary) parts.push(String(obj.summary));
      if (Array.isArray(obj.insights) && obj.insights.length) {
        parts.push(
          obj.insights
            .slice(0, 5)
            .map((i: any) => `• ${i.title || i.description || ''}`.trim())
            .filter((s: string) => s !== '•')
            .join('\n')
        );
      }
      if (Array.isArray(obj.recommendations) && obj.recommendations.length) {
        parts.push(
          'Recommendations:\n' +
            obj.recommendations
              .slice(0, 5)
              .map((r: any) => `• ${typeof r === 'string' ? r : r.text || r.title || ''}`)
              .join('\n')
        );
      }
      const joined = parts.filter(Boolean).join('\n\n').trim();
      if (joined) return joined;
    } catch {
      /* not valid JSON — fall through to the raw text */
    }
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Stored project context — GET/POST /v1/ai/projects/:id/ai/context
//
// The snapshot the AI chat reads automatically when `project_id` is passed. It
// is also rebuilt server-side (no client call) after a plan is accepted and
// after an integration sync succeeds. POST triggers a fresh rebuild — one
// Gemini call, 5-25s typical, up to ~90s — so it gets the long client budget.
// ---------------------------------------------------------------------------

const CONTEXT_TIMEOUT_MS = 120_000;

export async function getProjectContext(
  projectId: string,
): Promise<ProjectContextSnapshot | null> {
  return safeRead(
    async () => {
      const d = fromApi((await http.get(`/ai/projects/${projectId}/ai/context`)).data);
      return d && d.text ? (d as ProjectContextSnapshot) : null;
    },
    null,
    'ai.projectContext',
  );
}

export async function rebuildProjectContext(
  projectId: string,
): Promise<ProjectContextSnapshot> {
  const res = await http.post(
    `/ai/projects/${projectId}/ai/context`,
    {},
    { timeout: CONTEXT_TIMEOUT_MS },
  );
  return fromApi(res.data) as ProjectContextSnapshot;
}

export async function getProjectAiSummary(projectId: string): Promise<string> {
  return safeRead(async () => {
    const res = await http.post(`/projects/${projectId}/ai/summary`, {});
    const d = fromApi(res.data);
    return d.summaryText || d.summary_text || d.summary || '';
  }, '', 'ai.summary');
}

export async function getProjectRecommendations(
  projectId: string
): Promise<{ text: string; priority: string }[]> {
  return safeRead(async () => {
    const res = await http.post(`/projects/${projectId}/ai/recommendations`, {});
    const d = fromApi(res.data);
    return Array.isArray(d.items) ? d.items : [];
  }, [], 'ai.recommendations');
}
