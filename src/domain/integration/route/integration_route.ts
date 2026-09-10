import { Router } from 'express';
import { IntegrationController } from '../controller/integration_controller';
import { integrationMiddleware } from '../middleware/integration_middleware';

const router = Router();
const controller = new IntegrationController();

router.post('/', integrationMiddleware.validateCreate, controller.createIntegration);
router.post('/:id/sync', controller.syncIntegration);
router.get('/:id/sync-history', controller.getSyncHistory);
router.get('/:id', controller.getIntegration);
router.put('/:id', integrationMiddleware.validateUpdate, controller.updateIntegration);
router.delete('/:id', controller.deleteIntegration);

export default router;
