# Architecture

```mermaid
flowchart LR
  RPC[ Soroban RPC endpoints ] --> P[Poller and gap planner]
  P --> D[ScVal/topic decoder]
  D --> S[(SQLite WAL store)]
  S --> A[Read-only Fastify API]
  S --> C[CLI status, gaps, query, export]
  G[Archive-capable endpoints] --> B[Exact-range backfiller]
  B --> S
```

The indexer treats event IDs as the durable deduplication key. A page's events, checkpoint, and interval coverage are committed together. Coverage intervals are merged when adjacent or overlapping, while gaps remain explicit records until a complete range is recovered.
