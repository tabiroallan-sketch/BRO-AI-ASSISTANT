import { buildApp } from './app.js';
import { config } from './config/index.js';

async function main(): Promise<void> {
  const app = buildApp();

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
