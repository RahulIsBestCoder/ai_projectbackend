import { Request, Response, NextFunction } from 'express';
export const notificationMiddleware = {
  validateCreate: (req: Request, res: Response, next: NextFunction) => {
    const { user_id, title } = req.body;
    if (!user_id || !title) {
      return res.status(400).json({ message: 'user_id and title are required.' });
    }
    next();
  },
  validateUpdate: (req: Request, res: Response, next: NextFunction) => {
    const b = req.body;
    if (!b.title && !b.body && !b.type && !b.channel && b.is_read === undefined && !b.read_at) {
      return res.status(400).json({ message: 'At least one field must be provided for update.' });
    }
    next();
  },
};
