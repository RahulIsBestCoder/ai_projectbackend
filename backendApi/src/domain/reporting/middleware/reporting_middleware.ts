import { Request, Response, NextFunction } from 'express';
export const reportingMiddleware = {
  validateCreate: (req: Request, res: Response, next: NextFunction) => {
    const { project_id, name } = req.body;
    if (!project_id || !name) {
      return res.status(400).json({ message: 'project_id and name are required.' });
    }
    next();
  },
  validateUpdate: (req: Request, res: Response, next: NextFunction) => {
    const b = req.body;
    if (!b.name && !b.definition && !b.format && !b.status && !b.artifact_url) {
      return res.status(400).json({ message: 'At least one field must be provided for update.' });
    }
    next();
  },
};
