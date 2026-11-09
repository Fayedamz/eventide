import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { StrKey } from '@stellar/stellar-sdk';
import type { Config, EndpointConfig } from './types.js';
export function loadConfig(file = 'eventide.yaml'): Config {
  const raw = parse(fs.readFileSync(path.resolve(file), 'utf8')) as Partial<Config>;
  if (
    !raw.networkPassphrase ||
    !raw.database ||
    !Array.isArray(raw.endpoints) ||
    !raw.endpoints.length
  )
    throw new Error('networkPassphrase, database, and at least one endpoint are required');
  const cfg: Config = {
    networkPassphrase: raw.networkPassphrase,
    database: raw.database,
    pollIntervalMs: Math.max(raw.pollIntervalMs ?? 5000, 250),
    pageLimit: Math.min(Math.max(raw.pageLimit ?? 100, 1), 10000),
    retry: {
      maxRetries: raw.retry?.maxRetries ?? 3,
      baseDelayMs: raw.retry?.baseDelayMs ?? 250,
      maxDelayMs: raw.retry?.maxDelayMs ?? 5000,
    },
    api: {
      host: raw.api?.host ?? '127.0.0.1',
      port: raw.api?.port ?? 8787,
      corsOrigins: raw.api?.corsOrigins ?? [],
      apiKeyEnv: raw.api?.apiKeyEnv,
      rateLimitPerMinute: raw.api?.rateLimitPerMinute ?? 0,
    },
    endpoints: raw.endpoints as EndpointConfig[],
  };
  for (const e of cfg.endpoints) {
    if (!e.name || !e.url || !Array.isArray(e.contracts))
      throw new Error('each endpoint needs name, url, and contracts');
    if (e.auth?.mode === 'urlTemplate' && !e.auth.urlTemplate)
      throw new Error(`urlTemplate auth requires urlTemplate on ${e.name}`);
    for (const id of e.contracts) {
      if (!StrKey.isValidEd25519PublicKey(id))
        throw new Error(`invalid contract ID on ${e.name}: ${id}`);
    }
  }
  return cfg;
}
export function resolveEndpoint(e: EndpointConfig): {
  url: string;
  headers: Record<string, string>;
} {
  const secret = e.apiKeyEnv ? (process.env[e.apiKeyEnv] ?? '') : '';
  if (e.auth?.mode === 'urlTemplate') {
    const url = (e.auth.urlTemplate ?? e.url).replaceAll('${' + (e.apiKeyEnv ?? '') + '}', secret);
    return { url, headers: {} };
  }
  return { url: e.url, headers: secret ? { authorization: `Bearer ${secret}` } : {} };
}
