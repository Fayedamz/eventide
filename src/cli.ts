#!/usr/bin/env node
import fs from 'node:fs';
import { loadConfig } from './config.js';
import { Store } from './db.js';
import { Indexer } from './indexer.js';
import { createApi } from './api.js';
const template = `networkPassphrase: "Test SDF Network ; September 2015"\ndatabase: "./eventide.db"\npollIntervalMs: 5000\npageLimit: 1000\nretry: { maxRetries: 3, baseDelayMs: 250, maxDelayMs: 5000 }\napi: { host: "127.0.0.1", port: 8787, corsOrigins: [] }\nendpoints:\n  - name: testnet\n    url: "https://soroban-testnet.stellar.org"\n    archiveCapable: false\n    contracts: []\n`;
const [cmd, ...args] = process.argv.slice(2),
  file = args[0] ?? 'eventide.yaml';
async function main() {
  if (cmd === 'init') {
    if (fs.existsSync(file)) throw new Error(`${file} already exists`);
    fs.writeFileSync(file, template);
    console.log(`created ${file}`);
    return;
  }
  if (
    !cmd ||
    ![
      'run',
      'watch',
      'status',
      'gaps',
      'backfill',
      'query',
      'export',
      'validate-config',
      'api',
    ].includes(cmd)
  ) {
    console.error(
      'Usage: eventide init|run|watch|status|gaps|backfill|query|export|validate-config|api [config]',
    );
    process.exitCode = 2;
    return;
  }
  const cfg = loadConfig(file);
  if (cmd === 'validate-config') {
    console.log('configuration is valid');
    return;
  }
  const store = new Store(cfg.database),
    idx = new Indexer(cfg, store);
  const close = () => {
    store.close();
    process.exit(0);
  };
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
  try {
    if (cmd === 'status') console.log(JSON.stringify(store.status(), null, 2));
    else if (cmd === 'gaps') console.log(JSON.stringify(store.gaps(), null, 2));
    else if (cmd === 'query')
      console.log(JSON.stringify(store.events({ limit: 100, offset: 0 }), null, 2));
    else if (cmd === 'export') {
      const rows = store.events({ limit: 1000000, offset: 0 });
      if (args.includes('--csv')) {
        console.log('id,contract_id,ledger,event_name,tx_hash');
        for (const r of rows)
          console.log(
            [r.id, r.contract_id, r.ledger, r.event_name ?? '', r.tx_hash ?? '']
              .map((x) => JSON.stringify(x))
              .join(','),
          );
      } else for (const r of rows) console.log(JSON.stringify(r));
    } else if (cmd === 'backfill') {
      await idx.backfill();
      console.log(JSON.stringify(store.gaps(), null, 2));
    } else if (cmd === 'api') {
      await idx.verifyNetworks();
      if (cfg.api.host !== '127.0.0.1') console.warn(`WARNING: API is binding to ${cfg.api.host}`);
      await createApi(store, cfg).listen({ host: cfg.api.host, port: cfg.api.port });
    } else if (cmd === 'watch') {
      const controller = new AbortController();
      process.once('SIGINT', () => controller.abort());
      process.once('SIGTERM', () => controller.abort());
      await idx.watch(controller.signal);
    } else {
      await idx.runOnce();
      console.log(JSON.stringify(store.status(), null, 2));
    }
  } finally {
    if (cmd !== 'api') store.close();
  }
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
