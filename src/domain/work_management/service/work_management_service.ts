import { WorkManagementModel } from '../models/work_management_model';
import { IWorkItemCreate, IWorkItemUpdate } from '../interface/work_management_interface';
import { IServiceResult } from '../../../helper/common_interface';

/**
 * `WorkManagementService` – Business logic for normalized work-item CRUD (plan §07).
 */
export class WorkManagementService {
  private readonly _workItemModel = new WorkManagementModel();
  private readonly logName = 'work_management_service';

  private initLog(): void {
    /* parity with plan convention */
  }

  private log(method: string, msg: unknown, severity = 'INFO'): void {
    global.logs.writelog(`${this.logName}.${method}`, msg, severity);
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: createWorkItem
   */
  public async createWorkItem(param: IWorkItemCreate): Promise<IServiceResult> {
    this.initLog();
    this.log('createWorkItem', ['Request : ', param]);
    try {
      const existing = await this._workItemModel.findByAny({ project_id: param.project_id, title: param.title });
      if (existing) {
        return global.Helpers.makeBadServiceStatus('Work item already exists.');
      }
      const newWorkItem = await this._workItemModel.addNewRecord(param);
      this.log('Add new work item result:', newWorkItem);
      return global.Helpers.makeSuccessServiceStatus('Work item created.', newWorkItem);
    } catch (err: any) {
      this.log('createWorkItem', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: getWorkItem
   */
  public async getWorkItem(workItemId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getWorkItem', ['Request : ', workItemId]);
    try {
      const workItem = await this._workItemModel.findByAny({ _id: workItemId });
      if (!workItem) {
        return global.Helpers.makeBadServiceStatus('Work item not found.');
      }
      return global.Helpers.makeSuccessServiceStatus('Work item fetched.', workItem);
    } catch (err: any) {
      this.log('getWorkItem', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: updateWorkItem
   */
  public async updateWorkItem(workItemId: string, param: IWorkItemUpdate): Promise<IServiceResult> {
    this.initLog();
    this.log('updateWorkItem', ['Request : ', { workItemId, param }]);
    try {
      const updated = await this._workItemModel.updateAnyRecord({ _id: workItemId }, param);
      this.log('Update work item result:', updated);
      return global.Helpers.makeSuccessServiceStatus('Work item updated.', updated);
    } catch (err: any) {
      this.log('updateWorkItem', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: deleteWorkItem
   */
  public async deleteWorkItem(workItemId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('deleteWorkItem', ['Request : ', workItemId]);
    try {
      const deleted = await this._workItemModel.updateAnyRecord({ _id: workItemId }, { is_deleted: true });
      this.log('Delete work item result:', deleted);
      return global.Helpers.makeSuccessServiceStatus('Work item deleted.', deleted);
    } catch (err: any) {
      this.log('deleteWorkItem', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: listByProject
   */
  public async listByProject(projectId: string, status?: string, page: number = 1, limit: number = 20): Promise<IServiceResult> {
    this.initLog();
    this.log('listByProject', ['Request : ', { projectId, status, page, limit }]);
    try {
      const filter: any = { project_id: projectId, is_deleted: false };
      if (status) filter.status = status;
      const offset = (page - 1) * limit;
      const items = await this._workItemModel.findSelectiveByAny({
        data: filter,
        attributes: '',
        offset,
        limit,
        sort: { created_at: -1 },
      });
      const total = await this._workItemModel.countAllByAny(filter);
      return global.Helpers.makeSuccessServiceStatus('Work items fetched.', {
        rows: items,
        count: items.length,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
        total,
      });
    } catch (err: any) {
      this.log('listByProject', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }
}
