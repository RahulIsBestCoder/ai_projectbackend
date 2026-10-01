/**
 * Helpers that turn a chat question into repository search terms and locate the
 * relevant part of a source file. Pure functions so retrieval stays testable.
 */

// Words that describe the request ("go to the code base and search evidence about ...")
// rather than what to look for. Matching files on them returns unrelated files.
const INSTRUCTION_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'into', 'about', 'this', 'that', 'these', 'those', 'its', 'has', 'have', 'had',
  'are', 'was', 'were', 'is', 'can', 'could', 'would', 'should', 'will', 'does', 'did', 'done', 'please', 'tell', 'show',
  'explain', 'give', 'list', 'find', 'search', 'look', 'check', 'checks', 'see', 'get', 'go', 'goto', 'how', 'what', 'where',
  'when', 'why', 'which', 'who', 'whether', 'any', 'all', 'some', 'there', 'their', 'them', 'they', 'you', 'your', 'our',
  'code', 'codes', 'codebase', 'base', 'source', 'repo', 'repos', 'repository', 'repositories', 'project', 'file', 'files',
  'evidence', 'implementation', 'implemented', 'implement', 'implementing', 'function', 'functions', 'method', 'methods',
  'defined', 'define', 'definition', 'declared', 'located', 'location', 'written', 'work', 'works', 'working', 'correctly',
  'correct', 'properly', 'exist', 'exists', 'present', 'available', 'used', 'use', 'uses', 'logic', 'feature', 'features',
  'detail', 'details', 'more', 'also', 'like', 'want', 'need', 'know', 'it', 'do', 'in', 'of', 'to', 'on', 'by',
  // Progress/status wording: describes the question, not the code.
  'complete', 'completed', 'completion', 'finished', 'done', 'status', 'progress', 'remaining', 'pending', 'started',
  'initiated', 'current', 'currently', 'many', 'much', 'count', 'task', 'tasks', 'sprint', 'sprints', 'ready', 'yet',
  // Generic engineering words that appear in almost every plan task and match unrelated files.
  'crud', 'api', 'apis', 'ui', 'ux', 'db', 'ci', 'cd', 'qa', 'json', 'add', 'simple', 'handling', 'layer', 'basic', 'core',
  'full', 'system', 'end', 'setup', 'endpoints', 'endpoint', 'table', 'tables', 'screen', 'page', 'pages', 'workflow',
]);
// Long instruction words whose misspellings ("impleemntation") must be ignored too.
const TYPO_TARGETS = ['implementation', 'implemented', 'repository', 'evidence', 'function', 'codebase', 'definition', 'correctly'];

