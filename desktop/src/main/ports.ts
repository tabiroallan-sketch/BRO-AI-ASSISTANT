import { createServer } from 'node:net';

/**
 * Reserves a free TCP port. When `preferred` is given and still free it is
 * used; otherwise a random free port is returned. The port must be free on
 * BOTH the IPv4 and IPv6 loopback stacks, because PostgreSQL binds both when
 * listening on "localhost" (a common failure when Docker publishes a
 * container on ::1 while 127.0.0.1 looks free).
 */
export async function getFreePort(preferred?: number): Promise<number> {
  const candidates = preferred !== undefined ? [preferred, 0] : [0];
  for (const candidate of candidates) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const port = await reserve(candidate);
      if (port !== null) {
        return port;
      }
      if (candidate !== 0) {
        break;
      }
    }
  }
  throw new Error('Unable to allocate a free TCP port');
}

function reserve(preferred: number): Promise<number | null> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolve(null));
    server.listen(preferred, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : null;
      if (port === null) {
        server.close(() => resolve(null));
        return;
      }
      void isFreeOnV6(port).then((v6Free) => {
        server.close(() => resolve(v6Free ? port : null));
      });
    });
  });
}

function isFreeOnV6(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.unref();
    server.once('error', () => resolve(false));
    server.listen(port, '::1', () => {
      server.close(() => resolve(true));
    });
  });
}
