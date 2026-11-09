import { timingSafeEqual } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { Store } from './db.js';
import type { Config } from './types.js';

const sameSecret = (actual: string, expected: string) => {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};
export function createApi(store: Store, cfg: Config): FastifyInstance {
  if (cfg.api.apiKeyEnv && !process.env[cfg.api.apiKeyEnv])
    throw new Error(`API key environment variable ${cfg.api.apiKeyEnv} is unset or empty`);
  const app = Fastify({ logger: false });
  const buckets = new Map<string, { at: number; count: number }>();
  app.addHook('onRequest', async (req, reply) => {
    const origins = cfg.api.corsOrigins ?? [];
    if (origins.length) {
      const origin = String(req.headers.origin ?? '');
      if (origins.includes(origin)) reply.header('access-control-allow-origin', origin);
    }
    if (req.url !== '/health' && cfg.api.apiKeyEnv) {
      const expected = process.env[cfg.api.apiKeyEnv] ?? '';
      const supplied = String(req.headers.authorization ?? '');
      if (!supplied.startsWith('Bearer ') || !sameSecret(supplied.slice(7), expected))
        return reply
          .code(401)
          .send({ error: { code: 'unauthorized', message: 'authentication required' } });
    }
    if (cfg.api.rateLimitPerMinute) {
      const now = Date.now();
      for (const [key, bucket] of buckets) if (now - bucket.at >= 60000) buckets.delete(key);
      const bucket = buckets.get(req.ip);
      if (!bucket) buckets.set(req.ip, { at: now, count: 1 });
      else if (++bucket.count > cfg.api.rateLimitPerMinute)
        return reply
          .code(429)
          .send({ error: { code: 'rate_limited', message: 'rate limit exceeded' } });
    }
  });
  app.setErrorHandler((error, _req, reply) => {
    if ((error as { validation?: unknown }).validation)
      return reply
        .code(400)
        .send({ error: { code: 'invalid_request', message: 'invalid request' } });
    return reply.code(500).send({ error: { code: 'internal_error', message: 'internal error' } });
  });
  app.get('/health', async () => ({ ok: true }));
  app.get('/status', async () => store.status());
  app.get('/gaps', async () => ({ gaps: store.gaps() }));
  app.get('/contracts', async () => ({ contracts: store.contracts() }));
  app.get('/ledgers/coverage', async () => ({ coverage: store.coverage() }));
  app.get('/openapi.json', async () => ({
    openapi: '3.0.0',
    info: { title: 'Eventide API', version: '0.3.0' },
    paths: {
      '/health': { get: {} },
      '/status': { get: {} },
      '/gaps': { get: {} },
      '/contracts': { get: {} },
      '/ledgers/coverage': { get: {} },
      '/openapi.json': { get: {} },
      '/events': { get: {} },
      '/events/{id}': { get: {} },
    },
  }));
  app.get<{ Params: { id: string } }>(
    '/events/:id',
    async (req, reply) =>
      store.byId(req.params.id) ??
      reply.code(404).send({ error: { code: 'not_found', message: 'event not found' } }),
  );
  app.get<{
    Querystring: {
      contract?: string;
      from?: string;
      to?: string;
      event_name?: string;
      topic?: string;
      type?: string;
      tx_hash?: string;
      limit?: string;
      offset?: string;
    };
  }>('/events', async (req, reply) => {
    const q = req.query;
    const n = (value?: string) => (value === undefined ? undefined : Number(value));
    const limit = n(q.limit) ?? 100;
    const offset = n(q.offset) ?? 0;
    const from = n(q.from);
    const to = n(q.to);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 1000 ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      [from, to].some((value) => value !== undefined && !Number.isInteger(value))
    )
      return reply.code(400).send({
        error: { code: 'invalid_request', message: 'invalid pagination or ledger range' },
      });
    const rows = store.events({
      contract: q.contract,
      from,
      to,
      eventName: q.event_name,
      topic: q.topic,
      type: q.type,
      txHash: q.tx_hash,
      limit,
      offset,
    });
    const contracts = q.contract ? [q.contract] : [...new Set(rows.map((row) => row.contract_id))];
    return {
      events: rows.map((row) => ({
        ...row,
        topics: JSON.parse(row.topics_json),
        decoded_topics: JSON.parse(row.decoded_topics_json),
        value: row.value_json ? JSON.parse(row.value_json) : null,
      })),
      limit,
      offset,
      incomplete: contracts.some((contract) => store.overlaps(contract, from, to).length > 0),
    };
  });
  return app;
}
