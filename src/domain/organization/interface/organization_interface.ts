export interface IOrganizationCreate {
  name: string;
  description?: string;
  owner_id: string;
}

export interface IOrganizationUpdate {
  name?: string;
  description?: string;
}
