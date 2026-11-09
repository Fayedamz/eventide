# Limitations

If no configured endpoint has the requested history, Eventide marks the range `unrecoverable` with a reason. The range appears in `gaps`; queries over it return `incomplete: true`; Eventide returns no fabricated events.

RPC retention windows are provider/node configuration, not a guarantee of permanent history. Archive backfill only uses endpoints explicitly flagged `archiveCapable`; that flag is an operator assertion because Soroban RPC does not define a portable provider capability field. Eventide is single-process and uses a single SQLite database. There is no API authentication by default. CORS is disabled by default. Reorganization handling is not implemented. The CLI's `run` command performs one poll pass; a supervisor or scheduler can invoke it repeatedly.

The current v0.1 query command is intentionally small and prints the first 100 stored events. The API has a hard page-size cap of 1000. Endpoint-specific rate limits and billing are outside the indexer's control.
