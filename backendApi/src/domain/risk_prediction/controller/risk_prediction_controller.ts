import { Request, Response } from 'express';
import { DelayPredictionService } from '../service/delay_prediction_service';
import { RiskPredictionService } from '../service/risk_prediction_service';
import { IPredictionCreate, IPredictionUpdate } from '../interface/risk_prediction_interface';

/**
 * `RiskPredictionController` – Handles risk/prediction CRUD (plan §10).
 */
/*
 * @Developer: Sougata Bauri
 * @Date: 2026-09-27
 * @Function: RiskPredictionController
 */
export class RiskPredictionController {
  private readonly _service = new RiskPredictionService();
  private readonly _delayService = new DelayPredictionService();

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

  /*
   * @Function: getDelayPrediction
   * @Description: Predictive Intelligence Center baseline — delay probability,
   *   predicted finish, confidence, driver baselines, XAI drivers and actions.
   */
  public getDelayPrediction = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `getDelayPrediction${global.Helpers.getTraceID(req.params)}`;
    try {
      const ret = await this._delayService.getDelayPrediction(req.params.projectId);
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
   * @Function: simulateDelayPrediction
   * @Description: What-if scenario for the four risk drivers. Deterministic; stores nothing.
   */
  public simulateDelayPrediction = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `simulateDelayPrediction${global.Helpers.getTraceID(req.params)}`;
    try {
      const ret = await this._delayService.simulateDelayPrediction(req.params.projectId, req.body || {});
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
   * @Date: 2026-09-11
   * @Function: analyzeRisks
   */
  public analyzeRisks = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `analyzeRisks${global.Helpers.getTraceID(req.params)}`;
    try {
      const ret = await this._service.analyzeRisks(req.params.projectId);
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
   * @Date: 2026-09-11
   * @Function: predictDeadline
   */
  public predictDeadline = async (req: Request, res: Response): Promise<void> => {
    this.initLog();
    const trace = `predictDeadline${global.Helpers.getTraceID(req.params)}`;
    try {
      // Deterministic forecast only: AI Sync is the sole action that pulls GitHub/Taiga data,
      // so this route must not sync (that would bypass the sync cooldown).
      const ret = await this._service.predictDeadline(req.params.projectId, { sync: false, ai: false });
      if (ret.status) {
        // The route returns only the percentage chance of meeting the plan deadline; the full forecast stays stored for other views.
        const fc: any = (ret.data_sets as any)?.rule_forecast;
        const onTime = fc?.probability?.on_time;
        const capacityRatio = fc?.deterministic?.capacity_ratio;
        let percentage: number | null = null;
        let message = 'Deadline percentage predicted.';
        if (typeof onTime === 'number') {
          // Simulated on-time probability (also 0 when overdue, 100 when complete before the target).
          percentage = Math.round(onTime * 100);
        } else if (!fc?.deterministic?.target_date) {
          message = 'No deadline percentage: the project has no plan deadline.';
        } else if (fc?.status === 'stalled') {
          percentage = 0;
          message = 'Deadline percentage predicted: no work was closed in the last 20 working days.';
        } else if (fc?.status === 'forecast' && typeof capacityRatio === 'number') {
          // Not enough history to simulate: approximate with available vs. needed working days.
          percentage = Math.min(100, Math.round(capacityRatio * 100));
        } else {
          message = 'No deadline percentage: there is no work to forecast yet.';
        }
        global.Helpers.successStatusBuild(res, { project_id: req.params.projectId, deadline_meet_percentage: percentage }, message);
      } else {
        global.Helpers.badRequestStatusBuild(res, ret.status_message);
      }
    } catch (error) {
      global.logs.writelog(trace, error, 'ERROR');
      global.Helpers.badRequestStatusBuild(res, 'Something went wrong. Please try again');
    }
  };
}
