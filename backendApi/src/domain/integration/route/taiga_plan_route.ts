/**
 * `taiga_plan_route.ts` - plan-scoped Taiga publish routes ("Create in Taiga" button).
 *
 * Mounted on both `/v1/plans` (app_routing.ts) and `/v1/ai/plans`
 * (ai_intelligence_route.ts) so the two aliases stay in parity.
 *
 * The client only sends the plan id: the project (and therefore the Taiga
 * integration) is resolved from `ai_plans.project_id` server-side.
 *
 *   POST /:planId/create-in-taiga          - create | sync
 *   POST /:planId/create-in-taiga/preview  - dry run (no writes)
 *   GET  /:planId/taiga-sync               - publish state + mapping summary
 *   POST /:planId/taiga-sync/retry         - resume missing/failed entities
 */
import { Router, Request, Response, NextFunction } from 'express';
import { Types } from 'mongoose';
import { TaigaController } from '../controller/taiga_controller';
import { common_middleware } from '../../../helper/common_middleware';

/**
 * Validate plan identity and existence after token authentication.
 *
 * `requireSyncAccess` cannot be used here because the project id is not part of
 * the URL - the plan owns the project reference. When the plan has no (valid)
 * project the service returns the actionable `Plan has no project.` message.
 */
const requirePlan = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const userId = req.body?.loginDetails?.verifiedData?.user_id;
    if (!userId) {
      global.Helpers.unauthorizedStatusBuild(res, 'Authorization token missing');
      return;
    }
    const planId = String(req.params.planId || req.params.id || '');
    if (!Types.ObjectId.isValid(planId)) {
      res.status(400).json({ message: 'Invalid plan id.' });
      return;
    }
    const db = global.db.connection.db!;
    const plan = await db.collection('ai_plans').findOne({ _id: new Types.ObjectId(planId), is_deleted: { $ne: true } });
    if (!plan) {
      res.status(404).json({ message: 'Plan not found.' });
      return;
    }
    next();
  } catch (error) {
    global.logs.writelog('requirePlan', error, 'ERROR');
    res.status(500).json({ message: 'Unable to load plan.' });
  }
};

export function createTaigaPlanRoutes(): Router {
  const router = Router({ mergeParams: true });
  const controller = new TaigaController();
  const auth = new common_middleware().validateToken;

  // "Create in Taiga" button: confirm dialog (preview) + create/sync.
  router.post('/:planId/create-in-taiga/preview', auth, requirePlan, controller.previewForPlan);
  router.post('/:planId/create-in-taiga', auth, requirePlan, controller.createInTaigaForPlan);

  // Sync status + retry.
  router.get('/:planId/taiga-sync', auth, requirePlan, controller.planSyncStatus);
  router.post('/:planId/taiga-sync/retry', auth, requirePlan, controller.retryPlanSync);

  return router;
}
