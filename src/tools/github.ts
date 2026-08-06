import { requirePermission } from '../integrations/access.js';
import { getGrantedPermissions } from '../integrations/permissions.js';
import { getProvider } from '../integrations/providers.js';
import { getIntegration } from '../integrations/store.js';
import type { Tool } from './types.js';
import { fetchJson } from '../lib/http.js';

const GITHUB_API = 'https://api.github.com';

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
  state?: string;
  user?: { login?: string };
};

type GitHubPull = GitHubIssue;

type GitHubWorkflowRun = {
  id?: number;
  name?: string;
  head_branch?: string | null;
  status?: string;
  conclusion?: string | null;
  run_number?: number;
  html_url?: string;
  created_at?: string;
};

type GitHubCommit = {
  sha?: string;
  html_url?: string;
  commit?: {
    message?: string;
    author?: { name?: string; date?: string };
  };
};

type GitHubRelease = {
  tag_name?: string;
  name?: string | null;
  html_url?: string;
  published_at?: string;
};

type GitHubUser = {
  login?: string;
  name?: string | null;
  public_repos?: number;
  total_private_repos?: number;
};

function githubHeaders(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    accept: 'application/vnd.github+json',
  };
}

function normalizeRepo(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/^https?:\/\/[^/]+\//, '') : '';
}

function parseMaxResults(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(typeof value === 'string' ? value : '', 10);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 100) : fallback;
}

function firstLine(message: string | undefined): string {
  return (message ?? '').split('\n')[0] ?? '';
}

