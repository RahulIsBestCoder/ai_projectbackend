import { ChatEvidence, RetrievalResult } from '../rag_retrieval_service';

export type ChatRagSourceType = 'project' | 'plan' | 'task' | 'taiga_task' | 'commit' | 'code' | 'risk';
export interface ChatRagEvidence extends ChatEvidence {
  sourceType?: ChatRagSourceType;
  title?: string;
}

export interface ChatRagContext extends RetrievalResult {
  evidence: ChatRagEvidence[];
  sections: Record<string, string[]>;
}

/** Keeps chat evidence compact, diverse, cited, and grouped for the AI prompt. */
export class RagContextBuilder {
  private readonly sectionNames: Record<string, string> = {
    project: 'Project',
    plan: 'Plans and requirements',
    task: 'Work items',
    taiga_task: 'Taiga tasks',
    commit: 'Git activity',
    code: 'Code evidence',
    risk: 'Risk evidence',
  };

  public build(result: RetrievalResult): ChatRagContext {
    const seen = new Set<string>();
    const selected: ChatRagEvidence[] = [];
    // Code is filled after the record sources, so the total leaves room for ~4 source excerpts
    // (retrieval sends excerpts around the definition/match, ~3,000 characters each).
    let remaining = 32000;
    const sourceBudgets: Record<string, number> = {
      project: 2500, plan: 4000, task: 3500, taiga_task: 3500,
      commit: 2500, code: 14000, risk: 1500, other: 1000,
    };
    const groups = new Map<string, ChatRagEvidence[]>();
    for (const item of result.evidence as ChatRagEvidence[]) {
      const type = item.sourceType || 'other';
      (groups.get(type) || (groups.set(type, []), groups.get(type)!)).push(item);
    }

    for (const type of ['project', 'plan', 'task', 'taiga_task', 'commit', 'code', 'risk', 'other']) {
      let sourceRemaining = sourceBudgets[type];
      for (const evidence of groups.get(type) || []) {
        const key = `${type}:${evidence.source}:${evidence.text}`.toLowerCase();
        if (seen.has(key) || remaining <= 0 || sourceRemaining <= 0) continue;
        seen.add(key);
        const text = evidence.text.slice(0, Math.min(6000, remaining, sourceRemaining));
        remaining -= text.length;
        sourceRemaining -= text.length;
        selected.push({ ...evidence, id: `S${selected.length + 1}`, text });
      }
    }

    const sections: Record<string, string[]> = {};
    for (const item of selected) {
      const section = this.sectionNames[item.sourceType || ''] || 'Other evidence';
      (sections[section] ||= []).push(item.id);
    }

    return { ...result, evidence: selected, sections };
  }
}
