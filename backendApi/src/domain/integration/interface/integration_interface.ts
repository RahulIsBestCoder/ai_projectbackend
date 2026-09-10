export interface IIntegrationCreate {
  provider: string;
  repository_name: string;
  repository_organization?: string;
  repository_url?: string;
  token?: string;
  status?: number;
}

export interface IIntegrationUpdate {
  provider?: string;
  repository_name?: string;
  repository_organization?: string;
  repository_url?: string;
  token?: string;
  status?: number;
}
