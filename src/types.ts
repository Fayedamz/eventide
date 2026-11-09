export type EndpointConfig = { name: string; url: string; archiveCapable: boolean; contracts: string[]; apiKeyEnv?: string };
export type Config = { networkPassphrase: string; database: string; pollIntervalMs: number; pageLimit: number; api: { host: string; port: number; cors: boolean }; endpoints: EndpointConfig[] };
export type RpcEvent = { type: string; ledger: number; ledgerClosedAt?: string; contractId?: string; id: string; transactionIndex?: number; operationIndex?: number; topic?: string[]; value?: string | { xdr?: string }; txHash?: string };
export type EventsResult = { events: RpcEvent[]; latestLedger: number; oldestLedger: number; cursor?: string; ledgerRetentionWindow?: number };
