import { Request, Response, NextFunction } from 'express';
export const projectMiddleware = {
  validateCreate: (req: Request, res: Response, next: NextFunction) => {
    const { name, organization_id, owner_id } = req.body;
    if (!name || !organization_id || !owner_id) {
      return res.status(400).json({ message: 'Name, organization_id and owner_id are required.' });
    }
    next();
  },
  validateUpdate: (req: Request, res: Response, next: NextFunction) => {
    if (!req.body.name && !req.body.description && req.body.status === undefined && req.body.target_date === undefined) {
      return res.status(400).json({ message: 'At least one field must be provided for update.' });
    }
    if (req.body.status !== undefined) {
      const status = Number(req.body.status);
      if (!Number.isInteger(status) || status < 1 || status > 5) {
        return res.status(400).json({ message: 'Status must be an integer from 1 to 5.' });
      }
      req.body.status = status;
    }
    next();
  },
};
