# API

All endpoints are read-only. `GET /health`, `/status`, `/gaps`, `/contracts`, `/ledgers/coverage`, and `/openapi.json` expose operational data. `GET /events/:id` returns one event. `GET /events` accepts `contract`, `event_name`, `topic`, `from`, `to`, `type`, `tx_hash`, `limit`, and `offset`; `limit` is capped at 1000.

Event rows include raw XDR fields, parsed `topics`, parsed `decoded_topics`, parsed `value`, `event_name`, `source_endpoint`, and `decode_error`. Responses include `incomplete: true` when the requested contract/range overlaps an unrecovered gap.
