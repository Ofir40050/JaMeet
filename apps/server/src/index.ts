import 'dotenv/config';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { logger } from './logger.js';

logger.setupGlobalHandlers();

const config = loadConfig();
logger.info('server_startup', 'Starting JaMeet server', {
  host: config.HOST,
  port: config.PORT,
  nodeEnv: config.NODE_ENV,
  dataDir: config.DATA_DIR || 'default'
});

const { app } = await createApp(config);
await app.listen({ host: config.HOST, port: config.PORT });
logger.info('server_listening', `JaMeet server listening on ${config.HOST}:${config.PORT}`, {
  host: config.HOST,
  port: config.PORT
});
