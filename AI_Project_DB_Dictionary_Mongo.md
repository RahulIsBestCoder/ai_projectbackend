# AI Project Intelligence Platform

# Database Dictionary — MongoDB / Mongoose Edition

## Purpose

MongoDB/Mongoose translation of `AI_Project_DB_Dictionary_Structure (2).md`
(originally authored as PostgreSQL DDL). Every relational table becomes a
Mongoose model / collection. This document is the schema reference for the
Node.js/TypeScript/Express/Mongoose codebase.

The original PostgreSQL file is retained unchanged as the relational reference.

---

## Conversion Conventions

| PostgreSQL | MongoDB / Mongoose |
|---|---|
| `TABLE` (plural snake_case) | `model('<name>', schema)` — collection name kept identical |
| `<t>_id BIGSERIAL PRIMARY KEY` | implicit `_id: ObjectId` — no field declared |
| `fk_<x>_id BIGINT REFERENCES <x>` | `<x>_id: { type: Schema.Types.ObjectId, ref: '<x>' }` |
| `VARCHAR(n)` / `TEXT` / `CHAR(n)` / `INET` | `String` (`maxlength` optional) |
| `INT` / `BIGINT` (non-FK) / `NUMERIC(p,s)` | `Number` |
| `BOOLEAN` | `Boolean` |
| `TIMESTAMP WITH TIME ZONE` / `DATE` | `Date` |
| `JSONB` | `Schema.Types.Mixed` (or a typed sub-schema) |
| `TEXT[]` | `[String]` |
| `INTERVAL` | `Number` (seconds) |
| `UNIQUE` | `unique: true` |
| composite PK on a join table | `schema.index({ a: 1, b: 1 }, { unique: true })` |
| `DEFAULT now()` | handled by `timestamps` option, or `default: Date.now` |
| `created_at` / `updated_at` | `{ timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }` |
| `deleted_at` / `deleted_by` (soft delete) | explicit fields; queries filter `{ deleted_at: null }` |
| `ON DELETE CASCADE` | **not native** — enforce in the service layer or `pre('deleteOne'/'findOneAndDelete')` hooks |
| enum described in `Comments` | `enum: [...]` |
| `CREATE INDEX` | `schema.index({ ... })` |

### Shared snippets referenced below

```ts
import { Schema, model, Types } from 'mongoose';

// audit timestamps — maps Mongoose timestamps to snake_case columns
export const auditOpts = {
  timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
  versionKey: false,
};

// soft-delete fields (only on tables that had deleted_at in the DDL)
export const softDelete = {
  deleted_at: { type: Date, default: null },
};

// actor references (only on tables that had created_by/updated_by/deleted_by)
export const auditedBy = {
  created_by: { type: Schema.Types.ObjectId, ref: 'users', default: null },
  updated_by: { type: Schema.Types.ObjectId, ref: 'users', default: null },
  deleted_by: { type: Schema.Types.ObjectId, ref: 'users', default: null },
};
```

> **Join collections vs embedding.** Every `*_members` / `*_permissions` / link
> table is kept as its own collection with a compound unique index (faithful to
> the relational model). Where read patterns favour it, these may instead be
> embedded arrays of `ObjectId` on the parent — noted per case.

---

# Modules

## 1. Authentication

Collections: `users`, `roles`, `permissions`, `role_permissions`, `user_roles`,
`refresh_tokens`, `login_history`, `api_tokens`, `password_history`

```ts
const users = new Schema({
  full_name:     { type: String, required: true, trim: true },
  email:         { type: String, required: true, unique: true, lowercase: true, trim: true },
  password_hash: { type: String, required: true },
  is_active:     { type: Boolean, default: true },
  ...softDelete,
  ...auditedBy,
}, auditOpts);

const roles = new Schema({
  name:        { type: String, required: true, unique: true },
  description: { type: String },
  ...softDelete,
  ...auditedBy,
}, auditOpts);

const permissions = new Schema({
  name:        { type: String, required: true, unique: true },
  description: { type: String },
  ...softDelete,
  ...auditedBy,
}, auditOpts);

const role_permissions = new Schema({
  role_id:       { type: Schema.Types.ObjectId, ref: 'roles', required: true },
  permission_id: { type: Schema.Types.ObjectId, ref: 'permissions', required: true },
}, auditOpts);
role_permissions.index({ role_id: 1, permission_id: 1 }, { unique: true });

const user_roles = new Schema({
  user_id: { type: Schema.Types.ObjectId, ref: 'users', required: true },
  role_id: { type: Schema.Types.ObjectId, ref: 'roles', required: true },
}, auditOpts);
user_roles.index({ user_id: 1, role_id: 1 }, { unique: true });

const refresh_tokens = new Schema({
  user_id:    { type: Schema.Types.ObjectId, ref: 'users', required: true },
  token:      { type: String, required: true },
  expires_at: { type: Date, required: true },
}, auditOpts);

const login_history = new Schema({
  user_id:    { type: Schema.Types.ObjectId, ref: 'users', required: true },
  login_at:   { type: Date, default: Date.now },
  ip_address: { type: String },
  user_agent: { type: String },
  success:    { type: Boolean },
}, auditOpts);

const api_tokens = new Schema({
  user_id:    { type: Schema.Types.ObjectId, ref: 'users', required: true },
  token:      { type: String, required: true },
  expires_at: { type: Date, required: true },
}, auditOpts);

const password_history = new Schema({
  user_id:       { type: Schema.Types.ObjectId, ref: 'users', required: true },
  password_hash: { type: String, required: true },
  changed_at:    { type: Date, default: Date.now },
}, auditOpts);
```

**Indexes:** `users.email` (unique), `user_roles(user_id)`, `user_roles(role_id)`,
`role_permissions(role_id)`, `role_permissions(permission_id)`.
**Notes:** soft delete on `users`/`roles`/`permissions`; hash passwords (bcrypt);
`user_roles` / `role_permissions` may alternatively be embedded arrays
(`users.role_ids`, `roles.permission_ids`).

---

## 2. Organization

