import { Router } from 'express';
import { GitIntelligenceController } from '../controller/git_intelligence_controller';
import { gitIntelligenceMiddleware } from '../middleware/git_intelligence_middleware';

const router = Router();
const controller = new GitIntelligenceController();

router.post('/', gitIntelligenceMiddleware.validateCreate, controller.createRepository);
router.get('/:id', controller.getRepository);
router.put('/:id', gitIntelligenceMiddleware.validateUpdate, controller.updateRepository);
router.delete('/:id', controller.deleteRepository);

export default router;
