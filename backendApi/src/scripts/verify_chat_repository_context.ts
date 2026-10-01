import assert from 'node:assert/strict';
import { AiIntelligenceService } from '../domain/ai_intelligence/service/ai_intelligence_service';
import { GitHubCodeContextService } from '../domain/ai_intelligence/service/github_code_context_service';

async function main(): Promise<void> {
  const service: any = Object.create(AiIntelligenceService.prototype);
  service.initLog = () => {};
  service.log = () => {};
  service._projectModel = { findByAny: async () => ({ project_context: { text: 'Project summary' } }) };
  service._generate = async (prompt: string) => prompt;
  (global as any).db = { connection: { db: {} } };
  const original = GitHubCodeContextService.prototype.build;
  const projects: string[] = [];
  GitHubCodeContextService.prototype.build = async (id: string) => {
    projects.push(id);
    return { sourceFilter: 'domain/**', repositories: [], coverage: { incomplete: false },
      files: [{ path: 'domain/example.ts', content: 'export const answer = 42;' }] };
  };
  try {
    const prompt = await service.generateChatResponse({ project_id: 'project-a', prompt: 'Explain the code' });
    assert.deepEqual(projects, ['project-a']);
    assert.match(prompt, /export const answer = 42/);
    assert.match(prompt, /Project summary/);
    assert.match(prompt, /Explain the code/);
    assert.match(prompt, /untrusted data/);
    const generic = await service.generateChatResponse({ prompt: 'Hello' });
    assert.doesNotMatch(generic, /Repository Source/);
    assert.equal(projects.length, 1);
    GitHubCodeContextService.prototype.build = async () => { throw new Error('offline'); };
    assert.match(await service.generateChatResponse({ project_id: 'project-a', prompt: 'Explain' }), /Repository snapshot unavailable/);
    service._projectModel.findByAny = async () => null;
    await assert.rejects(service.generateChatResponse({ project_id: 'missing', prompt: 'Explain' }), /Project not found/);
    console.log('PASS: chat source context, project scope, generic chat, unavailable snapshot, missing project.');
  } finally { GitHubCodeContextService.prototype.build = original; }
}
main().catch(err => { console.error(err); process.exitCode = 1; });
