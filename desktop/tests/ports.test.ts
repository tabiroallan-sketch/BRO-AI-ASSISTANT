import { createServer } from 'node:net';
import { describe, expect, it } from 'vitest';
import { getFreePort } from '../src/main/ports.js';

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
  });
}

describe('getFreePort', () => {
  it('returns a usable port when no preference is given', async () => {
    const port = await getFreePort();
    expect(port).toBeGreaterThan(0);
    await expect(isPortFree(port)).resolves.toBe(true);
  });

  it('honours an available preferred port', async () => {
    const preferred = await getFreePort();
    const port = await getFreePort(preferred);
    expect(port).toBe(preferred);
  });

  it('falls back to a random port when the preferred one is taken', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const taken = (blocker.address() as { port: number }).port;
    const port = await getFreePort(taken);
    expect(port).not.toBe(taken);
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
    await expect(isPortFree(port)).resolves.toBe(true);
  });

  it('rejects a preferred port that is free on IPv4 but taken on IPv6', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '::1', resolve));
    const taken = (blocker.address() as { port: number }).port;
    const port = await getFreePort(taken);
    expect(port).not.toBe(taken);
    await new Promise<void>((resolve) => blocker.close(() => resolve()));
    await expect(isPortFree(port)).resolves.toBe(true);
  });
});
