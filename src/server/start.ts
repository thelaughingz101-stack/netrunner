import type { FastifyInstance } from 'fastify';
import { env } from '../env.js';
import { log } from '../logger.js';
import { db } from '../db/db.js';
import { getConfig } from '../config/store.js';
import { buildApp, type RouteModule } from './app.js';
import { runRoutes } from './routes/run.js';
import { schedulerSettled, startScheduler, stopScheduler, watchConfig } from '../scheduler.js';

export interface Server {
  app: FastifyInstance;
  url: string;
  shutdown: (reason: string) => Promise<never>;
}

/** Boot: env → db → server → scheduler. Shared by `npm start` and the desktop app (src/desktop.ts). */
export async function startServer(extraRoutes: RouteModule[] = []): Promise<Server> {
  const e = env();
  db();
  const { config } = getConfig(); // seeds config on first boot
  const app = await buildApp([runRoutes, ...extraRoutes]);
  await app.listen({ port: e.PORT, host: e.HOST });
  const url = `http://${e.HOST === '0.0.0.0' ? 'localhost' : e.HOST}:${e.PORT}`;
  log.info({ url }, 'NetRunner listening');
  startScheduler(config);
  watchConfig();

  // app.close() waits for in-flight requests, so a Run started from the window finishes and is saved before
  // the process exits. Every later shutdown call (watchdog, Ctrl+C) waits on that same close instead of
  // exiting underneath it.
  let closing: Promise<never> | null = null;
  const shutdown = (reason: string): Promise<never> => {
    if (closing) {
      log.info({ reason }, 'already shutting down; waiting for in-flight work to finish');
      return closing;
    }
    closing = (async () => {
      log.info({ reason }, 'shutting down');
      stopScheduler();
      await schedulerSettled();
      await app.close();
      db().close();
      process.exit(0);
    })();
    return closing;
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  return { app, url, shutdown };
}
