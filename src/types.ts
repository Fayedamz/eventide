export type AuthConfig = {
  mode?: 'header' | 'urlTemplate';
  headerName?: string;
  urlTemplate?: string;
};
export type EndpointConfig = {
  name: string;
  url: string;
  archiveCapable: boolean;
  contracts: string[];
  apiKeyEnv?: string;
  auth?: AuthConfig;
  timeoutMs?: number;
  maxRetries?: number;
};
export type Config = {
  networkPassphrase: string;
  database: string;
  pollIntervalMs: number;
  pageLimit: number;
  retry: { maxRetries: number; baseDelayMs: number; maxDelayMs: number };
  api: {
    host: string;
    port: number;
    corsOrigins: string[];
    apiKeyEnv?: string;
    rateLimitPerMinute?: number;
  };
  endpoints: EndpointConfig[];
};
export type RpcEvent = {
  type: string;
  ledger: number;
  ledgerClosedAt?: string;
  contractId?: string;
  id: string;
  transactionIndex?: number;
  operationIndex?: number;
  topic?: string[];
  value?: string | { xdr?: string };
  txHash?: string;
};
export type EventsResult = {
  events: RpcEvent[];
  latestLedger: number;
  oldestLedger: number;
  cursor?: string;
  ledgerRetentionWindow?: number;
};
export type CoverageInterval = {
  contract_id: string;
  start_ledger: number;
  end_ledger: number;
  source_endpoint?: string;
};
