import { Request, Response } from 'express';
import { UserService } from '../service/user_service';
import { IUserCreate, IUserUpdate } from '../interface/user_interface';

/**
 * `UserController` – Handles user CRUD and profile operations.
 */
export class UserController {
  private readonly _service = new UserService();

  private initLog(): void {
    /* parity with plan convention */
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: createUser
   */
  public createUser = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `createUser${global.Helpers.getTraceID(req.body)}`;
    try {
      const param: IUserCreate = req.body;
      const ret = await this._service.createUser(param);
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
   * @Function: getUser
   */
  public getUser = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getUser${global.Helpers.getTraceID(req.params)}`;
    try {
      const userId = req.params.id;
      const ret = await this._service.getUser(userId);
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
   * @Function: updateUser
   */
  public updateUser = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `updateUser${global.Helpers.getTraceID(req.body)}`;
    try {
      const userId = req.params.id;
      const param: IUserUpdate = req.body;
      const ret = await this._service.updateUser(userId, param);
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
   * @Function: deleteUser
   */
  public deleteUser = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `deleteUser${global.Helpers.getTraceID(req.params)}`;
    try {
      const userId = req.params.id;
      const ret = await this._service.deleteUser(userId);
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
