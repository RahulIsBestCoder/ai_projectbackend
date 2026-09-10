import { Request, Response } from 'express';
import { RiskPredictionService } from '../service/risk_prediction_service';
import { IPredictionCreate, IPredictionUpdate } from '../interface/risk_prediction_interface';

/**
 * `RiskPredictionController` – Handles risk/prediction CRUD (plan §10).
 */
export class RiskPredictionController {
  private readonly _service = new RiskPredictionService();

  private initLog(): void {
    /* parity with plan convention */
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: createPrediction
   */
  public createPrediction = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `createPrediction${global.Helpers.getTraceID(req.body)}`;
    try {
      const param: IPredictionCreate = req.body;
      const ret = await this._service.createPrediction(param);
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
   * @Function: getPrediction
   */
  public getPrediction = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getPrediction${global.Helpers.getTraceID(req.params)}`;
    try {
      const predictionId = req.params.id;
      const ret = await this._service.getPrediction(predictionId);
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
   * @Function: updatePrediction
   */
  public updatePrediction = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `updatePrediction${global.Helpers.getTraceID(req.body)}`;
    try {
      const predictionId = req.params.id;
      const param: IPredictionUpdate = req.body;
      const ret = await this._service.updatePrediction(predictionId, param);
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
   * @Function: deletePrediction
   */
  public deletePrediction = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `deletePrediction${global.Helpers.getTraceID(req.params)}`;
    try {
      const predictionId = req.params.id;
      const ret = await this._service.deletePrediction(predictionId);
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

  public getByProject = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getByProject${global.Helpers.getTraceID(req.params)}`;
    try {
      const projectId = req.params.projectId;
      const ret = await this._service.getByProject(projectId);
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
   * @Function: getRisks
   */
  public getRisks = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getRisks${global.Helpers.getTraceID(req.query)}`;
    try {
      const projectId = req.params.projectId;
      const level = req.query.level as string | undefined;
      const ret = await this._service.getRisksByProject(projectId, level);
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
   * @Function: getCompletionForecast
   */
  public getCompletionForecast = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getCompletionForecast${global.Helpers.getTraceID(req.query)}`;
    try {
      const ret = await this._service.getCompletionForecast(req.params.projectId);
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
