import assert from 'node:assert/strict';
import { codeSearchTerms, definitionIndex, isNonSourcePath, pathScore, snippetAround } from '../domain/ai_intelligence/service/rag/code_search';

// Identifiers win regardless of position; instruction words and their typos are dropped.
assert.deepEqual(codeSearchTerms('go to code base and search evidence about acl impleemntation'), ['acl']);
assert.deepEqual(codeSearchTerms('Where is the createRole function defined and what does it do?'), ['createRole']);
assert.deepEqual(codeSearchTerms('Where is checkAllPermission defined and what does it check?'), ['checkAllPermission']);
assert.equal(codeSearchTerms('Does getAdminUserListService work correctly with pagination, search filters and sorting?')[0], 'getAdminUserListService');
assert.deepEqual(codeSearchTerms('How is the JWT login handled in auth_middleware?').slice(0, 2), ['auth_middleware', 'jwt']);
// Plan task wording (report evidence): generic engineering words are not search terms.
assert.deepEqual(codeSearchTerms('Product CRUD + Variant handling', 3), ['product', 'variant']);
assert.deepEqual(codeSearchTerms('Banners CRUD & publishing workflow', 3), ['banner', 'publishing']);
assert.deepEqual(codeSearchTerms('Catalog CRUD endpoints', 3), ['catalog']);
// Chat passes the user's wording followed by expanded aliases; identifiers keep their casing.
assert.deepEqual(codeSearchTerms('Is the multilangual feature completed? multilingual i18n internationalization translation multilangual feature completed'),
  ['multilangual', 'multilingual', 'i18n', 'internationalization']);
assert.deepEqual(codeSearchTerms('Where is createRole defined? where createrole defined'), ['createRole']);
assert.deepEqual(codeSearchTerms('What is the current sprint progress and how many tasks are remaining?'), []);

// Assets and lock files are not evidence; file-name hits outrank content-only hits.
assert.ok(isNonSourcePath('flutter_app/ios/Runner/Base.lproj/Main.storyboard'));
assert.ok(isNonSourcePath('admin/public/images/search.svg'));
assert.ok(isNonSourcePath('package-lock.json'));
assert.ok(!isNonSourcePath('src/domain/acl/service/acl_service.ts'));
assert.ok(isNonSourcePath('flutter_app/android/build/reports/problems/problems-report.html'));
assert.ok(isNonSourcePath('admin/.cursor/rules/ngxs-and-http.mdc'));
assert.ok(!isNonSourcePath('admin/src/app/pages/banner/banner.component.html'));
assert.ok(pathScore('src/domain/acl/service/acl_service.ts', 'acl') > pathScore('src/app_routing.ts', 'acl'));

// Definitions are found; calls through an object are not definitions.
const source = [
  'export class AclService {',
  '  constructor() {}',
  '  async roleList(req: any) { return this.x.createRole(req); }',
  '  async createRole(reqData: IRoleRequest) {',
  '    return 1;',
  '  }',
  '}',
  'export const checkAllPermission = async (id: string): Promise<void> => {};',
  'function getAdminUserListService(req) { return []; }',
].join('\n');
assert.equal(definitionIndex(source, 'createRole'), source.indexOf('async createRole(reqData'));
assert.equal(definitionIndex(source, 'checkAllPermission'), source.indexOf('checkAllPermission ='));
assert.equal(definitionIndex(source, 'getAdminUserListService'), source.indexOf('function getAdminUserListService'));
assert.equal(definitionIndex('router.post("/role", controller.createRole);', 'createRole'), -1);

const excerpt = snippetAround(source, source.indexOf('async createRole'), 120);
assert.match(excerpt, /^\[excerpt starting at line \d+/);
assert.ok(excerpt.includes('async createRole('));

console.log('PASS: chat code search terms, path ranking, definition detection and excerpts.');
