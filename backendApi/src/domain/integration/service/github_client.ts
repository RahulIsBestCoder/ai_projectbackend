import { GitHubRequest } from './github_source_sync_service';

export function githubClient(owner: string, repository: string, token: string): GitHubRequest {
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repository) || !token) {
    throw new Error('A valid GitHub owner, repository name, and access token are required.');
  }
  return async path => {
    const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}${path}`, {
      signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'User-Agent': 'aiproject-sync', 'X-GitHub-Api-Version': '2022-11-28' },
    });
    if (!response.ok) {
      const error: any = new Error(`GitHub request failed with status ${response.status} (${owner}/${repository}).`);
      error.statusCode = response.status;
      throw error;
    }
    return response.json();
  };
}
