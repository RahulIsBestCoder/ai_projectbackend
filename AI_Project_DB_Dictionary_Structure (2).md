# AI Project Intelligence Platform

# Database Dictionary Document Structure

## Purpose

This document serves as the complete database dictionary for the AI
Project Intelligence Platform.

It provides detailed documentation for every PostgreSQL table,
including:

-   Table purpose
-   Column definitions
-   Data types
-   Constraints
-   Relationships
-   Default values
-   Business descriptions
-   Index recommendations

This document is intended for Backend Developers, Frontend Developers,
Database Administrators, DevOps Engineers, QA Engineers, AI Engineers,
and Project Architects.

------------------------------------------------------------------------

## Documentation Standards

Every table follows this structure:

    Module
    ↓
    Table Name
    ↓
    Purpose
    ↓
    Columns
    ↓
    Relationships
    ↓
    Indexes
    ↓
    Notes

## Column Definition Format

  Field                Description
  -------------------- ---------------------------------------
  Column Name          Database column name
  Data Type            PostgreSQL datatype
  Default Value        Default value if any
  Relation Table       Foreign key reference
  Nullable             Yes / No
  Comments             Constraints, enum values, validations
  Column Description   Business description
  Example Value        Sample value
  Used In              API / Module

## Naming Standards

### Tables

Use plural names.

### Primary Keys

`table_name_id`

### Foreign Keys

`fk_<table>_id`

### Audit Columns

-   created_at
-   updated_at
-   deleted_at
-   created_by
-   updated_by
-   deleted_by

------------------------------------------------------------------------

# Database Modules

## 1. Authentication

Purpose: Authentication and authorization.

Below is a ready‑to‑run PostgreSQL DDL for the Authentication module.  The
schema follows the naming conventions described earlier (plural tables, `*_id`
primary keys, `fk_*_id` foreign keys, audit columns, and soft‑delete).

```sql
-- users
CREATE TABLE IF NOT EXISTS users (
  user_id          BIGSERIAL PRIMARY KEY,
  full_name        VARCHAR(200) NOT NULL,
  email            VARCHAR(255) NOT NULL UNIQUE,
  password_hash    VARCHAR(255) NOT NULL,
  is_active        BOOLEAN DEFAULT TRUE,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at       TIMESTAMP WITH TIME ZONE,
  deleted_at       TIMESTAMP WITH TIME ZONE,
  created_by       BIGINT,
  updated_by       BIGINT,
  deleted_by       BIGINT
);

-- roles
CREATE TABLE IF NOT EXISTS roles (
  role_id          BIGSERIAL PRIMARY KEY,
  name             VARCHAR(100) NOT NULL UNIQUE,
  description      TEXT,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at       TIMESTAMP WITH TIME ZONE,
  deleted_at       TIMESTAMP WITH TIME ZONE,
  created_by       BIGINT,
  updated_by       BIGINT,
  deleted_by       BIGINT
);

-- permissions
CREATE TABLE IF NOT EXISTS permissions (
  permission_id    BIGSERIAL PRIMARY KEY,
  name             VARCHAR(100) NOT NULL UNIQUE,
  description      TEXT,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at       TIMESTAMP WITH TIME ZONE,
  deleted_at       TIMESTAMP WITH TIME ZONE,
  created_by       BIGINT,
  updated_by       BIGINT,
  deleted_by       BIGINT
);

-- role_permissions (many‑to‑many)
CREATE TABLE IF NOT EXISTS role_permissions (
  role_id          BIGINT NOT NULL,
  permission_id    BIGINT NOT NULL,
  PRIMARY KEY (role_id, permission_id),
  CONSTRAINT fk_role FOREIGN KEY (role_id) REFERENCES roles(role_id) ON DELETE CASCADE,
  CONSTRAINT fk_permission FOREIGN KEY (permission_id) REFERENCES permissions(permission_id) ON DELETE CASCADE
);

-- user_roles (many‑to‑many)
CREATE TABLE IF NOT EXISTS user_roles (
  user_id          BIGINT NOT NULL,
  role_id          BIGINT NOT NULL,
  PRIMARY KEY (user_id, role_id),
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_role FOREIGN KEY (role_id) REFERENCES roles(role_id) ON DELETE CASCADE
);

-- refresh_tokens
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_id         BIGSERIAL PRIMARY KEY,
  user_id          BIGINT NOT NULL,
  token            TEXT NOT NULL,
  expires_at       TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- login_history
CREATE TABLE IF NOT EXISTS login_history (
  login_id         BIGSERIAL PRIMARY KEY,
  user_id          BIGINT NOT NULL,
  login_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  ip_address       INET,
  user_agent       TEXT,
  success          BOOLEAN,
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- api_tokens
CREATE TABLE IF NOT EXISTS api_tokens (
  token_id         BIGSERIAL PRIMARY KEY,
  user_id          BIGINT NOT NULL,
  token            TEXT NOT NULL,
  expires_at       TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at       TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- password_history
CREATE TABLE IF NOT EXISTS password_history (
  history_id       BIGSERIAL PRIMARY KEY,
  user_id          BIGINT NOT NULL,
  password_hash    VARCHAR(255) NOT NULL,
  changed_at       TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_user_roles_user_id ON user_roles(user_id);
CREATE INDEX IF NOT EXISTS idx_user_roles_role_id ON user_roles(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_role_id ON role_permissions(role_id);
CREATE INDEX IF NOT EXISTS idx_role_permissions_permission_id ON role_permissions(permission_id);
```

------------------------------------------------------------------------

## 2. Organization

```sql
-- organizations
CREATE TABLE IF NOT EXISTS organizations (
  organization_id   BIGSERIAL PRIMARY KEY,
  name              VARCHAR(200) NOT NULL,
  description       TEXT,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at        TIMESTAMP WITH TIME ZONE,
  deleted_at        TIMESTAMP WITH TIME ZONE,
  created_by        BIGINT,
  updated_by        BIGINT,
  deleted_by        BIGINT
);

-- organization_settings
CREATE TABLE IF NOT EXISTS organization_settings (
  setting_id        BIGSERIAL PRIMARY KEY,
  organization_id   BIGINT NOT NULL,
  key               VARCHAR(100) NOT NULL,
  value             TEXT,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at        TIMESTAMP WITH TIME ZONE,
  CONSTRAINT fk_org FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE
);

-- organization_domains
CREATE TABLE IF NOT EXISTS organization_domains (
  domain_id         BIGSERIAL PRIMARY KEY,
  organization_id   BIGINT NOT NULL,
  domain            VARCHAR(255) NOT NULL,
  verified          BOOLEAN DEFAULT FALSE,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_org FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE
);

-- organization_subscription
CREATE TABLE IF NOT EXISTS organization_subscription (
  subscription_id   BIGSERIAL PRIMARY KEY,
  organization_id   BIGINT NOT NULL,
  plan_name         VARCHAR(100) NOT NULL,
  start_date        DATE NOT NULL,
  end_date          DATE,
  status            VARCHAR(50) DEFAULT 'active',
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_org FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE
);

-- organization_storage
CREATE TABLE IF NOT EXISTS organization_storage (
  storage_id        BIGSERIAL PRIMARY KEY,
  organization_id   BIGINT NOT NULL,
  quota_gb          NUMERIC(10,2) DEFAULT 0,
  used_gb           NUMERIC(10,2) DEFAULT 0,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_org FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE
);

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_domains_domain ON organization_domains(domain);
``` 

