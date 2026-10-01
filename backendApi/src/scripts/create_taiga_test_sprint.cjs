// Explicit manual integration check: one test sprint, using curl without printing credentials.
require('dotenv').config();
const mongoose = require('mongoose');
const { spawnSync } = require('node:child_process');
const base = 'https://api.taiga.io/api/v1';
function request(method, path, token, data) {
  const quote = value => JSON.stringify(String(value));
  const config = [
    'silent', 'show-error', 'max-time = 30',
    `url = ${quote(base + path)}`, `request = ${quote(method)}`,
    'header = "Content-Type: application/json"',
    'write-out = "\\n%{http_code}"',
  ];
  if (token) config.push(`header = ${quote('Authorization: Bearer ' + token)}`);
  if (data) config.push(`data = ${quote(JSON.stringify(data))}`);
  const result = spawnSync('curl.exe', ['--config', '-'], { input: config.join('\n'), encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error('curl transport failed (credentials omitted)');
  const split = result.stdout.lastIndexOf('\n');
  const status = Number(result.stdout.slice(split + 1));
  if (status === 204) {
    console.log(`${method} ${path}: HTTP ${status}`);
    return null;
  }
  let body;
  try { body = JSON.parse(result.stdout.slice(0, split)); } catch { throw new Error(`Taiga returned non-JSON, HTTP ${status}`); }
  console.log(`${method} ${path}: HTTP ${status}`);
  if (status >= 400) {
    const error = new Error(`Taiga HTTP ${status}: ${body._error_message || body.detail || JSON.stringify(body)}`);
    error.status = status;
    throw error;
  }
  return body;
}
async function main() {
  await mongoose.connect(`${process.env.MONGODB_URI}${process.env.DB_NAME || 'ai_project'}`, { serverSelectionTimeoutMS: 5000 });
  const integ = await mongoose.connection.db.collection('integrations').findOne({ _id: new mongoose.Types.ObjectId('6aae8c1c24b246439e32faa1'), provider: 'taiga', is_deleted: false });
  if (!integ) throw new Error('Integration not found');
  let token = integ.token;
  const authenticate = () => {
    if (!integ.username || !integ.password) throw new Error('Saved username/password missing');
    const auth = request('POST', '/auth', null, { type: 'normal', username: integ.username, password: integ.password });
    if (!auth.auth_token) throw new Error('Authentication returned no token');
    return auth.auth_token;
  };
  if (!token) token = authenticate();
  const slug = 'sougatabauri-demo-projetc';
  let project;
  try { project = request('GET', '/projects/by_slug?slug=' + slug, token); }
  catch (error) {
    if (![401, 403].includes(error.status)) throw error;
    token = authenticate();
    project = request('GET', '/projects/by_slug?slug=' + slug, token);
  }
  if (!project.id || project.slug !== slug) throw new Error('Unexpected Taiga project');
  const name = 'API test sprint - 19 Sep 2026';
  if (process.argv.includes('--delete-test')) {
    const sprintId = 532177;
    let sprint;
    try { sprint = request('GET', '/milestones/' + sprintId, token); }
    catch (error) {
      if (error.status === 404) { console.log('Test sprint already absent.'); return; }
      throw error;
    }
    if (sprint.name !== name || sprint.project !== project.id) throw new Error('Sprint identity changed; refusing deletion');
    const stories = request('GET', `/userstories?project=${project.id}&milestone=${sprintId}`, token);
    const tasks = request('GET', `/tasks?project=${project.id}&milestone=${sprintId}`, token);
    if (!Array.isArray(stories) || !Array.isArray(tasks) || stories.length || tasks.length || sprint.user_stories?.length) {
      throw new Error('Sprint may contain stories or tasks; refusing deletion to preserve work');
    }
    request('DELETE', '/milestones/' + sprintId, token);
    try { request('GET', '/milestones/' + sprintId, token); }
    catch (error) {
      if (error.status === 404) { console.log(`Verified deletion of test sprint ${sprintId}: ${name}`); return; }
      throw error;
    }
    throw new Error('Deletion could not be verified');
  }
  const existing = request('GET', '/milestones?project=' + project.id, token);
  const found = Array.isArray(existing) && existing.find(row => row.name === name);
  const sprint = found || request('POST', '/milestones', token, {
    project: project.id, name, estimated_start: '2026-09-19', estimated_finish: '2026-09-25',
  });
  const verified = request('GET', '/milestones/' + sprint.id, token);
  console.log(JSON.stringify({ created: !found, project_id: project.id, sprint_id: verified.id, name: verified.name, start: verified.estimated_start, finish: verified.estimated_finish, url: `https://tree.taiga.io/project/${slug}/taskboard/${verified.slug}` }, null, 2));
}
main().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => mongoose.disconnect());
