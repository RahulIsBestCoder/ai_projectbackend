import { RagRetrievalService, RetrievalResult } from '../rag_retrieval_service';
import { ChatRagEvidence, ChatRagSourceType } from './rag_context_builder';
import { ChatRagQueryExpander } from './chat_rag_query_expander';

/** Adds chat-specific Taiga and Git evidence without changing shared retrieval behavior. */
export class ChatRagRetrievalService {
  constructor(
    private readonly db: any = global.db.connection.db,
    private readonly base = new RagRetrievalService(db),
    private readonly queryExpander = new ChatRagQueryExpander()
  ) {}

  public async retrieve(projectId: string, question: string, project: any): Promise<RetrievalResult> {
    const expandedKeywords = this.queryExpander.expand(question);
    const needsCode = /feature|complete|progress|remaining|work|status|initiated/i.test(question);
    const baseQuestion = `${expandedKeywords.join(' ')} ${question}${needsCode ? ' implementation code test' : ''}`;
    // Code search terms: the user's own wording first (keeps identifier casing such as
    // createRole), then corrected spellings and aliases (multilangual -> multilingual, i18n).
    const result = await this.base.retrieve(projectId, baseQuestion, project, `${question} ${expandedKeywords.join(' ')}`);
    // Chat RAG must use current source records. The prebuilt project_context snapshot
    // belongs to older context flows and can inject stale risk/status statements.
    const evidence = result.evidence.filter(item =>
      item.source !== 'projects: stored context snapshot (may be stale)') as ChatRagEvidence[];
    const limitations = [...result.limitations];
    const pattern = expandedKeywords.join('|');
    const filter: any = { project_id: projectId, is_deleted: { $ne: true } };

    const addRows = async (config: {
      collection: string; type: ChatRagSourceType; fields: string[]; search: string[]; limit: number;
    }) => {
      try {
        const query: any = { ...filter };
        if (pattern) query.$or = config.search.map(field => ({ [field]: { $regex: pattern, $options: 'i' } }));
        const projection = Object.fromEntries(config.fields.map(field => [field, 1]));
        const rows = await this.db.collection(config.collection).find(query).project(projection)
          .sort({ updated_at: -1, modified_date: -1, committed_at: -1 }).limit(config.limit).maxTimeMS(5000).toArray();
        for (const row of rows) {
          const title = row.subject || row.message || row.title;
          evidence.push({ id: '', sourceType: config.type, title,
            source: `${config.collection}:${row._id}`, text: JSON.stringify(row),
            updatedAt: String(row.updated_at || row.modified_date || row.committed_at || '') || undefined });
        }
      } catch {
        limitations.push(`${config.collection} retrieval unavailable.`);
      }
    };

    await addRows({ collection: 'taiga_tasks', type: 'taiga_task', limit: 5,
      search: ['subject', 'description', 'user_story_subject'],
      fields: ['subject', 'description', 'status_name', 'is_closed', 'is_blocked', 'blocked_note',
        'user_story_subject', 'taiga_milestone_slug', 'assigned_to_full_name', 'modified_date', 'updated_at'] });
    await addRows({ collection: 'commits', type: 'commit', limit: 5, search: ['message'],
      fields: ['sha', 'message', 'author_name', 'repository_id', 'committed_at', 'stats'] });

    for (const item of evidence) {
      if (item.sourceType) continue;
      if (item.source.startsWith('projects:')) item.sourceType = 'project';
      else if (item.source.startsWith('ai_plans:')) item.sourceType = 'plan';
      else if (item.source.startsWith('work_items:')) item.sourceType = 'task';
      else if (item.source.startsWith('risk_predictions:')) item.sourceType = 'risk';
      else if (item.source.includes(' @ ')) item.sourceType = 'code';
    }
    return { ...result, evidence, limitations: [...new Set(limitations)] };
  }
}
