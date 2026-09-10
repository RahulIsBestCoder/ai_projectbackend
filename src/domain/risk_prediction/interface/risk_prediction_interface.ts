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
