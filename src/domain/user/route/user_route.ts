import { Router } from 'express';
import { UserController } from '../controller/user_controller';
import { userMiddleware } from '../middleware/user_middleware';

const router = Router();
const controller = new UserController();

router.post('/', userMiddleware.validateCreate, controller.createUser);
router.get('/:id', controller.getUser);
router.put('/:id', userMiddleware.validateUpdate, controller.updateUser);
router.delete('/:id', controller.deleteUser);

export default router;
