import { OrganizationModel } from '../models/organization_model';
import { IServiceResult } from '../../../helper/common_interface';
import { IOrganizationCreate, IOrganizationUpdate } from '../interface/organization_interface';
import mongoose from 'mongoose';

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
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: listDepartments
   * @Description: Departments derived from the workforce of an organization
   *               (users carry department_id / team_id).
   */
  public async listDepartments(organizationId?: string): Promise<IServiceResult> {
    this.initLog();
    this.log('listDepartments', ['Request : ', organizationId]);
    try {
      const db = global.db.connection.db!;
      const match: any = {};
      if (organizationId) match.organization_id = organizationId;
      const rows = await db.collection('users').aggregate([
        { $match: match },
        { $group: {
          _id: '$department_id',
          member_count: { $sum: 1 },
          active_count: { $sum: { $cond: [{ $eq: ['$is_active', true] }, 1, 0] } },
          teams: { $addToSet: '$team_id' },
        } },
        { $sort: { _id: 1 } },
      ]).toArray();
      const departments = rows.map((r: any) => ({
        // `id`/`_id` aliases so any frontend accessor resolves (fixes
        // `/departments/undefined/metrics` calls).
        id: r._id || null,
        _id: r._id || null,
        department_id: r._id || null,
        name: r._id
          ? (OrganizationService.DEPT_NAMES[r._id]
            || String(r._id).replace(/^dept-/, '').replace(/\b\w/g, (c: string) => c.toUpperCase()))
          : 'Unassigned',
        member_count: r.member_count,
        active_count: r.active_count,
        teams: (r.teams || []).filter(Boolean),
      }));
      return global.Helpers.makeSuccessServiceStatus('Departments fetched.', {
        rows: departments, count: departments.length, organization_id: organizationId || null,
      });
    } catch (err: any) {
      this.log('listDepartments', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: getDepartmentMetrics
   * @Description: Workforce metrics for one department: headcount, roles,
   *               teams, projects touched and assigned work items.
   */
  public async getDepartmentMetrics(departmentId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getDepartmentMetrics', ['Request : ', departmentId]);
    try {
      if (!departmentId || departmentId === 'undefined' || departmentId === 'null') {
        return global.Helpers.makeBadServiceStatus('Department id is required.');
      }
      const db = global.db.connection.db!;
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
