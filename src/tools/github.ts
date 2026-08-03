import { requireProviderToken } from '../integrations/access.js';
import type { Tool } from './types.js';

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
    const maxResults = typeof args.maxResults === 'string' ? args.maxResults : '10';
    const params = new URLSearchParams({ sort: 'updated', per_page: maxResults });
    const response = await fetch(`https://api.github.com/user/repos?${params.toString()}`, {
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'bro-assistant',
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub request failed with status ${response.status}`);
    }
    const repos = (await response.json()) as GitHubRepo[];
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
    const response = await fetch(`https://api.github.com/repos/${repo}/issues`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'bro-assistant',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ title, ...(body ? { body } : {}) }),
    });
    if (!response.ok) {
      throw new Error(`GitHub request failed with status ${response.status}`);
    }
    const issue = (await response.json()) as GitHubIssue;
    return `Issue #${issue.number ?? '?'} created: "${issue.title}" (${issue.html_url ?? ''})`;
  },
};
