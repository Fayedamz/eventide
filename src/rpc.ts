import { endpointHeaders } from './config.js'; import { redact } from './redact.js'; import type { EndpointConfig, EventsResult } from './types.js';
export class RpcError extends Error { constructor(public readonly code: number | undefined, message: string, public readonly data?: unknown) { super(message); } }
export class RpcClient { constructor(public readonly endpoint: EndpointConfig, private fetchImpl: typeof fetch = fetch) {}
 private async call<T>(method: string, params: Record<string, unknown>): Promise<T> { let res: Response; try { res = await this.fetchImpl(this.endpoint.url, { method: 'POST', headers: { 'content-type': 'application/json', ...endpointHeaders(this.endpoint) }, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }) }); } catch (error) { throw new RpcError(undefined, redact(error)); } const body = await res.json() as { result?: T; error?: { code?: number; message?: string; data?: unknown } }; if (!res.ok || body.error) throw new RpcError(body.error?.code, redact(body.error?.message ?? `HTTP ${res.status}`), body.error?.data); return body.result as T; }
 getNetwork() { return this.call<{passphrase:string}>('getNetwork', {}); } getHealth() { return this.call<{status:string;latestLedger:number;oldestLedger:number;ledgerRetentionWindow:number}>('getHealth', {}); }
 getEvents(params: Record<string, unknown>) { return this.call<EventsResult>('getEvents', params); }
}
// Stellar RPC documents an opaque cursor and a 1..10000 getEvents limit; callers persist the cursor and deduplicate by event id.
export function isBeforeOldest(e: unknown): boolean { return e instanceof RpcError && e.code === -32600 && /start is before oldest ledger/i.test(e.message); }
