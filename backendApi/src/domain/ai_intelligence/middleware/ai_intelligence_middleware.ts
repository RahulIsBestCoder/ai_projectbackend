import { Request, Response, NextFunction } from 'express';
import { validatePlanInput } from '../service/plan_schedule';
export const aiIntelligenceMiddleware = {
  validateCreate: (req: Request, res: Response, next: NextFunction) => {
    const { type } = req.body;
    if (!type) {
      return res.status(400).json({ message: 'type is required.' });
    }
    next();
  },
  validateUpdate: (req: Request, res: Response, next: NextFunction) => {
    const b = req.body;
    if (!b.provider && !b.model && !b.prompt && !b.response && !b.context_meta && b.cached === undefined) {
      return res.status(400).json({ message: 'At least one field must be provided for update.' });
    }
    next();
  },
  validateGeneratePlan: (req: Request, res: Response, next: NextFunction) => {
    try {
      validatePlanInput(req.body);
    } catch (error: any) {
      return res.status(400).json({ message: error.message });
    }
    next();
  },
  validateToggleExecutionItem: (req: Request, res: Response, next: NextFunction) => {
    if (typeof req.body?.is_completed !== 'boolean') {
      return res.status(400).json({ message: 'is_completed (boolean) is required.' });
    }
    const allowed = ['sprint', 'task', 'milestone', 'deadline', 'dependency'];
    if (req.params.kind && !allowed.includes(req.params.kind)) {
      return res.status(400).json({ message: 'Invalid execution item kind.' });
    }
    next();
  },
};
