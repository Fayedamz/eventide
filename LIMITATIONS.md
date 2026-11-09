# Limitations

If no archive-capable endpoint covers an open range completely, Eventide marks the gap `unrecoverable`. It remains visible in `/gaps` and CLI output. Queries overlapping it return `incomplete: true`; no history is fabricated.

Reorganizations and ledger hash continuity are not implemented. SQLite is a single-process store. The API is read-only but has no authentication unless `apiKeyEnv` is configured. The built-in rate limiter is process-local. Provider rate limits, billing, and retention windows remain provider-specific. Coverage is based on successful RPC response ranges, not proof that a contract emitted an event in every ledger.