------------------------------------------------------------------------

## 3. Projects

```sql
-- projects
CREATE TABLE IF NOT EXISTS projects (
  project_id        BIGSERIAL PRIMARY KEY,
  organization_id   BIGINT NOT NULL,
  name              VARCHAR(200) NOT NULL,
  description       TEXT,
  status            VARCHAR(50) DEFAULT 'active',
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at        TIMESTAMP WITH TIME ZONE,
  deleted_at        TIMESTAMP WITH TIME ZONE,
  created_by        BIGINT,
  updated_by        BIGINT,
  deleted_by        BIGINT,
  CONSTRAINT fk_org FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE
);

-- project_settings
CREATE TABLE IF NOT EXISTS project_settings (
  setting_id        BIGSERIAL PRIMARY KEY,
  project_id        BIGINT NOT NULL,
  key               VARCHAR(100) NOT NULL,
  value             TEXT,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at        TIMESTAMP WITH TIME ZONE,
  CONSTRAINT fk_proj FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

-- project_members (many‑to‑many with users)
CREATE TABLE IF NOT EXISTS project_members (
  project_id        BIGINT NOT NULL,
  user_id           BIGINT NOT NULL,
  role              VARCHAR(100),
  PRIMARY KEY (project_id, user_id),
  CONSTRAINT fk_proj FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- project_departments (many‑to‑many with departments)
CREATE TABLE IF NOT EXISTS project_departments (
  project_id        BIGINT NOT NULL,
  department_id     BIGINT NOT NULL,
  PRIMARY KEY (project_id, department_id),
  CONSTRAINT fk_proj FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
  CONSTRAINT fk_dept FOREIGN KEY (department_id) REFERENCES departments(department_id) ON DELETE CASCADE
);

-- project_status (reference table)
CREATE TABLE IF NOT EXISTS project_status (
  status_id         BIGSERIAL PRIMARY KEY,
  name              VARCHAR(50) NOT NULL UNIQUE,
  description       TEXT
);

-- project_labels (many‑to‑many with labels)
CREATE TABLE IF NOT EXISTS project_labels (
  project_id        BIGINT NOT NULL,
  label_id          BIGINT NOT NULL,
  PRIMARY KEY (project_id, label_id),
  CONSTRAINT fk_proj FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
  CONSTRAINT fk_label FOREIGN KEY (label_id) REFERENCES labels(label_id) ON DELETE CASCADE
);

-- project_milestones
CREATE TABLE IF NOT EXISTS project_milestones (
  milestone_id      BIGSERIAL PRIMARY KEY,
  project_id        BIGINT NOT NULL,
  title             VARCHAR(200) NOT NULL,
  description       TEXT,
  due_date          DATE,
  status            VARCHAR(50) DEFAULT 'open',
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_proj FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

-- project_calendar (simple calendar events)
CREATE TABLE IF NOT EXISTS project_calendar (
  event_id          BIGSERIAL PRIMARY KEY,
  project_id        BIGINT NOT NULL,
  title             VARCHAR(200) NOT NULL,
  start_time        TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time          TIMESTAMP WITH TIME ZONE,
  description       TEXT,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_proj FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

-- project_holidays (project‑specific holidays)
CREATE TABLE IF NOT EXISTS project_holidays (
  holiday_id        BIGSERIAL PRIMARY KEY,
  project_id        BIGINT NOT NULL,
  name              VARCHAR(200) NOT NULL,
  date              DATE NOT NULL,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_proj FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

-- project_dependencies (many‑to‑many with other projects)
CREATE TABLE IF NOT EXISTS project_dependencies (
  project_id        BIGINT NOT NULL,
  depends_on_id     BIGINT NOT NULL,
  PRIMARY KEY (project_id, depends_on_id),
  CONSTRAINT fk_proj FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
  CONSTRAINT fk_dep FOREIGN KEY (depends_on_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_project_org ON projects(organization_id);
CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);
CREATE INDEX IF NOT EXISTS idx_project_departments_dept ON project_departments(department_id);
``` 

------------------------------------------------------------------------

## 4. Teams

```sql
-- departments
CREATE TABLE IF NOT EXISTS departments (
  department_id     BIGSERIAL PRIMARY KEY,
  organization_id   BIGINT NOT NULL,
  name              VARCHAR(200) NOT NULL,
  description       TEXT,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_org FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE
);

-- teams
CREATE TABLE IF NOT EXISTS teams (
  team_id           BIGSERIAL PRIMARY KEY,
  organization_id   BIGINT NOT NULL,
  name              VARCHAR(200) NOT NULL,
  description       TEXT,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_org FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE
);

-- team_members (many‑to‑many with users)
CREATE TABLE IF NOT EXISTS team_members (
  team_id           BIGINT NOT NULL,
  user_id           BIGINT NOT NULL,
  role              VARCHAR(100),
  PRIMARY KEY (team_id, user_id),
  CONSTRAINT fk_team FOREIGN KEY (team_id) REFERENCES teams(team_id) ON DELETE CASCADE,
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- department_members (many‑to‑many with users)
CREATE TABLE IF NOT EXISTS department_members (
  department_id     BIGINT NOT NULL,
  user_id           BIGINT NOT NULL,
  role              VARCHAR(100),
  PRIMARY KEY (department_id, user_id),
  CONSTRAINT fk_dept FOREIGN KEY (department_id) REFERENCES departments(department_id) ON DELETE CASCADE,
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- designation (reference table)
CREATE TABLE IF NOT EXISTS designation (
  designation_id    BIGSERIAL PRIMARY KEY,
  name              VARCHAR(100) NOT NULL,
  description       TEXT
);

-- employee_profile (one‑to‑one with users)
CREATE TABLE IF NOT EXISTS employee_profile (
  profile_id        BIGSERIAL PRIMARY KEY,
  user_id           BIGINT NOT NULL UNIQUE,
  designation_id    BIGINT,
  hire_date         DATE,
  salary            NUMERIC(12,2),
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_desig FOREIGN KEY (designation_id) REFERENCES designation(designation_id) ON DELETE SET NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_team_org ON teams(organization_id);
CREATE INDEX IF NOT EXISTS idx_department_org ON departments(organization_id);
``` 

------------------------------------------------------------------------

## 5. Git Integration

