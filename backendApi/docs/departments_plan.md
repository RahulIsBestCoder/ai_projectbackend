# Departments by Repository Type: UI Integration Plan

## Goal

Show the organization's workforce grouped into **departments by repository type** (UI Team,
Backend, Apps, Shared, Other). The employees are the people who committed code to repositories of that type.
People are no longer grouped by the department set on their user accounts.

## Endpoints

Unwrap the standard envelope. Treat `response.status.action_status === false` as an error, even when the HTTP status is 200.

| Purpose | Request |
| --- | --- |
| Department list with employees | `GET /v1/departments?organization_id=<orgId>[&project_id=<id>[,<id>]]` |
| One department's details | `GET /v1/departments/:departmentId/metrics?organization_id=<orgId>[&project_id=<id>[,<id>]]` |

- `departmentId` is the repository type (`ui`, `backend`, `apps`, `shared`, `other`) or `testing` for QA / Testing.
- `project_id` is **required**: the currently selected project's id. The Departments section shows data for the selected project only. Without a valid `project_id` both calls return an error ("Select a project: a valid project_id is required."). Send the same value to the list and metrics calls so the numbers match.
- Always send `organization_id` to the metrics call too. Without it, the backend counts commits from every organization.
- Send `Cache-Control: no-cache`, or give the query a cache key that includes `organization_id`, so a cached 304 doesn't hide newly synced commits.

## Response shape

```ts
interface DepartmentsResponse {
  rows: Department[];
  count: number;
  total_employees: number;            // unique people across all departments
  unlinked_repository_count: number;  // commits whose repository is unknown (counted under Other)
  active_window_days: number;         // 30
  source: 'commits_by_repository_category';
  organization_id: string | null;
  project_ids: string[] | null;       // echo of the project filter, null when not filtered
}

interface Department {
  id: 'ui' | 'backend' | 'apps' | 'shared' | 'other' | 'testing';   // also in _id and department_id
  name: string;                // "UI Team", "Backend", ...
  color: string;               // hex, use for chips/charts
  description: string;
  member_count: number;
  active_count: number;        // committed in the last 30 days
  commit_count: number;
  additions: number;
  deletions: number;
  teams: string[];             // repository names
  repositories: { id: string; name: string | null; linked: boolean; project_id: string; project_name: string | null }[];
  employees: Employee[];       // sorted by commits (testing: by issues reported), highest first
  // testing department only
  issue_count?: number;
  open_issue_count?: number;
  closed_issue_count?: number;
}

interface Employee {
  id: string;                  // stable key, e.g. "login:sougata-mass"
  user_id: string | null;      // set when a commit email matches a user account
  name: string;
  login: string | null;        // GitHub username
  email: string | null;        // preferred (work) email
  emails: string[];            // every email seen in commits
  role: string | null;
  commits: number;
  additions: number;
  deletions: number;
  first_commit_at: string | null;
  last_commit_at: string | null;
  active: boolean;             // last commit within 30 days
  repositories: string[];      // repository ids (match Department.repositories[].id)
  projects: { id: string; name: string | null }[];
  // testing department only; active = reported an issue in the last 30 days
  issues?: { reported: number; open: number; closed: number; first_reported_at: string | null; last_reported_at: string | null };
}
```

### Metrics response (`/departments/:id/metrics`)
```ts
interface DepartmentMetrics {
  department_id: string; name: string; color: string;
  headcount: number; active_count: number;
  roles: Record<string, number>;
  teams: Record<string, number>;             // repository name → contributors
  projects: { count: number; rows: { _id: string; name: string | null }[] };
  commits: { total: number; additions: number; deletions: number };
  issues?: { total: number; open: number; closed: number };   // testing only
  repositories: Department['repositories'];
  employees: Employee[];
  work_items: { total: number; total_points: number; by_status: Record<string, { count: number; points: number }> };
}
```

## Layout

### 1. Summary strip
- Total employees (`total_employees`)
- Total departments (`count`)
- Total commits (sum of `commit_count`)
- Active in the last 30 days: sum of `active_count`. Label it "Active in last 30 days", because a person in two departments is counted twice.
- If `unlinked_repository_count > 0`, a small grey note: "N repositories without a type are grouped under Other".

### 2. Department cards (one per `rows[]`)
- Header: a colour dot or border using `color`, then `name` and `description`
- Stats: members, active, commits, and `+additions / −deletions`
- Repository chips from `repositories`:
  - Linked repositories show `name`, with `project_name` in a tooltip
  - Unlinked repositories (`linked: false`) show a grey "Unknown repository" chip
- Top 5 contributors: avatar initials, name, commits, and an active dot
- A **View department** link opens the detail view

### 3. Department detail (drawer or page)
Load `GET /v1/departments/:id/metrics?organization_id=...`, then show:
- Stat tiles: headcount, active, commits, projects, work items (total and points)
- An employee table:

