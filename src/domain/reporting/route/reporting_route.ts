import { Router } from 'express';
import { ReportingController } from '../controller/reporting_controller';
import { reportingMiddleware } from '../middleware/reporting_middleware';

const router = Router();
const controller = new ReportingController();

router.post('/', reportingMiddleware.validateCreate, controller.createReport);
router.get('/', controller.listReports);
router.get('/:id', controller.getReport);
router.put('/:id', reportingMiddleware.validateUpdate, controller.updateReport);
router.delete('/:id', controller.deleteReport);

export default router;
