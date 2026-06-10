# Changelog

All notable changes to this project will be documented in this file.

## [1.1.5] - 2026-06-10

### Added

- **MemoryStorage Adapter**: Lock-safe in-memory adapter (`MemoryStorage`) for prototyping and fast unit testing.
- **Task TTL (Expiration)**: Support for Time-to-Live on task records globally via `defaultTtlMs` or per-task on `claimTask()` and `writeTaskResult()`. Expired tasks automatically become reclaimable.
- **Task Deletion**: `diary.deleteTask(title)` API to remove specific tasks from state history.
- **History Querying**: `diary.getTasksCompletedSince(timestamp)` and `diary.findTasksByKeyword(keyword)` to filter and search history.
- **History Cleaning**: `diary.clearHistory()` to reset the agent diary state.

### Fixed

- Option naming in `LocalFileStorage` constructor usage inside the multi-process test worker (`directory` -> `baseDir`).
- ES Module loader conflicts for worker threads by renaming the worker fixture to `.cjs` and adding `dist/package.json` for CommonJS format detection.
