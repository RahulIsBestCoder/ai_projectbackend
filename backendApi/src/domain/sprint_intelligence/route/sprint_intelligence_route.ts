import { Router } from 'express';
import { SprintIntelligenceController } from '../controller/sprint_intelligence_controller';
import { sprintIntelligenceMiddleware } from '../middleware/sprint_intelligence_middleware';

const router = Router();
const controller = new SprintIntelligenceController();

router.post('/', sprintIntelligenceMiddleware.validateCreate, controller.createSprint);
router.get('/:id/summary', controller.getSprintSummary);
router.get('/:id/burndown', controller.getBurndown);
router.get('/:id/burnup', controller.getBurnup);
router.get('/:id/velocity', controller.getVelocity);
router.get('/:id/retrospective', controller.getRetrospective);
router.get('/:id', controller.getSprint);
router.put('/:id', sprintIntelligenceMiddleware.validateUpdate, controller.updateSprint);
router.delete('/:id', controller.deleteSprint);

export default router;
