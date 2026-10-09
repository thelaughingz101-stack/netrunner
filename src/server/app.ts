import { isIP } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import { env } from '../env.js';
import { configRoutes } from './routes/config.js';
import { digestRoutes } from './routes/digests.js';
import { keyRoutes } from './routes/keys.js';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');

export type RouteModule = (app: FastifyInstance) => void | Promise<void>;

/** Host header → bare hostname ("[::1]:8787" → "::1", "localhost:8787" → "localhost"). */
const hostnameOf = (host: string) => (host.startsWith('[') ? host.slice(1, host.indexOf(']')) : host.replace(/:\d+$/, '')).toLowerCase();

export function hostAllowed(host: string | undefined): boolean {
  if (!host) return false;
  const name = hostnameOf(host);
  if (name === 'localhost' || isIP(name)) return true;
  const e = env();
  const extra = (e.ALLOWED_HOSTS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return name === e.HOST.toLowerCase() || extra.includes(name);
}

export async function buildApp(extraRoutes: RouteModule[] = []): Promise<FastifyInstance> {
  const app = Fastify({ logger: false, bodyLimit: 5 * 1024 * 1024 });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'validation', issues: err.issues.map(i => ({ path: i.path.join('.'), message: i.message })) });
    }
    const e = err as { statusCode?: number; message?: string };
    return reply.code(e.statusCode ?? 500).send({ error: e.message ?? String(err) });
  });

  // DNS rebinding: a hostile site can point its own domain at 127.0.0.1, which makes its requests look
  // same-origin and come from loopback. Those requests still carry that domain in Host, so only names
  // that can't be rebound are accepted: localhost, IP literals, HOST from .env, and ALLOWED_HOSTS.
  app.addHook('onRequest', async (req, reply) => {
    if (!hostAllowed(req.headers.host)) return reply.code(403).send({ error: 'unexpected Host header refused' });
  });

  // Another website open in the same browser can still send requests to 127.0.0.1. Browsers always attach
  // Origin to those, so any write whose Origin isn't this server is refused.
  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'GET' || req.method === 'HEAD') return;
    const origin = req.headers.origin;
    if (!origin) return;
    let host = '';
    try { host = new URL(origin).host; } catch { /* "null" etc. */ }
    if (host !== req.headers.host) return reply.code(403).send({ error: 'cross-origin request refused' });
  });

  await app.register(fastifyStatic, { root: publicDir, index: ['netrunner-config.html'] });
  await app.register(async a => { await configRoutes(a); await digestRoutes(a); await keyRoutes(a); for (const r of extraRoutes) await r(a); }, { prefix: '/api' });
  return app;
}
