import Fastify, { type FastifyInstance } from 'fastify';
import { Store } from './db.js';
import type { Config } from './types.js';
export function createApi(store: Store, cfg: Config): FastifyInstance {
  const app = Fastify({ logger: false });
  const buckets = new Map<string, { at: number; count: number }>();
  app.addHook('onRequest', async (req, reply) => {
    const origins = cfg.api.corsOrigins ?? [];
    if (origins.length) {
      const origin = String(req.headers.origin ?? '');
      if (origins.includes(origin)) reply.header('access-control-allow-origin', origin);
    }
    if (
      cfg.api.apiKeyEnv &&
      req.headers.authorization !== `Bearer ${process.env[cfg.api.apiKeyEnv]}`
    )
      return reply
        .code(401)
        .send({ error: { code: 'unauthorized', message: 'authentication required' } });
    if (cfg.api.rateLimitPerMinute) {
      const key = req.ip,
        now = Date.now(),
        b = buckets.get(key);
      if (!b || now - b.at >= 60000) buckets.set(key, { at: now, count: 1 });
      else if (++b.count > cfg.api.rateLimitPerMinute)
        return reply
          .code(429)
          .send({ error: { code: 'rate_limited', message: 'rate limit exceeded' } });
    }
  });
  app.setErrorHandler((err, req, reply) => {
    if ((err as { validation?: unknown }).validation)
      return reply
        .code(400)
        .send({ error: { code: 'invalid_request', message: 'invalid request' } });
    reply.code(500).send({ error: { code: 'internal_error', message: 'internal error' } });
  });
  app.get('/health', async () => ({ ok: true }));
  app.get('/status', async () => store.status());
  app.get('/gaps', async () => ({ gaps: store.gaps() }));
  app.get('/contracts', async () => ({ contracts: store.contracts() }));
  app.get('/ledgers/coverage', async () => ({ coverage: store.coverage() }));
  app.get('/openapi.json', async () => ({
    openapi: '3.0.3',
    info: { title: 'Eventide API', version: '0.2.0' },
    paths: {
      '/events': { get: { summary: 'Query indexed events' } },
      '/events/{id}': { get: { summary: 'Get one event' } },
    },
  }));
  app.get<{ Params: { id: string } }>('/events/:id', async (req, reply) => {
    const event = store.byId(req.params.id);
    return (
      event ?? reply.code(404).send({ error: { code: 'not_found', message: 'event not found' } })
    );
  });
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
    const n = (v?: string) => (v === undefined ? undefined : Number(v));
    const limit = n(q.limit) ?? 100,
      offset = n(q.offset) ?? 0,
      from = n(q.from),
      to = n(q.to);
    if (
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 1000 ||
      !Number.isInteger(offset) ||
      offset < 0 ||
      [from, to].some((v) => v !== undefined && !Number.isInteger(v))
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
    const contracts = q.contract ? [q.contract] : [...new Set(rows.map((r) => r.contract_id))];
    const incomplete = contracts.some((c) => store.overlaps(c, from, to).length > 0);
    return {
      events: rows.map((r) => ({
        ...r,
        topics: JSON.parse(r.topics_json),
        decoded_topics: JSON.parse(r.decoded_topics_json),
        value: r.value_json ? JSON.parse(r.value_json) : null,
        topics_json: undefined,
        decoded_topics_json: undefined,
        value_json: undefined,
      })),
      limit,
      offset,
      incomplete,
    };
  });
  return app;
}
