import { Router } from 'express';
import { NotificationController } from '../controller/notification_controller';
import { notificationMiddleware } from '../middleware/notification_middleware';

const router = Router();
const controller = new NotificationController();

router.post('/', notificationMiddleware.validateCreate, controller.createNotification);
router.get('/', controller.listNotifications);
router.get('/:id', controller.getNotification);
router.put('/:id', notificationMiddleware.validateUpdate, controller.updateNotification);
router.delete('/:id', controller.deleteNotification);

export default router;
