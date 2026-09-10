import { Request, Response } from 'express';
import { NotificationService } from '../service/notification_service';
import { INotificationCreate, INotificationUpdate } from '../interface/notification_interface';

/**
 * `NotificationController` – Handles notification CRUD (plan §13).
 */
export class NotificationController {
  private readonly _service = new NotificationService();

  private initLog(): void {
    /* parity with plan convention */
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: createNotification
   */
  public createNotification = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `createNotification${global.Helpers.getTraceID(req.body)}`;
    try {
      const param: INotificationCreate = req.body;
      const ret = await this._service.createNotification(param);
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
   * @Date: 2026-09-04
   * @Function: getNotification
   */
  public getNotification = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getNotification${global.Helpers.getTraceID(req.params)}`;
    try {
      const notificationId = req.params.id;
      const ret = await this._service.getNotification(notificationId);
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
   * @Date: 2026-09-04
   * @Function: updateNotification
   */
  public updateNotification = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `updateNotification${global.Helpers.getTraceID(req.body)}`;
    try {
      const notificationId = req.params.id;
      const param: INotificationUpdate = req.body;
      const ret = await this._service.updateNotification(notificationId, param);
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
   * @Date: 2026-09-04
   * @Function: deleteNotification
   */
  public deleteNotification = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `deleteNotification${global.Helpers.getTraceID(req.params)}`;
    try {
      const notificationId = req.params.id;
      const ret = await this._service.deleteNotification(notificationId);
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
   * @Function: listNotifications
   */
  public listNotifications = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `listNotifications${global.Helpers.getTraceID(req.query)}`;
    try {
      const userId = req.query.user_id as string | undefined;
      const unreadOnly = req.query.unread === 'true';
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const ret = await this._service.listNotifications(userId, unreadOnly, page, limit);
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