```sql
-- git_accounts
CREATE TABLE IF NOT EXISTS git_accounts (
  account_id        BIGSERIAL PRIMARY KEY,
  organization_id   BIGINT NOT NULL,
  provider          VARCHAR(50) NOT NULL,
  access_token      TEXT NOT NULL,
  refresh_token     TEXT,
  token_expires_at  TIMESTAMP WITH TIME ZONE,
  created_at        TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_org FOREIGN KEY (organization_id) REFERENCES organizations(organization_id) ON DELETE CASCADE
);

-- git_repositories
CREATE TABLE IF NOT EXISTS git_repositories (
  repo_id            BIGSERIAL PRIMARY KEY,
  account_id         BIGINT NOT NULL,
  name               VARCHAR(200) NOT NULL,
  url                TEXT NOT NULL,
  visibility         VARCHAR(20) DEFAULT 'private',
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_acc FOREIGN KEY (account_id) REFERENCES git_accounts(account_id) ON DELETE CASCADE
);

-- git_branches
CREATE TABLE IF NOT EXISTS git_branches (
  branch_id          BIGSERIAL PRIMARY KEY,
  repo_id            BIGINT NOT NULL,
  name               VARCHAR(200) NOT NULL,
  last_commit_sha    VARCHAR(40),
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_repo FOREIGN KEY (repo_id) REFERENCES git_repositories(repo_id) ON DELETE CASCADE
);

-- git_commits
CREATE TABLE IF NOT EXISTS git_commits (
  commit_id          BIGSERIAL PRIMARY KEY,
  repo_id            BIGINT NOT NULL,
  sha                VARCHAR(40) NOT NULL,
  author_id          BIGINT,
  message            TEXT,
  committed_at       TIMESTAMP WITH TIME ZONE,
  CONSTRAINT fk_repo FOREIGN KEY (repo_id) REFERENCES git_repositories(repo_id) ON DELETE CASCADE
);

-- git_pull_requests
CREATE TABLE IF NOT EXISTS git_pull_requests (
  pr_id              BIGSERIAL PRIMARY KEY,
  repo_id            BIGINT NOT NULL,
  number             INT NOT NULL,
  title              VARCHAR(200),
  state              VARCHAR(20) DEFAULT 'open',
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  merged_at          TIMESTAMP WITH TIME ZONE,
  closed_at          TIMESTAMP WITH TIME ZONE,
  CONSTRAINT fk_repo FOREIGN KEY (repo_id) REFERENCES git_repositories(repo_id) ON DELETE CASCADE
);

-- git_reviews
CREATE TABLE IF NOT EXISTS git_reviews (
  review_id          BIGSERIAL PRIMARY KEY,
  pr_id              BIGINT NOT NULL,
  reviewer_id        BIGINT,
  state              VARCHAR(20) DEFAULT 'pending',
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_pr FOREIGN KEY (pr_id) REFERENCES git_pull_requests(pr_id) ON DELETE CASCADE
);

-- git_review_comments
CREATE TABLE IF NOT EXISTS git_review_comments (
  comment_id         BIGSERIAL PRIMARY KEY,
  review_id          BIGINT NOT NULL,
  author_id          BIGINT,
  body               TEXT,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_review FOREIGN KEY (review_id) REFERENCES git_reviews(review_id) ON DELETE CASCADE
);

-- git_tags
CREATE TABLE IF NOT EXISTS git_tags (
  tag_id             BIGSERIAL PRIMARY KEY,
  repo_id            BIGINT NOT NULL,
  name               VARCHAR(200) NOT NULL,
  commit_sha         VARCHAR(40),
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_repo FOREIGN KEY (repo_id) REFERENCES git_repositories(repo_id) ON DELETE CASCADE
);

-- git_releases
CREATE TABLE IF NOT EXISTS git_releases (
  release_id         BIGSERIAL PRIMARY KEY,
  repo_id            BIGINT NOT NULL,
  tag_name           VARCHAR(200) NOT NULL,
  name               VARCHAR(200),
  description        TEXT,
  prerelease         BOOLEAN DEFAULT FALSE,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_repo FOREIGN KEY (repo_id) REFERENCES git_repositories(repo_id) ON DELETE CASCADE
);

-- git_webhooks
CREATE TABLE IF NOT EXISTS git_webhooks (
  webhook_id         BIGSERIAL PRIMARY KEY,
  repo_id            BIGINT NOT NULL,
  url                TEXT NOT NULL,
  events             TEXT[],
  active             BOOLEAN DEFAULT TRUE,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_repo FOREIGN KEY (repo_id) REFERENCES git_repositories(repo_id) ON DELETE CASCADE
);

-- git_sync_history
CREATE TABLE IF NOT EXISTS git_sync_history (
  sync_id            BIGSERIAL PRIMARY KEY,
  repo_id            BIGINT NOT NULL,
  synced_at          TIMESTAMP WITH TIME ZONE DEFAULT now(),
  status             VARCHAR(20) DEFAULT 'success',
  message            TEXT,
  CONSTRAINT fk_repo FOREIGN KEY (repo_id) REFERENCES git_repositories(repo_id) ON DELETE CASCADE
);

-- git_contributors
CREATE TABLE IF NOT EXISTS git_contributors (
  contributor_id    BIGSERIAL PRIMARY KEY,
  repo_id           BIGINT NOT NULL,
  user_id           BIGINT,
  commits           INT DEFAULT 0,
  added_lines       INT DEFAULT 0,
  deleted_lines     INT DEFAULT 0,
  CONSTRAINT fk_repo FOREIGN KEY (repo_id) REFERENCES git_repositories(repo_id) ON DELETE CASCADE
);

-- git_file_changes
CREATE TABLE IF NOT EXISTS git_file_changes (
  change_id          BIGSERIAL PRIMARY KEY,
  commit_id          BIGINT NOT NULL,
  file_path          TEXT NOT NULL,
  added_lines        INT DEFAULT 0,
  deleted_lines      INT DEFAULT 0,
  CONSTRAINT fk_commit FOREIGN KEY (commit_id) REFERENCES git_commits(commit_id) ON DELETE CASCADE
);

-- git_merge_history
CREATE TABLE IF NOT EXISTS git_merge_history (
  merge_id           BIGSERIAL PRIMARY KEY,
  repo_id            BIGINT NOT NULL,
  source_branch      VARCHAR(200),
  target_branch      VARCHAR(200),
  merged_at          TIMESTAMP WITH TIME ZONE,
  CONSTRAINT fk_repo FOREIGN KEY (repo_id) REFERENCES git_repositories(repo_id) ON DELETE CASCADE
);

-- git_activity_snapshot (daily snapshot of activity)
CREATE TABLE IF NOT EXISTS git_activity_snapshot (
  snapshot_id        BIGSERIAL PRIMARY KEY,
  repo_id            BIGINT NOT NULL,
  snapshot_date      DATE NOT NULL,
  commit_count       INT DEFAULT 0,
  pr_count           INT DEFAULT 0,
  review_count       INT DEFAULT 0,
  CONSTRAINT fk_repo FOREIGN KEY (repo_id) REFERENCES git_repositories(repo_id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_git_repo_account ON git_repositories(account_id);
CREATE INDEX IF NOT EXISTS idx_git_commit_repo ON git_commits(repo_id);
CREATE INDEX IF NOT EXISTS idx_git_pr_repo ON git_pull_requests(repo_id);
``` 

