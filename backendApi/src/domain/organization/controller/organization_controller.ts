import { Request, Response } from 'express';
import { IOrganizationCreate, IOrganizationUpdate } from '../interface/organization_interface';
import { OrganizationService } from '../service/organization_service';

/**
 * `OrganizationController` – Handles organization CRUD and settings.
 */
export class OrganizationController {
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
      const ret = await this._service.listDepartments(organizationId);
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
      const ret = await this._service.getDepartmentMetrics(req.params.id);
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
