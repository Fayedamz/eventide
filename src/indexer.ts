import { isBeforeOldest, RpcClient } from './rpc.js';
import { Store } from './db.js';
import { decodeScVal, decodeTopics } from './decode.js';
import type { Config, EndpointConfig, RpcEvent } from './types.js';

type Fetcher = typeof fetch;
const batches = <T>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );

export class Indexer {
  private clients = new Map<string, RpcClient>();
  constructor(
    private cfg: Config,
    private store: Store,
    fetcher: Fetcher = fetch,
  ) {
    for (const endpoint of cfg.endpoints)
      this.clients.set(endpoint.name, new RpcClient(endpoint, fetcher));
  }
  async verifyNetworks() {
    for (const [name, client] of this.clients) {
      const network = await client.getNetwork();
      if (network.passphrase !== this.cfg.networkPassphrase)
        throw new Error(`Network passphrase mismatch for ${name}`);
    }
  }
  private async fetchRange(
    endpoint: EndpointConfig,
    contracts: string[],
    start: number,
    end?: number,
    initialCursor?: string,
  ) {
    const client = this.clients.get(endpoint.name)!;
    // Official getEvents semantics: startLedger is inclusive, endLedger is exclusive, and cursor pages omit both.
    const filters = [{ type: 'contract', contractIds: contracts }];
    let cursor = initialCursor;
    let coveredThrough = start - 1;
    let chainLatest = start - 1;
    let finished = false;
    for (;;) {
      const params = cursor
        ? { filters, pagination: { cursor, limit: this.cfg.pageLimit } }
        : {
            startLedger: start,
            ...(end === undefined ? {} : { endLedger: end + 1 }),
            filters,
            pagination: { limit: this.cfg.pageLimit },
          };
      const page = await client.getEvents(params);
      chainLatest = page.latestLedger;
      const events = page.events.filter(
        (event) => event.ledger >= start && (end === undefined || event.ledger <= end),
      );
      const lastLedger = events.length
        ? Math.max(...events.map((event) => event.ledger))
        : coveredThrough;
      const grouped = new Map<
        string,
        Array<{
          event: RpcEvent;
          valueXdr: string | null;
          valueJson: string | null;
          topicsJson: string;
          decodedTopicsJson: string;
          eventName: string | null;
          decodeError: boolean;
          endpoint: string;
        }>
      >();
      for (const event of events) {
        const value = decodeScVal(event.value);
        const topics = decodeTopics(event.topic);
        const item = {
          event,
          valueXdr: value.raw,
          valueJson: value.json === null ? null : JSON.stringify(value.json),
          topicsJson: JSON.stringify(topics.raw),
          decodedTopicsJson: JSON.stringify(topics.decoded),
          eventName: topics.eventName,
          decodeError: value.error || topics.error,
          endpoint: endpoint.name,
        };
        const contract = event.contractId ?? contracts[0];
        if (!grouped.has(contract)) grouped.set(contract, []);
        grouped.get(contract)!.push(item);
      }
      if (events.length) coveredThrough = Math.max(coveredThrough, lastLedger);
      if (page.events.length === 0) {
        finished = true;
        if (end !== undefined) coveredThrough = end;
      } else if (end !== undefined && lastLedger >= end) {
        finished = true;
        coveredThrough = end;
      }
      for (const contract of contracts) {
        const items = grouped.get(contract) ?? [];
        this.store.insertPage(items, {
          contract,
          cursor: finished ? undefined : page.cursor,
          coveredThrough,
          chainLatest,
          coveredStart: start,
          source: endpoint.name,
        });
      }
      if (finished || !page.cursor) break;
      cursor = page.cursor;
    }
    return { coveredThrough, chainLatest };
  }
  async pollEndpoint(endpoint: EndpointConfig, contracts = endpoint.contracts) {
    const client = this.clients.get(endpoint.name)!;
    const health = await client.getHealth();
    for (const group of batches(contracts, 5)) {
      const starts = new Map<string, number>();
      for (const contract of group) {
        const checkpoint = this.store.checkpoint(contract);
        const next = checkpoint ? checkpoint.covered_through + 1 : health.oldestLedger;
        if (next < health.oldestLedger) {
          this.store.addGap({
            contract,
            startLedger: next,
            endLedger: health.oldestLedger - 1,
            reason: 'RPC retention window no longer includes requested start',
            status: 'open',
          });
          this.store.clearCheckpointCursor(contract);
          starts.set(contract, health.oldestLedger);
        } else starts.set(contract, next);
      }
      const byStart = new Map<number, string[]>();
      for (const [contract, start] of starts) {
        if (!byStart.has(start)) byStart.set(start, []);
        byStart.get(start)!.push(contract);
      }
      for (const [start, batch] of byStart) {
        try {
          await this.fetchRange(endpoint, batch, start);
        } catch (error) {
          if (!isBeforeOldest(error)) throw error;
          const refreshed = await client.getHealth();
          for (const contract of batch) {
            this.store.addGap({
              contract,
              startLedger: start,
              endLedger: refreshed.oldestLedger - 1,
              reason: 'RPC retention window no longer includes requested start',
              status: 'open',
            });
            this.store.clearCheckpointCursor(contract);
          }
          await this.fetchRange(endpoint, batch, refreshed.oldestLedger);
        }
      }
    }
  }
  async runOnce() {
    await this.verifyNetworks();
    for (const endpoint of this.cfg.endpoints) {
      try {
        await this.pollEndpoint(endpoint);
      } catch (error) {
        console.error(`endpoint ${endpoint.name}: ${String(error)}`);
      }
    }
  }
  async backfill() {
    await this.verifyNetworks();
    for (const gap of this.store.gaps().filter((item) => item.status === 'open')) {
      let recovered = false;
      for (const endpoint of this.cfg.endpoints.filter(
        (item) => item.archiveCapable && item.contracts.includes(gap.contract),
      )) {
        try {
          await this.fetchRange(endpoint, [gap.contract], gap.startLedger, gap.endLedger);
          recovered = this.store
            .coverage(gap.contract)
            .some(
              (interval) =>
                interval.start_ledger <= gap.startLedger && interval.end_ledger >= gap.endLedger,
            );
          if (recovered) break;
        } catch (error) {
          console.error(`backfill ${endpoint.name}: ${String(error)}`);
        }
      }
      if (gap.id)
        this.store.updateGap(
          gap.id,
          recovered ? 'recovered' : 'unrecoverable',
          recovered
            ? undefined
            : 'No archive-capable endpoint covered the complete requested range',
        );
    }
  }
  async watch(signal?: AbortSignal) {
    await this.verifyNetworks();
    while (!signal?.aborted) {
      await this.runOnce();
      await new Promise((resolve) => setTimeout(resolve, this.cfg.pollIntervalMs));
    }
  }
}
