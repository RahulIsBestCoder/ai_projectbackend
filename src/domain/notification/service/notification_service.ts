import { NotificationModel } from '../models/notification_model';
import { INotificationCreate, INotificationUpdate } from '../interface/notification_interface';
import { IServiceResult } from '../../../helper/common_interface';

/**
 * `NotificationService` – Business logic for notification CRUD (plan §13).
 * Notifications are append-only, so create performs no duplicate check.
 */
export class NotificationService {
  private readonly _notificationModel = new NotificationModel();
  private readonly logName = 'notification_service';

  private initLog(): void {
    /* parity with plan convention */
  }

  private log(method: string, msg: unknown, severity = 'INFO'): void {
    global.logs.writelog(`${this.logName}.${method}`, msg, severity);
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: createNotification
   */
  public async createNotification(param: INotificationCreate): Promise<IServiceResult> {
    this.initLog();
    this.log('createNotification', ['Request : ', param]);
    try {
      const newNotification = await this._notificationModel.addNewRecord(param);
      this.log('Add new notification result:', newNotification);
      return global.Helpers.makeSuccessServiceStatus('Notification created.', newNotification);
    } catch (err: any) {
      this.log('createNotification', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: getNotification
   */
  public async getNotification(notificationId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getNotification', ['Request : ', notificationId]);
    try {
      const notification = await this._notificationModel.findByAny({ _id: notificationId });
      if (!notification) {
        return global.Helpers.makeBadServiceStatus('Notification not found.');
      }
      return global.Helpers.makeSuccessServiceStatus('Notification fetched.', notification);
    } catch (err: any) {
      this.log('getNotification', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: updateNotification
   */
  public async updateNotification(notificationId: string, param: INotificationUpdate): Promise<IServiceResult> {
    this.initLog();
    this.log('updateNotification', ['Request : ', { notificationId, param }]);
    try {
      const updated = await this._notificationModel.updateAnyRecord({ _id: notificationId }, param);
      this.log('Update notification result:', updated);
      return global.Helpers.makeSuccessServiceStatus('Notification updated.', updated);
    } catch (err: any) {
      this.log('updateNotification', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: deleteNotification
   */
  public async deleteNotification(notificationId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('deleteNotification', ['Request : ', notificationId]);
    try {
      const deleted = await this._notificationModel.updateAnyRecord({ _id: notificationId }, { is_deleted: true });
      this.log('Delete notification result:', deleted);
      return global.Helpers.makeSuccessServiceStatus('Notification deleted.', deleted);
    } catch (err: any) {
      this.log('deleteNotification', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: listNotifications
   */
  public async listNotifications(userId?: string, unreadOnly: boolean = false, page: number = 1, limit: number = 20): Promise<IServiceResult> {
    this.initLog();
    this.log('listNotifications', ['Request : ', { userId, unreadOnly, page, limit }]);
    try {
      const filter: any = { is_deleted: false };
      if (userId) filter.user_id = userId;
      if (unreadOnly) filter.is_read = false;
      const offset = (page - 1) * limit;
      const notifications = await this._notificationModel.findSelectiveByAny({
        data: filter,
        attributes: '',
        offset,
        limit,
        sort: { created_at: -1 },
      });
      const total = await this._notificationModel.countAllByAny(filter);
      return global.Helpers.makeSuccessServiceStatus('Notifications fetched.', {
        rows: notifications,
        count: notifications.length,
        page,
        limit,
        total_pages: Math.ceil(total / limit),
        total,
      });
    } catch (err: any) {
      this.log('listNotifications', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }
}
