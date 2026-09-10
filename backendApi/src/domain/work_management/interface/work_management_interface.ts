export interface IWorkItemCreate {
  project_id: string;
  title: string;
  description?: string;
  type?: string;
  status?: string;
  priority?: string;
  assignee_id?: string;
  sprint_id?: string;
  story_points?: number;
  integration_id?: string;
  external_id?: string;
}

export interface IWorkItemUpdate {
  title?: string;
  description?: string;
  type?: string;
  status?: string;
  priority?: string;
  assignee_id?: string;
  sprint_id?: string;
  story_points?: number;
}