Collections: `organizations`, `organization_settings`, `organization_domains`,
`organization_subscription`, `organization_storage`

```ts
const organizations = new Schema({
  name:        { type: String, required: true },
  description: { type: String },
  ...softDelete,
  ...auditedBy,
}, auditOpts);

const organization_settings = new Schema({
  organization_id: { type: Schema.Types.ObjectId, ref: 'organizations', required: true },
  key:             { type: String, required: true },
  value:           { type: String },
}, auditOpts);
organization_settings.index({ organization_id: 1, key: 1 }, { unique: true });

const organization_domains = new Schema({
  organization_id: { type: Schema.Types.ObjectId, ref: 'organizations', required: true },
  domain:          { type: String, required: true, unique: true },
  verified:        { type: Boolean, default: false },
}, auditOpts);

const organization_subscription = new Schema({
  organization_id: { type: Schema.Types.ObjectId, ref: 'organizations', required: true },
  plan_name:       { type: String, required: true },
  start_date:      { type: Date, required: true },
  end_date:        { type: Date },
  status:          { type: String, enum: ['active', 'past_due', 'cancelled', 'trialing'], default: 'active' },
}, auditOpts);

const organization_storage = new Schema({
  organization_id: { type: Schema.Types.ObjectId, ref: 'organizations', required: true },
  quota_gb:        { type: Number, default: 0 },
  used_gb:         { type: Number, default: 0 },
}, auditOpts);
```

**Indexes:** `organization_domains.domain` (unique), `organization_settings(organization_id, key)` (unique).
**Notes:** `organization_settings` is a generic key/value store — consider a single
embedded `settings` object on `organizations` instead.

---

## 3. Projects

Collections: `projects`, `project_settings`, `project_members`, `project_departments`,
`project_status`, `labels`, `project_labels`, `project_milestones`, `project_calendar`,
`project_holidays`, `project_dependencies`

```ts
const projects = new Schema({
  organization_id: { type: Schema.Types.ObjectId, ref: 'organizations', required: true },
  name:            { type: String, required: true },
  description:     { type: String },
  status:          { type: String, default: 'active' }, // see project_status
  ...softDelete,
  ...auditedBy,
}, auditOpts);
projects.index({ organization_id: 1 });

const project_settings = new Schema({
  project_id: { type: Schema.Types.ObjectId, ref: 'projects', required: true },
  key:        { type: String, required: true },
  value:      { type: String },
}, auditOpts);
project_settings.index({ project_id: 1, key: 1 }, { unique: true });

const project_members = new Schema({
  project_id: { type: Schema.Types.ObjectId, ref: 'projects', required: true },
  user_id:    { type: Schema.Types.ObjectId, ref: 'users', required: true },
  role:       { type: String },
}, auditOpts);
project_members.index({ project_id: 1, user_id: 1 }, { unique: true });
project_members.index({ user_id: 1 });

const project_departments = new Schema({
  project_id:    { type: Schema.Types.ObjectId, ref: 'projects', required: true },
  department_id: { type: Schema.Types.ObjectId, ref: 'departments', required: true },
}, auditOpts);
project_departments.index({ project_id: 1, department_id: 1 }, { unique: true });
project_departments.index({ department_id: 1 });

const project_status = new Schema({ // reference data
  name:        { type: String, required: true, unique: true },
  description: { type: String },
}, auditOpts);

// `labels` is referenced by project_labels but NOT defined in the source dictionary — added here.
const labels = new Schema({
  name:  { type: String, required: true },
  color: { type: String },
}, auditOpts);

const project_labels = new Schema({
  project_id: { type: Schema.Types.ObjectId, ref: 'projects', required: true },
  label_id:   { type: Schema.Types.ObjectId, ref: 'labels', required: true },
}, auditOpts);
project_labels.index({ project_id: 1, label_id: 1 }, { unique: true });

const project_milestones = new Schema({
  project_id:  { type: Schema.Types.ObjectId, ref: 'projects', required: true },
  title:       { type: String, required: true },
  description: { type: String },
  due_date:    { type: Date },
  status:      { type: String, enum: ['open', 'in_progress', 'done', 'missed'], default: 'open' },
}, auditOpts);

const project_calendar = new Schema({
  project_id:  { type: Schema.Types.ObjectId, ref: 'projects', required: true },
  title:       { type: String, required: true },
  start_time:  { type: Date, required: true },
  end_time:    { type: Date },
  description: { type: String },
}, auditOpts);

const project_holidays = new Schema({
  project_id: { type: Schema.Types.ObjectId, ref: 'projects', required: true },
  name:       { type: String, required: true },
  date:       { type: Date, required: true },
}, auditOpts);

const project_dependencies = new Schema({
  project_id:    { type: Schema.Types.ObjectId, ref: 'projects', required: true },
  depends_on_id: { type: Schema.Types.ObjectId, ref: 'projects', required: true },
}, auditOpts);
project_dependencies.index({ project_id: 1, depends_on_id: 1 }, { unique: true });
```

**Notes:** `project_dependencies` is a self-reference on `projects`; guard against
cycles in the service layer. `project_members` / `project_departments` /
`project_labels` are embeddable as ObjectId arrays on `projects`.

---

## 4. Teams

Collections: `departments`, `teams`, `team_members`, `department_members`,
`designation`, `employee_profile`