------------------------------------------------------------------------

## 6. Taiga Integration

```sql
-- taiga_projects
CREATE TABLE IF NOT EXISTS taiga_projects (
  project_id         BIGSERIAL PRIMARY KEY,
  repo_id            BIGINT,
  name               VARCHAR(200) NOT NULL,
  description        TEXT,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_repo FOREIGN KEY (repo_id) REFERENCES git_repositories(repo_id) ON DELETE SET NULL
);

-- taiga_epics
CREATE TABLE IF NOT EXISTS taiga_epics (
  epic_id            BIGSERIAL PRIMARY KEY,
  project_id         BIGINT NOT NULL,
  title              VARCHAR(200) NOT NULL,
  description        TEXT,
  status_id          BIGINT,
  priority_id        BIGINT,
  severity_id        BIGINT,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_proj FOREIGN KEY (project_id) REFERENCES taiga_projects(project_id) ON DELETE CASCADE
);

-- taiga_user_stories
CREATE TABLE IF NOT EXISTS taiga_user_stories (
  story_id           BIGSERIAL PRIMARY KEY,
  epic_id            BIGINT,
  title              VARCHAR(200) NOT NULL,
  description        TEXT,
  status_id          BIGINT,
  priority_id        BIGINT,
  severity_id        BIGINT,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_epic FOREIGN KEY (epic_id) REFERENCES taiga_epics(epic_id) ON DELETE SET NULL
);

-- taiga_tasks
CREATE TABLE IF NOT EXISTS taiga_tasks (
  task_id            BIGSERIAL PRIMARY KEY,
  story_id           BIGINT,
  title              VARCHAR(200) NOT NULL,
  description        TEXT,
  status_id          BIGINT,
  priority_id        BIGINT,
  severity_id        BIGINT,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_story FOREIGN KEY (story_id) REFERENCES taiga_user_stories(story_id) ON DELETE SET NULL
);

-- taiga_issues
CREATE TABLE IF NOT EXISTS taiga_issues (
  issue_id           BIGSERIAL PRIMARY KEY,
  project_id         BIGINT NOT NULL,
  title              VARCHAR(200) NOT NULL,
  description        TEXT,
  status_id          BIGINT,
  priority_id        BIGINT,
  severity_id        BIGINT,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_proj FOREIGN KEY (project_id) REFERENCES taiga_projects(project_id) ON DELETE CASCADE
);

-- taiga_sprints
CREATE TABLE IF NOT EXISTS taiga_sprints (
  sprint_id          BIGSERIAL PRIMARY KEY,
  project_id         BIGINT NOT NULL,
  name               VARCHAR(200) NOT NULL,
  start_date         DATE,
  end_date           DATE,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_proj FOREIGN KEY (project_id) REFERENCES taiga_projects(project_id) ON DELETE CASCADE
);

-- taiga_status (reference table)
CREATE TABLE IF NOT EXISTS taiga_status (
  status_id          BIGSERIAL PRIMARY KEY,
  name               VARCHAR(100) NOT NULL UNIQUE,
  description        TEXT
);

-- taiga_priorities (reference table)
CREATE TABLE IF NOT EXISTS taiga_priorities (
  priority_id        BIGSERIAL PRIMARY KEY,
  name               VARCHAR(100) NOT NULL UNIQUE,
  description        TEXT
);

-- taiga_severity (reference table)
CREATE TABLE IF NOT EXISTS taiga_severity (
  severity_id        BIGSERIAL PRIMARY KEY,
  name               VARCHAR(100) NOT NULL UNIQUE,
  description        TEXT
);

-- taiga_members (many‑to‑many with users)
CREATE TABLE IF NOT EXISTS taiga_members (
  project_id         BIGINT NOT NULL,
  user_id            BIGINT NOT NULL,
  role               VARCHAR(100),
  PRIMARY KEY (project_id, user_id),
  CONSTRAINT fk_proj FOREIGN KEY (project_id) REFERENCES taiga_projects(project_id) ON DELETE CASCADE,
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- taiga_sync_history
CREATE TABLE IF NOT EXISTS taiga_sync_history (
  sync_id            BIGSERIAL PRIMARY KEY,
  project_id         BIGINT NOT NULL,
  synced_at          TIMESTAMP WITH TIME ZONE DEFAULT now(),
  status             VARCHAR(20) DEFAULT 'success',
  message            TEXT,
  CONSTRAINT fk_proj FOREIGN KEY (project_id) REFERENCES taiga_projects(project_id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tg_proj_repo ON taiga_projects(repo_id);
CREATE INDEX IF NOT EXISTS idx_tg_epic_proj ON taiga_epics(project_id);
CREATE INDEX IF NOT EXISTS idx_tg_story_epic ON taiga_user_stories(epic_id);
CREATE INDEX IF NOT EXISTS idx_tg_task_story ON taiga_tasks(story_id);
CREATE INDEX IF NOT EXISTS idx_tg_issue_proj ON taiga_issues(project_id);
``` 

------------------------------------------------------------------------

## 7. Sprint

```sql
-- sprints
CREATE TABLE IF NOT EXISTS sprints (
  sprint_id          BIGSERIAL PRIMARY KEY,
  project_id         BIGINT NOT NULL,
  name               VARCHAR(200) NOT NULL,
  start_date         DATE,
  end_date           DATE,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_proj FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

-- sprint_tasks (many‑to‑many with work items)
CREATE TABLE IF NOT EXISTS sprint_tasks (
  sprint_id          BIGINT NOT NULL,
  work_item_id       BIGINT NOT NULL,
  PRIMARY KEY (sprint_id, work_item_id),
  CONSTRAINT fk_sprint FOREIGN KEY (sprint_id) REFERENCES sprints(sprint_id) ON DELETE CASCADE,
  CONSTRAINT fk_work FOREIGN KEY (work_item_id) REFERENCES work_items(work_item_id) ON DELETE CASCADE
);

-- sprint_velocity (daily snapshot)
CREATE TABLE IF NOT EXISTS sprint_velocity (
  velocity_id        BIGSERIAL PRIMARY KEY,
  sprint_id          BIGINT NOT NULL,
  date               DATE NOT NULL,
  points_completed   INT DEFAULT 0,
  CONSTRAINT fk_sprint FOREIGN KEY (sprint_id) REFERENCES sprints(sprint_id) ON DELETE CASCADE
);

-- sprint_burndown (daily snapshot)
CREATE TABLE IF NOT EXISTS sprint_burndown (
  burndown_id        BIGSERIAL PRIMARY KEY,
  sprint_id          BIGINT NOT NULL,
  date               DATE NOT NULL,
  remaining_points   INT DEFAULT 0,
  CONSTRAINT fk_sprint FOREIGN KEY (sprint_id) REFERENCES sprints(sprint_id) ON DELETE CASCADE
);

-- sprint_burnup (daily snapshot)
CREATE TABLE IF NOT EXISTS sprint_burnup (
  burnup_id          BIGSERIAL PRIMARY KEY,
  sprint_id          BIGINT NOT NULL,
  date               DATE NOT NULL,
  total_points       INT DEFAULT 0,
  CONSTRAINT fk_sprint FOREIGN KEY (sprint_id) REFERENCES sprints(sprint_id) ON DELETE CASCADE
);

-- sprint_retrospective (summary per sprint)
CREATE TABLE IF NOT EXISTS sprint_retrospective (
  retrospective_id   BIGSERIAL PRIMARY KEY,
  sprint_id          BIGINT NOT NULL,
  notes              TEXT,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_sprint FOREIGN KEY (sprint_id) REFERENCES sprints(sprint_id) ON DELETE CASCADE
);

-- sprint_summary (aggregated metrics)
CREATE TABLE IF NOT EXISTS sprint_summary (
  summary_id         BIGSERIAL PRIMARY KEY,
  sprint_id          BIGINT NOT NULL,
  velocity           INT,
  burndown_start     INT,
  burndown_end       INT,
  burnup_start       INT,
  burnup_end         INT,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_sprint FOREIGN KEY (sprint_id) REFERENCES sprints(sprint_id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sprint_proj ON sprints(project_id);
``` 

