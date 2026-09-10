import { Request, Response } from 'express';
import { UserModel } from '../models/user_model';
import { IUserCreate, IUserUpdate } from '../interface/user_interface';
import { IServiceResult } from '../../../helper/common_interface';

/**
 * `UserService` – Business logic for user CRUD and profile.
 */
export class UserService {
  private readonly _userModel = new UserModel();
  private readonly logName = 'user_service';

  private initLog(): void {
    /* parity with plan convention */
  }

  private log(method: string, msg: unknown, severity = 'INFO'): void {
    global.logs.writelog(`${this.logName}.${method}`, msg, severity);
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: createUser
   */
  public async createUser(param: IUserCreate): Promise<IServiceResult> {
    this.initLog();
    this.log('createUser', ['Request : ', param]);
    try {
      const existing = await this._userModel.findByAny({ email: param.email });
      if (existing) {
        return global.Helpers.makeBadServiceStatus('User already exists.');
      }
      const newUser = await this._userModel.addNewRecord(param);
      this.log('Add new user result:', newUser);
      return global.Helpers.makeSuccessServiceStatus('User created.', newUser);
    } catch (err: any) {
      this.log('createUser', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: getUser
   */
  public async getUser(userId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getUser', ['Request : ', userId]);
    try {
      const user = await this._userModel.findByAny({ _id: userId });
      if (!user) {
        return global.Helpers.makeBadServiceStatus('User not found.');
      }
      return global.Helpers.makeSuccessServiceStatus('User fetched.', user);
    } catch (err: any) {
      this.log('getUser', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: updateUser
   */
  public async updateUser(userId: string, param: IUserUpdate): Promise<IServiceResult> {
    this.initLog();
    this.log('updateUser', ['Request : ', { userId, param }]);
    try {
      const updated = await this._userModel.updateAnyRecord({ _id: userId }, param);
      this.log('Update user result:', updated);
      return global.Helpers.makeSuccessServiceStatus('User updated.', updated);
    } catch (err: any) {
      this.log('updateUser', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-08-31
   * @Function: deleteUser
   */
  public async deleteUser(userId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('deleteUser', ['Request : ', userId]);
    try {
      const deleted = await this._userModel.updateAnyRecord({ _id: userId }, { is_deleted: true });
      this.log('Delete user result:', deleted);
      return global.Helpers.makeSuccessServiceStatus('User deleted.', deleted);
    } catch (err: any) {
      this.log('deleteUser', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }
}
