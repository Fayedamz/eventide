import Database from 'better-sqlite3';
import type { CoverageInterval, RpcEvent } from './types.js';

export type Gap = {
  id?: number;
  contract: string;
  startLedger: number;
  endLedger: number;
  reason: string;
  status: 'open' | 'unrecoverable' | 'recovered';
};
export type StoredEvent = {
  id: string;
  contract_id: string;
  ledger: number;
  ledger_closed_at: string | null;
  type: string | null;
  event_name: string | null;
  transaction_index: number | null;
  operation_index: number | null;
  topics_json: string;
  decoded_topics_json: string;
  value_xdr: string | null;
  value_json: string | null;
  tx_hash: string | null;
  decode_error: number;
  source_endpoint: string;
};

export class Store {
  db: Database.Database;
  constructor(file: string) {
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.migrate();
  }
  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events(
        id TEXT PRIMARY KEY, contract_id TEXT NOT NULL, ledger INTEGER NOT NULL,
        ledger_closed_at TEXT, type TEXT, event_name TEXT, transaction_index INTEGER,
        operation_index INTEGER, topics_json TEXT NOT NULL, decoded_topics_json TEXT NOT NULL,
        value_xdr TEXT, value_json TEXT, tx_hash TEXT, decode_error INTEGER NOT NULL DEFAULT 0,
        source_endpoint TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_contract_ledger ON events(contract_id, ledger);
      CREATE INDEX IF NOT EXISTS events_event_name ON events(event_name);
      CREATE INDEX IF NOT EXISTS events_tx_hash ON events(tx_hash);
      CREATE TABLE IF NOT EXISTS checkpoints(
        contract_id TEXT PRIMARY KEY, cursor TEXT, covered_through INTEGER NOT NULL DEFAULT 0,
        chain_latest INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS coverage_intervals(
        contract_id TEXT NOT NULL, start_ledger INTEGER NOT NULL, end_ledger INTEGER NOT NULL,
        source_endpoint TEXT, PRIMARY KEY(contract_id, start_ledger, end_ledger)
      );
      CREATE INDEX IF NOT EXISTS coverage_lookup ON coverage_intervals(contract_id, start_ledger, end_ledger);
      CREATE TABLE IF NOT EXISTS gaps(
        id INTEGER PRIMARY KEY AUTOINCREMENT, contract_id TEXT NOT NULL,
        start_ledger INTEGER NOT NULL, end_ledger INTEGER NOT NULL,
        reason TEXT NOT NULL, status TEXT NOT NULL,
        UNIQUE(contract_id, start_ledger, end_ledger, reason)
      );
    `);
    const columns = this.db.prepare('PRAGMA table_info(checkpoints)').all() as Array<{
      name: string;
    }>;
    if (!columns.some((column) => column.name === 'covered_through'))
      this.db.exec('ALTER TABLE checkpoints ADD COLUMN covered_through INTEGER NOT NULL DEFAULT 0');
    if (!columns.some((column) => column.name === 'chain_latest'))
      this.db.exec('ALTER TABLE checkpoints ADD COLUMN chain_latest INTEGER NOT NULL DEFAULT 0');
    if (!this.db.prepare('SELECT 1 FROM schema_migrations WHERE version=1').get())
      this.db.prepare('INSERT INTO schema_migrations VALUES(1, ?)').run(new Date().toISOString());
    if (!this.db.prepare('SELECT 1 FROM schema_migrations WHERE version=2').get())
      this.db.prepare('INSERT INTO schema_migrations VALUES(2, ?)').run(new Date().toISOString());
  }
  close() {
    this.db.close();
  }
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
  addCoverage(contract: string, start: number, end: number, source?: string) {
    if (end < start) return;
    const rows = this.db
      .prepare(
        'SELECT start_ledger, end_ledger FROM coverage_intervals WHERE contract_id=? AND end_ledger>=? AND start_ledger<=? ORDER BY start_ledger',
      )
      .all(contract, start - 1, end + 1) as Array<{ start_ledger: number; end_ledger: number }>;
    let low = start;
    let high = end;
    for (const row of rows) {
      low = Math.min(low, row.start_ledger);
      high = Math.max(high, row.end_ledger);
    }
    this.db
      .prepare(
        'DELETE FROM coverage_intervals WHERE contract_id=? AND end_ledger>=? AND start_ledger<=?',
      )
      .run(contract, start - 1, end + 1);
    this.db
      .prepare('INSERT INTO coverage_intervals VALUES(?,?,?,?)')
      .run(contract, low, high, source ?? null);
  }
  insertPage(
    items: Array<{
      event: RpcEvent;
      valueXdr: string | null;
      valueJson: string | null;
      topicsJson: string;
      decodedTopicsJson: string;
      eventName: string | null;
      decodeError: boolean;
      endpoint: string;
    }>,
    checkpoint: {
      contract: string;
      cursor?: string;
      coveredThrough?: number;
      chainLatest?: number;
      coveredStart: number;
      coveredEnd?: number;
      latestLedger?: number;
      source?: string;
    },
  ) {
    this.transaction(() => {
      const insert = this.db.prepare(`INSERT OR IGNORE INTO events(
        id,contract_id,ledger,ledger_closed_at,type,event_name,transaction_index,operation_index,
        topics_json,decoded_topics_json,value_xdr,value_json,tx_hash,decode_error,source_endpoint
      ) VALUES(@id,@contract_id,@ledger,@ledger_closed_at,@type,@event_name,@transaction_index,@operation_index,
        @topics_json,@decoded_topics_json,@value_xdr,@value_json,@tx_hash,@decode_error,@source_endpoint)`);
      for (const item of items) {
        insert.run({
          id: item.event.id,
          contract_id: item.event.contractId ?? checkpoint.contract,
          ledger: item.event.ledger,
          ledger_closed_at: item.event.ledgerClosedAt ?? null,
          type: item.event.type ?? null,
          event_name: item.eventName,
          transaction_index: item.event.transactionIndex ?? null,
          operation_index: item.event.operationIndex ?? null,
          topics_json: item.topicsJson,
          decoded_topics_json: item.decodedTopicsJson,
          value_xdr: item.valueXdr,
          value_json: item.valueJson,
          tx_hash: item.event.txHash ?? null,
          decode_error: item.decodeError ? 1 : 0,
          source_endpoint: item.endpoint,
        });
      }
      this.db
        .prepare(
          `INSERT INTO checkpoints(contract_id,cursor,covered_through,chain_latest,updated_at)
        VALUES(?,?,?,?,?) ON CONFLICT(contract_id) DO UPDATE SET cursor=excluded.cursor,
        covered_through=excluded.covered_through,chain_latest=excluded.chain_latest,updated_at=excluded.updated_at`,
        )
        .run(
          checkpoint.contract,
          checkpoint.cursor ?? null,
          checkpoint.coveredThrough ??
            checkpoint.coveredEnd ??
            checkpoint.latestLedger ??
            checkpoint.coveredStart,
          checkpoint.chainLatest ?? checkpoint.latestLedger ?? checkpoint.coveredStart,
          new Date().toISOString(),
        );
      this.addCoverage(
        checkpoint.contract,
        checkpoint.coveredStart,
        checkpoint.coveredThrough ??
          checkpoint.coveredEnd ??
          checkpoint.latestLedger ??
          checkpoint.coveredStart,
        checkpoint.source,
      );
    });
  }
  checkpoint(contract: string) {
    return this.db.prepare('SELECT * FROM checkpoints WHERE contract_id=?').get(contract) as
      | { cursor: string | null; covered_through: number; chain_latest: number }
      | undefined;
  }
  clearCheckpointCursor(contract: string) {
    this.db.prepare('UPDATE checkpoints SET cursor=NULL WHERE contract_id=?').run(contract);
  }
  coverage(contract?: string) {
    return (
      contract
        ? this.db
            .prepare('SELECT * FROM coverage_intervals WHERE contract_id=? ORDER BY start_ledger')
            .all(contract)
        : this.db
            .prepare('SELECT * FROM coverage_intervals ORDER BY contract_id,start_ledger')
            .all()
    ) as CoverageInterval[];
  }
  addGap(gap: Gap) {
    this.db
      .prepare(
        'INSERT OR IGNORE INTO gaps(contract_id,start_ledger,end_ledger,reason,status) VALUES(?,?,?,?,?)',
      )
      .run(gap.contract, gap.startLedger, gap.endLedger, gap.reason, gap.status);
  }
  gaps() {
    return this.db
      .prepare(
        'SELECT id,contract_id as contract,start_ledger as startLedger,end_ledger as endLedger,reason,status FROM gaps ORDER BY contract_id,start_ledger',
      )
      .all() as Gap[];
  }
  updateGap(id: number, status: Gap['status'], reason?: string) {
    this.db
      .prepare('UPDATE gaps SET status=?,reason=COALESCE(?,reason) WHERE id=?')
      .run(status, reason ?? null, id);
  }
  overlaps(contract: string, from?: number, to?: number) {
    const low = from ?? 0;
    const high = to ?? Number.MAX_SAFE_INTEGER;
    return this.db
      .prepare(
        "SELECT * FROM gaps WHERE contract_id=? AND status!='recovered' AND end_ledger>=? AND start_ledger<=?",
      )
      .all(contract, low, high) as Array<Record<string, unknown>>;
  }
  events(query: {
    contract?: string;
    from?: number;
    to?: number;
    eventName?: string;
    topic?: string;
    type?: string;
    txHash?: string;
    limit: number;
    offset?: number;
  }) {
    const where: string[] = [];
    const values: unknown[] = [];
    const add = (sql: string, value: unknown) => {
      where.push(sql);
      values.push(value);
    };
    if (query.contract) add('contract_id = ?', query.contract);
    if (query.from !== undefined) add('ledger >= ?', query.from);
    if (query.to !== undefined) add('ledger <= ?', query.to);
    if (query.eventName) add('event_name = ?', query.eventName);
    if (query.type) add('type = ?', query.type);
    if (query.txHash) add('tx_hash = ?', query.txHash);
    if (query.topic)
      add(
        'decoded_topics_json LIKE ?',
        `%${query.topic.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`,
      );
    values.push(query.limit, query.offset ?? 0);
    return this.db
      .prepare(
        `SELECT * FROM events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ledger,id LIMIT ? OFFSET ?`,
      )
      .all(...values) as StoredEvent[];
  }
  contracts() {
    return this.db
      .prepare(
        'SELECT contract_id as contract,COUNT(*) as events,MIN(ledger) as first_ledger,MAX(ledger) as last_ledger FROM events GROUP BY contract_id ORDER BY contract_id',
      )
      .all();
  }
  byId(id: string) {
    return this.db.prepare('SELECT * FROM events WHERE id=?').get(id) as StoredEvent | undefined;
  }
  status() {
    return {
      events: (this.db.prepare('SELECT COUNT(*) c FROM events').get() as { c: number }).c,
      checkpoints: this.db.prepare('SELECT * FROM checkpoints').all(),
      coverage: this.coverage(),
      gaps: this.gaps(),
    };
  }
}
