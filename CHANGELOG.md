# Changelog

All notable changes to this project will be documented in this file.

## [1.2.0] - 2026-06-26

### Fixed

- **MemoryStorage isolation:** `store` and `locks` are now instance fields instead of `static` class fields, eliminating cross-instance state pollution in tests and multi-agent processes.
- **Consistent timestamps in `writeTaskResult`:** `record.timestamp` and `state.lastRun` are now captured from a single `Date.now()` call, ensuring they are always identical.
- **Non-atomic read warnings:** Added explicit `@warning` JSDoc annotations to `hasProcessedTask()` and `getTaskResult()` (matching the existing warning on `filterNewTasks()`).
- **SQLite `locked_at` index:** Added `CREATE INDEX IF NOT EXISTS` on the `locked_at` column of the locks table for faster TTL expiry scans under high concurrency.
- **Redis diary blob TTL:** `RedisStorage` now accepts an optional `globalTtlMs` constructor option. When set, every diary state blob written to Redis uses a `PX` expiry, preventing unbounded key growth.

### Added

- **`status` field on `TaskRecord`:** Tasks now track their lifecycle stage: `"pending"` (claimed, no result yet), `"done"` (result written), or `"failed"` (explicitly failed). The optional `failReason` field stores the failure message.
- **`diary.failTask(title, reason?)`:** Atomically marks a claimed task as `"failed"` with an optional human-readable reason. Throws if the task was never claimed.
- **`diary.batchClaimTasks(titles[], options?)`:** Atomically claims multiple tasks in a single lock acquisition. Returns the subset of titles that were successfully claimed. Drastically reduces storage round-trips for batch workloads.
- **`diary.getStats()`:** Returns a `AgentStats` diagnostic summary including `runCount`, `historyCount`, `pendingCount`, `doneCount`, `failedCount`, `lastRunAt`, and `oldestTaskAt`. Expired tasks are excluded from active counts.
- **`diary.exportHistory()`:** Exports the full agent state as a serializable `AgentState` object for backups, migrations, or cross-agent sync.
- **`diary.importHistory(snapshot, options?)`:** Imports a previously exported snapshot. Supports `merge: true` to merge new tasks into existing state without creating duplicates.
- **`diary.pruneExpiredTasks()`:** Atomically scans history, removes all expired records, and returns them. Also triggers the `onTaskExpired` callback for every evicted record.
- **`onTaskExpired` hook:** New `AgentDiaryOptions.onTaskExpired` callback is invoked whenever a task expires and is evicted — either during `claimTask()`, `batchClaimTasks()`, or `pruneExpiredTasks()`.
- **`hashFn` option:** New `AgentDiaryOptions.hashFn` lets you supply a custom signature function for task deduplication. Useful for structured task IDs or domain-specific normalization strategies.
- **PostgreSQL adapter (`PostgresStorage`):** New `src/adapters/postgres.ts` adapter with lock-table-based distributed locking, atomic expired-lock stealing, `lock_id`-safe release, and lazy table/index initialization. Compatible with Supabase, Neon, Railway, AWS RDS, and any managed Postgres provider.

## [1.1.6] - 2026-06-10

### Security

- Validate `tableName` and `locksTableName` in `SqliteStorage` constructor to prevent SQL injection vulnerabilities.

### Added

- **MemoryStorage Adapter**: Lock-safe in-memory adapter (`MemoryStorage`) for prototyping and fast unit testing.
- **Task TTL (Expiration)**: Support for Time-to-Live on task records globally via `defaultTtlMs` or per-task on `claimTask()` and `writeTaskResult()`. Expired tasks automatically become reclaimable.
- **Task Deletion**: `diary.deleteTask(title)` API to remove specific tasks from state history.
- **History Querying**: `diary.getTasksCompletedSince(timestamp)` and `diary.findTasksByKeyword(keyword)` to filter and search history.
- **History Cleaning**: `diary.clearHistory()` to reset the agent diary state.

### Fixed

- Option naming in `LocalFileStorage` constructor usage inside the multi-process test worker (`directory` -> `baseDir`).
- ES Module loader conflicts for worker threads by renaming the worker fixture to `.cjs` and adding `dist/package.json` for CommonJS format detection.
