/**
 * Repo categories — the dropdown options the UI shows when linking a
 * repository to a project ("this repo is for ...").
 * A project can have MULTIPLE repos, each tagged with one category.
 */
export type RepoCategory = 'ui' | 'backend' | 'apps' | 'shared' | 'other';

/** Dropdown catalog served to the UI (value + label + badge color). */
export const REPO_CATEGORIES: Array<{
  value: RepoCategory;
  label: string;
  color: string;
  description: string;
}> = [
  { value: 'ui', label: 'UI Team', color: '#8b5cf6', description: 'Frontend / UI team repository' },
  { value: 'backend', label: 'Backend', color: '#3b82f6', description: 'Backend / API team repository' },
  { value: 'apps', label: 'Apps', color: '#22c55e', description: 'Mobile / desktop apps repository' },
  { value: 'shared', label: 'Shared', color: '#f59e0b', description: 'Shared libraries / packages' },
  { value: 'other', label: 'Other', color: '#6b7280', description: 'Everything else' },
];

export const REPO_CATEGORY_VALUES: string[] = REPO_CATEGORIES.map((c) => c.value);

/** Category applied when the caller does not send one. */
export const DEFAULT_REPO_CATEGORY: RepoCategory = 'other';

/** Coerce any incoming value into a valid category (unknown -> 'other'). */
export function normalizeRepoCategory(value?: string | null): RepoCategory {
  const v = String(value || '').trim().toLowerCase();
  return REPO_CATEGORY_VALUES.includes(v) ? (v as RepoCategory) : DEFAULT_REPO_CATEGORY;
}

export interface IRepositoryCreate {
  repository_id: string;
  provider: string;
  token?: string;
  status?: number;
  /** Dropdown selection: which team/purpose this repo serves. */
  category?: RepoCategory;
}

export interface IRepositoryUpdate {
  provider?: string;
  token?: string;
  status?: number;
  /** Dropdown selection: which team/purpose this repo serves. */
  category?: RepoCategory;
}
