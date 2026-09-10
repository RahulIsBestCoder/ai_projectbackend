import { Request, Response, NextFunction } from 'express';
export const workManagementMiddleware = {
  validateCreate: (req: Request, res: Response, next: NextFunction) => {
    const { project_id, title } = req.body;
    if (!project_id || !title) {
      return res.status(400).json({ message: 'project_id and title are required.' });
    }
    next();
  },
  validateUpdate: (req: Request, res: Response, next: NextFunction) => {
    const b = req.body;
    if (!b.title && !b.description && !b.type && !b.status && !b.priority && !b.assignee_id && !b.sprint_id && b.story_points === undefined) {
      return res.status(400).json({ message: 'At least one field must be provided for update.' });
    }
    next();
  },
};
