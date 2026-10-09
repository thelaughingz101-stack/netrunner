// `npm start`: server + config page, stays up until Ctrl+C. The desktop app (src/desktop.ts) wraps the same boot.
import { log } from './logger.js';
import { startServer } from './server/start.js';

startServer().catch(err => {
  log.fatal({ err }, 'failed to start');
  process.exit(1);
});
