import { Request, Response, NextFunction } from 'express';
import { REPO_CATEGORY_VALUES } from '../../git_intelligence/interface/git_intelligence_interface';

const rejectBadCategory = (res: Response): boolean => {
  res.status(400).json({ message: `category must be one of: ${REPO_CATEGORY_VALUES.join(', ')}.` });
  return true;
};

export const integrationMiddleware = {
  validateCreate: (req: Request, res: Response, next: NextFunction) => {
    if (req.body.branch !== undefined && (typeof req.body.branch !== 'string' || !req.body.branch.trim())) {
      return res.status(400).json({ message: 'Branch must be a non-empty string.' });
    }
    const { provider, repository_name, category } = req.body;
    if (!provider || !repository_name) {
      return res.status(400).json({ message: 'Provider and repository_name are required.' });
    }
    if (category !== undefined && !REPO_CATEGORY_VALUES.includes(String(category).trim().toLowerCase())) {
      return rejectBadCategory(res);
    }
    next();
  },
  validateUpdate: (req: Request, res: Response, next: NextFunction) => {
    const b = req.body;
    if (b.branch !== undefined) {
      if (typeof b.branch !== 'string' || !b.branch.trim()) return res.status(400).json({ message: 'Branch must be a non-empty string.' });
    }
    if (!b.provider && !b.repository_name && !b.repository_organization && !b.repository_url && !b.project_id && !b.token && !b.username && !b.password && b.status === undefined && b.category === undefined && b.branch === undefined) {
      return res.status(400).json({ message: 'At least one field must be provided for update.' });
    }
    if (b.category !== undefined && !REPO_CATEGORY_VALUES.includes(String(b.category).trim().toLowerCase())) {
      return rejectBadCategory(res);
    }
    next();
  },
};
