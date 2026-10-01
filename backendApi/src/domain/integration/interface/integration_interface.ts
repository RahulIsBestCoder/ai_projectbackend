import { RepoCategory } from '../../git_intelligence/interface/git_intelligence_interface';

export interface IIntegrationUpdate {
  branch?: string;
  provider?: string;
  repository_name?: string;
  repository_organization?: string;
  repository_url?: string;
  project_id?: string;
  category?: RepoCategory;
  token?: string;
  username?: string;
  password?: string;
  status?: number;
  updated_at?: Date;
}

export interface IIntegrationCreate {
  branch?: string;
  project_id: string;
  provider: string;
  repository_name: string;
  repository_organization?: string;
  repository_url?: string;
  token?: string;
  username?: string;
  password?: string;
  status?: number;
  /** Dropdown: which team/purpose this repo serves (ui | backend | apps | shared | other). */
  category?: RepoCategory;
}

export interface IIntegrationSyncCredentials {
  token?: string;
  username?: string;
  password?: string;
}

/** List-branches payload for POST /v1/integrations/:id/branches (GitHub only). */
export interface IIntegrationBranchList {
  integrationId?: string;
  token?: string;
  owner?: string;
  repositoryName?: string;
  repository_name?: string;
  repository_url?: string;
}
