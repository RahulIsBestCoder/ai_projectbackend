export interface ISprintCreate {
  project_id: string;
  name: string;
  goal?: string;
  start_date?: Date;
  end_date?: Date;
  status?: string;
  planned_points?: number;
  completed_points?: number;
}

export interface ISprintUpdate {
  name?: string;
  goal?: string;
  start_date?: Date;
  end_date?: Date;
  status?: string;
  planned_points?: number;
  completed_points?: number;
}
