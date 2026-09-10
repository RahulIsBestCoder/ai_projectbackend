import { Router } from 'express';
import { RiskPredictionController } from '../controller/risk_prediction_controller';
import { riskPredictionMiddleware } from '../middleware/risk_prediction_middleware';

const router = Router();
const controller = new RiskPredictionController();

router.post('/', riskPredictionMiddleware.validateCreate, controller.createPrediction);
router.get('/:id', controller.getPrediction);
router.put('/:id', riskPredictionMiddleware.validateUpdate, controller.updatePrediction);
router.delete('/:id', controller.deletePrediction);

export default router;
