import { requireProviderToken } from '../integrations/access.js';
import type { Tool } from './types.js';
import { fetchJson } from '../lib/http.js';

type GitHubRepo = {
  full_name?: string;
  description?: string | null;
  html_url?: string;
  default_branch?: string;
  pushed_at?: string;
};

type GitHubIssue = {
  number?: number;
  title?: string;
  html_url?: string;
};

export const githubListReposTool: Tool = {
  name: 'github_list_repos',
  description:
    'List the user\u2019s GitHub repositories, most recently updated first, with description and default branch.',
  parameters: {
    type: 'object',
    properties: {
      maxResults: {
        type: 'string',
        description: 'Maximum number of repositories to return (default 10).',
      },
    },
  },
  async execute(args, context) {
    const token = await requireProviderToken(context.userId, 'github');
    const parsed = Number.parseInt(
      typeof args.maxResults === 'string' ? args.maxResults : '10',
      10,
    );
    const maxResults = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : 10;
    const params = new URLSearchParams({ sort: 'updated', per_page: String(maxResults) });
    const repos = await fetchJson<GitHubRepo[]>(`https://api.github.com/user/repos?${params}`, {
      timeoutMs: 10_000,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
      },
    });
    if (repos.length === 0) {
      return 'No repositories found.';
    }
    const lines = repos.map((repo, index) => {
      const desc = repo.description ? `\n  ${repo.description}` : '';
      return `${index + 1}. ${repo.full_name ?? '(unnamed)'} (${repo.default_branch ?? 'main'})${desc}`;
    });
    return lines.join('\n');
  },
};

export const githubCreateIssueTool: Tool = {
  name: 'github_create_issue',
  description:
    'Create an issue on a GitHub repository. Provide the repo in "owner/repo" format, a title, and optional body.',
  parameters: {
    type: 'object',
    properties: {
      repo: {
        type: 'string',
        description: 'Repository in "owner/repo" format, e.g. "octocat/Hello-World".',
      },
      title: { type: 'string', description: 'Issue title.' },
      body: { type: 'string', description: 'Optional issue body.' },
    },
    required: ['repo', 'title'],
  },
  async execute(args, context) {
    const repo =
      typeof args.repo === 'string' ? args.repo.trim().replace(/^https?:\/\/[^/]+\//, '') : '';
    const title = typeof args.title === 'string' ? args.title.trim() : '';
    if (!repo || !title) {
      throw new Error('Missing "repo" or "title" argument');
    }
    const token = await requireProviderToken(context.userId, 'github');
    const body = typeof args.body === 'string' && args.body.trim() ? args.body.trim() : undefined;
    const issue = await fetchJson<GitHubIssue>(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      timeoutMs: 10_000,
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title, ...(body ? { body } : {}) }),
    });
    return `Issue #${issue.number ?? '?'} created: "${issue.title}" (${issue.html_url ?? ''})`;
  },
};