```ts
const departments = new Schema({
  organization_id: { type: Schema.Types.ObjectId, ref: 'organizations', required: true },
  name:            { type: String, required: true },
  description:     { type: String },
}, auditOpts);
departments.index({ organization_id: 1 });

const teams = new Schema({
  organization_id: { type: Schema.Types.ObjectId, ref: 'organizations', required: true },
  name:            { type: String, required: true },
  description:     { type: String },
}, auditOpts);
teams.index({ organization_id: 1 });

const team_members = new Schema({
  team_id: { type: Schema.Types.ObjectId, ref: 'teams', required: true },
  user_id: { type: Schema.Types.ObjectId, ref: 'users', required: true },
  role:    { type: String },
}, auditOpts);
team_members.index({ team_id: 1, user_id: 1 }, { unique: true });

const department_members = new Schema({
  department_id: { type: Schema.Types.ObjectId, ref: 'departments', required: true },
  user_id:       { type: Schema.Types.ObjectId, ref: 'users', required: true },
  role:          { type: String },
}, auditOpts);
department_members.index({ department_id: 1, user_id: 1 }, { unique: true });

const designation = new Schema({ // reference data
  name:        { type: String, required: true },
  description: { type: String },
}, auditOpts);

const employee_profile = new Schema({ // one-to-one with users
  user_id:        { type: Schema.Types.ObjectId, ref: 'users', required: true, unique: true },
  designation_id: { type: Schema.Types.ObjectId, ref: 'designation', default: null },
  hire_date:      { type: Date },
  salary:         { type: Number },
}, auditOpts);
```

**Notes:** `employee_profile` is a 1:1 extension of `users`; could be embedded as
`users.profile`.

---

## 5. Git Integration

Collections: `git_accounts`, `git_repositories`, `git_branches`, `git_commits`,
`git_pull_requests`, `git_reviews`, `git_review_comments`, `git_tags`, `git_releases`,
`git_webhooks`, `git_sync_history`, `git_contributors`, `git_file_changes`,
`git_merge_history`, `git_activity_snapshot`

```ts
const git_accounts = new Schema({
  organization_id:  { type: Schema.Types.ObjectId, ref: 'organizations', required: true },
  provider:         { type: String, enum: ['github', 'gitlab', 'bitbucket', 'azure_devops'], required: true },
  access_token:     { type: String, required: true },      // encrypt at rest
  refresh_token:    { type: String },
  token_expires_at: { type: Date },
}, auditOpts);

const git_repositories = new Schema({
  account_id:  { type: Schema.Types.ObjectId, ref: 'git_accounts', required: true },
  name:        { type: String, required: true },
  url:         { type: String, required: true },
  visibility:  { type: String, enum: ['private', 'public', 'internal'], default: 'private' },
}, auditOpts);
git_repositories.index({ account_id: 1 });

const git_branches = new Schema({
  repo_id:         { type: Schema.Types.ObjectId, ref: 'git_repositories', required: true },
  name:            { type: String, required: true },
  last_commit_sha: { type: String },
}, auditOpts);

const git_commits = new Schema({
  repo_id:      { type: Schema.Types.ObjectId, ref: 'git_repositories', required: true },
  sha:          { type: String, required: true },
  author_id:    { type: Schema.Types.ObjectId, ref: 'users', default: null },
  message:      { type: String },
  committed_at: { type: Date },
}, auditOpts);
git_commits.index({ repo_id: 1 });
git_commits.index({ repo_id: 1, sha: 1 }, { unique: true });

const git_pull_requests = new Schema({
  repo_id:   { type: Schema.Types.ObjectId, ref: 'git_repositories', required: true },
  number:    { type: Number, required: true },
  title:     { type: String },
  state:     { type: String, enum: ['open', 'closed', 'merged'], default: 'open' },
  merged_at: { type: Date },
  closed_at: { type: Date },
}, auditOpts);
git_pull_requests.index({ repo_id: 1 });
git_pull_requests.index({ repo_id: 1, number: 1 }, { unique: true });

const git_reviews = new Schema({
  pr_id:       { type: Schema.Types.ObjectId, ref: 'git_pull_requests', required: true },
  reviewer_id: { type: Schema.Types.ObjectId, ref: 'users', default: null },
  state:       { type: String, enum: ['pending', 'approved', 'changes_requested', 'commented'], default: 'pending' },
}, auditOpts);

const git_review_comments = new Schema({
  review_id: { type: Schema.Types.ObjectId, ref: 'git_reviews', required: true },
  author_id: { type: Schema.Types.ObjectId, ref: 'users', default: null },
  body:      { type: String },
}, auditOpts);

const git_tags = new Schema({
  repo_id:    { type: Schema.Types.ObjectId, ref: 'git_repositories', required: true },
  name:       { type: String, required: true },
  commit_sha: { type: String },
}, auditOpts);

const git_releases = new Schema({
  repo_id:     { type: Schema.Types.ObjectId, ref: 'git_repositories', required: true },
  tag_name:    { type: String, required: true },
  name:        { type: String },
  description: { type: String },
  prerelease:  { type: Boolean, default: false },
}, auditOpts);

const git_webhooks = new Schema({
  repo_id: { type: Schema.Types.ObjectId, ref: 'git_repositories', required: true },
  url:     { type: String, required: true },
  events:  { type: [String], default: [] },
  active:  { type: Boolean, default: true },
}, auditOpts);

const git_sync_history = new Schema({
  repo_id:   { type: Schema.Types.ObjectId, ref: 'git_repositories', required: true },
  synced_at: { type: Date, default: Date.now },
  status:    { type: String, enum: ['success', 'partial', 'failed'], default: 'success' },
  message:   { type: String },
}, auditOpts);

const git_contributors = new Schema({
  repo_id:       { type: Schema.Types.ObjectId, ref: 'git_repositories', required: true },
  user_id:       { type: Schema.Types.ObjectId, ref: 'users', default: null },
  commits:       { type: Number, default: 0 },
  added_lines:   { type: Number, default: 0 },
  deleted_lines: { type: Number, default: 0 },
}, auditOpts);

const git_file_changes = new Schema({
  commit_id:     { type: Schema.Types.ObjectId, ref: 'git_commits', required: true },
  file_path:     { type: String, required: true },
  added_lines:   { type: Number, default: 0 },
  deleted_lines: { type: Number, default: 0 },
}, auditOpts);

const git_merge_history = new Schema({
  repo_id:       { type: Schema.Types.ObjectId, ref: 'git_repositories', required: true },
  source_branch: { type: String },
  target_branch: { type: String },
  merged_at:     { type: Date },
}, auditOpts);

const git_activity_snapshot = new Schema({
  repo_id:       { type: Schema.Types.ObjectId, ref: 'git_repositories', required: true },
  snapshot_date: { type: Date, required: true },
  commit_count:  { type: Number, default: 0 },
  pr_count:      { type: Number, default: 0 },
  review_count:  { type: Number, default: 0 },
}, auditOpts);
git_activity_snapshot.index({ repo_id: 1, snapshot_date: 1 }, { unique: true });
```

