# Operations

Run `eventide watch eventide.yaml` under a process supervisor. Back up the SQLite database while the process is stopped or using SQLite's backup tooling. Keep the WAL and shared-memory files with the database during a filesystem-level backup.

Monitor `/status`, `/gaps`, and `/ledgers/coverage`. An `unrecoverable` gap means no configured archive-capable endpoint proved it could cover the entire range. Queries report incomplete results rather than fabricating history. Reorganizations are not handled in v0.2.0.