------------------------------------------------------------------------

## 8. Analytics

```sql
-- project_health
CREATE TABLE IF NOT EXISTS project_health (
  health_id          BIGSERIAL PRIMARY KEY,
  project_id         BIGINT NOT NULL,
  score              NUMERIC(5,2) DEFAULT 0,
  last_evaluated     TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_proj FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

-- project_progress
CREATE TABLE IF NOT EXISTS project_progress (
  progress_id        BIGSERIAL PRIMARY KEY,
  project_id         BIGINT NOT NULL,
  percent_complete   NUMERIC(5,2) DEFAULT 0,
  last_updated       TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_proj FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

-- project_velocity
CREATE TABLE IF NOT EXISTS project_velocity (
  velocity_id        BIGSERIAL PRIMARY KEY,
  project_id         BIGINT NOT NULL,
  sprint_id          BIGINT,
  points             INT,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_proj FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
  CONSTRAINT fk_sprint FOREIGN KEY (sprint_id) REFERENCES sprints(sprint_id) ON DELETE SET NULL
);

-- project_risk
CREATE TABLE IF NOT EXISTS project_risk (
  risk_id            BIGSERIAL PRIMARY KEY,
  project_id         BIGINT NOT NULL,
  risk_type          VARCHAR(100),
  severity           VARCHAR(50),
  description        TEXT,
  mitigated          BOOLEAN DEFAULT FALSE,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_proj FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

-- project_prediction
CREATE TABLE IF NOT EXISTS project_prediction (
  prediction_id      BIGSERIAL PRIMARY KEY,
  project_id         BIGINT NOT NULL,
  metric_name        VARCHAR(100),
  predicted_value    NUMERIC,
  confidence         NUMERIC(5,2),
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_proj FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

-- developer_metrics (per user)
CREATE TABLE IF NOT EXISTS developer_metrics (
  metric_id          BIGSERIAL PRIMARY KEY,
  user_id            BIGINT NOT NULL,
  commits            INT DEFAULT 0,
  prs_merged         INT DEFAULT 0,
  code_reviews       INT DEFAULT 0,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- department_metrics
CREATE TABLE IF NOT EXISTS department_metrics (
  metric_id          BIGSERIAL PRIMARY KEY,
  department_id      BIGINT NOT NULL,
  commits            INT DEFAULT 0,
  prs_merged         INT DEFAULT 0,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_dept FOREIGN KEY (department_id) REFERENCES departments(department_id) ON DELETE CASCADE
);

-- team_metrics
CREATE TABLE IF NOT EXISTS team_metrics (
  metric_id          BIGSERIAL PRIMARY KEY,
  team_id            BIGINT NOT NULL,
  commits            INT DEFAULT 0,
  prs_merged         INT DEFAULT 0,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_team FOREIGN KEY (team_id) REFERENCES teams(team_id) ON DELETE CASCADE
);

-- productivity_metrics
CREATE TABLE IF NOT EXISTS productivity_metrics (
  metric_id          BIGSERIAL PRIMARY KEY,
  project_id         BIGINT NOT NULL,
  sprint_id          BIGINT,
  velocity           INT,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_proj FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
  CONSTRAINT fk_sprint FOREIGN KEY (sprint_id) REFERENCES sprints(sprint_id) ON DELETE SET NULL
);

-- quality_metrics
CREATE TABLE IF NOT EXISTS quality_metrics (
  metric_id          BIGSERIAL PRIMARY KEY,
  project_id         BIGINT NOT NULL,
  bug_count          INT DEFAULT 0,
  code_coverage      NUMERIC(5,2),
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_proj FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

-- bug_metrics
CREATE TABLE IF NOT EXISTS bug_metrics (
  metric_id          BIGSERIAL PRIMARY KEY,
  project_id         BIGINT NOT NULL,
  severity           VARCHAR(50),
  count              INT DEFAULT 0,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_proj FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

-- release_metrics
CREATE TABLE IF NOT EXISTS release_metrics (
  metric_id          BIGSERIAL PRIMARY KEY,
  project_id         BIGINT NOT NULL,
  release_id         BIGINT,
  deploy_time        INTERVAL,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_proj FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE,
  CONSTRAINT fk_rel FOREIGN KEY (release_id) REFERENCES git_releases(release_id) ON DELETE SET NULL
);

-- historical_snapshots (generic snapshot table)
CREATE TABLE IF NOT EXISTS historical_snapshots (
  snapshot_id        BIGSERIAL PRIMARY KEY,
  entity_type        VARCHAR(50),
  entity_id          BIGINT,
  snapshot_date      DATE NOT NULL,
  data               JSONB,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- daily_snapshots
CREATE TABLE IF NOT EXISTS daily_snapshots (
  snapshot_id        BIGSERIAL PRIMARY KEY,
  entity_type        VARCHAR(50),
  entity_id          BIGINT,
  snapshot_date      DATE NOT NULL,
  data               JSONB,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- weekly_snapshots
CREATE TABLE IF NOT EXISTS weekly_snapshots (
  snapshot_id        BIGSERIAL PRIMARY KEY,
  entity_type        VARCHAR(50),
  entity_id          BIGINT,
  week_start         DATE,
  data               JSONB,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- monthly_snapshots
CREATE TABLE IF NOT EXISTS monthly_snapshots (
  snapshot_id        BIGSERIAL PRIMARY KEY,
  entity_type        VARCHAR(50),
  entity_id          BIGINT,
  month_start        DATE,
  data               JSONB,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_metric_proj ON developer_metrics(user_id);
CREATE INDEX IF NOT EXISTS idx_metric_dept ON department_metrics(department_id);
CREATE INDEX IF NOT EXISTS idx_metric_team ON team_metrics(team_id);
``` 

------------------------------------------------------------------------

## 9. AI