**Notes:** encrypt `access_token` / `refresh_token`. `author_id` / `reviewer_id`
map external provider users to internal `users` — nullable until matched. Add a
provider `external_id` per record when ingesting real data.

---

## 6. Taiga Integration

Collections: `taiga_projects`, `taiga_epics`, `taiga_user_stories`, `taiga_tasks`,
`taiga_issues`, `taiga_sprints`, `taiga_status`, `taiga_priorities`, `taiga_severity`,
`taiga_members`, `taiga_sync_history`

```ts
const taiga_projects = new Schema({
  repo_id:     { type: Schema.Types.ObjectId, ref: 'git_repositories', default: null },
  name:        { type: String, required: true },
  description: { type: String },
}, auditOpts);
taiga_projects.index({ repo_id: 1 });

const taiga_epics = new Schema({
  project_id:  { type: Schema.Types.ObjectId, ref: 'taiga_projects', required: true },
  title:       { type: String, required: true },
  description: { type: String },
  status_id:   { type: Schema.Types.ObjectId, ref: 'taiga_status', default: null },
  priority_id: { type: Schema.Types.ObjectId, ref: 'taiga_priorities', default: null },
  severity_id: { type: Schema.Types.ObjectId, ref: 'taiga_severity', default: null },
}, auditOpts);
taiga_epics.index({ project_id: 1 });

const taiga_user_stories = new Schema({
  epic_id:     { type: Schema.Types.ObjectId, ref: 'taiga_epics', default: null },
  title:       { type: String, required: true },
  description: { type: String },
  status_id:   { type: Schema.Types.ObjectId, ref: 'taiga_status', default: null },
  priority_id: { type: Schema.Types.ObjectId, ref: 'taiga_priorities', default: null },
  severity_id: { type: Schema.Types.ObjectId, ref: 'taiga_severity', default: null },
}, auditOpts);
taiga_user_stories.index({ epic_id: 1 });

const taiga_tasks = new Schema({
  story_id:    { type: Schema.Types.ObjectId, ref: 'taiga_user_stories', default: null },
  title:       { type: String, required: true },
  description: { type: String },
  status_id:   { type: Schema.Types.ObjectId, ref: 'taiga_status', default: null },
  priority_id: { type: Schema.Types.ObjectId, ref: 'taiga_priorities', default: null },
  severity_id: { type: Schema.Types.ObjectId, ref: 'taiga_severity', default: null },
}, auditOpts);
taiga_tasks.index({ story_id: 1 });

const taiga_issues = new Schema({
  project_id:  { type: Schema.Types.ObjectId, ref: 'taiga_projects', required: true },
  title:       { type: String, required: true },
  description: { type: String },
  status_id:   { type: Schema.Types.ObjectId, ref: 'taiga_status', default: null },
  priority_id: { type: Schema.Types.ObjectId, ref: 'taiga_priorities', default: null },
  severity_id: { type: Schema.Types.ObjectId, ref: 'taiga_severity', default: null },
}, auditOpts);
taiga_issues.index({ project_id: 1 });

const taiga_sprints = new Schema({
  project_id: { type: Schema.Types.ObjectId, ref: 'taiga_projects', required: true },
  name:       { type: String, required: true },
  start_date: { type: Date },
  end_date:   { type: Date },
}, auditOpts);

const taiga_status     = new Schema({ name: { type: String, required: true, unique: true }, description: String }, auditOpts);
const taiga_priorities  = new Schema({ name: { type: String, required: true, unique: true }, description: String }, auditOpts);
const taiga_severity   = new Schema({ name: { type: String, required: true, unique: true }, description: String }, auditOpts);

const taiga_members = new Schema({
  project_id: { type: Schema.Types.ObjectId, ref: 'taiga_projects', required: true },
  user_id:    { type: Schema.Types.ObjectId, ref: 'users', required: true },
  role:       { type: String },
}, auditOpts);
taiga_members.index({ project_id: 1, user_id: 1 }, { unique: true });

const taiga_sync_history = new Schema({
  project_id: { type: Schema.Types.ObjectId, ref: 'taiga_projects', required: true },
  synced_at:  { type: Date, default: Date.now },
  status:     { type: String, enum: ['success', 'partial', 'failed'], default: 'success' },
  message:    { type: String },
}, auditOpts);
```

**Notes:** `taiga_status` / `taiga_priorities` / `taiga_severity` overlap with the
Master module (`master_status` / `master_priority` / `master_severity`) — dedupe
into masters if provider-agnostic values are acceptable.

---

## 7. Sprint

Collections: `sprints`, `work_items`, `sprint_tasks`, `sprint_velocity`,
`sprint_burndown`, `sprint_burnup`, `sprint_retrospective`, `sprint_summary`