export const githubListReposTool: Tool = {
  name: 'github_list_repos',
  providerId: 'github',
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
    const token = await requirePermission(context.userId, 'github', 'github.repos');
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
  providerId: 'github',
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
    const token = await requirePermission(context.userId, 'github', 'github.issues');
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

export const githubListIssuesTool: Tool = {
  name: 'github_list_issues',
  providerId: 'github',
  description:
    'List the issues on a GitHub repository, optionally filtered by state (open, closed, or all).',
  parameters: {
    type: 'object',
    properties: {
      repo: {
        type: 'string',
        description: 'Repository in "owner/repo" format, e.g. "octocat/Hello-World".',
      },
      state: {
        type: 'string',
        description: 'Issue state filter: "open", "closed", or "all" (default open).',
      },
      maxResults: {
        type: 'string',
        description: 'Maximum number of issues to return (default 10).',
      },
    },
    required: ['repo'],
  },
  async execute(args, context) {
    const repo = normalizeRepo(args.repo);
    if (!repo) {
      throw new Error('Missing "repo" argument');
    }
    const token = await requirePermission(context.userId, 'github', 'github.issues');
    const state = typeof args.state === 'string' && args.state.trim() ? args.state.trim() : 'open';
    const perPage = parseMaxResults(args.maxResults, 10);
    const params = new URLSearchParams({ state, per_page: String(perPage) });
    params.set('type', 'issue');
    const issues = await fetchJson<GitHubIssue[]>(
      `${GITHUB_API}/repos/${repo}/issues?${params.toString()}`,
      { timeoutMs: 10_000, headers: githubHeaders(token) },
    );
    if (issues.length === 0) {
      return 'No issues found.';
    }
    const lines = issues.map((issue, index) => {
      const author = issue.user?.login ? ` by ${issue.user.login}` : '';
      return `${index + 1}. #${issue.number ?? '?'} ${issue.title ?? '(untitled)'} (${issue.state ?? state})${author}\n   ${issue.html_url ?? ''}`;
    });
    return lines.join('\n');
  },
};

export const githubListPullsTool: Tool = {
  name: 'github_list_pulls',
  providerId: 'github',
  description:
    'List the pull requests on a GitHub repository, optionally filtered by state (open, closed, or all).',
  parameters: {
    type: 'object',
    properties: {
      repo: {
        type: 'string',
        description: 'Repository in "owner/repo" format, e.g. "octocat/Hello-World".',
      },
      state: {
        type: 'string',
        description: 'Pull request state filter: "open", "closed", or "all" (default open).',
      },
      maxResults: {
        type: 'string',
        description: 'Maximum number of pull requests to return (default 10).',
      },
    },
    required: ['repo'],
  },
  async execute(args, context) {
    const repo = normalizeRepo(args.repo);
    if (!repo) {
      throw new Error('Missing "repo" argument');
    }
    const token = await requirePermission(context.userId, 'github', 'github.pulls');
    const state = typeof args.state === 'string' && args.state.trim() ? args.state.trim() : 'open';
    const perPage = parseMaxResults(args.maxResults, 10);
    const params = new URLSearchParams({ state, per_page: String(perPage) });
    const pulls = await fetchJson<GitHubPull[]>(
      `${GITHUB_API}/repos/${repo}/pulls?${params.toString()}`,
      { timeoutMs: 10_000, headers: githubHeaders(token) },
    );
    if (pulls.length === 0) {
      return 'No pull requests found.';
    }
    const lines = pulls.map((pull, index) => {
      const author = pull.user?.login ? ` by ${pull.user.login}` : '';
      return `${index + 1}. #${pull.number ?? '?'} ${pull.title ?? '(untitled)'} (${pull.state ?? state})${author}\n   ${pull.html_url ?? ''}`;
    });
    return lines.join('\n');
  },
};

export const githubListWorkflowRunsTool: Tool = {
  name: 'github_list_workflow_runs',
  providerId: 'github',
  description:
    'List the most recent GitHub Actions workflow runs for a repository with their status and conclusion.',
  parameters: {
    type: 'object',
    properties: {
      repo: {
        type: 'string',
        description: 'Repository in "owner/repo" format, e.g. "octocat/Hello-World".',
      },
      maxResults: {
        type: 'string',
        description: 'Maximum number of workflow runs to return (default 10).',
      },
    },
    required: ['repo'],
  },
  async execute(args, context) {
    const repo = normalizeRepo(args.repo);
    if (!repo) {
      throw new Error('Missing "repo" argument');
    }
    const token = await requirePermission(context.userId, 'github', 'github.actions');
    const perPage = parseMaxResults(args.maxResults, 10);
    const params = new URLSearchParams({ per_page: String(perPage) });
    const body = await fetchJson<{ workflow_runs?: GitHubWorkflowRun[] }>(
      `${GITHUB_API}/repos/${repo}/actions/runs?${params.toString()}`,
      { timeoutMs: 10_000, headers: githubHeaders(token) },
    );
    const runs = body.workflow_runs ?? [];
    if (runs.length === 0) {
      return 'No workflow runs found.';
    }
    const lines = runs.map((run, index) => {
      const outcome = run.conclusion ?? run.status ?? 'unknown';
      const branch = run.head_branch ? ` on ${run.head_branch}` : '';
      return `${index + 1}. Run #${run.run_number ?? '?'} ${run.name ?? '(unnamed workflow)'}${branch} — ${outcome}${run.created_at ? ` (${run.created_at})` : ''}\n   ${run.html_url ?? ''}`;
    });
    return lines.join('\n');
  },
};

export const githubListCommitsTool: Tool = {
  name: 'github_list_commits',
  providerId: 'github',
  description:
    'List the most recent commits on a GitHub repository, optionally restricted to a branch.',
  parameters: {
    type: 'object',
    properties: {
      repo: {
        type: 'string',
        description: 'Repository in "owner/repo" format, e.g. "octocat/Hello-World".',
      },
      branch: {
        type: 'string',
        description: 'Optional branch name or ref (e.g. "main"). Defaults to the default branch.',
      },
      maxResults: {
        type: 'string',
        description: 'Maximum number of commits to return (default 10).',
      },
    },
    required: ['repo'],
  },
  async execute(args, context) {
    const repo = normalizeRepo(args.repo);
    if (!repo) {
      throw new Error('Missing "repo" argument');
    }
    const token = await requirePermission(context.userId, 'github', 'github.commits');
    const perPage = parseMaxResults(args.maxResults, 10);
    const params = new URLSearchParams({ per_page: String(perPage) });
    if (typeof args.branch === 'string' && args.branch.trim()) {
      params.set('sha', args.branch.trim());
    }
    const commits = await fetchJson<GitHubCommit[]>(
      `${GITHUB_API}/repos/${repo}/commits?${params.toString()}`,
      { timeoutMs: 10_000, headers: githubHeaders(token) },
    );
    if (commits.length === 0) {
      return 'No commits found.';
    }
    const lines = commits.map((commit, index) => {
      const author = commit.commit?.author?.name ? ` by ${commit.commit.author.name}` : '';
      const date = commit.commit?.author?.date ? ` (${commit.commit.author.date})` : '';
      return `${index + 1}. ${(commit.sha ?? '').slice(0, 7)} ${firstLine(commit.commit?.message)}${author}${date}`;
    });
    return lines.join('\n');
  },
};

export const githubListReleasesTool: Tool = {
  name: 'github_list_releases',
  providerId: 'github',
  description: 'List the releases on a GitHub repository with their tag, title, and publish date.',
  parameters: {
    type: 'object',
    properties: {
      repo: {
        type: 'string',
        description: 'Repository in "owner/repo" format, e.g. "octocat/Hello-World".',
      },
      maxResults: {
        type: 'string',
        description: 'Maximum number of releases to return (default 10).',
      },
    },
    required: ['repo'],
  },
  async execute(args, context) {
    const repo = normalizeRepo(args.repo);
    if (!repo) {
      throw new Error('Missing "repo" argument');
    }
    const token = await requirePermission(context.userId, 'github', 'github.releases');
    const perPage = parseMaxResults(args.maxResults, 10);
    const params = new URLSearchParams({ per_page: String(perPage) });
    const releases = await fetchJson<GitHubRelease[]>(
      `${GITHUB_API}/repos/${repo}/releases?${params.toString()}`,
      { timeoutMs: 10_000, headers: githubHeaders(token) },
    );
    if (releases.length === 0) {
      return 'No releases found.';
    }
    const lines = releases.map((release, index) => {
      const title = release.name ? ` — ${release.name}` : '';
      const date = release.published_at ? ` (${release.published_at})` : '';
      return `${index + 1}. ${release.tag_name ?? '(untagged)'}${title}${date}\n   ${release.html_url ?? ''}`;
    });
    return lines.join('\n');
  },
};

export const githubProfileTool: Tool = {
  name: 'github_profile',
  providerId: 'github',
  description:
    'Show the connected GitHub user\u2019s username, repository count, and granted permissions.',
  parameters: {
    type: 'object',
    properties: {},
  },
  async execute(_args, context) {
    const token = await requirePermission(context.userId, 'github', 'github.profile');
    const user = await fetchJson<GitHubUser>(`${GITHUB_API}/user`, {
      timeoutMs: 10_000,
      headers: githubHeaders(token),
    });
    const publicRepos = user.public_repos ?? 0;
    const privateRepos = user.total_private_repos ?? 0;
    const repoCount = publicRepos + privateRepos;

    const provider = getProvider('github');
    const integration = await getIntegration(context.userId, 'github');
    const granted =
      provider && integration
        ? getGrantedPermissions(provider, integration.scopes).filter(
            (permission) => permission.enabled,
          )
        : [];
    const permissions =
      granted.length > 0
        ? granted.map((permission) => `- ${permission.label}`).join('\n')
        : '- none recorded (reconnect to GitHub to refresh permissions)';

    return [
      `Username: ${user.login ?? 'unknown'}`,
      `Name: ${user.name ?? '(not set)'}`,
      `Repository count: ${repoCount} (${publicRepos} public, ${privateRepos} private)`,
      'Permissions:',
      permissions,
    ].join('\n');
  },
};
