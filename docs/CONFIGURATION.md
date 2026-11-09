# Configuration

`networkPassphrase` is required and must match every configured endpoint. `database` points to the SQLite file. `pollIntervalMs` controls `watch`; `pageLimit` is capped at the RPC maximum of 10,000. `retry` controls timeout retries.

Each endpoint has a `url`, `name`, `contracts`, and an explicit `archiveCapable` flag. Set `apiKeyEnv` to the environment variable holding a secret. Header auth uses `Authorization: Bearer`; URL-template auth uses `auth.mode: urlTemplate` and substitutes `${ENV_VAR}`. API keys are never written to YAML.

The API defaults to loopback. `corsOrigins` is an explicit allowlist. `apiKeyEnv` enables bearer auth for the read-only API, and `rateLimitPerMinute` enables a simple per-client limit.
