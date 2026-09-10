import { Request, Response, NextFunction } from 'express';
export const organizationMiddleware = {
  validateCreate: (req: Request, res: Response, next: NextFunction) => {
    const { name, owner_id } = req.body;
    if (!name || !owner_id) {
      return res.status(400).json({ message: 'Name and owner_id are required.' });
    }
    next();
  },
  validateUpdate: (req: Request, res: Response, next: NextFunction) => {
    if (!req.body.name && !req.body.description) {
      return res.status(400).json({ message: 'At least one field must be provided for update.' });
    }
    next();
  },
};
