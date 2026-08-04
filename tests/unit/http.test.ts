import { describe, expect, it, vi } from 'vitest';
import { assertPublicHttpUrl, fetchJson, isPublicHttpUrl } from '../../src/lib/http.js';

describe('isPublicHttpUrl SSRF guard', () => {
  it('rejects loopback and localhost addresses', async () => {
    expect(await isPublicHttpUrl('http://127.0.0.1')).toBe(false);
    expect(await isPublicHttpUrl('http://localhost')).toBe(false);
    expect(await isPublicHttpUrl('http://localhost:8080/admin')).toBe(false);
    expect(await isPublicHttpUrl('http://[::1]')).toBe(false);
  });

  it('rejects private, link-local and metadata addresses', async () => {
    expect(await isPublicHttpUrl('http://10.0.0.5')).toBe(false);
    expect(await isPublicHttpUrl('http://192.168.1.1')).toBe(false);
    expect(await isPublicHttpUrl('http://172.16.0.1')).toBe(false);
    expect(await isPublicHttpUrl('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(await isPublicHttpUrl('http://100.64.0.1')).toBe(false);
    expect(await isPublicHttpUrl('http://[fc00::1]')).toBe(false);
    expect(await isPublicHttpUrl('http://[::ffff:127.0.0.1]')).toBe(false);
    expect(await isPublicHttpUrl('http://[fe80::1]')).toBe(false);
  });

  it('rejects private hostnames without a DNS lookup', async () => {
    expect(await isPublicHttpUrl('http://myhost.local')).toBe(false);
    expect(await isPublicHttpUrl('http://anything.localhost')).toBe(false);
  });

  it('accepts public IP literals', async () => {
    expect(await isPublicHttpUrl('https://8.8.8.8')).toBe(true);
    expect(await isPublicHttpUrl('http://1.1.1.1')).toBe(true);
  });

  it('rejects non-http protocols and malformed URLs', async () => {
    expect(await isPublicHttpUrl('ftp://example.com')).toBe(false);
    expect(await isPublicHttpUrl('file:///etc/passwd')).toBe(false);
    expect(await isPublicHttpUrl('not a url')).toBe(false);
  });
});

describe('assertPublicHttpUrl', () => {
  it('returns the parsed URL for public addresses', async () => {
    const url = await assertPublicHttpUrl('https://8.8.8.8/path');
    expect(url.href).toBe('https://8.8.8.8/path');
  });

  it('throws a friendly error for private addresses', async () => {
    await expect(assertPublicHttpUrl('http://127.0.0.1')).rejects.toThrow(/private or internal/);
    await expect(assertPublicHttpUrl('http://localhost')).rejects.toThrow(/private or internal/);
  });

  it('throws for malformed URLs and non-http protocols', async () => {
    await expect(assertPublicHttpUrl('nope')).rejects.toThrow(/not a valid URL/);
    await expect(assertPublicHttpUrl('ftp://example.com')).rejects.toThrow(/not a valid http/);
  });
});

describe('fetchJson', () => {
  it('aborts requests that exceed the timeout', async () => {
    vi.stubGlobal(
      'fetch',
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('aborted'));
          });
        }),
    );
    await expect(fetchJson('https://example.com', { timeoutMs: 50 })).rejects.toThrow('aborted');
    vi.unstubAllGlobals();
  });

  it('throws HttpError for non-2xx responses', async () => {
    vi.stubGlobal(
      'fetch',
      () =>
        Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        }) as unknown as Response,
    );
    await expect(fetchJson('https://example.com')).rejects.toThrow(/HTTP 500/);
    vi.unstubAllGlobals();
  });
});