| Column | Source |
| --- | --- |
| Name | `name`; show `login` underneath in muted text |
| Email | `email`; a tooltip lists `emails` when there are several |
| Role | `role` or "—" |
| Commits | `commits` (sortable, default sort) |
| Lines | `+additions / −deletions` |
| Last commit | relative time from `last_commit_at` |
| Status | "Active" (green) / "Inactive" (grey) from `active` |
| Projects | chips from `projects[].name` |

- Repositories list: `repositories` with a contributor count taken from `teams[repositoryName]`
- Work items by status: small bar chart from `work_items.by_status`, hidden when `total === 0`

## Project filter

- The Departments section always uses the **currently selected project** (the app's project selector). There is no "All projects" view.
- Send `project_id=<selectedProjectId>` to the list call and to every detail call. Refetch when the selected project changes, and clear the open detail view.
- Until a project is selected, don't call the API. Show "Select a project to see its departments."
- Read `project_ids` from the response to confirm the result belongs to the selected project before rendering (ignore late responses for a previously selected project).
- An empty `rows` shows: "No commit or Taiga data for this project yet. Connect GitHub/Taiga and run a sync."

## QA / Testing department

- `id: 'testing'`, name "QA / Testing". Its members are the people who created Taiga **issues or tasks** (testers often log bugs as tasks). It only appears when at least one such item exists for the selected projects.
- The `issues` counts on these members cover both Taiga issues and tasks they created. Label them "Reported" in the UI.
- Card stats: members, active (reported in the last 30 days), **issues reported / open / closed** (`issue_count`, `open_issue_count`, `closed_issue_count`). Hide the commit and lines stats and the repository chips (`repositories` is empty); show project chips from `teams`.
- Top contributors: sort by `issues.reported` and show "12 issues (3 open)" instead of commits.
- Detail employee table for testing replaces Commits / Lines / Last commit with **Reported**, **Open**, **Closed** and **Last reported** (`issues.last_reported_at`).
- A person who writes code and also reports issues appears in both departments. Use the same "Also in" hint (match `employee.id`).
- Testing data comes from the Taiga sync. After a Taiga sync (or AI Sync on a project with Taiga connected), refetch the departments query.

## Behaviour and rendering rules

| Case | UI |
| --- | --- |
| `rows` is empty | Empty state: "No commit data yet. Connect a GitHub repository and run AI Sync." |
| Person appears in two departments | Show them in both. Add a "Also in: Backend" hint by matching `employee.id` across departments. |
| `user_id` is null | Show "Not linked to an account" in muted text and disable profile links |
| `role` null | "—" |
| `active_count === 0` | Show "0 active" in grey, not red |
| Department `other` | Add the note "Repositories without a team type" and a link to the repository settings, where the type can be set |

- Use `employee.id` as the list key, not `email`: one person can have several emails.
- Use `department.id` as the key and as the route parameter. Never build `/departments/undefined/metrics`.
- After **AI Sync** finishes for a project, refetch the departments query, because new commits change the counts.

## Client service sketch

```ts
getDepartments(organizationId: string, projectId: string) {
  return this.http.get<ApiEnvelope<DepartmentsResponse>>('/v1/departments', {
    params: { organization_id: organizationId, project_id: projectId },
    headers: { 'Cache-Control': 'no-cache' },
  }).pipe(map(unwrapEnvelope));
}

getDepartmentMetrics(departmentId: string, organizationId: string, projectId: string) {
  return this.http.get<ApiEnvelope<DepartmentMetrics>>(
    `/v1/departments/${encodeURIComponent(departmentId)}/metrics`,
    {
      params: { organization_id: organizationId, project_id: projectId },
      headers: { 'Cache-Control': 'no-cache' },
    },
  ).pipe(map(unwrapEnvelope));
}

function unwrapEnvelope<T>(envelope: ApiEnvelope<T>): T {
  if (!envelope.response.status.action_status) throw new Error(envelope.response.status.msg);
  return envelope.response.dataset;
}
```

## Errors

| Response | UI |
| --- | --- |
| `action_status: false`, "Department not found." | Detail view: "This department has no contributors" with a back link |
| Network or other error | Keep any rendered data; show an inline error with Retry |

## Accessibility

- Don't use colour alone: always show the department name and the active or inactive text.
- Make the employee table a real `<table>` with sortable column headers (`aria-sort`).

## Acceptance checks

- The department list shows UI Team, Backend and Other for the current organization, with member and commit counts.
- One person with a GitHub noreply email and a work email is shown once per department.
- A person who committed to UI and Backend repositories appears in both, with the "Also in" hint.
- Opening a department loads the metrics with the same `organization_id` and shows the employee table.
- Unlinked repositories show as "Unknown repository" and never as raw ids.
- After AI Sync, the department counts update without a full page reload.