```ts
const sprints = new Schema({
  project_id: { type: Schema.Types.ObjectId, ref: 'projects', required: true },
  name:       { type: String, required: true },
  start_date: { type: Date },
  end_date:   { type: Date },
}, auditOpts);
sprints.index({ project_id: 1 });

// `work_items` is referenced by sprint_tasks but NOT defined in the source dictionary — added here
// as the canonical, provider-agnostic task abstraction (plan §07).
const work_items = new Schema({
  project_id:     { type: Schema.Types.ObjectId, ref: 'projects', required: true },
  sprint_id:      { type: Schema.Types.ObjectId, ref: 'sprints', default: null },
  source:         { type: String, enum: ['taiga', 'jira', 'github', 'linear', 'manual'], default: 'manual' },
  external_id:    { type: String, default: null },
  title:          { type: String, required: true },
  description:    { type: String },
  type:           { type: String, enum: ['story', 'task', 'bug', 'issue', 'epic'], default: 'task' },
  status:         { type: String, default: 'todo' },
  priority:       { type: String, default: 'medium' },
  assignee_id:    { type: Schema.Types.ObjectId, ref: 'users', default: null },
  story_points:   { type: Number, default: 0 },
  ...softDelete,
}, auditOpts);
work_items.index({ project_id: 1, status: 1 });
work_items.index({ source: 1, external_id: 1 }, { unique: true, sparse: true });

const sprint_tasks = new Schema({
  sprint_id:    { type: Schema.Types.ObjectId, ref: 'sprints', required: true },
  work_item_id: { type: Schema.Types.ObjectId, ref: 'work_items', required: true },
}, auditOpts);
sprint_tasks.index({ sprint_id: 1, work_item_id: 1 }, { unique: true });

const sprint_velocity = new Schema({
  sprint_id:        { type: Schema.Types.ObjectId, ref: 'sprints', required: true },
  date:             { type: Date, required: true },
  points_completed: { type: Number, default: 0 },
}, auditOpts);
sprint_velocity.index({ sprint_id: 1, date: 1 }, { unique: true });

const sprint_burndown = new Schema({
  sprint_id:        { type: Schema.Types.ObjectId, ref: 'sprints', required: true },
  date:             { type: Date, required: true },
  remaining_points: { type: Number, default: 0 },
}, auditOpts);
sprint_burndown.index({ sprint_id: 1, date: 1 }, { unique: true });

const sprint_burnup = new Schema({
  sprint_id:    { type: Schema.Types.ObjectId, ref: 'sprints', required: true },
  date:         { type: Date, required: true },
  total_points: { type: Number, default: 0 },
}, auditOpts);
sprint_burnup.index({ sprint_id: 1, date: 1 }, { unique: true });

const sprint_retrospective = new Schema({
  sprint_id: { type: Schema.Types.ObjectId, ref: 'sprints', required: true },
  notes:     { type: String },
}, auditOpts);

const sprint_summary = new Schema({
  sprint_id:      { type: Schema.Types.ObjectId, ref: 'sprints', required: true },
  velocity:       { type: Number },
  burndown_start: { type: Number },
  burndown_end:   { type: Number },
  burnup_start:   { type: Number },
  burnup_end:     { type: Number },
}, auditOpts);
```

---

## 8. Analytics

Collections: `project_health`, `project_progress`, `project_velocity`, `project_risk`,
`project_prediction`, `developer_metrics`, `department_metrics`, `team_metrics`,
`productivity_metrics`, `quality_metrics`, `bug_metrics`, `release_metrics`,
`historical_snapshots`, `daily_snapshots`, `weekly_snapshots`, `monthly_snapshots`

```ts
const project_health = new Schema({
  project_id:     { type: Schema.Types.ObjectId, ref: 'projects', required: true },
  score:          { type: Number, default: 0 },     // 0–100
  last_evaluated: { type: Date, default: Date.now },
  calculation_version: { type: String, default: 'v1' },
}, auditOpts);

const project_progress = new Schema({
  project_id:       { type: Schema.Types.ObjectId, ref: 'projects', required: true },
  percent_complete: { type: Number, default: 0 },
  last_updated:     { type: Date, default: Date.now },
}, auditOpts);

const project_velocity = new Schema({
  project_id: { type: Schema.Types.ObjectId, ref: 'projects', required: true },
  sprint_id:  { type: Schema.Types.ObjectId, ref: 'sprints', default: null },
  points:     { type: Number },
}, auditOpts);

const project_risk = new Schema({
  project_id:  { type: Schema.Types.ObjectId, ref: 'projects', required: true },
  risk_type:   { type: String },
  severity:    { type: String, enum: ['low', 'medium', 'high', 'critical'] },
  description: { type: String },
  mitigated:   { type: Boolean, default: false },
}, auditOpts);

const project_prediction = new Schema({
  project_id:      { type: Schema.Types.ObjectId, ref: 'projects', required: true },
  metric_name:     { type: String },
  predicted_value: { type: Number },
  confidence:      { type: Number },   // 0–100
}, auditOpts);

const developer_metrics = new Schema({
  user_id:      { type: Schema.Types.ObjectId, ref: 'users', required: true },
  commits:      { type: Number, default: 0 },
  prs_merged:   { type: Number, default: 0 },
  code_reviews: { type: Number, default: 0 },
}, auditOpts);
developer_metrics.index({ user_id: 1 });

const department_metrics = new Schema({
  department_id: { type: Schema.Types.ObjectId, ref: 'departments', required: true },
  commits:      { type: Number, default: 0 },
  prs_merged:   { type: Number, default: 0 },
}, auditOpts);
department_metrics.index({ department_id: 1 });

const team_metrics = new Schema({
  team_id:    { type: Schema.Types.ObjectId, ref: 'teams', required: true },
  commits:    { type: Number, default: 0 },
  prs_merged: { type: Number, default: 0 },
}, auditOpts);
team_metrics.index({ team_id: 1 });

const productivity_metrics = new Schema({
  project_id: { type: Schema.Types.ObjectId, ref: 'projects', required: true },
  sprint_id:  { type: Schema.Types.ObjectId, ref: 'sprints', default: null },
  velocity:   { type: Number },
}, auditOpts);

const quality_metrics = new Schema({
  project_id:    { type: Schema.Types.ObjectId, ref: 'projects', required: true },
  bug_count:     { type: Number, default: 0 },
  code_coverage: { type: Number },   // percent
}, auditOpts);

const bug_metrics = new Schema({
  project_id: { type: Schema.Types.ObjectId, ref: 'projects', required: true },
  severity:   { type: String, enum: ['low', 'medium', 'high', 'critical'] },
  count:      { type: Number, default: 0 },
}, auditOpts);

const release_metrics = new Schema({
  project_id:  { type: Schema.Types.ObjectId, ref: 'projects', required: true },
  release_id:  { type: Schema.Types.ObjectId, ref: 'git_releases', default: null },
  deploy_time: { type: Number },   // seconds (was INTERVAL)
}, auditOpts);

// Generic snapshot stores — `data` holds the metric payload as computed.
const snapshotShape = {
  entity_type:   { type: String, enum: ['project', 'team', 'department', 'user', 'sprint'] },
  entity_id:     { type: Schema.Types.ObjectId },
  data:          { type: Schema.Types.Mixed },
};
const historical_snapshots = new Schema({ ...snapshotShape, snapshot_date: { type: Date, required: true } }, auditOpts);
const daily_snapshots      = new Schema({ ...snapshotShape, snapshot_date: { type: Date, required: true } }, auditOpts);
const weekly_snapshots     = new Schema({ ...snapshotShape, week_start:    { type: Date } }, auditOpts);
const monthly_snapshots    = new Schema({ ...snapshotShape, month_start:   { type: Date } }, auditOpts);

historical_snapshots.index({ entity_type: 1, entity_id: 1, snapshot_date: 1 });
daily_snapshots.index({ entity_type: 1, entity_id: 1, snapshot_date: 1 }, { unique: true });
weekly_snapshots.index({ entity_type: 1, entity_id: 1, week_start: 1 }, { unique: true });
monthly_snapshots.index({ entity_type: 1, entity_id: 1, month_start: 1 }, { unique: true });
```

