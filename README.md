# Eventide

[![CI](https://github.com/Fayedamz/eventide/actions/workflows/ci.yml/badge.svg)](https://github.com/Fayedamz/eventide/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Eventide is a TypeScript/Node.js Soroban event indexer that notices missing ledger ranges and repairs them when a configured archive-capable endpoint can prove the exact range is available. It stores contract events in SQLite, preserves malformed XDR, and reports incomplete history honestly.

## Quickstart

```bash
npm ci
cp config.example.yaml eventide.yaml
# add valid contract IDs
npm run build
node dist/cli.js validate-config eventide.yaml
node dist/cli.js watch eventide.yaml
```

Run `node dist/cli.js api eventide.yaml` in another process. The API binds to `127.0.0.1` by default. Docker users can use `docker compose up --build` after placing a config at the mounted `/data/eventide.yaml` path.

## Commands

`init` creates a self-contained starter config. `validate-config` checks endpoint shape and contract StrKeys. `run` performs one pass; `watch` polls serially at `pollIntervalMs`; `status`, `gaps`, and `query` inspect local state; `backfill` attempts exact open ranges on archive-capable endpoints; `export` emits NDJSON or CSV; `api` starts the read-only service.

## API

The API exposes `/health`, `/status`, `/gaps`, `/contracts`, `/ledgers/coverage`, `/openapi.json`, `/events/:id`, and `/events`. Event queries support contract, event name, topic, ledger range, type, transaction hash, limit, and offset filters. Responses contain parsed JSON values and topics, plus `incomplete` when the requested contract/range overlaps an unrecovered gap. Optional bearer auth, CORS allowlisting, and a simple rate limit are configurable.

## How gap recovery works

Each successful page commits events, a per-contract cursor/latest ledger checkpoint, and a coverage interval in one SQLite transaction. Adjacent or overlapping intervals merge. If an RPC retention boundary moves past a requested start, Eventide records the missing range and continues from the node's current oldest ledger. Backfill requests the gap's exact inclusive range, paginates to completion, verifies interval coverage, and only then marks the gap recovered.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md), [`docs/API.md`](docs/API.md), [`docs/OPERATIONS.md`](docs/OPERATIONS.md), [`docs/VERIFIED.md`](docs/VERIFIED.md), and [`LIMITATIONS.md`](LIMITATIONS.md).

## Status

Version 0.3.0 is pre-alpha and testnet-first. Reorganizations are not handled, the SQLite store is single-process, and a provider's archive capability must be explicitly verified by the operator.
