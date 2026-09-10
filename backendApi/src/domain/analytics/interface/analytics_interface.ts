export interface ISnapshotCreate {
  project_id: string;
  metric_type: string;
  value: number;
  breakdown?: Record<string, unknown>;
  period?: string;
  calculation_version?: string;
  captured_at?: Date;
}

export interface ISnapshotUpdate {
  value?: number;
  breakdown?: Record<string, unknown>;
  period?: string;
  calculation_version?: string;
}
