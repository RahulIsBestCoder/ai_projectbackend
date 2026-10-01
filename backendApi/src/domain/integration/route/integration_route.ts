import { Router } from 'express';
import { IntegrationController } from '../controller/integration_controller';
import { integrationMiddleware } from '../middleware/integration_middleware';
import { common_middleware } from '../../../helper/common_middleware';

const router = Router();
const controller = new IntegrationController();

router.post('/', integrationMiddleware.validateCreate, controller.createIntegration);
router.post('/:id/branches', new common_middleware().validateToken, controller.listGithubBranches);
router.post('/:id/sync', new common_middleware().validateToken, controller.syncIntegration);
router.get('/:id/sync-history', controller.getSyncHistory);
router.get('/:id/taiga-tasks', controller.listTaigaTasks);
router.get('/:id', controller.getIntegration);
router.put('/:id', integrationMiddleware.validateUpdate, controller.updateIntegration);
router.delete('/:id', controller.deleteIntegration);

export default router;
