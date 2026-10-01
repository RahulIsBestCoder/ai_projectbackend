import { ChatRagContext, RagContextBuilder } from './rag_context_builder';
import { ChatRagRetrievalService } from './chat_rag_retrieval_service';

/** Chat-only RAG orchestration. It does not call or alter an AI provider. */
export class RagService {
  constructor(
    private readonly retrieval = new ChatRagRetrievalService(),
    private readonly contextBuilder = new RagContextBuilder()
  ) {}

  public async execute(projectId: string, question: string, project: any): Promise<ChatRagContext> {
    const result = await this.retrieval.retrieve(projectId, question, project);
    return this.contextBuilder.build(result);
  }
}
