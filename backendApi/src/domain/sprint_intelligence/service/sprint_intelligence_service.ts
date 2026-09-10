import { SprintIntelligenceModel } from '../models/sprint_intelligence_model';
import { ISprintCreate, ISprintUpdate } from '../interface/sprint_intelligence_interface';
import { IServiceResult } from '../../../helper/common_interface';

/**
 * `SprintIntelligenceService` – Business logic for sprint CRUD (plan §08).
 */
export class SprintIntelligenceService {
  private readonly _sprintModel = new SprintIntelligenceModel();
  private readonly logName = 'sprint_intelligence_service';

  private initLog(): void {
    /* parity with plan convention */
  }

  private log(method: string, msg: unknown, severity = 'INFO'): void {
    global.logs.writelog(`${this.logName}.${method}`, msg, severity);
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: createSprint
   */
  public async createSprint(param: ISprintCreate): Promise<IServiceResult> {
    this.initLog();
    this.log('createSprint', ['Request : ', param]);
    try {
      const existing = await this._sprintModel.findByAny({ project_id: param.project_id, name: param.name });
      if (existing) {
        return global.Helpers.makeBadServiceStatus('Sprint already exists.');
      }
      const newSprint = await this._sprintModel.addNewRecord(param);
      this.log('Add new sprint result:', newSprint);
      return global.Helpers.makeSuccessServiceStatus('Sprint created.', newSprint);
    } catch (err: any) {
      this.log('createSprint', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: getSprint
   */
  public async getSprint(sprintId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getSprint', ['Request : ', sprintId]);
    try {
      const sprint = await this._sprintModel.findByAny({ _id: sprintId });
      if (!sprint) {
        return global.Helpers.makeBadServiceStatus('Sprint not found.');
      }
      return global.Helpers.makeSuccessServiceStatus('Sprint fetched.', sprint);
    } catch (err: any) {
      this.log('getSprint', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: updateSprint
   */
  public async updateSprint(sprintId: string, param: ISprintUpdate): Promise<IServiceResult> {
    this.initLog();
    this.log('updateSprint', ['Request : ', { sprintId, param }]);
    try {
      const updated = await this._sprintModel.updateAnyRecord({ _id: sprintId }, param);
      this.log('Update sprint result:', updated);
      return global.Helpers.makeSuccessServiceStatus('Sprint updated.', updated);
    } catch (err: any) {
      this.log('updateSprint', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-04
   * @Function: deleteSprint
   */
  public async deleteSprint(sprintId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('deleteSprint', ['Request : ', sprintId]);
    try {
      const deleted = await this._sprintModel.updateAnyRecord({ _id: sprintId }, { is_deleted: true });
      this.log('Delete sprint result:', deleted);
      return global.Helpers.makeSuccessServiceStatus('Sprint deleted.', deleted);
    } catch (err: any) {
      this.log('deleteSprint', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: listByProject
   */
  public async listByProject(projectId: string, status?: string): Promise<IServiceResult> {
    this.initLog();
    this.log('listByProject', ['Request : ', { projectId, status }]);
    try {
      const filter: any = { project_id: projectId, is_deleted: false };
      if (status) filter.status = status;
      const sprints = await this._sprintModel.findSelectiveByAny({
        data: filter,
        attributes: '',
        offset: 0,
        limit: 100,
        sort: { start_date: 1 },
      });
      return global.Helpers.makeSuccessServiceStatus('Sprints fetched.', {
        rows: sprints,
        count: sprints.length,
        active_sprint: sprints.find((s: any) => s.status === 'active') || null,
      });
    } catch (err: any) {
      this.log('listByProject', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: getSprintSummary
   * @Description: Aggregated sprint dashboard — sprint meta, live work-item
   *               roll-up (counts + story points per status) and time progress.
   */
  public async getSprintSummary(sprintId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getSprintSummary', ['Request : ', sprintId]);
    try {
      const sprint = await this._sprintModel.findByAny({ _id: sprintId, is_deleted: false });
      if (!sprint) {
        return global.Helpers.makeBadServiceStatus('Sprint not found.');
      }

      // Live roll-up of the sprint's work items (collection access via the
      // native driver — `sprint_id` is stored as a plain string).
      const db = global.db.connection.db!;
      const statusBreakdown = await db.collection('work_items').aggregate([
        { $match: { sprint_id: sprintId, is_deleted: false } },
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            points: { $sum: { $ifNull: ['$story_points', 0] } },
          },
        },
      ]).toArray();

      const byStatus: Record<string, { count: number; points: number }> = {
        todo: { count: 0, points: 0 },
        in_progress: { count: 0, points: 0 },
        in_review: { count: 0, points: 0 },
        done: { count: 0, points: 0 },
      };
      let totalCount = 0;
      let totalPoints = 0;
      let doneCount = 0;
      let donePoints = 0;
      for (const row of statusBreakdown) {
        const key = String(row._id);
        if (!byStatus[key]) byStatus[key] = { count: 0, points: 0 };
        byStatus[key].count += row.count;
        byStatus[key].points += row.points;
        totalCount += row.count;
        totalPoints += row.points;
        if (key === 'done') {
          doneCount += row.count;
          donePoints += row.points;
        }
      }

      // Time progress against the sprint window.
      const now = Date.now();
      const start = sprint.start_date ? new Date(sprint.start_date).getTime() : null;
      const end = sprint.end_date ? new Date(sprint.end_date).getTime() : null;
      const totalDays = start && end ? Math.max(0, Math.ceil((end - start) / 86400000)) : null;
      const elapsedDays = start ? Math.max(0, Math.min(totalDays ?? 0, Math.ceil((now - start) / 86400000))) : null;
      const remainingDays = end ? Math.max(0, Math.ceil((end - now) / 86400000)) : null;

      const round1 = (n: number) => Math.round(n * 10) / 10;
      return global.Helpers.makeSuccessServiceStatus('Sprint summary fetched.', {
        sprint: {
          _id: sprint._id,
          project_id: sprint.project_id,
          name: sprint.name,
          goal: sprint.goal,
          status: sprint.status,
          start_date: sprint.start_date,
          end_date: sprint.end_date,
          planned_points: sprint.planned_points,
          completed_points: sprint.completed_points,
          retrospective: sprint.retrospective || null,
        },
        work_items: {
          total: totalCount,
          by_status: byStatus,
          points_total: totalPoints,
          points_done: donePoints,
          completion_rate: totalCount > 0 ? round1((doneCount / totalCount) * 100) : 0,
          points_completion_rate: totalPoints > 0 ? round1((donePoints / totalPoints) * 100) : 0,
        },
        time: {
          total_days: totalDays,
          elapsed_days: elapsedDays,
          remaining_days: remainingDays,
          elapsed_percent: totalDays ? round1(Math.min(100, (elapsedDays! / totalDays) * 100)) : 0,
        },
      });
    } catch (err: any) {
      this.log('getSprintSummary', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /* ==================== sprint time-series helpers ==================== */

  /*
   * Cumulative-completion anchor curve (0→1). A realistic sprint effort
   * profile: slow start, mid-sprint push, end-of-sprint catch-up.
   */
  private static readonly CUM_ANCHORS: number[] = [
    0, 0.03, 0.08, 0.16, 0.28, 0.4, 0.52, 0.63, 0.73, 0.82, 0.9, 0.95, 0.98, 1,
  ];

  private _hash(str: string): number {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return h;
  }

  private _dayKey(d: Date): string {
    return d.toISOString().slice(0, 10);
  }

  /*
   * Builds the sprint's day list (UTC) from start_date to end_date.
   */
  private _sprintDays(sprint: any): Date[] {
    const days: Date[] = [];
    const start = new Date(sprint.start_date);
    const end = new Date(sprint.end_date);
    const cursor = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
    const last = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
    for (let t = cursor; t <= last; t += 86400000) days.push(new Date(t));
    return days;
  }

  /*
   * Estimated cumulative completion ratio for day index `i` of `n` days.
   * Deterministic per sprint (rotated by id hash) so charts are stable.
   */
  private _estimatedRatio(dayIndex: number, totalDays: number, seed: string): number {
    const anchors = SprintIntelligenceService.CUM_ANCHORS;
    const shift = this._hash(seed) % anchors.length;
    const t = totalDays <= 1 ? 1 : dayIndex / (totalDays - 1);
    const pos = t * (anchors.length - 1);
    const i0 = Math.floor(pos);
    const i1 = Math.min(anchors.length - 1, i0 + 1);
    const frac = pos - i0;
    const a0 = anchors[(i0 + shift) % anchors.length];
    const a1 = anchors[(i1 + shift) % anchors.length];
    return a0 + (a1 - a0) * frac;
  }

  /*
   * Live done-points per day from work items (`updated_at` is the best
   * available completion timestamp in the current schema).
   */
  private async _donePointsByDay(sprintId: string): Promise<Map<string, number>> {
    const db = global.db.connection.db!;
    const rows = await db.collection('work_items').aggregate([
      { $match: { sprint_id: sprintId, status: 'done', is_deleted: false } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$updated_at' } },
          points: { $sum: { $ifNull: ['$story_points', 0] } },
        },
      },
    ]).toArray();
    const map = new Map<string, number>();
    for (const r of rows) map.set(String(r._id), r.points);
    return map;
  }

  private _sprintHead(sprint: any) {
    return {
      _id: sprint._id,
      project_id: sprint.project_id,
      name: sprint.name,
      status: sprint.status,
      start_date: sprint.start_date,
      end_date: sprint.end_date,
      planned_points: sprint.planned_points,
      completed_points: sprint.completed_points,
    };
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: getBurndown
   * @Description: Daily remaining-points line vs the ideal line. Uses real
   *               done-item dates when available; otherwise a deterministic
   *               estimated profile (flagged via `source`).
   */
  public async getBurndown(sprintId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getBurndown', ['Request : ', sprintId]);
    try {
      const sprint = await this._sprintModel.findByAny({ _id: sprintId, is_deleted: false });
      if (!sprint) {
        return global.Helpers.makeBadServiceStatus('Sprint not found.');
      }
      const days = this._sprintDays(sprint);
      const planned = sprint.planned_points || 0;
      const doneByDay = await this._donePointsByDay(sprintId);

      const hasActual = doneByDay.size > 0;
      const total = days.length;
      const todayKey = this._dayKey(new Date());
      const isPast = new Date(sprint.end_date).getTime() < Date.now();

      let cumulative = 0;
      const series = days.map((d, i) => {
        const key = this._dayKey(d);
        const ideal = total <= 1 ? 0 : Math.round(planned * (1 - i / (total - 1)) * 10) / 10;
        let completed: number | null;
        if (hasActual) {
          cumulative += doneByDay.get(key) || 0;
          completed = Math.min(planned, cumulative);
        } else if (isPast && planned > 0) {
          completed = Math.round(planned * this._estimatedRatio(i, total, String(sprint._id)));
          if (i === total - 1) completed = planned;
        } else {
          completed = key <= todayKey ? 0 : null;
        }
        return {
          date: key,
          day: i,
          ideal_remaining: ideal,
          actual_remaining: completed === null ? null : Math.max(0, Math.round((planned - completed) * 10) / 10),
        };
      });

      return global.Helpers.makeSuccessServiceStatus('Sprint burndown fetched.', {
        sprint: this._sprintHead(sprint),
        source: hasActual ? 'actual' : 'estimated',
        series,
      });
    } catch (err: any) {
      this.log('getBurndown', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: getBurnup
   * @Description: Cumulative completed points vs total scope per day.
   */
  public async getBurnup(sprintId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getBurnup', ['Request : ', sprintId]);
    try {
      const sprint = await this._sprintModel.findByAny({ _id: sprintId, is_deleted: false });
      if (!sprint) {
        return global.Helpers.makeBadServiceStatus('Sprint not found.');
      }
      const days = this._sprintDays(sprint);
      const planned = sprint.planned_points || 0;
      const doneByDay = await this._donePointsByDay(sprintId);

      const hasActual = doneByDay.size > 0;
      const total = days.length;
      const todayKey = this._dayKey(new Date());
      const isPast = new Date(sprint.end_date).getTime() < Date.now();

      let cumulative = 0;
      const series = days.map((d, i) => {
        const key = this._dayKey(d);
        let completed: number | null;
        if (hasActual) {
          cumulative += doneByDay.get(key) || 0;
          completed = Math.min(planned, cumulative);
        } else if (isPast && planned > 0) {
          completed = Math.round(planned * this._estimatedRatio(i, total, String(sprint._id)));
          if (i === total - 1) completed = planned;
        } else {
          completed = key <= todayKey ? 0 : null;
        }
        return { date: key, day: i, scope: planned, completed };
      });

      return global.Helpers.makeSuccessServiceStatus('Sprint burnup fetched.', {
        sprint: this._sprintHead(sprint),
        source: hasActual ? 'actual' : 'estimated',
        series,
      });
    } catch (err: any) {
      this.log('getBurnup', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: getVelocity
   * @Description: This sprint's velocity in the context of the project's
   *               sprint history (chronological trend + rolling averages).
   */
  public async getVelocity(sprintId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getVelocity', ['Request : ', sprintId]);
    try {
      const sprint = await this._sprintModel.findByAny({ _id: sprintId, is_deleted: false });
      if (!sprint) {
        return global.Helpers.makeBadServiceStatus('Sprint not found.');
      }
      const siblings = await this._sprintModel.findAllByAny({
        project_id: sprint.project_id,
        is_deleted: false,
      });
      siblings.sort((a: any, b: any) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());

      const round1 = (n: number) => Math.round(n * 10) / 10;
      const trend = siblings.map((s: any) => ({
        sprint_id: s._id,
        name: s.name,
        status: s.status,
        planned_points: s.planned_points || 0,
        completed_points: s.completed_points || 0,
        completion_rate: s.planned_points ? round1(((s.completed_points || 0) / s.planned_points) * 100) : 0,
        is_current: String(s._id) === String(sprint._id),
      }));

      const completedPts = siblings
        .filter((s: any) => s.status === 'completed')
        .map((s: any) => s.completed_points || 0);
      const avg = completedPts.length
        ? round1(completedPts.reduce((a: number, b: number) => a + b, 0) / completedPts.length)
        : 0;
      const last3 = completedPts.slice(-3);
      const avg3 = last3.length
        ? round1(last3.reduce((a: number, b: number) => a + b, 0) / last3.length)
        : 0;

      return global.Helpers.makeSuccessServiceStatus('Sprint velocity fetched.', {
        sprint: this._sprintHead(sprint),
        project_average: avg,
        last3_average: avg3,
        trend,
      });
    } catch (err: any) {
      this.log('getVelocity', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-10
   * @Function: getRetrospective
   */
  public async getRetrospective(sprintId: string): Promise<IServiceResult> {
    this.initLog();
    this.log('getRetrospective', ['Request : ', sprintId]);
    try {
      const sprint = await this._sprintModel.findByAny({ _id: sprintId, is_deleted: false });
      if (!sprint) {
        return global.Helpers.makeBadServiceStatus('Sprint not found.');
      }
      return global.Helpers.makeSuccessServiceStatus('Sprint retrospective fetched.', {
        sprint_id: sprint._id,
        name: sprint.name,
        status: sprint.status,
        start_date: sprint.start_date,
        end_date: sprint.end_date,
        retrospective: sprint.retrospective || null,
      });
    } catch (err: any) {
      this.log('getRetrospective', err?.stack || err, 'ERROR');
      return global.Helpers.makeBadServiceStatus('Something went wrong, please try again later.');
    }
  }
}
