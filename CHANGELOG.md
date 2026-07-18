# Changelog

All notable changes to `@agent-diaries/core` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [2.0.0] - 2026-07-18

### 🏛️ Architectural Evolution in Version 2.0.0
Version 2.0.0 marks the evolution of `@agent-diaries/core` from an orchestration library backed by a generic key-value storage wrapper into a true **enterprise-grade orchestration platform**.

Underneath the public `AgentDiary` API, the framework has been re-architected around a domain-driven repository model (`WorkflowRepository`, `DiaryRepository`, `TraceRepository`, `TimelineRepository`, `MetricsRepository`, `ProviderRepository`), a decoupled infrastructure facade (`StorageManager`), a strict workflow state machine (`WorkflowStateMachine`), an internal pub-sub event bus (`EventBus`), a worker process registry (`WorkerRegistry`), and an extensible plugin system (`PluginRegistry`).

All architectural enhancements have been delivered while preserving **100% backward compatibility** with no breaking changes to existing public APIs or storage adapters.

---

### Added
- **Domain Repository Pattern:**
  - `WorkflowRepository`: Lifecycle management (`createWorkflow`, `claimWorkflow`, `completeWorkflow`, `failWorkflow`, `cancelWorkflow`, `findReusableWorkflow`).
  - `DiaryRepository`: Key-value task indexing and signature matching (`saveDiary`, `loadDiary`, `recordReuse`, `findBySignature`).
  - `TraceRepository`: OpenTelemetry-style trace and span tracking (`recordTrace`, `recordSpan`, `loadWorkflowTrace`).
  - `TimelineRepository`: Sequenced audit log trail (`appendEvent`, `loadTimeline`).
  - `MetricsRepository`: Metric recording and aggregation (`recordMetric`, `aggregateMetrics`).
  - `ProviderRepository`: Provider health and latency monitoring (`recordProviderLatency`, `recordProviderFailure`).
- **Infrastructure Abstraction (`StorageManager`):**
  - Decoupled storage facade orchestrating `CacheProvider`, `LockProvider`, and `PersistenceProvider` abstractions.
  - Built-in bridge (`StorageAdapterBridge`) for legacy key-value storage adapters (`LocalFileStorage`, `MemoryStorage`).
- **Workflow State Machine (`WorkflowStateMachine`):**
  - Enforces valid status transitions across 9 lifecycle states: `CREATED`, `QUEUED`, `CLAIMED`, `RUNNING`, `WAITING`, `COMPLETED`, `FAILED`, `CANCELLED`, `EXPIRED`.
  - Throws `InvalidStateTransitionError` on disallowed state transitions.
- **Internal Event Bus (`EventBus`):**
  - Strongly-typed pub-sub event system emitting `WorkflowCreated`, `WorkflowClaimed`, `WorkflowStarted`, `WorkflowCompleted`, `WorkflowFailed`, `WorkflowReused`, `DiaryUpdated`, `TraceRecorded`, `ProviderFailure`, `CacheHit`, `CacheMiss`, `LockAcquired`, and `LockReleased`.
- **Worker Process Registry (`WorkerRegistry`):**
  - Active worker monitoring, hostname/PID tracking, heartbeats, and stale worker pruning via `pruneStaleWorkers()`.
- **Extensible Plugin System (`PluginRegistry`):**
  - Modular framework (`AgentDiariesPlugin`, `PluginContext`, `PluginRegistry`) allowing third-party storage, search, metrics, and tracing plugins.
- **Search Provider Orchestration (`SearchOrchestrator`):**
  - Multi-provider search orchestration supporting `TinyFishProvider` and `TavilyProvider` with automated latency recording and failovers.
- **Diagnostics & Benchmarking:**
  - `Dashboard`: Real-time active worker monitoring, workflow counts, and event stream summaries.
  - `BenchmarkEngine` & `CertificationEngine`: Automated throughput benchmarking and system certification tests.
- **Subpath Import Support:**
  - Package subpath exports configured in `package.json` for `@agent-diaries/core/core`, `/memory`, `/redis`, `/postgres`, `/shared`, `/diary`, `/storage`, and `/adapters/*`.

### Changed
- **Monorepo Internal Architecture:**
  - Source code reorganized into modular internal packages (`packages/shared`, `packages/core`, `packages/memory`, `packages/redis`, `packages/postgres`) compiled into a single canonical build output (`dist/`).
- **Build Pipeline Optimization:**
  - Cleaned build output pipeline to reduce unpacked package size by **57.7%** (from 333.1 kB to 140.7 kB) and tarball size by **30.6%**.

### Deprecated
- Unmanaged direct manipulation of raw storage adapters without routing through `StorageManager` (retained for backward compatibility).

### Removed
- Redundant `dist/package.json` build artifact.
- Duplicate nested output directories (`dist/src/`, `dist/packages/`).

### Fixed
- Fixed state synchronization in `AgentDiary` when instantiated with custom legacy storage adapters.
- Fixed path resolution aliases in Vitest test runner for sub-package modules.

### Security
- Strengthened atomic spin-lock lease acquisition and renewal routines in `MemoryLockProvider` and `StorageAdapterBridge` to prevent race conditions during high-volume worker concurrency (verified up to 50 concurrent agents).
