import { RpcClient } from './rpc.js';
import { Store } from './db.js';
import { decodeScVal, decodeTopics } from './decode.js';
import type { Config, EndpointConfig, RpcEvent } from './types.js';
const batches = <T>(items: T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );
export class Indexer {
  private clients = new Map<string, RpcClient>();
  constructor(
    private cfg: Config,
    private store: Store,
  ) {
    for (const e of cfg.endpoints) this.clients.set(e.name, new RpcClient(e));
  }
  async verifyNetworks() {
    for (const [name, c] of this.clients) {
      const n = await c.getNetwork();
      if (n.passphrase !== this.cfg.networkPassphrase)
        throw new Error(`Network passphrase mismatch for ${name}`);
    }
  }
  private async fetchRange(
    endpoint: EndpointConfig,
    contracts: string[],
    start: number,
    end?: number,
  ) {
    const client = this.clients.get(endpoint.name)!;
    // Stellar RPC documents a maximum of five contract IDs per filter; cursor pages omit start/end.
    const filters = [{ type: 'contract', contractIds: contracts }];
    let cursor: string | undefined;
    let latest = start - 1;
    let oldest = start;
    let pages = 0;
    for (;;) {
      const params = cursor
        ? { filters, pagination: { cursor, limit: this.cfg.pageLimit } }
        : {
            startLedger: start,
            ...(end !== undefined ? { endLedger: end + 1 } : {}),
            filters,
            pagination: { limit: this.cfg.pageLimit },
          };
      const page = await client.getEvents(params);
      pages++;
      latest = Math.max(latest, page.latestLedger);
      oldest = page.oldestLedger;
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
      for (const event of page.events) {
        const d = decodeScVal(event.value),
          t = decodeTopics(event.topic);
        const item = {
          event,
          valueXdr: d.raw,
          valueJson: d.json === null ? null : JSON.stringify(d.json),
          topicsJson: JSON.stringify(t.raw),
          decodedTopicsJson: JSON.stringify(t.decoded),
          eventName: t.eventName,
          decodeError: d.error || t.error,
          endpoint: endpoint.name,
        };
        const key = event.contractId ?? contracts[0];
        if (!grouped.has(key)) grouped.set(key, []);
        grouped.get(key)!.push(item);
      }
      for (const contract of contracts) {
        const items = grouped.get(contract) ?? [];
        this.store.insertPage(items, {
          contract,
          cursor: page.cursor,
          latestLedger: page.latestLedger,
          coveredStart: start,
          coveredEnd:
            end !== undefined
              ? Math.min(end, page.latestLedger)
              : page.events.length
                ? Math.max(...page.events.map((e) => e.ledger))
                : page.latestLedger,
          source: endpoint.name,
        });
      }
      if (!page.cursor || page.events.length === 0 || (end !== undefined && latest >= end)) break;
      cursor = page.cursor;
      if (pages > 100000) throw new Error('pagination safety limit exceeded');
    }
    return { latest, oldest };
  }
  async pollEndpoint(endpoint: EndpointConfig, contracts = endpoint.contracts) {
    const health = await this.clients.get(endpoint.name)!.getHealth();
    for (const group of batches(contracts, 5)) {
      const starts = group.map(
        (c) => this.store.checkpoint(c)?.latest_ledger ?? health.oldestLedger,
      );
      const start = Math.min(...starts);
      if (start < health.oldestLedger) {
        for (const c of group)
          this.store.addGap({
            contract: c,
            startLedger: starts[group.indexOf(c)],
            endLedger: health.oldestLedger - 1,
            reason: 'RPC retention window no longer includes requested start',
            status: 'open',
          });
        await this.fetchRange(endpoint, group, health.oldestLedger);
        continue;
      }
      await this.fetchRange(endpoint, group, start);
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
    for (const gap of this.store.gaps().filter((g) => g.status === 'open')) {
      let recovered = false;
      for (const endpoint of this.cfg.endpoints.filter(
        (e) => e.archiveCapable && e.contracts.includes(gap.contract),
      )) {
        try {
          await this.fetchRange(endpoint, [gap.contract], gap.startLedger, gap.endLedger);
          const covered = this.store
            .coverage(gap.contract)
            .some((i) => i.start_ledger <= gap.startLedger && i.end_ledger >= gap.endLedger);
          if (covered) {
            recovered = true;
            break;
          }
        } catch (error) {
          console.error(`backfill ${endpoint.name}: ${String(error)}`);
        }
      }
      if (recovered && gap.id) this.store.updateGap(gap.id, 'recovered');
      else if (gap.id)
        this.store.updateGap(
          gap.id,
          'unrecoverable',
          'No archive-capable endpoint covered the complete requested range',
        );
    }
  }
  async watch(signal?: AbortSignal) {
    await this.verifyNetworks();
    while (!signal?.aborted) {
      await this.runOnce();
      await new Promise((r) => setTimeout(r, this.cfg.pollIntervalMs));
    }
  }
}
