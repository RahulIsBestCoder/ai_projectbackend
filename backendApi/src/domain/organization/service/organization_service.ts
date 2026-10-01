import { OrganizationModel } from '../models/organization_model';
import { IServiceResult } from '../../../helper/common_interface';
import { IOrganizationCreate, IOrganizationUpdate } from '../interface/organization_interface';
import mongoose from 'mongoose';
import { reporterKey, qaEfficiency, eligibleReporting, reporterDepartmentName, reporterDepartmentDescription } from './qa_reporting';
import { REPO_CATEGORIES, REPO_CATEGORY_VALUES, normalizeRepoCategory } from '../../git_intelligence/interface/git_intelligence_interface';

const ACTIVE_WINDOW_DAYS = 30;

const TESTING_DEPARTMENT = {
  value: 'testing', label: 'QA / Testing', color: '#ef4444', description: 'People who create issues or tasks in Taiga',
};

/**
 * `OrganizationService` – Business logic for organization CRUD and settings.
 */
export class OrganizationService {
  private readonly _orgModel = new OrganizationModel();
  private readonly logName = 'organization_service';

  private initLog(): void {
    /* parity with plan convention */
  }

  private log(method: string, msg: unknown, severity = 'INFO'): void {
    global.logs.writelog(`${this.logName}.${method}`, msg, severity);
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: createOrganization
   */
  public async createOrganization(param: IOrganizationCreate): Promise<IServiceResult> {
    this.initLog();
    this.log('createOrganization', ['Request : ', param]);
    try {
      const existing = await this._orgModel.findByAny({ name: param.name });
      if (existing) {
        return global.Helpers.makeBadServiceStatus('Organization already exists.');
      }
      const newOrg = await this._orgModel.addNewRecord(param);
      this.log('Add new organization result:', newOrg);
      return global.Helpers.makeSuccessServiceStatus('Organization created.', newOrg);
    } catch (err: any) {
      this.log('createOrganization', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: getOrganization
   */
  public async getOrganization(orgId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getOrganization', ['Request : ', orgId]);
    try {
      const org = await this._orgModel.findByAny({ _id: orgId });
      if (!org) {
        return global.Helpers.makeBadServiceStatus('Organization not found.');
      }
      return global.Helpers.makeSuccessServiceStatus('Organization fetched.', org);
    } catch (err: any) {
      this.log('getOrganization', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: updateOrganization
   */
  public async updateOrganization(orgId: string, param: IOrganizationUpdate): Promise<IServiceResult> {
    this.initLog();
    this.log('updateOrganization', ['Request : ', { orgId, param }]);
    try {
      const updated = await this._orgModel.updateAnyRecord({ _id: orgId }, param);
      this.log('Update organization result:', updated);
      return global.Helpers.makeSuccessServiceStatus('Organization updated.', updated);
    } catch (err: any) {
      this.log('updateOrganization', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: deleteOrganization
   */
  public async deleteOrganization(orgId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('deleteOrganization', ['Request : ', orgId]);
    try {
      const deleted = await this._orgModel.updateAnyRecord({ _id: orgId }, { is_deleted: true });
      this.log('Delete organization result:', deleted);
      return global.Helpers.makeSuccessServiceStatus('Organization deleted.', deleted);
    } catch (err: any) {
      this.log('deleteOrganization', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: listOrganizations
   */
  public async listOrganizations(page: number = 1, limit: number = 20): Promise<IServiceResult> {
    this.initLog();
    this.log('listOrganizations', ['Request : ', { page, limit }]);
    try {
      const filter = { is_deleted: { $ne: true } };
      const offset = (page - 1) * limit;
      const orgs = await this._orgModel.findSelectiveByAny({
        data: filter,
        attributes: '',
        offset,
        limit,
        sort: { created_at: -1 },
      });
      const total = await this._orgModel.countAllByAny(filter);
      return global.Helpers.makeSuccessServiceStatus('Organizations fetched.', {
        rows: orgs,
        count: orgs.length,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
        total,
      });
    } catch (err: any) {
      this.log('listOrganizations', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /* ==================== departments (plan §03) ==================== */

  private static readonly DEPT_NAMES: Record<string, string> = {
    'dept-eng': 'Engineering', 'dept-product': 'Product',
    'dept-design': 'Design', 'dept-qa': 'Quality Assurance',
  };

  /*
   * Commit authors grouped into departments by the category of the repository
   * they committed to (ui / backend / apps / shared / other), plus a QA / Testing
   * department of Taiga issue creators. A person active in several departments
   * appears in each of them.
   */
  private async _departments(organizationId?: string, projectIdFilter?: string[]): Promise<{ departments: any[]; totalEmployees: number; unlinkedRepositoryCount: number }> {
    const db = global.db.connection.db!;
    const projectFilter: any = { is_deleted: { $ne: true } };
    if (organizationId) {
      projectFilter.organization_id = mongoose.Types.ObjectId.isValid(organizationId)
        ? { $in: [organizationId, new mongoose.Types.ObjectId(organizationId)] }
        : organizationId;
    }
    if (projectIdFilter) {
      projectFilter._id = {
        $in: projectIdFilter.filter(id => mongoose.Types.ObjectId.isValid(id)).map(id => new mongoose.Types.ObjectId(id)),
      };
    }
    const projects = await db.collection('projects').find(projectFilter).project({ name: 1 }).toArray();
    const projectNames = new Map(projects.map((p: any) => [String(p._id), p.name]));
    const projectIds = [...projectNames.keys()];
    if (!projectIds.length) return { departments: [], totalEmployees: 0, unlinkedRepositoryCount: 0 };

    const repos = await db.collection('git_intelligence')
      .find({ project_id: { $in: projectIds }, is_deleted: { $ne: true } })
      .project({ name: 1, category: 1, project_id: 1 }).toArray();
    const repoByKey = new Map<string, any>();
    for (const repo of repos) {
      repoByKey.set(`${repo.project_id}|${String(repo._id)}`, repo);
      if (repo.name) repoByKey.set(`${repo.project_id}|${repo.name}`, repo);
    }

    const groups = await db.collection('commits').aggregate([
      { $match: { project_id: { $in: projectIds }, is_deleted: { $ne: true } } },
      { $group: {
        _id: {
          project_id: '$project_id',
          repository_id: '$repository_id',
          email: { $toLower: { $ifNull: ['$author_email', ''] } },
          name: { $ifNull: ['$author_name', ''] },
        },
        commits: { $sum: 1 },
        additions: { $sum: { $ifNull: ['$additions', 0] } },
        deletions: { $sum: { $ifNull: ['$deletions', 0] } },
        last_commit_at: { $max: '$committed_at' },
        first_commit_at: { $min: '$committed_at' },
      } },
    ]).toArray();

    const emails = [...new Set(groups.map((g: any) => g._id.email).filter(Boolean))];
    const users = emails.length ? await db.collection('users')
      .find({ email: { $in: emails } })
      .project({ email: 1, name: 1, role: 1, is_active: 1 }).toArray() : [];
    const userByEmail = new Map(users.map((u: any) => [String(u.email).toLowerCase(), u]));

    const activeSince = Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const byCategory = new Map<string, { employees: Map<string, any>; repositories: Map<string, any> }>();
    const allEmployees = new Set<string>();
    const unlinkedRepositories = new Set<string>();

    for (const group of groups) {
      const { project_id: projectId, repository_id: repositoryId, email, name } = group._id;
      // GitHub noreply addresses look like "<id>+<login>@users.noreply.github.com"; merge them with the
      // author's other email by login so one person is not listed twice.
      const noreplyLogin = /^(?:\d+\+)?([^@]+)@users\.noreply\.github\.com$/.exec(email)?.[1];
      const login = String(noreplyLogin || name || '').trim().toLowerCase();
      const key = login ? `login:${login}` : email;
      if (!key) continue;
      const repo = repoByKey.get(`${projectId}|${repositoryId}`);
      const category = normalizeRepoCategory(repo?.category);
      if (!byCategory.has(category)) byCategory.set(category, { employees: new Map(), repositories: new Map() });
      const bucket = byCategory.get(category)!;
      allEmployees.add(key);
      if (!repo) unlinkedRepositories.add(String(repositoryId));

      const repoId = repo ? String(repo._id) : String(repositoryId);
      if (!bucket.repositories.has(repoId)) {
        bucket.repositories.set(repoId, {
          id: repoId, name: repo?.name || null, linked: Boolean(repo),
          project_id: projectId, project_name: projectNames.get(projectId) || null,
        });
      }

      const user: any = email ? userByEmail.get(email) : undefined;
      const employee = bucket.employees.get(key) || {
        id: key, user_id: null, name: name || email, login: login || null,
        email: null, emails: new Set<string>(), role: null,
        commits: 0, additions: 0, deletions: 0, last_commit_at: null, first_commit_at: null,
        repositories: new Set<string>(), projects: new Set<string>(),
      };
      if (email) {
        employee.emails.add(email);
        if (!employee.email || employee.email.endsWith('@users.noreply.github.com')) employee.email = email;
      }
      if (user && !employee.user_id) {
        employee.user_id = String(user._id);
        employee.name = user.name || employee.name;
        employee.role = user.role || null;
      }
      employee.commits += group.commits;
      employee.additions += group.additions;
      employee.deletions += group.deletions;
      if (group.last_commit_at && (!employee.last_commit_at || group.last_commit_at > employee.last_commit_at)) {
        employee.last_commit_at = group.last_commit_at;
        if (!employee.user_id && name) employee.name = name;
      }
      if (group.first_commit_at && (!employee.first_commit_at || group.first_commit_at < employee.first_commit_at)) {
        employee.first_commit_at = group.first_commit_at;
      }
      employee.repositories.add(repoId);
      employee.projects.add(projectId);
      bucket.employees.set(key, employee);
    }

    const departments: any[] = REPO_CATEGORIES.filter(c => byCategory.has(c.value)).map(category => {
      const bucket = byCategory.get(category.value)!;
      const employees = [...bucket.employees.values()]
        .map(e => ({
          ...e,
          active: Boolean(e.last_commit_at && new Date(e.last_commit_at).getTime() >= activeSince),
          emails: [...e.emails],
          repositories: [...e.repositories],
          projects: [...e.projects].map(id => ({ id, name: projectNames.get(id) || null })),
        }))
        .sort((a, b) => b.commits - a.commits);
      const repositories = [...bucket.repositories.values()];
      return {
        id: category.value,
        _id: category.value,
        department_id: category.value,
        name: category.label,
        color: category.color,
        description: category.description,
        member_count: employees.length,
        active_count: employees.filter(e => e.active).length,
        commit_count: employees.reduce((sum, e) => sum + e.commits, 0),
        additions: employees.reduce((sum, e) => sum + e.additions, 0),
        deletions: employees.reduce((sum, e) => sum + e.deletions, 0),
        teams: [...new Set(repositories.map(r => r.name).filter(Boolean))],
        repositories,
        employees,
      };
    });
    // Testers log bugs either as Taiga issues or as Taiga tasks, so both creators count as QA reporters.
    const reporterPipeline = (idField: string) => [
      { $match: { project_id: { $in: projectIds }, is_deleted: { $ne: true }, [idField]: { $exists: true, $ne: null } } },
      { $group: {
        _id: {
          project_id: '$project_id',
          username: { $ifNull: ['$owner_username', ''] },
          owner_id: '$owner_id',
          full_name: { $ifNull: ['$owner_full_name', ''] },
        },
        reported: { $sum: 1 },
        closed: { $sum: { $cond: ['$is_closed', 1, 0] } },
        first_reported_at: { $min: '$created_date' },
        last_reported_at: { $max: '$created_date' },
      } },
    ];
    const [issueGroups, taskGroups] = await Promise.all([
      db.collection('taiga_issues').aggregate(reporterPipeline('taiga_issue_id')).toArray(),
      db.collection('taiga_tasks').aggregate(reporterPipeline('taiga_task_id')).toArray(),
    ]);
    const toDate = (value: any): Date | null => {
      if (!value) return null;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    };

    const classifications = await db.collection('qa_reporter_roles')
      .find({ project_id: { $in: projectIds } }).toArray();
    const roleByReporter = new Map(classifications.map((row: any) => [`${row.project_id}|${row.reporter_id}`, row.reporting_role]));
    const testers = new Map<string, any>();
    for (const rawGroup of [...issueGroups.map((group: any) => ({ ...group, source: 'issue' })), ...taskGroups.map((group: any) => ({ ...group, source: 'task' }))]) {
      const group: any = {
        ...rawGroup,
        first_reported_at: toDate(rawGroup.first_reported_at),
        last_reported_at: toDate(rawGroup.last_reported_at),
      };
      const { project_id: projectId, username, owner_id: ownerId, full_name: fullName } = group._id;
      const login = String(username || '').trim().toLowerCase();
      const key = reporterKey(username, ownerId);
      if (!key) continue;
      allEmployees.add(key);
      const tester = testers.get(key) || {
        id: key, user_id: null, name: fullName || username || String(ownerId), login: login || null,
        email: null, emails: [], role: null,
        commits: 0, additions: 0, deletions: 0, last_commit_at: null, first_commit_at: null,
        repositories: [], projects: new Set<string>(),
        reporting_roles: new Set<string>(), eligible_reported: 0, eligible_closed: 0,
        tasks: { created: 0, closed: 0 },
        issues: { reported: 0, open: 0, closed: 0, first_reported_at: null, last_reported_at: null },
      };
      tester.issues.reported += group.reported;
      if (group.source === 'task') {
        tester.tasks.created += group.reported;
        tester.tasks.closed += group.closed;
      }
      const reportingRole = roleByReporter.get(`${projectId}|${key}`) === 'manager' ? 'manager' : 'qa';
      tester.reporting_roles.add(reportingRole);
      const eligible = eligibleReporting(reportingRole, group.reported, group.closed);
      tester.eligible_reported += eligible.reported;
      tester.eligible_closed += eligible.closed;
      tester.issues.closed += group.closed;
      tester.issues.open += group.reported - group.closed;
      if (group.first_reported_at && (!tester.issues.first_reported_at || group.first_reported_at < tester.issues.first_reported_at)) {
        tester.issues.first_reported_at = group.first_reported_at;
      }
      if (group.last_reported_at && (!tester.issues.last_reported_at || group.last_reported_at > tester.issues.last_reported_at)) {
        tester.issues.last_reported_at = group.last_reported_at;
      }
      tester.projects.add(projectId);
      testers.set(key, tester);
    }

    if (testers.size) {
      const employees = [...testers.values()]
        .map(t => ({
          ...t,
          reporting_roles: [...t.reporting_roles],
          reporting_role: t.reporting_roles.size > 1 ? 'mixed' : [...t.reporting_roles][0],
          efficiency_eligible: t.reporting_roles.has('qa'),
          efficiency: t.reporting_roles.has('qa') ? qaEfficiency(t.eligible_reported, t.eligible_closed) : null,
          active: Boolean(t.issues.last_reported_at && new Date(t.issues.last_reported_at).getTime() >= activeSince),
          projects: [...t.projects].map((id: string) => ({ id, name: projectNames.get(id) || null })),
        }))
        .sort((a, b) => b.issues.reported - a.issues.reported);
      const issueCount = employees.reduce((sum, e) => sum + e.issues.reported, 0);
      const closedCount = employees.reduce((sum, e) => sum + e.issues.closed, 0);
      departments.push({
        id: TESTING_DEPARTMENT.value,
        _id: TESTING_DEPARTMENT.value,
        department_id: TESTING_DEPARTMENT.value,
        name: reporterDepartmentName(employees.map(e => e.reporting_role)),
        color: TESTING_DEPARTMENT.color,
        description: reporterDepartmentDescription(employees.map(e => e.reporting_role)),
        member_count: employees.length,
        active_count: employees.filter(e => e.active).length,
        commit_count: 0,
        additions: 0,
        deletions: 0,
        issue_count: issueCount,
        open_issue_count: issueCount - closedCount,
        closed_issue_count: closedCount,
        tasks: {
          created: employees.reduce((sum, e) => sum + e.tasks.created, 0),
          closed: employees.reduce((sum, e) => sum + e.tasks.closed, 0),
        },
        efficiency: qaEfficiency(
          employees.reduce((sum, e) => sum + e.eligible_reported, 0),
          employees.reduce((sum, e) => sum + e.eligible_closed, 0),
        ),
        teams: [...new Set(employees.flatMap(e => e.projects.map((p: any) => p.name)).filter(Boolean))],
        repositories: [],
        employees,
      });
    }

    return { departments, totalEmployees: allEmployees.size, unlinkedRepositoryCount: unlinkedRepositories.size };
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: listDepartments
   * @Description: Departments = repository categories; employees = commit
   *               authors of the organization's project repositories.
   */
  public async listDepartments(organizationId?: string, projectIds?: string[]): Promise<IServiceResult> {
    this.initLog();
    this.log('listDepartments', ['Request : ', { organizationId, projectIds }]);
    try {
      const { departments, totalEmployees, unlinkedRepositoryCount } = await this._departments(organizationId, projectIds);
      return global.Helpers.makeSuccessServiceStatus('Departments fetched.', {
        rows: departments,
        count: departments.length,
        total_employees: totalEmployees,
        unlinked_repository_count: unlinkedRepositoryCount,
        active_window_days: ACTIVE_WINDOW_DAYS,
        source: 'commits_by_repository_category',
        organization_id: organizationId || null,
        project_ids: projectIds || null,
      });
    } catch (err: any) {
      this.log('listDepartments', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  public async setQaReporterRole(projectId: string, reporterId: string, role: unknown, actorId: string): Promise<IServiceResult> {
    if (!mongoose.Types.ObjectId.isValid(projectId) || !reporterId || !['qa', 'manager'].includes(String(role))) {
      return global.Helpers.makeBadServiceStatus('Valid project, reporter and qa/manager role are required.');
    }
    const { departments } = await this._departments(undefined, [projectId]);
    if (!departments.find(d => d.id === 'testing')?.employees.some((e: any) => e.id === reporterId)) {
      return global.Helpers.makeBadServiceStatus('Reporter not found in this project.');
    }
    const now = new Date();
    // A deterministic primary key makes repeated/concurrent saves an atomic upsert.
    await global.db.connection.db!.collection<any>('qa_reporter_roles').updateOne(
      { _id: `${projectId}|${reporterId}` },
      { $set: { project_id: projectId, reporter_id: reporterId, reporting_role: role, updated_by: actorId, updated_at: now },
        $setOnInsert: { created_at: now } },
      { upsert: true },
    );
    return global.Helpers.makeSuccessServiceStatus('Reporter classification saved.', { reporter_id: reporterId, reporting_role: role });
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: getDepartmentMetrics
   * @Description: Workforce metrics for one department: headcount, roles,
   *               teams, projects touched and assigned work items.
   */
  public async getDepartmentMetrics(departmentId: string, organizationId?: string, projectIdFilter?: string[]): Promise<IServiceResult> {
    this.initLog();
    this.log('getDepartmentMetrics', ['Request : ', { departmentId, organizationId, projectIds: projectIdFilter }]);
    try {
      if (!departmentId || departmentId === 'undefined' || departmentId === 'null') {
        return global.Helpers.makeBadServiceStatus('Department id is required.');
      }
      const db = global.db.connection.db!;
      if (REPO_CATEGORY_VALUES.includes(departmentId) || departmentId === TESTING_DEPARTMENT.value) {
        const { departments } = await this._departments(organizationId, projectIdFilter);
        const department = departments.find(d => d.id === departmentId);
        if (!department) return global.Helpers.makeBadServiceStatus('Department not found.');
        const userIds = department.employees.filter((e: any) => e.efficiency_eligible !== false).map((e: any) => e.user_id).filter(Boolean);
        const workAgg = userIds.length ? await db.collection('work_items').aggregate([
          { $match: { assignee_id: { $in: userIds }, is_deleted: false } },
          { $group: { _id: '$status', count: { $sum: 1 }, points: { $sum: { $ifNull: ['$story_points', 0] } } } },
        ]).toArray() : [];
        const byStatus: Record<string, any> = {};
        let totalItems = 0, totalPoints = 0;
        for (const w of workAgg) {
          byStatus[w._id] = { count: w.count, points: w.points };
          totalItems += w.count; totalPoints += w.points;
        }
        const roles: Record<string, number> = {};
        for (const e of department.employees) if (e.role) roles[e.role] = (roles[e.role] || 0) + 1;
        const projects = new Map<string, any>();
        for (const repo of department.repositories) projects.set(repo.project_id, { _id: repo.project_id, name: repo.project_name });
        for (const employee of department.employees) {
          for (const project of employee.projects) if (!projects.has(project.id)) projects.set(project.id, { _id: project.id, name: project.name });
        }
        return global.Helpers.makeSuccessServiceStatus('Department metrics fetched.', {
          department_id: department.id,
          name: department.name,
          color: department.color,
          headcount: department.member_count,
          active_count: department.active_count,
          roles,
          teams: Object.fromEntries(department.repositories.map((r: any) => [r.name,
            department.employees.filter((e: any) => e.repositories.includes(r.id)).length])),
          projects: { count: projects.size, rows: [...projects.values()] },
          commits: { total: department.commit_count, additions: department.additions, deletions: department.deletions },
          ...(department.id === TESTING_DEPARTMENT.value ? {
            issues: { total: department.issue_count, open: department.open_issue_count, closed: department.closed_issue_count },
            efficiency: department.efficiency,
            tasks: department.tasks,
          } : {}),
          repositories: department.repositories,
          employees: department.employees,
          work_items: { total: totalItems, total_points: totalPoints, by_status: byStatus },
        });
      }
      const users = await db.collection('users').find({ department_id: departmentId }).toArray();
      if (!users.length) return global.Helpers.makeBadServiceStatus('Department not found.');
      const userIds = users.map((u: any) => String(u._id));

      const roles: Record<string, number> = {};
      const teams: Record<string, number> = {};
      for (const u of users) {
        if (u.role) roles[u.role] = (roles[u.role] || 0) + 1;
        if (u.team_id) teams[u.team_id] = (teams[u.team_id] || 0) + 1;
      }
      const memberships = await db.collection('project_members')
        .find({ user_id: { $in: userIds }, is_deleted: false }).toArray();
      const projectIds = [...new Set(memberships.map((m: any) => String(m.project_id)))];
      const projects = projectIds.length ? await db.collection('projects')
        .find(
          { _id: { $in: projectIds.map((p) => new mongoose.Types.ObjectId(p)) } },
          { projection: { name: 1, health_score: 1, status: 1 } },
        ).toArray() : [];
      const workAgg = await db.collection('work_items').aggregate([
        { $match: { assignee_id: { $in: userIds }, is_deleted: false } },
        { $group: { _id: '$status', count: { $sum: 1 }, points: { $sum: { $ifNull: ['$story_points', 0] } } } },
      ]).toArray();
      const byStatus: Record<string, any> = {};
      let totalItems = 0, totalPoints = 0;
      for (const w of workAgg) {
        byStatus[w._id] = { count: w.count, points: w.points };
        totalItems += w.count; totalPoints += w.points;
      }
      const name = OrganizationService.DEPT_NAMES[departmentId]
        || String(departmentId).replace(/^dept-/, '').replace(/\b\w/g, (c: string) => c.toUpperCase());
      return global.Helpers.makeSuccessServiceStatus('Department metrics fetched.', {
        department_id: departmentId,
        name,
        headcount: users.length,
        active_count: users.filter((u: any) => u.is_active).length,
        roles,
        teams,
        projects: { count: projects.length, rows: projects },
        work_items: { total: totalItems, total_points: totalPoints, by_status: byStatus },
      });
    } catch (err: any) {
      this.log('getDepartmentMetrics', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }
}
