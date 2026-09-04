import { describe, expect, it, vi } from 'vitest';

process.env.DATABASE_URL = '';
process.env.REDIS_URL = '';
process.env.JWT_SECRET = 'test-access-secret';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret';

vi.mock('../../src/lib/prisma.js', () => ({ prisma: undefined }));

function mockFetchJson(responses: Map<string, unknown>) {
  return vi.fn(async (url: string) => {
    for (const [pattern, response] of responses) {
      if (url.includes(pattern)) {
        return response;
      }
    }
    throw new Error(`No mock for URL: ${url}`);
  });
}

describe('serpapi-jobs adapter', () => {
  it('returns an error when SERPAPI_KEY is not configured', async () => {
    process.env.SERPAPI_KEY = '';
    vi.resetModules();
    const { serpApiJobsAdapter } = await import('../../src/sales/sources/serpapi-jobs.js');
    const result = await serpApiJobsAdapter.search('react developer');
    expect(result.candidates).toEqual([]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.message).toContain('SERPAPI_KEY');
  });

  it('parses SerpAPI Google Jobs response into candidates', async () => {
    process.env.SERPAPI_KEY = 'test-key';
    vi.resetModules();
    const mockResponse = {
      jobs_results: [
        {
          title: 'Senior React Developer',
          company_name: 'Acme Corp',
          location: 'San Francisco, CA',
          description: 'We are hiring a React developer with TypeScript and Node.js experience.',
          detected_extensions: {
            salary: '$120,000 - $160,000/year',
            schedule_type: 'Full-time',
            remote: true,
            posted_at: '3 days ago',
          },
          share_link: 'https://www.google.com/job/123',
          extensions: ['react', 'typescript', 'node.js'],
        },
        {
          title: 'Junior Python Developer',
          company_name: 'StartupXYZ',
          location: 'Remote',
          description: 'Entry-level Python position.',
          detected_extensions: { schedule_type: 'Full-time' },
        },
      ],
    };
    const fetchJson = mockFetchJson(new Map([['serpapi.com', mockResponse]]));
    vi.doMock('../../src/lib/http.js', () => ({ fetchJson }));
    vi.doMock('../../src/config/index.js', () => ({
      config: { serpApiKey: 'test-key' },
    }));
    const { serpApiJobsAdapter } = await import('../../src/sales/sources/serpapi-jobs.js');
    const result = await serpApiJobsAdapter.search('developer');
    expect(result.errors).toEqual([]);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]!.title).toBe('Senior React Developer');
    expect(result.candidates[0]!.company).toBe('Acme Corp');
    expect(result.candidates[0]!.source).toBe('serpapi-jobs');
    expect(result.candidates[0]!.sourceReliability).toBe('MEDIUM');
    expect(result.candidates[0]!.remote).toBe(true);
    expect(result.candidates[0]!.compensation).toBe('$120,000 - $160,000/year');
    expect(result.candidates[0]!.requiredSkills).toEqual(
      expect.arrayContaining(['react', 'typescript', 'node.js']),
    );
    expect(result.candidates[1]!.title).toBe('Junior Python Developer');
    vi.doUnmock('../../src/lib/http.js');
    vi.doUnmock('../../src/config/index.js');
  });

  it('handles SerpAPI errors gracefully', async () => {
    process.env.SERPAPI_KEY = 'test-key';
    vi.resetModules();
    vi.doMock('../../src/lib/http.js', () => ({
      fetchJson: mockFetchJson(new Map([['serpapi.com', { error: 'Invalid API key' }]])),
    }));
    vi.doMock('../../src/config/index.js', () => ({
      config: { serpApiKey: 'test-key' },
    }));
    const { serpApiJobsAdapter } = await import('../../src/sales/sources/serpapi-jobs.js');
    const result = await serpApiJobsAdapter.search('test');
    expect(result.candidates).toEqual([]);
    expect(result.errors[0]!.message).toContain('Invalid API key');
    vi.doUnmock('../../src/lib/http.js');
    vi.doUnmock('../../src/config/index.js');
  });

  it('reports adapter metadata correctly', async () => {
    process.env.SERPAPI_KEY = '';
    vi.resetModules();
    const { serpApiJobsAdapter } = await import('../../src/sales/sources/serpapi-jobs.js');
    expect(serpApiJobsAdapter.id).toBe('serpapi-jobs');
    expect(serpApiJobsAdapter.label).toBe('Google Jobs (SerpAPI)');
    expect(serpApiJobsAdapter.supportsSearch).toBe(true);
    expect(serpApiJobsAdapter.supportsFetchUrl).toBe(false);
    expect(serpApiJobsAdapter.supportsCompanyWebsite).toBe(false);
  });
});

