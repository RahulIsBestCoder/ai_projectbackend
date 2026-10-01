/**
 * `WorkItemSource` – declared source types for work items (plan §07).
 *
 * Every source a work item can originate from should be declared here so the
 * value is kept in one place and reused by the model, interfaces, service and
 * controllers. Add a new source here before it is used anywhere else.
 *
 * Current declared sources:
 *  - `taiga`   : imported from a Taiga project integration (user stories / tasks)
 *  - `manual`  : created directly through the API / UI with no external provider
 *  - `github`  : reserved for future GitHub-issue-based work item import
 *  - `other`   : fallback for any provider that is not explicitly declared yet
 */

export const WORK_ITEM_SOURCES = [
  'taiga',
  'manual',
  'github',
  'other',
] as const;

export type WorkItemSource = (typeof WORK_ITEM_SOURCES)[number];

export const isWorkItemSource = (value: unknown): value is WorkItemSource =>
  typeof value === 'string' && WORK_ITEM_SOURCES.includes(value as WorkItemSource);
