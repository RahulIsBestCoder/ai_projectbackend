export interface IProjectCreate {
  name: string;
  description?: string;
  organization_id: string;
  owner_id: string;
  status?: number;
}

export interface IProjectUpdate {
  name?: string;
  description?: string;
  status?: number;
}
