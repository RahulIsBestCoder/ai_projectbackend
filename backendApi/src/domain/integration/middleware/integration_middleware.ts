import { Request, Response, NextFunction } from 'express';
export const integrationMiddleware = {
  validateCreate: (req: Request, res: Response, next: NextFunction) => {
    const { provider, repository_name } = req.body;
    if (!provider || !repository_name) {
      return res.status(400).json({ message: 'Provider and repository_name are required.' });
    }
    next();
  },
  validateUpdate: (req: Request, res: Response, next: NextFunction) => {
    if (!req.body.provider && !req.body.repository_name) {
      return res.status(400).json({ message: 'At least one field must be provided for update.' });
    }
    next();
  },
};
