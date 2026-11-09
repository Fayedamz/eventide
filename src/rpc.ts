import { resolveEndpoint } from './config.js';
import { redact } from './redact.js';
import type { EndpointConfig, EventsResult } from './types.js';
export class RpcError extends Error {
  constructor(
    public code: number | undefined,
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export class RpcClient {
  constructor(
    public endpoint: EndpointConfig,
    private fetchImpl: typeof fetch = fetch,
  ) {}
  private async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const max = this.endpoint.maxRetries ?? 3;
    const timeout = this.endpoint.timeoutMs ?? 10000;
    for (let attempt = 0; ; attempt++) {
      const target = resolveEndpoint(this.endpoint);
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeout);
      try {
        const res = await this.fetchImpl(target.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...target.headers },
          body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
          signal: ctl.signal,
        });
        clearTimeout(timer);
        const text = await res.text();
        let body: { result?: T; error?: { code?: number; message?: string } };
        try {
          body = JSON.parse(text);
        } catch {
          throw new RpcError(undefined, `RPC returned non-JSON (HTTP ${res.status})`, res.status);
        }
        if ((res.status === 429 || res.status >= 500) && attempt < max) {
          const retryAfter = Number(res.headers.get('retry-after') ?? 0) * 1000;
          await sleep(
            retryAfter || Math.min(5000, 250 * 2 ** attempt) + Math.floor(Math.random() * 100),
          );
          continue;
        }
        if (!res.ok || body.error)
          throw new RpcError(
            body.error?.code,
            redact(body.error?.message ?? `HTTP ${res.status}`),
            res.status,
          );
        return body.result as T;
      } catch (error) {
        clearTimeout(timer);
        if (error instanceof RpcError && error.status === 429) throw error;
        if (attempt >= max)
          throw new RpcError(error instanceof RpcError ? error.code : undefined, redact(error));
        await sleep(Math.min(5000, 250 * 2 ** attempt) + Math.floor(Math.random() * 100));
      }
    }
  }
  getNetwork() {
    return this.call<{ passphrase: string }>('getNetwork', {});
  }
  getHealth() {
    return this.call<{
      status: string;
      latestLedger: number;
      oldestLedger: number;
      ledgerRetentionWindow: number;
    }>('getHealth', {});
  }
  getEvents(params: Record<string, unknown>) {
    return this.call<EventsResult>('getEvents', params);
  }
}
export function isBeforeOldest(e: unknown) {
  return (
    e instanceof RpcError && e.code === -32600 && /start is before oldest ledger/i.test(e.message)
  );
}
