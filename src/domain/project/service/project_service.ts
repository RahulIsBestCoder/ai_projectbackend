import { ProjectModel } from '../models/project_model';
import { IServiceResult } from '../../../helper/common_interface';
import { IProjectCreate, IProjectUpdate } from '../interface/project_interface';
import mongoose from 'mongoose';

/**
 * `ProjectService` – Business logic for project CRUD and settings.
 */
export class ProjectService {
  private readonly _projectModel = new ProjectModel();
  private readonly logName = 'project_service';

  private initLog(): void {
    /* parity with plan convention */
  }

  private log(method: string, msg: unknown, severity = 'INFO'): void {
    global.logs.writelog(`${this.logName}.${method}`, msg, severity);
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: createProject
   */
  public async createProject(param: IProjectCreate): Promise<IServiceResult> {
    this.initLog();
    this.log('createProject', ['Request : ', param]);
    try {
      const existing = await this._projectModel.findByAny({ name: param.name, organization_id: param.organization_id });
      if (existing) {
        return global.Helpers.makeBadServiceStatus('Project already exists.');
      }
      const newProject = await this._projectModel.addNewRecord(param);
      this.log('Add new project result:', newProject);
      return global.Helpers.makeSuccessServiceStatus('Project created.', newProject);
    } catch (err: any) {
      this.log('createProject', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: getProject
   */
  public async getProject(projectId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getProject', ['Request : ', projectId]);
    try {
      const project = await this._projectModel.findByAny({ _id: projectId });
      if (!project) {
        return global.Helpers.makeBadServiceStatus('Project not found.');
      }
      return global.Helpers.makeSuccessServiceStatus('Project fetched.', project);
    } catch (err: any) {
      this.log('getProject', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: updateProject
   */
  public async updateProject(projectId: string, param: IProjectUpdate): Promise<IServiceResult> {
    this.initLog();
    this.log('updateProject', ['Request : ', { projectId, param }]);
    try {
      const updated = await this._projectModel.updateAnyRecord({ _id: projectId }, param);
      this.log('Update project result:', updated);
      return global.Helpers.makeSuccessServiceStatus('Project updated.', updated);
    } catch (err: any) {
      this.log('updateProject', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: deleteProject
   */
  public async deleteProject(projectId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('deleteProject', ['Request : ', projectId]);
    try {
      const deleted = await this._projectModel.updateAnyRecord({ _id: projectId }, { is_deleted: true });
      this.log('Delete project result:', deleted);
      return global.Helpers.makeSuccessServiceStatus('Project deleted.', deleted);
    } catch (err: any) {
      this.log('deleteProject', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: listProjects
   */
  public async listProjects(page: number = 1, limit: number = 20, organizationId?: string): Promise<IServiceResult> {
    this.initLog();
    this.log('listProjects', ['Request : ', { page, limit, organizationId }]);
    try {
      const filter: any = { is_deleted: false };
      if (organizationId) {
        filter.organization_id = organizationId;
      }
      const offset = (page - 1) * limit;
      const projects = await this._projectModel.findSelectiveByAny({
        data: filter,
        attributes: '',
        offset,
        limit,
        sort: { created_at: -1 },
      });
      const total = await this._projectModel.countAllByAny(filter);
      return global.Helpers.makeSuccessServiceStatus('Projects fetched.', {
        rows: projects,
        count: projects.length,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
        total,
      });
    } catch (err: any) {
      this.log('listProjects', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /* ==================== project-scoped child listings ==================== */

  /*
   * Generic paginated listing of a project-scoped collection. Members/
   * milestones/dependencies/reports/releases have no dedicated domain
   * models yet, so raw collections are used (same pattern as the git
   * intelligence service for commits/PRs).
   */
  private async _listProjectCollection(
    method: string,
    collection: string,
    label: string,
    projectId: string,
    page: number,
    limit: number,
    sort: any = { created_at: -1 },
  ): Promise<IServiceResult> {
    this.initLog();
    this.log(method, ['Request : ', { projectId, page, limit }]);
    try {
      const project = await this._projectModel.findByAny({ _id: projectId, is_deleted: false });
      if (!project) {
        return global.Helpers.makeBadServiceStatus('Project not found.');
      }
      const db = global.db.connection.db!;
      const col = db.collection(collection);
      const filter = { project_id: projectId, is_deleted: { $ne: true } };
      const offset = (page - 1) * limit;
      const [rows, total] = await Promise.all([
        col.find(filter).sort(sort).skip(offset).limit(limit).toArray(),
        col.countDocuments(filter),
      ]);
      return global.Helpers.makeSuccessServiceStatus(`${label} fetched.`, {
        rows,
        count: rows.length,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
        total,
      });
    } catch (err: any) {
      this.log(method, err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  public async getProjectMembers(projectId: string, page: number, limit: number): Promise<IServiceResult> {
    const rows = await this._listProjectCollection('getProjectMembers', 'project_members', 'Project members', projectId, page, limit, { joined_at: -1 });
    // enrich with user info for convenience
    if (!rows.status) return rows;
    const db = global.db.connection.db!;
    const data: any = rows.data_sets;
    const userIds = data.rows.map((r: any) => r.user_id).filter(Boolean);
    if (userIds.length) {
      const users = await db.collection('users')
        .find({ _id: { $in: userIds.map((u: string) => new mongoose.Types.ObjectId(u)) } })
        .project({ full_name: 1, email: 1, avatar_url: 1, role: 1 })
        .toArray();
      const byId = new Map(users.map((u: any) => [String(u._id), u]));
      data.rows = data.rows.map((r: any) => ({ ...r, user: byId.get(String(r.user_id)) || null }));
    }
    return rows;
  }

  public async getProjectMilestones(projectId: string, page: number, limit: number): Promise<IServiceResult> {
    return this._listProjectCollection('getProjectMilestones', 'milestones', 'Milestones', projectId, page, limit, { due_date: 1 });
  }

  public async getProjectDependencies(projectId: string, page: number, limit: number): Promise<IServiceResult> {
    const ret = await this._listProjectCollection('getProjectDependencies', 'dependencies', 'Dependencies', projectId, page, limit, { created_at: -1 });
    if (!ret.status) return ret;
    // resolve depends_on project names
    const db = global.db.connection.db!;
    const data: any = ret.data_sets;
    const ids = data.rows.map((r: any) => r.depends_on_project_id).filter(Boolean);
    if (ids.length) {
      const deps = await db.collection('projects')
        .find({ _id: { $in: ids.map((i: string) => new mongoose.Types.ObjectId(i)) } })
        .project({ name: 1, health_score: 1 })
        .toArray();
      const byId = new Map(deps.map((d: any) => [String(d._id), d]));
      data.rows = data.rows.map((r: any) => ({ ...r, depends_on: byId.get(String(r.depends_on_project_id)) || null }));
    }
    return ret;
  }

  public async getProjectReports(projectId: string, page: number, limit: number): Promise<IServiceResult> {
    return this._listProjectCollection('getProjectReports', 'reports', 'Reports', projectId, page, limit);
  }

  public async getProjectReleases(projectId: string, page: number, limit: number): Promise<IServiceResult> {
    return this._listProjectCollection('getProjectReleases', 'git_releases', 'Releases', projectId, page, limit, { published_at: -1 });
  }
}