describe('indeed-rss adapter', () => {
  function mockRss(
    items: Array<{ title: string; link: string; description: string; pubDate: string }>,
  ): string {
    const itemXml = items
      .map(
        (item) => `<item>
  <title><![CDATA[${item.title}]]></title>
  <link>${item.link}</link>
  <description><![CDATA[${item.description}]]></description>
  <pubDate>${item.pubDate}</pubDate>
</item>`,
      )
      .join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>Indeed</title>${itemXml}</channel></rss>`;
  }

  it('parses Indeed RSS items into candidates', async () => {
    const rss = mockRss([
      {
        title: 'React Developer - Acme Corp - San Francisco, CA',
        link: 'https://www.indeed.com/viewjob?jk=abc123',
        description: '<p>We need a <b>React developer</b> with experience.</p>',
        pubDate: 'Mon, 01 Jan 2024 12:00:00 GMT',
      },
      {
        title: 'Python Engineer',
        link: 'https://www.indeed.com/viewjob?jk=def456',
        description: 'Python role at a startup.',
        pubDate: 'Tue, 02 Jan 2024 12:00:00 GMT',
      },
    ]);
    const mockFetch = vi.fn(async () => ({
      ok: true,
      text: async () => rss,
    }));
    vi.doMock('../../src/config/index.js', () => ({ config: {} }));
    global.fetch = mockFetch as unknown as typeof fetch;
    const { indeedRssAdapter } = await import('../../src/sales/sources/indeed-rss.js');
    const result = await indeedRssAdapter.search('react developer');
    expect(result.errors).toEqual([]);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]!.title).toBe('React Developer');
    expect(result.candidates[0]!.company).toBe('Acme Corp');
    expect(result.candidates[0]!.location).toBe('San Francisco, CA');
    expect(result.candidates[0]!.source).toBe('indeed-rss');
    expect(result.candidates[0]!.sourceReliability).toBe('MEDIUM');
    expect(result.candidates[0]!.sourceUrl).toContain('indeed.com/viewjob');
    expect(result.candidates[0]!.description).toContain('React developer');
    expect(result.candidates[1]!.title).toBe('Python Engineer');
    vi.doUnmock('../../src/config/index.js');
  });

  it('handles HTTP errors gracefully', async () => {
    const mockFetch = vi.fn(async () => ({
      ok: false,
      status: 403,
      text: async () => 'Forbidden',
    }));
    global.fetch = mockFetch as unknown as typeof fetch;
    const { indeedRssAdapter } = await import('../../src/sales/sources/indeed-rss.js');
    const result = await indeedRssAdapter.search('test');
    expect(result.candidates).toEqual([]);
    expect(result.errors[0]!.message).toContain('403');
  });

  it('handles network errors gracefully', async () => {
    const mockFetch = vi.fn(async () => {
      throw new Error('Network timeout');
    });
    global.fetch = mockFetch as unknown as typeof fetch;
    const { indeedRssAdapter } = await import('../../src/sales/sources/indeed-rss.js');
    const result = await indeedRssAdapter.search('test');
    expect(result.candidates).toEqual([]);
    expect(result.errors[0]!.message).toContain('Network timeout');
  });

  it('handles empty RSS feeds', async () => {
    const rss = `<?xml version="1.0"?><rss version="2.0"><channel><title>Indeed</title></channel></rss>`;
    const mockFetch = vi.fn(async () => ({
      ok: true,
      text: async () => rss,
    }));
    global.fetch = mockFetch as unknown as typeof fetch;
    const { indeedRssAdapter } = await import('../../src/sales/sources/indeed-rss.js');
    const result = await indeedRssAdapter.search('nonexistent');
    expect(result.candidates).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('reports adapter metadata correctly', async () => {
    const { indeedRssAdapter } = await import('../../src/sales/sources/indeed-rss.js');
    expect(indeedRssAdapter.id).toBe('indeed-rss');
    expect(indeedRssAdapter.label).toBe('Indeed RSS');
    expect(indeedRssAdapter.supportsSearch).toBe(true);
    expect(indeedRssAdapter.supportsFetchUrl).toBe(false);
    expect(indeedRssAdapter.supportsCompanyWebsite).toBe(false);
  });
});
