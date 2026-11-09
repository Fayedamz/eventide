import { resolveEndpoint } from './config.js';
import { redact } from './redact.js';
import type { EndpointConfig, EventsResult } from './types.js';

export class RpcError extends Error {
  constructor(
    public code: number | undefined,
    message: string,
    public status?: number,
    public retryAfter?: string | null,
  ) {
    super(message);
  }
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const retryDelay = (attempt: number, retryAfter?: string | null) => {
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  return Number.isFinite(seconds) && seconds >= 0
    ? seconds * 1000
    : Math.min(5000, 250 * 2 ** attempt) + Math.floor(Math.random() * 100);
};
const retryable = (error: unknown) => {
  if (!(error instanceof RpcError)) return true;
  return error.status === 429 || (error.status !== undefined && error.status >= 500);
};

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
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await this.fetchImpl(target.url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...target.headers },
          body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
          signal: controller.signal,
        });
        const text = await response.text();
        let body: { result?: T; error?: { code?: number; message?: string } };
        try {
          body = JSON.parse(text);
        } catch {
          throw new RpcError(
            undefined,
            `RPC returned non-JSON (HTTP ${response.status})`,
            response.status,
          );
        }
        if (body.error)
          throw new RpcError(
            body.error.code,
            redact(body.error.message ?? 'RPC application error'),
          );
        if (!response.ok)
          throw new RpcError(
            undefined,
            redact(`HTTP ${response.status}`),
            response.status,
            response.headers.get('retry-after'),
          );
        return body.result as T;
      } catch (error) {
        if (attempt >= max || !retryable(error)) {
          if (error instanceof RpcError) throw error;
          throw new RpcError(undefined, redact(error));
        }
        await sleep(retryDelay(attempt, error instanceof RpcError ? error.retryAfter : undefined));
      } finally {
        clearTimeout(timer);
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
export function isBeforeOldest(error: unknown) {
  return (
    error instanceof RpcError &&
    error.code === -32600 &&
    /start is before oldest ledger/i.test(error.message)
  );
}
