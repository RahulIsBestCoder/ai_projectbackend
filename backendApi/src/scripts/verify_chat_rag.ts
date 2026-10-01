import assert from 'node:assert/strict';
import { ChatRagRetrievalService } from '../domain/ai_intelligence/service/rag/chat_rag_retrieval_service';
import { RagContextBuilder } from '../domain/ai_intelligence/service/rag/rag_context_builder';
import { ChatRagQueryExpander } from '../domain/ai_intelligence/service/rag/chat_rag_query_expander';
import { AI_CONTEXT_CONFIG } from '../configuration/context.config';
import { AiIntelligenceService } from '../domain/ai_intelligence/service/ai_intelligence_service';

async function main(): Promise<void> {
  const expanded = new ChatRagQueryExpander().expand('Is the multilangual feature intiated?');
  assert.ok(expanded.includes('multilingual'));
  assert.ok(expanded.includes('i18n'));
  assert.ok(expanded.includes('localization'));
  assert.ok(expanded.includes('translation'));
  assert.ok(expanded.includes('initiated'));
  const greetingPrompt = AI_CONTEXT_CONFIG.chatPrompt('hello', [],
    { evidence: [], limitations: [], mode: 'none' }, null);
  assert.doesNotMatch(greetingPrompt, /predicted late finish/i);
  const chat: any = Object.create(AiIntelligenceService.prototype);
  chat._generate = async (prompt: string) => prompt;
  const isolatedGreeting = await chat.generateChatResponse({ prompt: 'hello', history: [
    { role: 'assistant', content: 'The project has a predicted late finish and high risk.' },
  ] });
  assert.doesNotMatch(isolatedGreeting, /predicted late finish|high risk/i);
  const queries: Array<{ collection: string; query: any }> = [];
  const rows: Record<string, any[]> = {
    taiga_tasks: [{ _id: 'task-1', subject: 'Payment webhook', status_name: 'In Progress' }],
    commits: [{ _id: 'commit-1', sha: 'abc123', message: 'Add payment webhook' }],
  };
  const db = {
    collection: (collection: string) => ({
      find: (query: any) => {
        queries.push({ collection, query });
        const cursor: any = {
          project: () => cursor, sort: () => cursor, limit: () => cursor, maxTimeMS: () => cursor,
          toArray: async () => rows[collection] || [],
        };
        return cursor;
      },
    }),
  };
  let baseQuestion = '';
  const base = {
    retrieve: async (_projectId: string, question: string) => {
      baseQuestion = question;
      return { mode: 'keyword', limitations: [], evidence: [
        { id: 'old', source: 'projects: current project', text: '{"name":"Payments"}' },
        { id: 'stale', source: 'projects: stored context snapshot (may be stale)', text: 'Old risk context' },
      ] };
    },
  };

  const retrieval = new ChatRagRetrievalService(db as any, base as any);
  const result = await retrieval.retrieve('project-a', 'Is the multilangual feature intiated and what is its status?', {});
  assert.match(baseQuestion, /implementation code test/);
  assert.match(baseQuestion, /multilingual i18n internationalization/);
  assert.equal(queries.length, 2);
  assert.ok(queries.every(item => item.query.project_id === 'project-a'));
  assert.ok(result.evidence.some((item: any) => item.sourceType === 'taiga_task'));
  assert.ok(result.evidence.some((item: any) => item.sourceType === 'commit'));
  assert.ok(!result.evidence.some(item => item.source.includes('stored context snapshot')));

  const context = new RagContextBuilder().build(result);
  assert.deepEqual(context.evidence.map(item => item.id), ['S1', 'S2', 'S3']);
  assert.deepEqual(context.sections.Project, ['S1']);
  assert.deepEqual(context.sections['Taiga tasks'], ['S2']);
  assert.deepEqual(context.sections['Git activity'], ['S3']);
  assert.ok(context.evidence.reduce((total, item) => total + item.text.length, 0) <= 32000);
  console.log('PASS: chat-only RAG retrieval, project isolation, citations, and context sections.');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
