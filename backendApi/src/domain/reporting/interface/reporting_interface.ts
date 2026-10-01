export interface IReportCreate {
  project_id: string;
  name: string;
  definition?: Record<string, unknown>;
  format?: string;
  status?: string;
  artifact_url?: string;
  scope?: string[];
  /** User instructions or subject matter for the generated report. */
  content?: string;
  /** Backward-compatible alias for content. */
  report_content?: string;
  /** Explicitly bypass a matching stored generation. */
  force_regenerate?: boolean;
  report_type?: 'project' | 'sprint';
  sprint_id?: string;
}

export interface IReportUpdate {
  name?: string;
  definition?: Record<string, unknown>;
  format?: string;
  status?: string;
  artifact_url?: string;
  scope?: string[];
  content?: string;
  report_content?: string;
}