**Notes:** `entity_id` is a polymorphic ref (no single `ref:` possible) — resolve
via `entity_type`. Health calculation must be deterministic and version-stamped
(`calculation_version`) so historical scores are reproducible.

---

## 9. AI

Collections: `ai_provider`, `ai_models`, `ai_prompt_templates`, `ai_conversation`,
`ai_chat_history`, `ai_reports`, `ai_summary`, `ai_recommendations`,
`ai_prediction_logs`, `ai_feedback`

```ts
const ai_provider = new Schema({
  name:     { type: String, required: true, unique: true },  // openai | anthropic | gemini | deepseek | ollama
  api_key:  { type: String },       // encrypt at rest
  endpoint: { type: String },
}, auditOpts);

const ai_models = new Schema({
  provider_id: { type: Schema.Types.ObjectId, ref: 'ai_provider', required: true },
  name:        { type: String, required: true },
  version:     { type: String },
  description: { type: String },
}, auditOpts);
ai_models.index({ provider_id: 1 });
ai_models.index({ provider_id: 1, name: 1 }, { unique: true });

const ai_prompt_templates = new Schema({
  model_id:    { type: Schema.Types.ObjectId, ref: 'ai_models', required: true },
  name:        { type: String, required: true },
  prompt_text: { type: String, required: true },
}, auditOpts);
ai_prompt_templates.index({ model_id: 1 });

const ai_conversation = new Schema({
  user_id: { type: Schema.Types.ObjectId, ref: 'users', required: true },
  title:   { type: String },
}, auditOpts);

const ai_chat_history = new Schema({
  user_id:         { type: Schema.Types.ObjectId, ref: 'users', required: true },
  model_id:        { type: Schema.Types.ObjectId, ref: 'ai_models', required: true },
  conversation_id: { type: Schema.Types.ObjectId, ref: 'ai_conversation', default: null },
  messages:        { type: Schema.Types.Mixed },   // [{ role, content, ts }]
}, auditOpts);

const ai_reports = new Schema({
  conversation_id: { type: Schema.Types.ObjectId, ref: 'ai_conversation', required: true },
  report_text:     { type: String },
}, auditOpts);

const ai_summary = new Schema({
  conversation_id: { type: Schema.Types.ObjectId, ref: 'ai_conversation', required: true },
  summary_text:    { type: String },
}, auditOpts);

const ai_recommendations = new Schema({
  conversation_id:     { type: Schema.Types.ObjectId, ref: 'ai_conversation', required: true },
  recommendation_text: { type: String },
}, auditOpts);

const ai_prediction_logs = new Schema({
  model_id:    { type: Schema.Types.ObjectId, ref: 'ai_models', required: true },
  input_text:  { type: String },
  output_text: { type: String },
  confidence:  { type: Number },
}, auditOpts);

const ai_feedback = new Schema({
  conversation_id: { type: Schema.Types.ObjectId, ref: 'ai_conversation', required: true },
  rating:          { type: Number, min: 1, max: 5 },
  comments:        { type: String },
}, auditOpts);
```

**Notes:** `ai_provider` / `ai_models` overlap with `master_ai_provider` — keep
masters for the catalog, `ai_provider` for tenant-configured credentials.

---

## 10. Reporting

Collections: `reports`, `report_templates`, `scheduled_reports`, `report_history`,
`report_export`, `report_delivery`

```ts
const reports = new Schema({
  project_id:  { type: Schema.Types.ObjectId, ref: 'projects', required: true },
  name:        { type: String, required: true },
  description: { type: String },
}, auditOpts);
reports.index({ project_id: 1 });

const report_templates = new Schema({
  name:          { type: String, required: true },
  template_text: { type: String, required: true },
}, auditOpts);

const scheduled_reports = new Schema({
  report_id:       { type: Schema.Types.ObjectId, ref: 'reports', required: true },
  cron_expression: { type: String, required: true },
  next_run:        { type: Date },
}, auditOpts);
scheduled_reports.index({ report_id: 1 });

const report_history = new Schema({
  report_id:   { type: Schema.Types.ObjectId, ref: 'reports', required: true },
  run_at:      { type: Date, default: Date.now },
  status:      { type: String, enum: ['success', 'failed', 'processing'], default: 'processing' },
  output_path: { type: String },
}, auditOpts);

const report_export = new Schema({
  history_id:  { type: Schema.Types.ObjectId, ref: 'report_history', required: true },
  format:      { type: String, enum: ['pdf', 'ppt', 'html'], default: 'pdf' },
  exported_at: { type: Date, default: Date.now },
  file_path:   { type: String },
}, auditOpts);

const report_delivery = new Schema({
  export_id:       { type: Schema.Types.ObjectId, ref: 'report_export', required: true },
  recipient_email: { type: String },
  sent_at:         { type: Date },
  status:          { type: String, enum: ['queued', 'sent', 'failed'], default: 'queued' },
}, auditOpts);
```

