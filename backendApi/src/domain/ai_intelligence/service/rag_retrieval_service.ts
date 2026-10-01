import { RepositoryReader } from './repository_reader';
import { codeSearchTerms, isCodeIdentifier } from './rag/code_search';
import { CodeEvidenceSearch } from './rag/code_evidence_search';

const CODE_SNIPPET_CHARS = 3200;   // per source file
const CODE_BUDGET_CHARS = 16000;   // all source excerpts
const OTHER_BUDGET_CHARS = 12000;  // project, plan, tasks, risks
const CODE_FILES = 5;

export interface ChatEvidence { id: string; source: string; text: string; updatedAt?: string; }
export interface RetrievalResult { evidence: ChatEvidence[]; limitations: string[]; mode: string; }

/** Retrieval reads current records; it never persists conversation content. */
export class RagRetrievalService {
  constructor(private readonly db: any = global.db.connection.db, private readonly reader = new RepositoryReader(db)) {}

  public static isSmallTalk(question: string): boolean {
    return /^(hi|hello|hey|good morning|good evening|good afternoon|thanks|thank you|bye|goodbye|how are you)[!.?\s]*$/i.test(question.trim());
  }

  public static keywords(question: string): string[] {
    const stop = new Set('the a an is are was were how what where when why can could would should please tell show explain about this that these those project code implementation does do for and with from have has its'.split(' '));
    return [...new Set((question.toLowerCase().match(/[a-z][a-z0-9_]{2,}/g) || []).filter(word => !stop.has(word)))].slice(0, 6);
  }

  /*
   * @Developer: Sougata Bauri
   * @Date: 2026-09-28
   * @Function: retrieve
   */
  /**
   * `codeQuery` is the user's own wording, used to choose repository search terms; `question`
   * may carry expanded keywords for record retrieval.
   */
  public async retrieve(projectId: string, question: string, project: any, codeQuery?: string): Promise<RetrievalResult> {
    const evidence: ChatEvidence[] = [];
    const limitations: string[] = [];
    const add = (source: string, text: string, updatedAt?: any, maxChars = 6000) => {
      evidence.push({ id: `S${evidence.length + 1}`, source, text: text.slice(0, maxChars), updatedAt: updatedAt ? String(updatedAt) : undefined });
    };
    add('projects: current project', JSON.stringify({ name: project.name, description: project.description,
      status: project.status, target_date: project.target_date }), project.updated_at);
    const stored = project.project_context?.combined || project.project_context;
    if (stored?.text) add('projects: stored context snapshot (may be stale)', stored.text, stored.updated_at);
    const keywords = RagRetrievalService.keywords(question);
    const filter = { project_id: projectId, is_deleted: { $ne: true } };
    if (/task|work|complete|progress|remaining|count|many|status/i.test(question)) {
      try {
        const counts = await this.db.collection('work_items').aggregate([
          { $match: filter }, { $group: { _id: '$status', count: { $sum: 1 } } },
        ], { maxTimeMS: 5000 }).toArray();
        add('work_items: live counts grouped by status', JSON.stringify(counts), new Date().toISOString());
      } catch { limitations.push('Live task counts unavailable. Do not infer totals from retrieved examples.'); }
    }
    const sources = [
      { collection: 'ai_plans', fields: ['title', 'plan', 'input', 'status', 'updated_at', 'created_at'] },
      { collection: 'work_items', fields: ['title', 'description', 'status', 'priority', 'updated_at'] },
    ];
    if (/health|risk|deadline|forecast|probability|score/i.test(question)) {
      sources.push({ collection: 'risk_predictions', fields: ['kind', 'summary', 'risk_level', 'forecast', 'factors', 'updated_at', 'created_at'] });
    }
    for (const source of sources) {
      try {
        const query: any = { ...filter };
        if (source.collection === 'work_items' && keywords.length) {
          query.$or = ['title', 'description'].map(field => ({ [field]: { $regex: keywords.join('|'), $options: 'i' } }));
        }
        const projection = Object.fromEntries(source.fields.map(field => [field, 1]));
        const rows = await this.db.collection(source.collection).find(query).project(projection)
          .sort({ updated_at: -1, created_at: -1 }).limit(source.collection === 'ai_plans' ? 1 : 4).maxTimeMS(5000).toArray();
        for (const row of rows) add(`${source.collection}:${row._id}`, JSON.stringify(row), row.updated_at || row.created_at);
      } catch { limitations.push(`${source.collection} retrieval unavailable.`); }
    }
    const terms = codeSearchTerms(codeQuery ?? question);
    // `question` may carry the chat's "implementation code test" hint for progress questions.
    const asksAboutCode = /code|implement|function|class|method|file|repo|auth|login|api|endpoint|test|bug|service|controller|model|route|middleware|module|acl/i.test(`${question} ${codeQuery ?? ''}`);
    if (terms.length && (asksAboutCode || terms.some(isCodeIdentifier))) {
      try {
        const excerpts = await new CodeEvidenceSearch(this.reader, projectId).search(terms, { files: CODE_FILES, snippetChars: CODE_SNIPPET_CHARS });
        for (const item of excerpts) add(item.source, item.text, item.syncedAt, CODE_SNIPPET_CHARS);
        limitations.push(`Repository search terms: ${terms.join(', ')}. Retrieval is partial; unread files, test execution and test coverage remain unknown.`);
      } catch { limitations.push('Repository evidence unavailable.'); }
    }
    // Optional semantic ranking works on ordinary MongoDB: no vector index required.
    // Embeddings exist only during this request and contain no conversation history.
    let mode = 'keyword';
    if (process.env.RAG_EMBEDDING_MODEL && evidence.length > 1) {
      try {
        const base = (process.env.RAG_EMBEDDING_BASE_URL || process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
        const response = await fetch(`${base}/api/embed`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: process.env.RAG_EMBEDDING_MODEL, input: [question, ...evidence.map(item => item.text)], truncate: true }),
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) throw new Error('Embedding request failed');
        const data: any = await response.json();
        const vectors = data.embeddings;
        if (!Array.isArray(vectors) || vectors.length !== evidence.length + 1) throw new Error('Invalid embeddings');
        const query = vectors[0];
        if (!Array.isArray(query) || !query.length) throw new Error('Invalid query embedding');
        const scored = evidence.map((item, index) => {
          const vector = vectors[index + 1];
          if (!Array.isArray(vector) || vector.length !== query.length || ![...vector, ...query].every(Number.isFinite)) throw new Error('Invalid vector');
          const dot = vector.reduce((sum: number, value: number, i: number) => sum + value * query[i], 0);
          const norm = Math.sqrt(vector.reduce((sum: number, value: number) => sum + value * value, 0) * query.reduce((sum: number, value: number) => sum + value * value, 0));
          return { item, score: norm ? dot / norm : 0 };
        }).sort((a, b) => b.score - a.score);
        evidence.splice(0, evidence.length, ...scored.map(row => row.item));
        mode = 'keyword+semantic';
      } catch { limitations.push('Semantic ranking unavailable; keyword retrieval used.'); }
    }
    // Source excerpts get their own budget so plan/task records cannot crowd out the code.
    const budget = { code: CODE_BUDGET_CHARS, other: OTHER_BUDGET_CHARS };
    const selected = evidence.filter(item => {
      const kind = item.source.includes(' @ ') ? 'code' : 'other';
      if (budget[kind] <= 0) return false;
      item.text = item.text.slice(0, budget[kind]); budget[kind] -= item.text.length; return true;
    });
    return { evidence: selected, limitations, mode };
  }

}
