import { Request, Response, NextFunction } from 'express';
export const analyticsMiddleware = {
  validateCreate: (req: Request, res: Response, next: NextFunction) => {
    const { project_id, metric_type, value } = req.body;
    if (!project_id || !metric_type || value === undefined) {
      return res.status(400).json({ message: 'project_id, metric_type and value are required.' });
    }
    next();
  },
  validateUpdate: (req: Request, res: Response, next: NextFunction) => {
    const b = req.body;
    if (b.value === undefined && !b.breakdown && !b.period && !b.calculation_version) {
      return res.status(400).json({ message: 'At least one field must be provided for update.' });
    }
    next();
  },
};
