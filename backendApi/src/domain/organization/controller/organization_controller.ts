import { Request, Response } from 'express';
import { IOrganizationCreate, IOrganizationUpdate } from '../interface/organization_interface';
import { OrganizationService } from '../service/organization_service';

/**
 * `OrganizationController` – Handles organization CRUD and settings.
 */
/*
 * @Developer: Sougata Bauri
 * @Date: 2026-09-27
 * @Function: OrganizationController
 */
export class OrganizationController {
  public setQaReporterRole = async (req: Request, res: Response): Promise<void> => {
    try {
      if (typeof req.body?.reporting_role !== 'string' || !['qa', 'manager'].includes(req.body.reporting_role)) {
        global.Helpers.badRequestStatusBuild(res, 'reporting_role must be qa or manager.');
        return;
      }
      const result = await this._service.setQaReporterRole(req.params.projectId, req.params.reporterId,
        req.body.reporting_role, String(req.body.loginDetails.verifiedData.user_id));
      if (result.status) global.Helpers.successStatusBuild(res, result.data_sets, result.status_message);
      else global.Helpers.badRequestStatusBuild(res, result.status_message);
    } catch (error) {
      global.logs.writelog('setQaReporterRole', error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Could not save reporter classification.');
    }
  };
  private readonly _service = new OrganizationService();

  private initLog(): void {
    /* parity with plan convention */
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: createOrganization
   */
  public createOrganization = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `createOrganization${global.Helpers.getTraceID(req.body)}`;
    try {
      const param: IOrganizationCreate = req.body;
      const ret = await this._service.createOrganization(param);
      if (ret.status) {
        global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      } else {
        global.Helpers.badRequestStatusBuild(res, ret.status_message);
      }
    } catch (error) {
      global.logs.writelog(trace, error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong. Please try again');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: getOrganization
   */
  public getOrganization = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getOrganization${global.Helpers.getTraceID(req.params)}`;
    try {
      const orgId = req.params.id;
      const ret = await this._service.getOrganization(orgId);
      if (ret.status) {
        global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      } else {
        global.Helpers.badRequestStatusBuild(res, ret.status_message);
      }
    } catch (error) {
      global.logs.writelog(trace, error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong. Please try again');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: updateOrganization
   */
  public updateOrganization = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `updateOrganization${global.Helpers.getTraceID(req.body)}`;
    try {
      const orgId = req.params.id;
      const param: IOrganizationUpdate = req.body;
      const ret = await this._service.updateOrganization(orgId, param);
      if (ret.status) {
        global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      } else {
        global.Helpers.badRequestStatusBuild(res, ret.status_message);
      }
    } catch (error) {
      global.logs.writelog(trace, error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong. Please try again');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: deleteOrganization
   */
  public deleteOrganization = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `deleteOrganization${global.Helpers.getTraceID(req.params)}`;
    try {
      const orgId = req.params.id;
      const ret = await this._service.deleteOrganization(orgId);
      if (ret.status) {
        global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      } else {
        global.Helpers.badRequestStatusBuild(res, ret.status_message);
      }
    } catch (error) {
      global.logs.writelog(trace, error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong. Please try again');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: listOrganizations
   */
  public listOrganizations = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `listOrganizations${global.Helpers.getTraceID(req.query)}`;
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const ret = await this._service.listOrganizations(page, limit);
      if (ret.status) {
        global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      } else {
        global.Helpers.badRequestStatusBuild(res, ret.status_message);
      }
    } catch (error) {
      global.logs.writelog(trace, error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong. Please try again');
    }
  };

  /** Selected project id(s) from `?project_id=a[,b]`; undefined when none is a valid ObjectId. */
  private _selectedProjectIds(req: Request): string[] | undefined {
    const raw = typeof req.query.project_id === 'string' ? req.query.project_id : '';
    const ids = raw.split(',').map(id => id.trim()).filter(id => /^[a-f0-9]{24}$/i.test(id));
    return ids.length ? ids : undefined;
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: listDepartments
   */
  public listDepartments = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `listDepartments${global.Helpers.getTraceID(req.query)}`;
    try {
      const organizationId = req.query.organization_id as string | undefined;
      const projectIds = this._selectedProjectIds(req);
      if (!projectIds) {
        global.Helpers.badRequestStatusBuild(res, 'Select a project: a valid project_id is required.');
        return;
      }
      const ret = await this._service.listDepartments(organizationId, projectIds);
      if (ret.status) {
        global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      } else {
        global.Helpers.badRequestStatusBuild(res, ret.status_message);
      }
    } catch (error) {
      global.logs.writelog(trace, error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong. Please try again');
    }
  };

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: getDepartmentMetrics
   */
  public getDepartmentMetrics = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getDepartmentMetrics${global.Helpers.getTraceID(req.query)}`;
    try {
      const projectIds = this._selectedProjectIds(req);
      if (!projectIds && !String(req.params.id || '').startsWith('dept-')) {
        global.Helpers.badRequestStatusBuild(res, 'Select a project: a valid project_id is required.');
        return;
      }
      const ret = await this._service.getDepartmentMetrics(req.params.id, req.query.organization_id as string | undefined, projectIds);
      if (ret.status) {
        global.Helpers.successStatusBuild(res, ret.data_sets, ret.status_message);
      } else {
        global.Helpers.badRequestStatusBuild(res, ret.status_message);
      }
    } catch (error) {
      global.logs.writelog(trace, error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong. Please try again');
    }
  };
}
