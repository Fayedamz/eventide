# Changelog

## Unreleased

- Fixed retention-gap detection for single-contract polling.

## 0.3.0 - 2026-11-09

- Fixed contract StrKey validation to accept C... contract IDs and reject G... account addresses.
- Fixed bounded backfill pagination to honor inclusive start and exclusive end semantics, continue through cursor pages, and only mark complete ranges covered after pagination finishes.
- Separated chain-tip metadata from fully covered-through checkpoint state.
- Restricted RPC retries to transport failures, timeouts, HTTP 429, and HTTP 5xx; Retry-After is honored.
- Added constant-time API bearer comparison, health authentication exemption, bounded rate buckets, and fail-fast empty-key startup validation.
- Added regression coverage for these fixes and reached 72.09% statement coverage. Branch coverage remains below the requested 70% threshold.

## 0.2.0 - 2026-11-09

- Added interval coverage and versioned SQLite migrations.
- Added exact-range backfill, watch mode, batch filters, topic decoding, event names, API filters, API-key auth, rate limiting, and OpenAPI discovery.
- Added resilient RPC transport with timeout, retry, jitter, and malformed-response handling.
- Added Docker, CI, contributor documentation, and an issue backlog.
