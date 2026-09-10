import { Request, Response, NextFunction } from 'express';
export const riskPredictionMiddleware = {
  validateCreate: (req: Request, res: Response, next: NextFunction) => {
    const { project_id, kind } = req.body;
    if (!project_id || !kind) {
      return res.status(400).json({ message: 'project_id and kind are required.' });
    }
    next();
  },
  validateUpdate: (req: Request, res: Response, next: NextFunction) => {
    const b = req.body;
    if (!b.risk_level && !b.predicted_date && !b.target_date && b.confidence_score === undefined && !b.factors && !b.summary) {
      return res.status(400).json({ message: 'At least one field must be provided for update.' });
    }
    next();
  },
};