---

## 11. Notifications

Collections: `notifications`, `notification_templates`, `notification_history`,
`email_queue`, `email_logs`, `webhook_logs`

```ts
const notifications = new Schema({
  user_id: { type: Schema.Types.ObjectId, ref: 'users', required: true },
  type:    { type: String, required: true },   // see master_notification_type
  payload: { type: Schema.Types.Mixed },
  read_at: { type: Date, default: null },
}, auditOpts);
notifications.index({ user_id: 1 });
notifications.index({ user_id: 1, read_at: 1 });

const notification_templates = new Schema({
  name:          { type: String, required: true },
  subject:       { type: String },
  body_template: { type: String, required: true },
}, auditOpts);

const notification_history = new Schema({
  notification_id: { type: Schema.Types.ObjectId, ref: 'notifications', required: true },
  delivered_at:    { type: Date },
  status:          { type: String, enum: ['queued', 'delivered', 'failed'], default: 'queued' },
}, auditOpts);

const email_queue = new Schema({
  recipient_email: { type: String, required: true },
  subject:         { type: String },
  body:            { type: String },
  queued_at:       { type: Date, default: Date.now },
  sent_at:         { type: Date },
  status:          { type: String, enum: ['queued', 'sent', 'failed'], default: 'queued' },
}, auditOpts);
email_queue.index({ recipient_email: 1 });

const email_logs = new Schema({
  email_id:      { type: Schema.Types.ObjectId, ref: 'email_queue', required: true },
  sent_at:       { type: Date },
  status:        { type: String },
  error_message: { type: String },
}, auditOpts);

const webhook_logs = new Schema({
  webhook_url:   { type: String, required: true },
  payload:       { type: Schema.Types.Mixed },
  sent_at:       { type: Date },
  status:        { type: String },
  response_code: { type: Number },
  response_body: { type: String },
}, auditOpts);
```

---

## 12. Audit

Collections: `audit_logs`, `user_activity`, `api_logs`, `system_logs`, `error_logs`,
`scheduler_logs`

```ts
const audit_logs = new Schema({
  entity_type:  { type: String },
  entity_id:    { type: Schema.Types.ObjectId },
  action:       { type: String, enum: ['create', 'update', 'delete', 'login', 'export', 'sync'] },
  performed_by: { type: Schema.Types.ObjectId, ref: 'users', default: null },
  performed_at: { type: Date, default: Date.now },
  details:      { type: Schema.Types.Mixed },
}, auditOpts);
audit_logs.index({ performed_by: 1 });
audit_logs.index({ entity_type: 1, entity_id: 1 });

const user_activity = new Schema({
  user_id:       { type: Schema.Types.ObjectId, ref: 'users', required: true },
  activity_type: { type: String },
  activity_data: { type: Schema.Types.Mixed },
  performed_at:  { type: Date, default: Date.now },
}, auditOpts);

const api_logs = new Schema({
  user_id:          { type: Schema.Types.ObjectId, ref: 'users', default: null },
  endpoint:         { type: String },
  method:           { type: String, enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
  status_code:      { type: Number },
  response_time_ms: { type: Number },
  request_body:     { type: Schema.Types.Mixed },
  response_body:    { type: Schema.Types.Mixed },
  logged_at:        { type: Date, default: Date.now },
}, auditOpts);
api_logs.index({ user_id: 1 });

const system_logs = new Schema({
  level:     { type: String, enum: ['debug', 'info', 'warn', 'error'] },
  message:   { type: String },
  logged_at: { type: Date, default: Date.now },
}, auditOpts);

const error_logs = new Schema({
  error_message: { type: String },
  stack_trace:   { type: String },
  occurred_at:   { type: Date, default: Date.now },
}, auditOpts);

const scheduler_logs = new Schema({
  job_name:    { type: String },
  status:      { type: String, enum: ['success', 'failed', 'running'] },
  started_at:  { type: Date },
  finished_at: { type: Date },
  details:     { type: Schema.Types.Mixed },
}, auditOpts);
```

**Notes:** high-write, append-only collections — consider TTL indexes
(`{ expireAfterSeconds }`) or capped collections for `system_logs` / `api_logs`.

---

## 13. Scheduler

Collections: `scheduler_jobs`, `scheduler_history`, `scheduler_failures`,
`scheduler_configuration`

```ts
const scheduler_jobs = new Schema({
  name:            { type: String, required: true, unique: true },
  cron_expression: { type: String, required: true },
  enabled:         { type: Boolean, default: true },
}, auditOpts);

const scheduler_history = new Schema({
  job_id: { type: Schema.Types.ObjectId, ref: 'scheduler_jobs', required: true },
  run_at: { type: Date, default: Date.now },
  status: { type: String, enum: ['success', 'failed'], default: 'success' },
  output: { type: String },
}, auditOpts);

const scheduler_failures = new Schema({
  job_id:        { type: Schema.Types.ObjectId, ref: 'scheduler_jobs', required: true },
  occurred_at:   { type: Date, default: Date.now },
  error_message: { type: String },
}, auditOpts);

const scheduler_configuration = new Schema({
  key:         { type: String, required: true, unique: true },
  value:       { type: String },
  description: { type: String },
}, auditOpts);
```

---

## 14. Configuration

Collections: `system_settings`, `integration_settings`, `feature_flags`,
`application_settings`, `email_settings`, `storage_settings`, `ai_settings`,
`security_settings`

