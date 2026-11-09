import { afterEach, describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { Store } from '../src/db.js';
import { decodeScVal, decodeTopics } from '../src/decode.js';
import { redact } from '../src/redact.js';
import { RpcClient, RpcError, isBeforeOldest } from '../src/rpc.js';
import { createApi } from '../src/api.js';
import { loadConfig } from '../src/config.js';
import { Indexer } from '../src/indexer.js';
const files: string[] = [];
function store() {
  const f = path.join(os.tmpdir(), `eventide-${Date.now()}-${Math.random()}.db`);
  files.push(f);
  return new Store(f);
}
afterEach(() => {
  for (const f of files)
    for (const x of [f, `${f}-wal`, `${f}-shm`])
      try {
        fs.rmSync(x);
      } catch {}
});
const event = (id: string, ledger: number, contract = 'C1') => ({
  id,
  ledger,
  contractId: contract,
  value: 'bad',
  topic: ['AAAADwAAAAh0cmFuc2Zlcg=='],
});
describe('storage and coverage', () => {
  it('deduplicates and merges adjacent intervals transactionally', () => {
    const s = store();
    const x = (e: any) => ({
      event: e,
      valueXdr: 'bad',
      valueJson: null,
      topicsJson: '[]',
      decodedTopicsJson: '[]',
      eventName: null,
      decodeError: true,
      endpoint: 'mock',
    });
    s.insertPage([x(event('e1', 10))], {
      contract: 'C1',
      cursor: 'a',
      latestLedger: 10,
      coveredStart: 10,
      coveredEnd: 10,
    });
    s.insertPage([x(event('e1', 10)), x(event('e2', 11))], {
      contract: 'C1',
      cursor: 'b',
      latestLedger: 11,
      coveredStart: 11,
      coveredEnd: 11,
    });
    expect(s.status().events).toBe(2);
    expect(s.coverage('C1')).toHaveLength(1);
    expect(s.coverage('C1')[0].start_ledger).toBe(10);
    expect(s.coverage('C1')[0].end_ledger).toBe(11);
    s.close();
  });
  it('records and overlaps unrecovered gaps', () => {
    const s = store();
    s.addGap({ contract: 'C1', startLedger: 1, endLedger: 2, reason: 'retention', status: 'open' });
    expect(s.overlaps('C1', 2, 3)).toHaveLength(1);
    s.updateGap(s.gaps()[0].id!, 'unrecoverable');
    expect(s.gaps()[0].status).toBe('unrecoverable');
    s.close();
  });
});
describe('configuration', () => {
  it('accepts a contract StrKey and rejects an account StrKey', () => {
    const file = path.join(os.tmpdir(), `eventide-config-${Date.now()}.yaml`);
    const contract = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
    const account = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
    fs.writeFileSync(
      file,
      `networkPassphrase: test\ndatabase: ./test.db\nendpoints:\n  - name: mock\n    url: http://127.0.0.1\n    archiveCapable: false\n    contracts: [${contract}]\n`,
    );
    expect(loadConfig(file).endpoints[0].contracts).toEqual([contract]);
    fs.writeFileSync(
      file,
      `networkPassphrase: test\ndatabase: ./test.db\nendpoints:\n  - name: mock\n    url: http://127.0.0.1\n    archiveCapable: false\n    contracts: [${account}]\n`,
    );
    expect(() => loadConfig(file)).toThrow(/invalid contract/i);
    fs.rmSync(file);
  });
});
describe('indexer pagination', () => {
  const contract = 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC';
  const config = (url: string) => ({
    networkPassphrase: 'test',
    database: 'unused',
    pollIntervalMs: 250,
    pageLimit: 2,
    retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
    api: { host: '127.0.0.1', port: 1, corsOrigins: [] },
    endpoints: [
      { name: 'archive', url, archiveCapable: true, contracts: [contract], maxRetries: 0 },
    ],
  });
  it('does not recover a bounded gap until all pages are fetched', async () => {
    const s = store();
    s.addGap({ contract, startLedger: 10, endLedger: 12, reason: 'retention', status: 'open' });
    const calls: Array<Record<string, unknown>> = [];
    const fetchImpl = async (_url: string, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body)) as {
        method: string;
        params: Record<string, any>;
      };
      calls.push(body.params);
      if (body.method === 'getNetwork')
        return new Response(JSON.stringify({ result: { passphrase: 'test' } }));
      if (body.method === 'getHealth')
        return new Response(
          JSON.stringify({
            result: { oldestLedger: 1, latestLedger: 100, ledgerRetentionWindow: 100 },
          }),
        );
      if (!body.params.pagination?.cursor)
        return new Response(
          JSON.stringify({
            result: {
              events: [event('e10', 10)],
              latestLedger: 100,
              oldestLedger: 1,
              cursor: 'cursor-1',
            },
          }),
        );
      if (body.params.pagination.cursor === 'cursor-1')
        return new Response(
          JSON.stringify({
            result: {
              events: [event('e11', 11)],
              latestLedger: 100,
              oldestLedger: 1,
              cursor: 'cursor-2',
            },
          }),
        );
      return new Response(
        JSON.stringify({
          result: { events: [event('e12', 12)], latestLedger: 100, oldestLedger: 1 },
        }),
      );
    };
    await new Indexer(config('http://archive'), s, fetchImpl).backfill();
    expect(calls.filter((p) => p.pagination?.cursor).length).toBe(2);
    expect(s.gaps()[0].status).toBe('recovered');
    expect(s.coverage(contract)[0]).toMatchObject({ start_ledger: 10, end_ledger: 12 });
    s.close();
  });
});
describe('decoding and transport', () => {
  it('decodes topics and derives the event name', () => {
    const t = decodeTopics(['AAAADwAAAAh0cmFuc2Zlcg==']);
    expect(t.eventName).toBe('transfer');
    expect(t.error).toBe(false);
  });
  it('keeps malformed XDR raw', () =>
    expect(decodeScVal('not-xdr')).toMatchObject({ raw: 'not-xdr', error: true }));
  it('recognizes range errors and redacts secrets', () => {
    expect(isBeforeOldest(new RpcError(-32600, 'start is before oldest ledger'))).toBe(true);
    expect(redact('https://x.test/rpc?api_key=secret Bearer abc')).not.toContain('secret');
  });
  it('handles non-json RPC responses as errors', async () => {
    const c = new RpcClient(
      { name: 'm', url: 'https://x.test', archiveCapable: false, contracts: [], maxRetries: 0 },
      async () => new Response('oops', { status: 200 }),
    );
    await expect(c.getNetwork()).rejects.toThrow('non-JSON');
  });
  it('does not retry JSON-RPC application errors or ordinary 4xx responses', async () => {
    let calls = 0;
    const c = new RpcClient(
      { name: 'm', url: 'https://x.test', archiveCapable: false, contracts: [], maxRetries: 3 },
      async () => {
        calls++;
        return new Response(JSON.stringify({ error: { code: -32602, message: 'bad params' } }), {
          status: 200,
        });
      },
    );
    await expect(c.getNetwork()).rejects.toThrow('bad params');
    expect(calls).toBe(1);
  });
  it('honors Retry-After for a transient 429 response', async () => {
    let calls = 0;
    const c = new RpcClient(
      { name: 'm', url: 'https://x.test', archiveCapable: false, contracts: [], maxRetries: 1 },
      async () => {
        calls++;
        return calls === 1
          ? new Response('', { status: 429, headers: { 'retry-after': '0' } })
          : new Response(JSON.stringify({ result: { passphrase: 'test' } }));
      },
    );
    await expect(c.getNetwork()).resolves.toEqual({ passphrase: 'test' });
    expect(calls).toBe(2);
  });
});
describe('api', () => {
  it('rejects bad pagination and reports per-query completeness', async () => {
    const s = store();
    s.addGap({ contract: 'C1', startLedger: 10, endLedger: 20, reason: 'outage', status: 'open' });
    const app = createApi(s, {
      networkPassphrase: 'p',
      database: 'x',
      pollIntervalMs: 1,
      pageLimit: 1,
      retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
      api: { host: '127.0.0.1', port: 1, corsOrigins: [] },
      endpoints: [],
    });
    expect((await app.inject('/events?limit=1001')).statusCode).toBe(400);
    const r = await app.inject('/events?contract=C1&from=12&to=13');
    expect(r.statusCode).toBe(200);
    expect(r.json().incomplete).toBe(true);
    await app.close();
    s.close();
  });
  it('exempts health and rejects missing or wrong bearer credentials', async () => {
    process.env.EVENTIDE_TEST_KEY = 'secret';
    const s = store();
    const cfg = {
      networkPassphrase: 'p',
      database: 'x',
      pollIntervalMs: 1,
      pageLimit: 1,
      retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
      endpoints: [],
      api: {
        host: '127.0.0.1',
        port: 1,
        corsOrigins: [],
        apiKeyEnv: 'EVENTIDE_TEST_KEY',
        rateLimitPerMinute: 0,
      },
    };
    const app = createApi(s, cfg);
    expect((await app.inject('/health')).statusCode).toBe(200);
    expect((await app.inject('/status')).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/status',
          headers: { authorization: 'Bearer secret' },
        })
      ).statusCode,
    ).toBe(200);
    await app.close();
    s.close();
    delete process.env.EVENTIDE_TEST_KEY;
  });
  it('refuses to create an API when the configured key is empty', () => {
    delete process.env.EVENTIDE_EMPTY_KEY;
    const s = store();
    expect(() =>
      createApi(s, {
        networkPassphrase: 'p',
        database: 'x',
        pollIntervalMs: 1,
        pageLimit: 1,
        retry: { maxRetries: 0, baseDelayMs: 1, maxDelayMs: 1 },
        endpoints: [],
        api: { host: '127.0.0.1', port: 1, corsOrigins: [], apiKeyEnv: 'EVENTIDE_EMPTY_KEY' },
      }),
    ).toThrow(/unset or empty/);
    s.close();
  });
});
