# Eventide

Eventide v0.1 is a TypeScript/Node.js Soroban event indexer that stores events in SQLite, tracks the ledger ranges it has covered, and records gaps instead of pretending unavailable history exists.

## Quickstart

```bash
npm install
cp config.example.yaml eventide.yaml
# edit the network passphrase, contract IDs, and endpoints
npm run build
node dist/cli.js run eventide.yaml
node dist/cli.js status eventide.yaml
node dist/cli.js api eventide.yaml
```

The default API listens on `127.0.0.1:8787`. Set `api.host` explicitly to expose it elsewhere; Eventide prints a warning when it is not loopback-only. CORS is disabled unless you add an opt-in CORS implementation in a deployment wrapper. RPC API keys are supplied through an environment variable named by `apiKeyEnv`; the secret value is never stored in YAML or logs.

## Commands

`init [config]` creates a starter YAML configuration. `run [config]` verifies every endpoint's network passphrase and performs one polling pass. `status [config]` prints event, checkpoint, and gap status. `gaps [config]` lists open, recovered, and unrecoverable ranges. `backfill [config]` tries open gaps against endpoints explicitly marked `archiveCapable`. `query [config]` prints stored events. `api [config]` starts the read-only HTTP API.

The API exposes `GET /health`, `GET /status`, `GET /gaps`, and `GET /events`. `/events` accepts `contract`, `from`, `to`, `limit` (1–1000), and `offset`. SQL values are always bound parameters; no API route writes or runs backfill.

## Design notes

Events use the RPC event `id` as their primary key and are inserted with `INSERT OR IGNORE`. Event writes and checkpoint/range updates share one SQLite transaction. SQLite WAL mode is enabled. A malformed ScVal is retained as raw XDR with `decode_error=1`, while indexing continues. Shutdown handlers close the database cleanly.

Read [docs/VERIFIED.md](docs/VERIFIED.md) for the external facts this implementation relies on and [LIMITATIONS.md](LIMITATIONS.md) for recovery and deployment limits.
