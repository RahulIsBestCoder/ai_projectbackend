import { RepositoryReader } from '../repository_reader';
import { definitionIndex, isCodeIdentifier, isNonSourcePath, pathScore, snippetAround } from './code_search';

export interface CodeExcerpt {
  repositoryId: string;
  branch: string;
  path: string;
  /** "<owner/repo>/<branch>/<path> @ <commit>" */
  source: string;
  text: string;
  isDefinition: boolean;
  score: number;
  syncedAt?: any;
}

export interface CodeSearchOptions {
  /** Maximum excerpts returned. */
  files?: number;
  /** Characters per excerpt. */
  snippetChars?: number;
  /**
   * Rank files naming a camelCase/snake_case identifier first (default). Right for user
   * questions that name real functions; turn off for generated text such as plan task
   * descriptions, whose identifiers are often guesses that do not exist in the code.
   */
  preferIdentifiers?: boolean;
}

/**
 * Searches synced repository snapshots for terms and returns excerpts around the
 * definition or first match. Used by chat retrieval and by report implementation
 * analysis. One instance caches searches and reads, so reuse it across many queries
 * against the same project (e.g. every task of a plan).
 */
export class CodeEvidenceSearch {
  private repositories: any[] | null = null;
  private readonly searches = new Map<string, Promise<any[]>>();
  private readonly reads = new Map<string, Promise<any>>();

  constructor(private readonly reader: RepositoryReader, private readonly projectId: string) {}

  public async search(terms: string[], options: CodeSearchOptions = {}): Promise<CodeExcerpt[]> {
    const maxFiles = options.files ?? 5;
    const snippetChars = options.snippetChars ?? 3200;
    if (!terms.length || maxFiles <= 0) return [];
    this.repositories ||= (await this.reader.execute(this.projectId, { tool: 'repositories' })).repositories.slice(0, 6);
    const candidates = new Map<string, { repo: any; path: string; score: number; terms: Set<string> }>();
    const hits = await Promise.all(this.repositories!.flatMap(repo => terms.map(async term => ({ repo, term, files: await this.searchFiles(repo, term) }))));
    for (const { repo, term, files } of hits) {
      for (const file of files) {
        if (file.encoding !== 'utf8' || file.fileType !== 'blob' || isNonSourcePath(file.path)) continue;
        const key = `${repo.repositoryId}:${repo.branch}:${file.path}`;
        const entry = candidates.get(key) || { repo, path: file.path, score: 0, terms: new Set<string>() };
        entry.score += pathScore(file.path, term) + (isCodeIdentifier(term) ? 2 : 0);
        entry.terms.add(term);
        candidates.set(key, entry);
      }
    }
    // Files matching more of the terms rank higher. When a named identifier was found,
    // files mentioning it come first; two or more such files are enough on their own.
    const preferIdentifiers = options.preferIdentifiers !== false;
    const ranked = [...candidates.values()]
      .map(entry => ({ ...entry, score: entry.score + (entry.terms.size - 1) * 2,
        named: preferIdentifiers && [...entry.terms].some(isCodeIdentifier) }))
      .sort((a, b) => Number(b.named) - Number(a.named) || b.score - a.score);
    const named = ranked.filter(entry => entry.named);
    const shortlist = (named.length >= 2 ? named : ranked).slice(0, maxFiles * 2);
    const excerpts = await Promise.all(shortlist.map(async candidate => {
      try {
        const excerpt = await this.excerpt(candidate.repo, candidate.path, terms, snippetChars);
        return excerpt ? { ...excerpt, score: (candidate.named ? 1000 : 0) + candidate.score + (excerpt.isDefinition ? 6 : 0) } : null;
      } catch { return null; /* restricted or unavailable file */ }
    }));
    return excerpts.filter((excerpt): excerpt is CodeExcerpt => excerpt !== null).sort((a, b) => b.score - a.score).slice(0, maxFiles);
  }

