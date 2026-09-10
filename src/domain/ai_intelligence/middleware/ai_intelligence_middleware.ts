import { Request, Response, NextFunction } from 'express';
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
    const description = req.body?.description;
    if (!description || typeof description !== 'string' || !description.trim()) {
      return res.status(400).json({ message: 'description is required (describe the project to plan).' });
    }
    next();
  },
};
