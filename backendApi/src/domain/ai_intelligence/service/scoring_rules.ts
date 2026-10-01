import { readFileSync } from 'fs';
import { resolve } from 'path';
import { AI_CONTEXT_CONFIG } from '../../../configuration/context.config';

export const SCORING_RULES_FILE = resolve(process.cwd(), 'docs', 'project_health_scoring_rules.md');

// AI steps that score health, assess implementation, analyse risk or explain forecasts.
export const SCORING_RULES_ENDPOINTS = new Set([
  'project_assessment',
  'report_evidence',
  'report_json',
  'implementation_analysis',
  'analyze',
  'insights',
  'recommendations',
]);

let cached: { text: string; version: string } | null = null;

export function loadScoringRules(): { text: string; version: string } | null {
  if (cached) return cached;
  try {
    const text = readFileSync(SCORING_RULES_FILE, 'utf8').trim();
    const version = /^Version:\s*(.+?)\s*$/m.exec(text)?.[1] || 'unversioned';
    cached = { text, version };
    return cached;
  } catch (err: any) {
    global.logs.writelog('scoring_rules.load', `Rule book not readable at ${SCORING_RULES_FILE}: ${err?.message || err}`, 'ERROR');
    return null;
  }
}

export function scoringRulesContext(): string | null {
  const rules = loadScoringRules();
  if (!rules) return null;
  return AI_CONTEXT_CONFIG.scoringRulesContext(rules.version, rules.text);
}
