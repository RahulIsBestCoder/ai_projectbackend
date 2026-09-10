import { Request, Response, NextFunction } from 'express';
export const sprintIntelligenceMiddleware = {
  validateCreate: (req: Request, res: Response, next: NextFunction) => {
    const { project_id, name } = req.body;
    if (!project_id || !name) {
      return res.status(400).json({ message: 'project_id and name are required.' });
    }
    next();
  },
  validateUpdate: (req: Request, res: Response, next: NextFunction) => {
    const b = req.body;
    if (!b.name && !b.goal && !b.start_date && !b.end_date && !b.status && b.planned_points === undefined && b.completed_points === undefined) {
      return res.status(400).json({ message: 'At least one field must be provided for update.' });
    }
    next();
  },
};
