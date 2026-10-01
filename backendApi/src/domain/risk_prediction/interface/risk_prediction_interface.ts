export interface IPredictionCreate {
  project_id: string;
  kind: string;
  risk_level?: string;
  predicted_date?: Date;
  target_date?: Date;
  confidence_score?: number;
  factors?: unknown[];
  summary?: string;
}

export interface IPredictionUpdate {
  risk_level?: string;
  predicted_date?: Date;
  target_date?: Date;
  confidence_score?: number;
  factors?: unknown[];
  summary?: string;
}

export type RiskLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

/**
 * A risk row produced by `analyzeRisks` — either from a deterministic rule or
 * from the AI pass. Persisted into `risk_predictions` as `kind: 'risk'`.
 */
export interface IGeneratedRisk {
  risk_key: string;
  risk_level: RiskLevel;
  summary: string;
  factors: string[];
  mitigation?: string;
  confidence_score: number;
  source: 'deterministic' | 'ai';
}

export interface IRiskAnalysisTaigaSync {
  connected: boolean;
  attempted: boolean;
  ok: boolean;
  status: string | null;
  error?: string | null;
  last_sync_at?: string | null;
}

export interface IRiskAnalysisPlanExecution {
  plan_title: string;
  percent: number;
  total: number;
  completed: number;
  overdue_unchecked: number;
  incomplete_dependencies: number;
}

export interface IRiskAnalysisResult {
  project_id: string;
  generated_at: string;
  overall_risk_level: RiskLevel;
  counts: Record<string, number>;
  ai_used: boolean;
  taiga_sync: IRiskAnalysisTaigaSync;
  plan_execution: IRiskAnalysisPlanExecution | null;
  risks: IGeneratedRisk[];
}

export interface IIntegrationSyncSummary {
  connected: boolean;
  attempted: boolean;
  ok: boolean;
  status: string | null;
  error?: string | null;
  last_sync_at?: string | null;
}

export interface IDeadlinePredictionResult {
  project_id: string;
  generated_at: string;
  risk_level: RiskLevel;
  predicted_date: string | null;
  target_date: string | null;
  on_time_probability: number | null;
  confidence: 'high' | 'medium' | 'low' | string;
  confidence_score: number;
  summary: string;
  forecast: {
    status: string;
    p50: string | null;
    p80: string | null;
    p95: string | null;
    optimistic: string | null;
    pessimistic: string | null;
  };
  velocity: unknown;
  remaining_story_points: number | null;
  taiga_sync: IIntegrationSyncSummary;
  git_sync: IIntegrationSyncSummary;
  factors: string[];
}
