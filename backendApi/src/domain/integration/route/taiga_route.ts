/**
 * `taiga_route.ts` — Routes for the Taiga publish pipeline.
 *
 * Mounted under `/v1/projects` in `project_route.ts`.
 * All routes require auth via `common_middleware.validateToken`.
 */
import { Router } from 'express';
import { TaigaController } from '../controller/taiga_controller';
import { common_middleware } from '../../../helper/common_middleware';

const router = Router({ mergeParams: true });
const controller = new TaigaController();
const auth = new common_middleware().validateToken;

// Taiga connection management
router.post('/:projectId/taiga/connect', auth, controller.connect);
router.post('/:projectId/taiga/test-connection', auth, controller.testConnection);
router.get('/:projectId/taiga/status', auth, controller.status);

// Plan publish endpoints
router.post('/:projectId/plans/:planId/publish-to-taiga/preview', auth, controller.preview);
router.post('/:projectId/plans/:planId/publish-to-taiga', auth, controller.publish);

// Plan create-in-taiga endpoint (one-shot, fails if any entity exists)
router.post('/:projectId/plans/:planId/create-in-taiga', auth, controller.createInTaiga);

export default router;
