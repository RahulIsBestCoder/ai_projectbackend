import { Router } from 'express';
import { WorkManagementController } from '../controller/work_management_controller';
import { workManagementMiddleware } from '../middleware/work_management_middleware';

const router = Router();
const controller = new WorkManagementController();

router.post('/', workManagementMiddleware.validateCreate, controller.createWorkItem);
router.get('/:id', controller.getWorkItem);
router.put('/:id', workManagementMiddleware.validateUpdate, controller.updateWorkItem);
router.delete('/:id', controller.deleteWorkItem);

export default router;