```sql
-- ai_provider
CREATE TABLE IF NOT EXISTS ai_provider (
  provider_id        BIGSERIAL PRIMARY KEY,
  name               VARCHAR(100) NOT NULL,
  api_key           TEXT,
  endpoint          TEXT,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- ai_models
CREATE TABLE IF NOT EXISTS ai_models (
  model_id           BIGSERIAL PRIMARY KEY,
  provider_id        BIGINT NOT NULL,
  name               VARCHAR(200) NOT NULL,
  version            VARCHAR(50),
  description        TEXT,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_provider FOREIGN KEY (provider_id) REFERENCES ai_provider(provider_id) ON DELETE CASCADE
);

-- ai_prompt_templates
CREATE TABLE IF NOT EXISTS ai_prompt_templates (
  template_id        BIGSERIAL PRIMARY KEY,
  model_id           BIGINT NOT NULL,
  name               VARCHAR(200) NOT NULL,
  prompt_text        TEXT NOT NULL,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_model FOREIGN KEY (model_id) REFERENCES ai_models(model_id) ON DELETE CASCADE
);

-- ai_chat_history
CREATE TABLE IF NOT EXISTS ai_chat_history (
  chat_id            BIGSERIAL PRIMARY KEY,
  user_id            BIGINT NOT NULL,
  model_id           BIGINT NOT NULL,
  conversation_id    BIGINT,
  messages           JSONB,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
  CONSTRAINT fk_model FOREIGN KEY (model_id) REFERENCES ai_models(model_id) ON DELETE CASCADE
);

-- ai_conversation
CREATE TABLE IF NOT EXISTS ai_conversation (
  conversation_id    BIGSERIAL PRIMARY KEY,
  user_id            BIGINT NOT NULL,
  title              VARCHAR(200),
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- ai_reports
CREATE TABLE IF NOT EXISTS ai_reports (
  report_id          BIGSERIAL PRIMARY KEY,
  conversation_id    BIGINT NOT NULL,
  report_text        TEXT,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_convo FOREIGN KEY (conversation_id) REFERENCES ai_conversation(conversation_id) ON DELETE CASCADE
);

-- ai_summary
CREATE TABLE IF NOT EXISTS ai_summary (
  summary_id         BIGSERIAL PRIMARY KEY,
  conversation_id    BIGINT NOT NULL,
  summary_text       TEXT,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_convo FOREIGN KEY (conversation_id) REFERENCES ai_conversation(conversation_id) ON DELETE CASCADE
);

-- ai_recommendations
CREATE TABLE IF NOT EXISTS ai_recommendations (
  recommendation_id  BIGSERIAL PRIMARY KEY,
  conversation_id    BIGINT NOT NULL,
  recommendation_text TEXT,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_convo FOREIGN KEY (conversation_id) REFERENCES ai_conversation(conversation_id) ON DELETE CASCADE
);

-- ai_prediction_logs
CREATE TABLE IF NOT EXISTS ai_prediction_logs (
  log_id             BIGSERIAL PRIMARY KEY,
  model_id           BIGINT NOT NULL,
  input_text         TEXT,
  output_text        TEXT,
  confidence         NUMERIC(5,2),
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_model FOREIGN KEY (model_id) REFERENCES ai_models(model_id) ON DELETE CASCADE
);

-- ai_feedback
CREATE TABLE IF NOT EXISTS ai_feedback (
  feedback_id        BIGSERIAL PRIMARY KEY,
  conversation_id    BIGINT NOT NULL,
  rating             INT,
  comments           TEXT,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_convo FOREIGN KEY (conversation_id) REFERENCES ai_conversation(conversation_id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ai_model_provider ON ai_models(provider_id);
CREATE INDEX IF NOT EXISTS idx_ai_prompt_model ON ai_prompt_templates(model_id);
``` 

------------------------------------------------------------------------

## 10. Reporting

```sql
-- reports
CREATE TABLE IF NOT EXISTS reports (
  report_id          BIGSERIAL PRIMARY KEY,
  project_id         BIGINT NOT NULL,
  name               VARCHAR(200) NOT NULL,
  description        TEXT,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_proj FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

-- report_templates
CREATE TABLE IF NOT EXISTS report_templates (
  template_id        BIGSERIAL PRIMARY KEY,
  name               VARCHAR(200) NOT NULL,
  template_text      TEXT NOT NULL,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- scheduled_reports
CREATE TABLE IF NOT EXISTS scheduled_reports (
  schedule_id        BIGSERIAL PRIMARY KEY,
  report_id          BIGINT NOT NULL,
  cron_expression    VARCHAR(100) NOT NULL,
  next_run           TIMESTAMP WITH TIME ZONE,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_report FOREIGN KEY (report_id) REFERENCES reports(report_id) ON DELETE CASCADE
);

-- report_history
CREATE TABLE IF NOT EXISTS report_history (
  history_id         BIGSERIAL PRIMARY KEY,
  report_id          BIGINT NOT NULL,
  run_at             TIMESTAMP WITH TIME ZONE DEFAULT now(),
  status             VARCHAR(50) DEFAULT 'success',
  output_path        TEXT,
  CONSTRAINT fk_report FOREIGN KEY (report_id) REFERENCES reports(report_id) ON DELETE CASCADE
);

-- report_export
CREATE TABLE IF NOT EXISTS report_export (
  export_id          BIGSERIAL PRIMARY KEY,
  history_id         BIGINT NOT NULL,
  format             VARCHAR(20) DEFAULT 'pdf',
  exported_at        TIMESTAMP WITH TIME ZONE DEFAULT now(),
  file_path          TEXT,
  CONSTRAINT fk_history FOREIGN KEY (history_id) REFERENCES report_history(history_id) ON DELETE CASCADE
);

-- report_delivery
CREATE TABLE IF NOT EXISTS report_delivery (
  delivery_id        BIGSERIAL PRIMARY KEY,
  export_id          BIGINT NOT NULL,
  recipient_email    VARCHAR(255),
  sent_at            TIMESTAMP WITH TIME ZONE,
  status             VARCHAR(50) DEFAULT 'queued',
  CONSTRAINT fk_export FOREIGN KEY (export_id) REFERENCES report_export(export_id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_report_proj ON reports(project_id);
CREATE INDEX IF NOT EXISTS idx_schedule_report ON scheduled_reports(report_id);
``` 

------------------------------------------------------------------------

## 11. Notifications

