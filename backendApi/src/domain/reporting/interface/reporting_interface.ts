export interface IReportCreate {
  project_id: string;
  name: string;
  definition?: Record<string, unknown>;
  format?: string;
  status?: string;
  artifact_url?: string;
}

export interface IReportUpdate {
  name?: string;
  definition?: Record<string, unknown>;
  format?: string;
  status?: string;
  artifact_url?: string;
}
