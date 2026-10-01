/**
 * `taiga_client.ts` — Thin fetch wrapper for the Taiga REST API.
 *
 * Mirrors the shape of the existing `tg()` closure inside `syncTaiga`
 * (`integration_service.ts:1048-1057`) so both read-side and write-side
 * use the same auth contract. Kept stateless — one instance per publish.
 */
export class TaigaClient {
  private readonly baseUrl: string;
  private token: string;
  private readonly fetch: any;

  constructor(token: string, baseUrl = 'https://api.taiga.io/api/v1', private readonly refreshToken?: () => Promise<string>) {
    this.token = token;
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.fetch = (globalThis as any).fetch;
  }

  /** Retry a rejected token once; concurrent requests share authentication. */
  private refreshPromise: Promise<string> | null = null;

  private async request<T>(path: string, method: string, body?: any): Promise<T> {
    const send = (token: string) => this.fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const requestToken = this.token;
    let r = await send(requestToken);
    if (r.status === 401 && this.refreshToken) {
      if (this.token === requestToken) {
        if (!this.refreshPromise) {
          this.refreshPromise = this.refreshToken().then(token => {
            this.token = token;
            return token;
          }).finally(() => { this.refreshPromise = null; });
        }
        await this.refreshPromise;
      }
      r = await send(this.token);
    }
    if (!r.ok) {
      const b: any = await r.json().catch(() => ({}));
      const detail = b?._error_message || b?.detail || (Object.keys(b).length ? JSON.stringify(b) : r.statusText);
      const reconnect = r.status === 401 ? ' Reconnect the Taiga integration with valid credentials or a new access token.' : '';
      const error = new Error(`Taiga ${r.status}: ${detail}${reconnect}`);
      Object.assign(error, { status: r.status });
      throw error;
    }
    return r.json();
  }

  async get<T = any>(path: string): Promise<T> {
    return this.request<T>(path, 'GET');
  }

  async post<T = any>(path: string, body: any): Promise<T> {
    return this.request<T>(path, 'POST', body);
  }

  async patch<T = any>(path: string, body: any): Promise<T> {
    return this.request<T>(path, 'PATCH', body);
  }

  /** Authenticate with username/password, returns auth_token. */
  async auth(username: string, password: string): Promise<string> {
    const r = await this.fetch(`${this.baseUrl}/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'normal', username, password }),
    });
    if (!r.ok) {
      const b: any = await r.json().catch(() => ({}));
      throw new Error(`Taiga auth ${r.status}: ${b.detail || b._error_message || r.statusText}`);
    }
    const data: any = await r.json();
    if (!data.auth_token) {
      throw new Error('Taiga auth response missing auth_token.');
    }
    return data.auth_token;
  }

  /** Resolve a Taiga project by slug. */
  async projectBySlug(slug: string): Promise<any> {
    return this.get(`/projects/by_slug?slug=${encodeURIComponent(slug)}`);
  }

  /**
   * Resolve a Taiga project by numeric id.
   *
   * Preferred over `projectBySlug`: `connect` stores the Taiga project id in
   * `integrations.repository_name`, while `repository_url` is the API base.
   */
  async getProject(projectId: number): Promise<any> {
    return this.get(`/projects/${projectId}`);
  }

  /** Fetch all metadata needed for publish mapping. */
  async getMetadata(projectId: number): Promise<any> {
    const [users, priorities, severities, taskStatuses, userStoryStatuses, points] = await Promise.all([
      this.get(`/memberships?project=${projectId}`),
      this.get(`/priorities?project=${projectId}`),
      this.get(`/severities?project=${projectId}`),
      this.get(`/task-statuses?project=${projectId}`),
      this.get(`/userstory-statuses?project=${projectId}`),
      this.get(`/points?project=${projectId}`),
    ]);

    // Taiga memberships contain user info inside `user` / `user_extra_info`
    const userRows: any[] = Array.isArray(users)
      ? users.map((m: any) => ({
          id: m.user ?? m.user_extra_info?.id,
          username: m.user_extra_info?.username || m.username,
          full_name: m.user_extra_info?.full_name_display || m.full_name,
        }))
      : [];

    return {
      users: userRows,
      priorities: Array.isArray(priorities) ? priorities : [],
      severities: Array.isArray(severities) ? severities : [],
      // Taiga has issue types, but no task types endpoint. Keep the response key.
      taskTypes: [],
      taskStatuses: Array.isArray(taskStatuses) ? taskStatuses : [],
      userStoryStatuses: Array.isArray(userStoryStatuses) ? userStoryStatuses : [],
      points: Array.isArray(points) ? points : [],
    };
  }

  /** Create a milestone (sprint in Taiga's older API). */
  async hasSprints(projectId: number): Promise<boolean> {
    // The first page is sufficient: any sprint, including a closed one, blocks creation.
    const rows = await this.get(`/milestones?project=${projectId}`);
    if (!Array.isArray(rows)) throw new Error('Unexpected Taiga sprint list response.');
    return rows.length > 0;
  }

  /** Create a milestone (sprint in Taiga's older API). */
  async createMilestone(projectId: number, body: any): Promise<any> {
    return this.post('/milestones', { project: projectId, ...body });
  }

  /** Update a milestone. */
  async updateMilestone(milestoneId: number, body: any): Promise<any> {
    return this.patch(`/milestones/${milestoneId}`, body);
  }

  /** Create a user story. */
  async createUserStory(projectId: number, body: any): Promise<any> {
    return this.post('/userstories', { project: projectId, ...body });
  }

  /** Update a user story. */
  async updateUserStory(storyId: number, body: any): Promise<any> {
    const current = await this.get(`/userstories/${storyId}`);
    return this.patch(`/userstories/${storyId}`, { ...body, version: current.version });
  }

  /** Create a task attached to a user story (or standalone). */
  async createTask(projectId: number, body: any): Promise<any> {
    return this.post('/tasks', { project: projectId, ...body });
  }

  /** Update a task. */
  async updateTask(taskId: number, body: any): Promise<any> {
    const current = await this.get(`/tasks/${taskId}`);
    return this.patch(`/tasks/${taskId}`, { ...body, version: current.version });
  }
}
