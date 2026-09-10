import { Router } from 'express';
import { AnalyticsController } from '../controller/analytics_controller';
import { analyticsMiddleware } from '../middleware/analytics_middleware';

const router = Router();
const controller = new AnalyticsController();

router.post('/', analyticsMiddleware.validateCreate, controller.createSnapshot);
router.get('/:id', controller.getSnapshot);
router.put('/:id', analyticsMiddleware.validateUpdate, controller.updateSnapshot);
router.delete('/:id', controller.deleteSnapshot);

export default router;