function editDistance(left: string, right: string): number {
  const row = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= right.length; j++) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (left[i - 1] === right[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[right.length];
}

const isInstructionWord = (word: string) => INSTRUCTION_WORDS.has(word)
  || (word.length >= 7 && TYPO_TARGETS.some(target => Math.abs(target.length - word.length) <= 2 && editDistance(word, target) <= 2));

const singular = (word: string) =>
  word.length > 4 && word.endsWith('ies') ? `${word.slice(0, -3)}y`
    : word.length > 3 && word.endsWith('s') && !/(ss|us|is|os)$/.test(word) ? word.slice(0, -1) : word;

/**
 * camelCase, PascalCase with 2+ humps, or snake_case: names that point at specific code.
 * Acronyms (ACL, JWT, CRUD) are treated as ordinary search words, not identifiers.
 */
export const isCodeIdentifier = (token: string) =>
  /[a-z0-9][A-Z]/.test(token) || /^[A-Za-z]\w*_\w+$/.test(token);

/**
 * Search terms in priority order: code identifiers first (wherever they appear in the
 * question), then other meaningful words. Instruction words and their typos are dropped.
 */
export function codeSearchTerms(question: string, max = 4): string[] {
  const tokens = String(question || '').match(/[A-Za-z_$][A-Za-z0-9_$]*/g) || [];
  const identifiers: string[] = [];
  const words: string[] = [];
  const seen = new Set<string>();
  for (const token of tokens) {
    const key = token.toLowerCase();
    if (seen.has(key)) continue;
    if (isCodeIdentifier(token)) { seen.add(key); identifiers.push(token); continue; }
    if (key.length < 3 || isInstructionWord(key)) continue;
    // Singular form also matches the plural ("banner" finds banners/banner_controller).
    const word = singular(key);
    if (seen.has(word)) continue;
    seen.add(key);
    seen.add(word);
    words.push(word);
  }
  return [...identifiers, ...words].slice(0, max);
}

/** Files that cannot be meaningful source evidence (assets, lock files, platform layout files). */
export function isNonSourcePath(path: string): boolean {
  const name = path.split('/').pop() || '';
  // Build output, dependency folders and AI-assistant notes are not the project's implementation.
  if (/(^|\/)(build|dist|out|coverage|node_modules|vendor|\.dart_tool|\.cursor|\.idea|\.vscode|\.gradle|Pods)\//i.test(path)) return true;
  return /\.(svg|png|jpe?g|gif|ico|webp|bmp|ttf|otf|woff2?|eot|lock|storyboard|xib|pbxproj|plist|xcconfig|map|min\.js|min\.css|mdc)$/i.test(name)
    || /^(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|pubspec\.lock|composer\.lock|Podfile\.lock|\.gitignore|\.gitattributes|\.editorconfig|\.prettierrc|\.eslintrc.*|AGENTS\.md|CLAUDE\.md)$/i.test(name);
}

/** Relevance of one search hit for one term: file name > path > content-only match. */
export function pathScore(path: string, term: string): number {
  const lowerPath = path.toLowerCase();
  const lowerTerm = term.toLowerCase();
  const name = lowerPath.split('/').pop() || '';
  let score = 1;
  if (name.includes(lowerTerm)) score += 5;
  else if (lowerPath.includes(lowerTerm)) score += 3;
  if (/\.(md|txt)$/i.test(name)) score -= 3;             // documentation, not implementation
  else if (/\.(s?css|less|sass)$/i.test(name)) score -= 3; // styling, not behaviour
  else if (/\.(json|ya?ml)$/i.test(name)) score -= 1;
  return score;
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Index where `name` is defined (function, method, arrow function, class), not merely
 * called; -1 when the content only uses it. Calls like `this.service.name(...)` are skipped.
 */
export function definitionIndex(content: string, name: string): number {
  const id = escapeRegex(name);
  const patterns = [
    new RegExp(`(?:function|class|interface|def|fun|func)\\s+${id}\\b`),
    new RegExp(`(?<![.\\w$])${id}\\s*[:=]\\s*(?:async\\s*)?(?:function\\b|\\([^)]*\\)\\s*(?::[^=]+)?=>)`),
    new RegExp(`(?<![.\\w$])(?:(?:public|private|protected|static|async|override|readonly)\\s+)*${id}\\s*\\([^;{]*\\)\\s*(?::\\s*[^{;]+)?\\{`),
  ];
  const positions = patterns.map(pattern => content.search(pattern)).filter(index => index >= 0);
  return positions.length ? Math.min(...positions) : -1;
}

/** A window of `size` characters starting a little before `index`, labelled with line numbers. */
export function snippetAround(content: string, index: number, size: number, baseOffset = 0): string {
  const start = Math.max(0, index - Math.floor(size * 0.1));
  const lineStart = start === 0 ? 0 : content.lastIndexOf('\n', start) + 1;
  const text = content.slice(lineStart, lineStart + size);
  const where = baseOffset === 0 ? `line ${content.slice(0, lineStart).split('\n').length}` : `byte ~${baseOffset + lineStart}`;
  return `[excerpt starting at ${where}${lineStart + size < content.length ? ', continues' : ''}]\n${text}`;
}
