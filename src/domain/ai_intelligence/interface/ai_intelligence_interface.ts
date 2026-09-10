export interface IInsightCreate {
  type: string;
  project_id?: string;
  provider?: string;
  model?: string;
  prompt?: string;
  response?: string;
  context_meta?: Record<string, unknown>;
  cached?: boolean;
}

export interface IInsightUpdate {
  provider?: string;
  model?: string;
  prompt?: string;
  response?: string;
  context_meta?: Record<string, unknown>;
  cached?: boolean;
}

/**
 * Structured AI response model for consistent output format.
 * Makes the UI easy to render with cards and structured blocking information.
 */
export interface IAgentResponse {
  summary: string;
  insights: Array<{
    title: string;
    description: string;
    severity: 'low' | 'medium' | 'high';
    evidence: string[];
  }>;
  recommendations: Array<{
    action: string;
    priority: 'low' | 'medium' | 'high';
    owner?: string;
    due_date?: string;
  }>;
  confidence: number;
  generated_at: Date;
}

/**
 * Project context data assembled from analytics, risk, and project information.
 * This is what gets sent to the AI model for analysis.
 */
export interface IProjectContext {
  project: {
    id: string;
    name: string;
    description: string;
    status: string;
  };
  analytics: {
    metrics: Array<{
      metric_type: string;
      value: number;
      breakdown: Record<string, unknown>;
      period: string;
    }>;
    health_score?: number;
    velocity?: number;
  };
  risks: {
    risk_level: string;
    factors: string[];
    predictions: Array<{
      kind: string;
      risk_level: string;
      confidence_score: number;
      summary: string;
    }>;
  };
  blockers: string[];
  sprint_data: {
    current_sprint?: string;
    velocity?: number;
    completion_rate?: number;
  };
}

/**
 * Chat session for maintaining conversation history.
 */
export interface IChatSession {
  session_id: string;
  project_id?: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
  }>;
  created_at: Date;
  updated_at: Date;
}

/**
 * Provider configuration for multi-vendor support.
 */
export interface IProviderConfig {
  name: string;
  type: 'google' | 'openai' | 'anthropic' | 'ollama';
  api_key?: string;
  base_url?: string;
  model?: string;
  is_default: boolean;
  is_active: boolean;
}

/**
 * Input for the AI sprint-plan generator (POST /v1/plans).
 * Only `description` is required — every other field tunes the generated plan.
 */
export interface IPlanGenerate {
  description: string;
  project_name?: string;
  project_id?: string;
  team_size?: number;
  duration_weeks?: number;
  sprint_length_weeks?: number;
  start_date?: string;
  constraints?: string[];
}

export interface IPlanTask {
  title: string;
  description?: string;
  type?: string;
  priority?: string;
  assignee_role?: string;
  estimate_hours?: number;
  story_points?: number;
}

export interface IPlanSprint {
  index?: number;
  name: string;
  goal?: string;
  start_date?: string;
  end_date?: string;
  deadline?: string;
  planned_points?: number;
  tasks: IPlanTask[];
}

export interface IPlanMilestone {
  name: string;
  date?: string;
  description?: string;
}

export interface IPlanDeadline {
  label: string;
  date?: string;
}

export interface IPlanRisk {
  description: string;
  severity?: string;
  mitigation?: string;
}

/**
 * Structured plan JSON returned by the AI provider (or the heuristic
 * fallback). Sprint/deadline dates are always normalized server-side.
 */
export interface ISprintPlan {
  plan_name: string;
  summary: string;
  total_duration_weeks?: number;
  sprints: IPlanSprint[];
  milestones?: IPlanMilestone[];
  deadlines?: IPlanDeadline[];
  risks?: IPlanRisk[];
  assumptions?: string[];
  generated_by?: string;
}
