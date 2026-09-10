export interface IRepositoryCreate {
  repository_id: string;
  provider: string;
  token?: string;
  status?: number;
}

export interface IRepositoryUpdate {
  provider?: string;
  token?: string;
  status?: number;
}