```sql
-- notifications
CREATE TABLE IF NOT EXISTS notifications (
  notification_id    BIGSERIAL PRIMARY KEY,
  user_id            BIGINT NOT NULL,
  type               VARCHAR(50) NOT NULL,
  payload            JSONB,
  read_at            TIMESTAMP WITH TIME ZONE,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- notification_templates
CREATE TABLE IF NOT EXISTS notification_templates (
  template_id        BIGSERIAL PRIMARY KEY,
  name               VARCHAR(200) NOT NULL,
  subject            VARCHAR(200),
  body_template      TEXT NOT NULL,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- notification_history
CREATE TABLE IF NOT EXISTS notification_history (
  history_id         BIGSERIAL PRIMARY KEY,
  notification_id    BIGINT NOT NULL,
  delivered_at       TIMESTAMP WITH TIME ZONE,
  status             VARCHAR(50) DEFAULT 'queued',
  CONSTRAINT fk_notification FOREIGN KEY (notification_id) REFERENCES notifications(notification_id) ON DELETE CASCADE
);

-- email_queue
CREATE TABLE IF NOT EXISTS email_queue (
  email_id           BIGSERIAL PRIMARY KEY,
  recipient_email    VARCHAR(255) NOT NULL,
  subject            VARCHAR(200),
  body               TEXT,
  queued_at          TIMESTAMP WITH TIME ZONE DEFAULT now(),
  sent_at            TIMESTAMP WITH TIME ZONE,
  status             VARCHAR(50) DEFAULT 'queued'
);

-- email_logs
CREATE TABLE IF NOT EXISTS email_logs (
  log_id             BIGSERIAL PRIMARY KEY,
  email_id           BIGINT NOT NULL,
  sent_at            TIMESTAMP WITH TIME ZONE,
  status             VARCHAR(50),
  error_message      TEXT,
  CONSTRAINT fk_email FOREIGN KEY (email_id) REFERENCES email_queue(email_id) ON DELETE CASCADE
);

-- webhook_logs
CREATE TABLE IF NOT EXISTS webhook_logs (
  log_id             BIGSERIAL PRIMARY KEY,
  webhook_url        TEXT NOT NULL,
  payload            JSONB,
  sent_at            TIMESTAMP WITH TIME ZONE,
  status             VARCHAR(50),
  response_code      INT,
  response_body      TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_notification_user ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_email_recipient ON email_queue(recipient_email);
``` 

------------------------------------------------------------------------

## 12. Audit

```sql
-- audit_logs
CREATE TABLE IF NOT EXISTS audit_logs (
  audit_id           BIGSERIAL PRIMARY KEY,
  entity_type        VARCHAR(50),
  entity_id          BIGINT,
  action             VARCHAR(50),
  performed_by       BIGINT,
  performed_at       TIMESTAMP WITH TIME ZONE DEFAULT now(),
  details            JSONB
);

-- user_activity
CREATE TABLE IF NOT EXISTS user_activity (
  activity_id        BIGSERIAL PRIMARY KEY,
  user_id            BIGINT NOT NULL,
  activity_type      VARCHAR(50),
  activity_data      JSONB,
  performed_at       TIMESTAMP WITH TIME ZONE DEFAULT now(),
  CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- api_logs
CREATE TABLE IF NOT EXISTS api_logs (
  log_id             BIGSERIAL PRIMARY KEY,
  user_id            BIGINT,
  endpoint           TEXT,
  method             VARCHAR(10),
  status_code        INT,
  response_time_ms   INT,
  request_body       JSONB,
  response_body      JSONB,
  logged_at          TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- system_logs
CREATE TABLE IF NOT EXISTS system_logs (
  log_id             BIGSERIAL PRIMARY KEY,
  level              VARCHAR(20),
  message            TEXT,
  logged_at          TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- error_logs
CREATE TABLE IF NOT EXISTS error_logs (
  error_id           BIGSERIAL PRIMARY KEY,
  error_message      TEXT,
  stack_trace        TEXT,
  occurred_at        TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- scheduler_logs
CREATE TABLE IF NOT EXISTS scheduler_logs (
  log_id             BIGSERIAL PRIMARY KEY,
  job_name           VARCHAR(200),
  status             VARCHAR(50),
  started_at         TIMESTAMP WITH TIME ZONE,
  finished_at        TIMESTAMP WITH TIME ZONE,
  details            JSONB
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(performed_by);
CREATE INDEX IF NOT EXISTS idx_api_user ON api_logs(user_id);
``` 

------------------------------------------------------------------------

## 13. Scheduler

```sql
-- scheduler_jobs
CREATE TABLE IF NOT EXISTS scheduler_jobs (
  job_id             BIGSERIAL PRIMARY KEY,
  name               VARCHAR(200) NOT NULL,
  cron_expression    VARCHAR(100) NOT NULL,
  enabled            BOOLEAN DEFAULT TRUE,
  created_at         TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- scheduler_history
CREATE TABLE IF NOT EXISTS scheduler_history (
  history_id         BIGSERIAL PRIMARY KEY,
  job_id             BIGINT NOT NULL,
  run_at             TIMESTAMP WITH TIME ZONE DEFAULT now(),
  status             VARCHAR(50) DEFAULT 'success',
  output             TEXT,
  CONSTRAINT fk_job FOREIGN KEY (job_id) REFERENCES scheduler_jobs(job_id) ON DELETE CASCADE
);

-- scheduler_failures
CREATE TABLE IF NOT EXISTS scheduler_failures (
  failure_id         BIGSERIAL PRIMARY KEY,
  job_id             BIGINT NOT NULL,
  occurred_at        TIMESTAMP WITH TIME ZONE DEFAULT now(),
  error_message      TEXT,
  CONSTRAINT fk_job FOREIGN KEY (job_id) REFERENCES scheduler_jobs(job_id) ON DELETE CASCADE
);

-- scheduler_configuration
CREATE TABLE IF NOT EXISTS scheduler_configuration (
  config_id          BIGSERIAL PRIMARY KEY,
  key                VARCHAR(100) NOT NULL,
  value              TEXT,
  description        TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_job_name ON scheduler_jobs(name);
``` 

------------------------------------------------------------------------

## 14. Configuration

```sql
-- system_settings
CREATE TABLE IF NOT EXISTS system_settings (
  setting_id         BIGSERIAL PRIMARY KEY,
  key                VARCHAR(100) NOT NULL UNIQUE,
  value              TEXT,
  description        TEXT
);

-- integration_settings
CREATE TABLE IF NOT EXISTS integration_settings (
  setting_id         BIGSERIAL PRIMARY KEY,
  provider           VARCHAR(50) NOT NULL,
  key                VARCHAR(100) NOT NULL,
  value              TEXT,
  description        TEXT
);

-- feature_flags
CREATE TABLE IF NOT EXISTS feature_flags (
  flag_id            BIGSERIAL PRIMARY KEY,
  name               VARCHAR(100) NOT NULL UNIQUE,
  enabled            BOOLEAN DEFAULT FALSE,
  description        TEXT
);

-- application_settings
CREATE TABLE IF NOT EXISTS application_settings (
  setting_id         BIGSERIAL PRIMARY KEY,
  key                VARCHAR(100) NOT NULL UNIQUE,
  value              TEXT,
  description        TEXT
);

-- email_settings
CREATE TABLE IF NOT EXISTS email_settings (
  setting_id         BIGSERIAL PRIMARY KEY,
  smtp_server        VARCHAR(200),
  smtp_port          INT,
  smtp_user          VARCHAR(200),
  smtp_password      TEXT,
  from_address       VARCHAR(200),
  use_tls            BOOLEAN DEFAULT TRUE
);

-- storage_settings
CREATE TABLE IF NOT EXISTS storage_settings (
  setting_id         BIGSERIAL PRIMARY KEY,
  provider           VARCHAR(50),
  bucket_name        VARCHAR(200),
  region             VARCHAR(100),
  access_key         TEXT,
  secret_key         TEXT
);

-- ai_settings
CREATE TABLE IF NOT EXISTS ai_settings (
  setting_id         BIGSERIAL PRIMARY KEY,
  key                VARCHAR(100) NOT NULL UNIQUE,
  value              TEXT,
  description        TEXT
);

-- security_settings
CREATE TABLE IF NOT EXISTS security_settings (
  setting_id         BIGSERIAL PRIMARY KEY,
  key                VARCHAR(100) NOT NULL UNIQUE,
  value              TEXT,
  description        TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sys_setting_key ON system_settings(key);
CREATE INDEX IF NOT EXISTS idx_app_setting_key ON application_settings(key);
``` 