  /**
   * Path matches plus the first page of content matches. Content results are capped and
   * ordered by path, so a common word ("order") would otherwise fill the page with files
   * that only mention it and hide the files named after it (order/service/order_service.ts).
   */
  private searchFiles(repo: any, term: string): Promise<any[]> {
    const key = `${repo.repositoryId}:${repo.branch}:${term.toLowerCase()}`;
    if (!this.searches.has(key)) {
      const run = (field?: 'path') => this.reader.execute(this.projectId,
        { tool: 'search', repositoryId: repo.repositoryId, branch: repo.branch, query: term, ...(field ? { field } : {}) })
        .then((result: any) => result.files || []).catch(() => []);
      this.searches.set(key, Promise.all([run('path'), run()]).then(([byPath, byContent]) => {
        const seen = new Set<string>(byPath.map((file: any) => file.path));
        return [...byPath, ...byContent.filter((file: any) => !seen.has(file.path))];
      }));
    }
    return this.searches.get(key)!;
  }

  private read(repo: any, path: string, offset: number): Promise<any> {
    const key = `${repo.repositoryId}:${repo.branch}:${path}:${offset}`;
    if (!this.reads.has(key)) {
      const pending = this.reader.execute(this.projectId, { tool: 'read', repositoryId: repo.repositoryId, branch: repo.branch, path, offset });
      pending.catch(() => this.reads.delete(key));
      this.reads.set(key, pending);
    }
    return this.reads.get(key)!;
  }

  /** Reads a file chunk by chunk until it finds a definition of an identifier term, else the first term match. */
  private async excerpt(repo: any, path: string, terms: string[], snippetChars: number): Promise<Omit<CodeExcerpt, 'score'> | null> {
    const identifiers = terms.filter(isCodeIdentifier);
    const size = Math.max(400, snippetChars - 200);
    const base = { repositoryId: String(repo.repositoryId), branch: repo.branch, path };
    let offset = 0;
    let firstMatch: { content: string; index: number; offset: number } | null = null;
    let file: any;
    for (let chunk = 0; chunk < 10; chunk++) {
      file = await this.read(repo, path, offset);
      if (typeof file.content !== 'string') return null;
      const content: string = file.content;
      for (const name of identifiers) {
        const index = definitionIndex(content, name);
        if (index < 0) continue;
        let windowText = content, windowIndex = index, windowOffset = offset;
        if (index + size * 0.9 > content.length && file.nextOffset != null) {
          // Definition sits near the end of this chunk: re-read starting just before it.
          const lead = Math.max(0, index - Math.floor(size * 0.1));
          windowOffset = offset + Buffer.byteLength(content.slice(0, lead), 'utf8');
          windowText = (await this.read(repo, path, windowOffset)).content || content;
          windowIndex = 0;
        }
        return { ...base, source: `${file.repository}/${file.branch}/${file.path} @ ${file.commit}`, syncedAt: file.syncedAt,
          isDefinition: true, text: `Defines ${name}\n${snippetAround(windowText, windowIndex, size, windowOffset)}` };
      }
      if (!firstMatch) {
        const lower = content.toLowerCase();
        const index = Math.min(...terms.map(term => lower.indexOf(term.toLowerCase())).filter(i => i >= 0).concat(Infinity));
        if (Number.isFinite(index)) firstMatch = { content, index, offset };
      }
      if (file.nextOffset == null) break;
      offset = Math.max(offset + 1, file.nextOffset - 500); // overlap so a definition split across chunks is still found
    }
    const match = firstMatch || { content: (await this.read(repo, path, 0)).content || '', index: 0, offset: 0 };
    return { ...base, source: `${file.repository}/${file.branch}/${file.path} @ ${file.commit}`, syncedAt: file.syncedAt, isDefinition: false,
      text: snippetAround(match.content, match.index, size, match.offset) };
  }
}
