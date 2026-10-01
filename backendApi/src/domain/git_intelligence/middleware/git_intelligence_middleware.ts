import { Request, Response, NextFunction } from 'express';
import { REPO_CATEGORY_VALUES } from '../interface/git_intelligence_interface';

const rejectBadCategory = (res: Response): boolean => {
  res.status(400).json({ message: `category must be one of: ${REPO_CATEGORY_VALUES.join(', ')}.` });
  return true;
};

export const gitIntelligenceMiddleware = {
  validateCreate: (req: Request, res: Response, next: NextFunction) => {
    const { repository_id, provider, category } = req.body;
    if (!repository_id || !provider) {
      return res.status(400).json({ message: 'repository_id and provider are required.' });
    }
    if (category !== undefined && !REPO_CATEGORY_VALUES.includes(String(category).trim().toLowerCase())) {
      return rejectBadCategory(res);
    }
    next();
  },
  validateUpdate: (req: Request, res: Response, next: NextFunction) => {
    const b = req.body;
    if (!b.provider && !b.token && b.status === undefined && b.category === undefined) {
      return res.status(400).json({ message: 'At least one field must be provided for update.' });
    }
    if (b.category !== undefined && !REPO_CATEGORY_VALUES.includes(String(b.category).trim().toLowerCase())) {
      return rejectBadCategory(res);
    }
    next();
  },
};