------------------------------------------------------------------------

## 15. Master Tables

```sql
-- master_status
CREATE TABLE IF NOT EXISTS master_status (
  status_id          BIGSERIAL PRIMARY KEY,
  name               VARCHAR(50) NOT NULL UNIQUE,
  description        TEXT
);

-- master_priority
CREATE TABLE IF NOT EXISTS master_priority (
  priority_id        BIGSERIAL PRIMARY KEY,
  name               VARCHAR(50) NOT NULL UNIQUE,
  description        TEXT
);

-- master_severity
CREATE TABLE IF NOT EXISTS master_severity (
  severity_id        BIGSERIAL PRIMARY KEY,
  name               VARCHAR(50) NOT NULL UNIQUE,
  description        TEXT
);

-- master_department
CREATE TABLE IF NOT EXISTS master_department (
  department_id      BIGSERIAL PRIMARY KEY,
  name               VARCHAR(200) NOT NULL UNIQUE,
  description        TEXT
);

-- master_designation
CREATE TABLE IF NOT EXISTS master_designation (
  designation_id     BIGSERIAL PRIMARY KEY,
  name               VARCHAR(200) NOT NULL UNIQUE,
  description        TEXT
);

-- master_country
CREATE TABLE IF NOT EXISTS master_country (
  country_id         BIGSERIAL PRIMARY KEY,
  name               VARCHAR(200) NOT NULL UNIQUE,
  iso_code           CHAR(2) NOT NULL UNIQUE
);

-- master_state
CREATE TABLE IF NOT EXISTS master_state (
  state_id           BIGSERIAL PRIMARY KEY,
  country_id         BIGINT NOT NULL,
  name               VARCHAR(200) NOT NULL,
  iso_code           CHAR(3),
  CONSTRAINT fk_country FOREIGN KEY (country_id) REFERENCES master_country(country_id) ON DELETE CASCADE
);

-- master_city
CREATE TABLE IF NOT EXISTS master_city (
  city_id            BIGSERIAL PRIMARY KEY,
  state_id           BIGINT NOT NULL,
  name               VARCHAR(200) NOT NULL,
  CONSTRAINT fk_state FOREIGN KEY (state_id) REFERENCES master_state(state_id) ON DELETE CASCADE
);

-- master_language
CREATE TABLE IF NOT EXISTS master_language (
  language_id        BIGSERIAL PRIMARY KEY,
  name               VARCHAR(200) NOT NULL UNIQUE,
  iso_code           CHAR(2) NOT NULL UNIQUE
);

-- master_timezone
CREATE TABLE IF NOT EXISTS master_timezone (
  timezone_id        BIGSERIAL PRIMARY KEY,
  name               VARCHAR(200) NOT NULL UNIQUE,
  offset_hours       INT
);

-- master_currency
CREATE TABLE IF NOT EXISTS master_currency (
  currency_id        BIGSERIAL PRIMARY KEY,
  name               VARCHAR(200) NOT NULL UNIQUE,
  symbol             VARCHAR(5),
  iso_code           CHAR(3) NOT NULL UNIQUE
);

-- master_project_type
CREATE TABLE IF NOT EXISTS master_project_type (
  type_id            BIGSERIAL PRIMARY KEY,
  name               VARCHAR(200) NOT NULL UNIQUE,
  description        TEXT
);

-- master_integration
CREATE TABLE IF NOT EXISTS master_integration (
  integration_id     BIGSERIAL PRIMARY KEY,
  name               VARCHAR(200) NOT NULL UNIQUE,
  description        TEXT
);

-- master_notification_type
CREATE TABLE IF NOT EXISTS master_notification_type (
  type_id            BIGSERIAL PRIMARY KEY,
  name               VARCHAR(200) NOT NULL UNIQUE,
  description        TEXT
);

-- master_ai_provider
CREATE TABLE IF NOT EXISTS master_ai_provider (
  provider_id        BIGSERIAL PRIMARY KEY,
  name               VARCHAR(200) NOT NULL UNIQUE,
  description        TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_master_country_iso ON master_country(iso_code);
CREATE INDEX IF NOT EXISTS idx_master_state_iso ON master_state(iso_code);
CREATE INDEX IF NOT EXISTS idx_master_language_iso ON master_language(iso_code);
CREATE INDEX IF NOT EXISTS idx_master_currency_iso ON master_currency(iso_code);
``` 

------------------------------------------------------------------------

# Standard Table Template

## Module

Authentication

## Table

users

## Purpose

Stores all platform users.

## Relationships

  Related Table   Relation
  --------------- --------------
  roles           Many-to-Many
  organizations   Many-to-One
  projects        Many-to-Many

## Columns

  ------------------------------------------------------------------------------------------------------------------------
  Column Name Data Type      Default   Relation   Nullable   Comments   Column        Example Value       Used In
                             Value     Table                            Description                       
  ----------- -------------- --------- ---------- ---------- ---------- ------------- ------------------- ----------------
  user_id     BIGSERIAL      Auto                 No         Primary    User          101                 Authentication
                                                             Key        identifier                        

  full_name   VARCHAR(200)                        No                    User full     John Smith          User Profile
                                                                        name                              

  email       VARCHAR(255)                        No         Unique     Login email   admin@company.com   Authentication
  ------------------------------------------------------------------------------------------------------------------------

## Indexes

  Index Name        Columns   Type
  ----------------- --------- --------
  idx_users_email   email     Unique

## Notes

-   Use soft delete.
-   Encrypt passwords.
-   Email must be unique.

------------------------------------------------------------------------

# Estimated Database Size

  Module                Estimated Tables
  ------------------- ------------------
  Authentication                       9
  Organization                         5
  Projects                            10
  Teams                                6
  Git Integration                     15
  Taiga Integration                   11
  Sprint                               7
  Analytics                           16
  AI                                  10
  Reporting                            6
  Notifications                        6
  Audit                                6
  Scheduler                            4
  Configuration                        8
  Master Tables                       15

**Estimated Total:** **140--150 tables**