```ts
const kv = {
  key:         { type: String, required: true, unique: true },
  value:       { type: String },
  description: { type: String },
};
const system_settings      = new Schema({ ...kv }, auditOpts);
const application_settings  = new Schema({ ...kv }, auditOpts);
const ai_settings          = new Schema({ ...kv }, auditOpts);
const security_settings    = new Schema({ ...kv }, auditOpts);

const integration_settings = new Schema({
  provider:    { type: String, required: true },
  key:         { type: String, required: true },
  value:       { type: String },
  description: { type: String },
}, auditOpts);
integration_settings.index({ provider: 1, key: 1 }, { unique: true });

const feature_flags = new Schema({
  name:        { type: String, required: true, unique: true },
  enabled:     { type: Boolean, default: false },
  description: { type: String },
}, auditOpts);

const email_settings = new Schema({
  smtp_server:   { type: String },
  smtp_port:     { type: Number },
  smtp_user:     { type: String },
  smtp_password: { type: String },   // encrypt at rest
  from_address:  { type: String },
  use_tls:       { type: Boolean, default: true },
}, auditOpts);

const storage_settings = new Schema({
  provider:    { type: String, enum: ['s3', 'gcs', 'azure_blob', 'local'] },
  bucket_name: { type: String },
  region:      { type: String },
  access_key:  { type: String },     // encrypt at rest
  secret_key:  { type: String },     // encrypt at rest
}, auditOpts);
```

**Notes:** the four pure key/value collections can collapse into one
`settings` collection with a `scope` discriminator.

---

## 15. Master Tables

Collections: `master_status`, `master_priority`, `master_severity`,
`master_department`, `master_designation`, `master_country`, `master_state`,
`master_city`, `master_language`, `master_timezone`, `master_currency`,
`master_project_type`, `master_integration`, `master_notification_type`,
`master_ai_provider`

```ts
const namedRef = {
  name:        { type: String, required: true, unique: true },
  description: { type: String },
};
const master_status            = new Schema({ ...namedRef }, auditOpts);
const master_priority           = new Schema({ ...namedRef }, auditOpts);
const master_severity          = new Schema({ ...namedRef }, auditOpts);
const master_department        = new Schema({ ...namedRef }, auditOpts);
const master_designation       = new Schema({ ...namedRef }, auditOpts);
const master_project_type      = new Schema({ ...namedRef }, auditOpts);
const master_integration       = new Schema({ ...namedRef }, auditOpts);
const master_notification_type = new Schema({ ...namedRef }, auditOpts);
const master_ai_provider       = new Schema({ ...namedRef }, auditOpts);

const master_country = new Schema({
  name:     { type: String, required: true, unique: true },
  iso_code: { type: String, required: true, unique: true, minlength: 2, maxlength: 2 },
}, auditOpts);

const master_state = new Schema({
  country_id: { type: Schema.Types.ObjectId, ref: 'master_country', required: true },
  name:       { type: String, required: true },
  iso_code:   { type: String, maxlength: 3 },
}, auditOpts);
master_state.index({ iso_code: 1 });

const master_city = new Schema({
  state_id: { type: Schema.Types.ObjectId, ref: 'master_state', required: true },
  name:     { type: String, required: true },
}, auditOpts);

const master_language = new Schema({
  name:     { type: String, required: true, unique: true },
  iso_code: { type: String, required: true, unique: true, minlength: 2, maxlength: 2 },
}, auditOpts);

const master_timezone = new Schema({
  name:         { type: String, required: true, unique: true },
  offset_hours: { type: Number },
}, auditOpts);

const master_currency = new Schema({
  name:     { type: String, required: true, unique: true },
  symbol:   { type: String, maxlength: 5 },
  iso_code: { type: String, required: true, unique: true, minlength: 3, maxlength: 3 },
}, auditOpts);
```

---

# Relationship Summary (reference / insert order)

Documents must be created parent-first (Mongoose does not enforce FKs):

```
L0  masters (master_country → master_state → master_city; master_* named refs),
    users, roles, permissions, organizations, ai_provider, report_templates,
    notification_templates, scheduler_jobs, *_settings / feature_flags
L1  role_permissions, user_roles, refresh_tokens, login_history, api_tokens,
    password_history, organization_settings, organization_domains,
    organization_subscription, organization_storage, departments, teams,
    projects, employee_profile, git_accounts, ai_models
L2  department_members, team_members, project_settings, project_members,
    project_departments, project_labels, project_milestones, project_calendar,
    project_holidays, project_dependencies, sprints, work_items,
    git_repositories, ai_prompt_templates, ai_conversation, ai_chat_history,
    reports, notifications, project_health, project_progress, project_velocity,
    project_risk, project_prediction, productivity_metrics, quality_metrics,
    bug_metrics, developer_metrics, department_metrics, team_metrics
L3  git_branches, git_commits, git_pull_requests, git_tags, git_releases,
    git_webhooks, git_sync_history, git_contributors, git_activity_snapshot,
    git_merge_history, taiga_projects, sprint_tasks, sprint_velocity,
    sprint_burndown, sprint_burnup, sprint_retrospective, sprint_summary,
    scheduled_reports, report_history, notification_history, ai_reports,
    ai_summary, ai_recommendations, ai_feedback, release_metrics,
    scheduler_history, scheduler_failures
L4  git_reviews, git_file_changes, taiga_epics, taiga_issues, taiga_sprints,
    taiga_members, taiga_sync_history, report_export
L5  git_review_comments, taiga_user_stories, report_delivery
L6  taiga_tasks
```

# Divergences from the PostgreSQL source

| Item | Source | This edition |
|---|---|---|
| `work_items` | referenced, never defined | defined in Module 7 as the canonical task model |
| `labels` | referenced by `project_labels`, never defined | defined in Module 3 |
| `taiga_status/priorities/severity` | separate reference tables | kept, but flagged as duplicates of `master_*` |
| `ai_provider` vs `master_ai_provider` | both present | masters = catalog, `ai_provider` = tenant credentials |
| integer serial PKs / FKs | `BIGSERIAL` / `BIGINT` | `ObjectId` (`_id` implicit, FKs are `ref`) |
| `ON DELETE CASCADE` | DB-enforced | service-layer / Mongoose hooks |
| join tables | composite-PK tables | collections with compound unique index (embeddable) |
| `created_at` / `updated_at` | explicit columns | `timestamps` option mapped to snake_case |
| key/value settings | 4 config + 1 org + 1 project tables | retained; noted as collapsible into one `settings` collection |

**Estimated collections:** ~142 (15 modules), matching the source's 140–150 table estimate.
