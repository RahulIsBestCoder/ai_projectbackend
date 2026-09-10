import { Request, Response, NextFunction } from 'express';
export const gitIntelligenceMiddleware = {
  validateCreate: (req: Request, res: Response, next: NextFunction) => {
    const { repository_id, provider } = req.body;
    if (!repository_id || !provider) {
      return res.status(400).json({ message: 'repository_id and provider are required.' });
    }
    next();
  },
  validateUpdate: (req: Request, res: Response, next: NextFunction) => {
    const b = req.body;
    if (!b.provider && !b.token && b.status === undefined) {
      return res.status(400).json({ message: 'At least one field must be provided for update.' });
    }
    next();
  },
};
