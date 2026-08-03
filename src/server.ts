import { buildApp } from './app.js';
import { shutdownBrowser } from './browser/sessions.js';
import { config } from './config/index.js';

async function main(): Promise<void> {
  const app = buildApp();

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'Shutting down');
    await shutdownBrowser();
    await app.close();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({
      port: config.port,
      host: '0.0.0.0',
    });
  } catch (error) {
    app.log.error(error, 'Failed to start server');
    process.exit(1);
  }
}

main();
