import { Request, Response, NextFunction } from 'express';
export const reportingMiddleware = {
  validateCreate: (req: Request, res: Response, next: NextFunction) => {
    const { project_id, name } = req.body;
    if (!project_id || !name) {
      return res.status(400).json({ message: 'project_id and name are required.' });
    }
    if (req.body.scope !== undefined && (!Array.isArray(req.body.scope) || req.body.scope.some((item: any) => typeof item !== 'string'))) {
      return res.status(400).json({ message: 'scope must be an array of strings.' });
    }
    const content = req.body.content ?? req.body.report_content;
    if (content !== undefined && (typeof content !== 'string' || content.length > 20000)) {
      return res.status(400).json({ message: 'content must be a string up to 20,000 characters.' });
    }
    if (req.body.force_regenerate !== undefined && typeof req.body.force_regenerate !== 'boolean') {
      return res.status(400).json({ message: 'force_regenerate must be a boolean.' });
    }
    if (req.body.report_type !== undefined && !['project', 'sprint'].includes(req.body.report_type)) {
      return res.status(400).json({ message: 'report_type must be project or sprint.' });
    }
    if (req.body.report_type === 'sprint' && (typeof req.body.sprint_id !== 'string' || !req.body.sprint_id.trim())) {
      return res.status(400).json({ message: 'sprint_id is required for a sprint report.' });
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
