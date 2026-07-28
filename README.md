<div align="center">
  <h1>🧠 Agent Diaries Core</h1>
  <p><strong>The lightweight, lock-safe state management & enterprise workflow orchestration platform for AI agents.</strong></p>

[![NPM Version](https://img.shields.io/npm/v/@agent-diaries/core?style=for-the-badge&logo=npm&color=CB3837)](https://www.npmjs.com/package/@agent-diaries/core)
[![NPM Downloads](https://img.shields.io/npm/dm/@agent-diaries/core?style=for-the-badge&logo=npm&color=44CC11)](https://www.npmjs.com/package/@agent-diaries/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Build Status](https://img.shields.io/github/actions/workflow/status/swapwarick/agent-diaries-core/codecov.yml?branch=main&style=for-the-badge&logo=github&label=Build)](https://github.com/swapwarick/agent-diaries-core/actions)
[![Test Status](https://img.shields.io/badge/Tests-69%2F69%20Passing-brightgreen?style=for-the-badge&logo=vitest&logoColor=white)](https://github.com/swapwarick/agent-diaries-core/actions)

</div>

<br />

## 📖 Introduction

### What is Agent Diaries?
**Agent Diaries** is a framework-agnostic state management and workflow orchestration framework built for autonomous AI agents and swarm deployments. It equips your agents with a persistent, concurrency-safe "diary" memory, enabling them to remember past actions, prevent infinite execution loops, and coordinate work across distributed worker nodes.

### What Problems Does It Solve?
- **🛑 Infinite Execution Loops:** Prevents agents from repeatedly executing the exact same LLM call or web scraping job when context windows reset or prompts repeat.
- **⚡ Multi-Agent Swarm Race Conditions:** Uses provider-appropriate locking to guarantee that when 50+ agents attempt to claim the exact same task simultaneously, exactly **one** agent succeeds while the others safely back off. In-memory deployments use a **process-local FIFO Promise mutex** (no TTL, no polling, no lock theft). Distributed deployments (Redis, PostgreSQL) use **TTL-based distributed locks with exponential backoff + jitter** for cross-process coordination.
- **💸 Wasted API & Scraping Costs:** Caches and indexes completed task results by signature, allowing agents to instantly reuse previous results instead of re-running expensive LLM pipelines.
- **🔍 Zero Visibility into Swarm Health:** Provides built-in OpenTelemetry-style distributed tracing, real-time metrics aggregation, and sequenced audit timelines.

### Why Use Agent Diaries?
- **Framework Agnostic:** Works seamlessly with custom TypeScript/Node.js scripts, LangChain, AutoGen, CrewAI, LlamaIndex, or Vercel AI SDK.
- **Zero Heavy Runtime Dependencies:** Ultra-fast, lightweight bundle size with zero required database drivers.
- **Distributed-Ready Architecture:** Cleanly decouples domain logic from storage via `StorageManager` (Cache, Lock, and Persistence abstractions) with support for **Redis**, **PostgreSQL**, **SQLite**, **MongoDB**, and **In-Memory** storage.

---

## 🏛️ High-Level Architecture

```
                       ┌───────────────────────────────────────┐
                       │          Public Developer API         │
                       │     AgentDiary  │  WorkflowCoordinator│
                       └───────────────────┬───────────────────┘
                                           │
                                           ▼
                       ┌───────────────────────────────────────┐
                       │            Repository Layer           │
                       │  Workflow │ Diary │ Trace │ Timeline  │
                       │     Metrics   │    Provider Health    │
                       └───────────────────┬───────────────────┘
                                           │
                   ┌───────────────────────┼───────────────────────┐
                   │                       │                       │
                   ▼                       ▼                       ▼
        ┌─────────────────────┐ ┌─────────────────────┐ ┌─────────────────────┐
        │  WorkflowState      │ │      EventBus       │ │   PluginRegistry    │
        │      Machine        │ │ (Pub-Sub Events)    │ │(Extensible Plugins) │
        └─────────────────────┘ └─────────────────────┘ └─────────────────────┘
                                           │
                                           ▼
                       ┌───────────────────────────────────────┐
                       │         StorageManager Facade         │
                       │ CacheProvider │ LockProvider │ Persist│
                       └───────────────────┬───────────────────┘
                                           │
         ┌─────────────────────────────────┼─────────────────────────────────┐
         │                                 │                                 │
         ▼                                 ▼                                 ▼
┌──────────────────┐             ┌──────────────────┐             ┌────────────────────┐
│ Memory Providers │             │  Redis Providers │             │ Postgres Providers │
│ (Memory / File)  │             │   (Distributed)  │             │     (Durable SQL)  │
└──────────────────┘             └──────────────────┘             └────────────────────┘
```

---

## ✨ Features & Enterprise Capabilities

- **🔄 Workflow Orchestration:** End-to-end multi-agent workflow submission, atomic worker claims, execution coordination, and state transitions.
- **🔎 Search & Execution Reuse:** Deduplicate expensive web research, web scraping, or LLM reasoning by caching workflow outputs based on signature hashes.
- **☁️ Distributed-Ready Storage:** Decoupled persistence facade (`StorageManager`) providing unified interfaces for caching (`CacheProvider`), distributed locking (`LockProvider`), and durable storage (`PersistenceProvider`).
- **🚦 Workflow Lifecycle State Machine:** Enforces valid status transitions (`CREATED` → `QUEUED` → `CLAIMED` → `RUNNING` → `COMPLETED` / `FAILED` / `CANCELLED` / `EXPIRED`).
- **📡 Strongly-Typed Event Bus:** Decoupled pub-sub `EventBus` emitting domain events (`WorkflowCreated`, `WorkflowCompleted`, `DiaryUpdated`, `TraceRecorded`) for real-time observability.
- **👷 Worker Heartbeat Registry:** Track active worker nodes, PIDs, hostnames, and heartbeats with automated stale worker pruning.
- **🔌 Modular Plugin Framework:** Register custom storage, search, metrics, and tracing plugins via `PluginRegistry`.
- **📊 Real-Time Metrics & Timelines:** Automated metrics aggregation (counts, latencies, success rates) and sequenced audit log trails.
- **🔭 Distributed Tracing:** OpenTelemetry-style trace recording and span tracking across multi-step agent pipelines.

---

## 📦 Installation

Install the core package:

```bash
npm install @agent-diaries/core
```

Optional peer dependencies for database storage adapters:

```bash
npm install better-sqlite3 # For SQLite Storage
npm install ioredis        # For Redis Storage
npm install mongodb        # For MongoDB Storage
npm install pg             # For PostgreSQL Storage
```

---

## 🚀 Quick Start

Initialize `AgentDiary` and wrap your LLM calls to prevent duplicate executions.

```typescript
import { AgentDiary } from "@agent-diaries/core";

async function runAgent() {
  const diary = new AgentDiary({ agentId: "data-collector" });
  const currentTask = "Download Q3 Financial Report";

  // 1. claimTask is ATOMIC.
  // If 50 agents try to claim it at the exact same millisecond, only ONE succeeds.
  const isNew = await diary.claimTask(currentTask);

  if (!isNew) {
    const pastResult = await diary.getTaskResult(currentTask);
    console.log(`[Agent] ⏩ Skipping task. Already processed: "${pastResult}"`);
    return pastResult;
  }

  // 2. Execute your expensive LLM / Web Scraping logic safely
  console.log(`[Agent] ⚙️ Executing: "${currentTask}"...`);
  const result = "Found 2 warnings, no critical errors.";

  // 3. Update the pending task with the final result
  await diary.writeTaskResult(currentTask, result);
  console.log(`[Agent] ✅ Task complete. Diary updated!`);
  return result;
}

runAgent();
```

---

## 🏛️ Advanced Workflow Orchestration

For enterprise swarm coordination, use the `WorkflowCoordinator` and `WorkflowRepository` directly:

```typescript
import {
  StorageManager,
  WorkflowRepository,
  DiaryRepository,
  TraceRepository,
  TimelineRepository,
  MetricsRepository,
  ProviderRepository,
  WorkflowCoordinator,
  defaultEventBus,
} from "@agent-diaries/core";

// 1. Initialize StorageManager
const storageManager = new StorageManager();

// 2. Initialize Repositories
const workflowRepo = new WorkflowRepository(storageManager, defaultEventBus);
const diaryRepo = new DiaryRepository(storageManager, defaultEventBus);
const traceRepo = new TraceRepository(storageManager, defaultEventBus);
const timelineRepo = new TimelineRepository(storageManager);
const metricsRepo = new MetricsRepository(storageManager);
const providerRepo = new ProviderRepository(defaultEventBus);

// 3. Initialize Coordinator
const coordinator = new WorkflowCoordinator(
  workflowRepo,
  diaryRepo,
  traceRepo,
  timelineRepo,
  metricsRepo,
  providerRepo,
);

async function runSwarmWorkflow() {
  // Submit workflow with signature deduplication
  const wf = await coordinator.submitWorkflow("Sync Customer Accounts", { batchSize: 50 }, {
    signature: "sync-cust-accounts-batch-50",
  });

  // Execute workflow safely under worker claim
  const result = await coordinator.executeWorkflow(wf.id, "worker-node-01", async () => {
    return { syncedCount: 50, status: "SUCCESS" };
  });

  console.log("Workflow Result:", result);
}

runSwarmWorkflow();
```

---

## 📦 Package Subpath Imports

`@agent-diaries/core` supports explicit modular subpath imports:

```typescript
// Core entry point (All exports)
import { AgentDiary, WorkflowCoordinator } from "@agent-diaries/core";

// Domain & Framework Core
import { StorageManager, WorkflowStateMachine, EventBus } from "@agent-diaries/core/core";

// Memory & Local Storage
import { MemoryCacheProvider, MemoryLockProvider, LocalFileStorage } from "@agent-diaries/core/memory";

// Distributed Redis Hooks
import { RedisCacheProvider, RedisLockProvider } from "@agent-diaries/core/redis";

// Durable PostgreSQL Hooks
import { PostgresPersistenceProvider, PostgresLockProvider } from "@agent-diaries/core/postgres";

// Types & Utilities
import { WorkflowState, TaskRecord, normalizeSignature } from "@agent-diaries/core/shared";

// Legacy Storage Adapters
import { SqliteStorage } from "@agent-diaries/core/adapters/sqlite";
```

---

## 🆕 What's New in vNext

> **Highlights**
>
> ✅ Eliminated duplicate execution race in `MemoryStorage` / `MemoryLockProvider`  
> ✅ Added structured benchmark logging (`quiet` → `progress` → `verbose` → `trace`)  
> ✅ Added Chaos Engineering regression testing  
> ✅ Improved Validation Suite observability and scenario coverage  
> ✅ No breaking API changes

---

### Why This Release Matters

The previous release exposed a class of concurrency bug that was invisible under normal workloads but reproducible under chaos conditions. A purpose-built **Chaos Engineering Validation Suite** — running 100 concurrent agents with injected delays, crash simulations, and restart cycles — detected a case where the same task was executed twice by two different workers.

This release fixes that bug at the root, introduces the logging infrastructure needed to observe distributed coordination in production, and adds a permanent regression test suite to prevent this class of issue from silently returning.

---

### 1. Chaos Race Condition Fix

**Affected components:** `MemoryStorage.withLock()`, `MemoryLockProvider.withLock()`

The previous in-memory lock implementation used a TTL-based spin-lock with a hard-coded 10-second lease. Under chaos conditions — injected delays, simulated crashes, slow I/O — the lease could expire while the original holder was still executing inside `fn()`. A second waiter would then observe a stale lock entry, steal ownership, and enter the critical section simultaneously. Both workers would read the diary, find the task absent, claim it, and execute it — producing a duplicate execution.

**Exact failure sequence:**

```
T=0ms     Worker-A  acquires lock   (lease expiresAt = T+10 000ms)
T=0ms     Worker-A  reads diary     → task NOT found → will claim
          ← chaos delay injected (> 10 000ms) →
T=10001ms             lease expires
T=10001ms Worker-B  acquireLock()  → expiresAt < now → steals lock
T=10001ms Worker-B  reads diary    → task STILL not committed → claims it
T=10001ms Worker-B  executes task  ✓
T=~12000ms Worker-A  resumes, commits diary, executes task  ✓
          → duplicate_execution: task executed by Worker-A and Worker-B
```

**Resolution:** Both `withLock()` implementations now use a **chained-Promise FIFO mutex** with no TTL.

```typescript
// Before — TTL spin-lock (unsafe under chaos delays)
const lockTtlMs = 10_000; // ← could expire while fn() still running
while (!acquireLock()) { await sleep(backoff + jitter); }

// After — Promise-queue mutex (no TTL, no polling, no lock theft)
const prev = this.mutexQueues.get(mutexKey) ?? Promise.resolve();
let releaseMutex!: () => void;
const hold = new Promise<void>(resolve => { releaseMutex = resolve; });
this.mutexQueues.set(mutexKey, prev.then(() => hold));
await prev;
try { return await fn(); } finally { releaseMutex(); }
```

**Guarantees provided by the new mutex:**

| Property | Before | After |
|---|---|---|
| Lock theft under long delays | ❌ Possible (TTL expiry) | ✅ Impossible |
| Busy polling | ❌ Yes (spin-wait loop) | ✅ None (event-loop) |
| Exception safety | ⚠️ Partial | ✅ Always releases in `finally` |
| FIFO ordering | ❌ Non-deterministic | ✅ Strict FIFO queue |
| Max execution time | ❌ Bounded by TTL | ✅ Unbounded — no theft |

> **Note:** This change applies **only** to the in-memory providers (`MemoryStorage`, `MemoryLockProvider`). Distributed providers — Redis, PostgreSQL — continue using TTL-based distributed locks with exponential backoff + jitter and lease renewal semantics, which is the correct primitive for cross-process coordination. The two strategies are intentionally different: a Promise queue requires no network round-trips and is optimal for single-process isolation, while a TTL-based lease is required for multi-process correctness across separate runtime environments.

---

### 2. Structured Logging

A new reusable logging framework is available at `@agent-diaries/core` (or `@agent-diaries/core/core`).

**Log levels** (ordered least → most verbose):

| Level | Description |
|---|---|
| `quiet` | Silent — no output |
| `progress` | Scenario milestones and pass/fail results |
| `verbose` | Operational info: task counts, iteration markers, timing |
| `trace` | Full event stream: diary events, lock events, retries, recovery |

**Trace events** emitted in `trace` mode:

```
[Diary  HIT ]  key="task:intel:u917"             ← diary lookup returned existing record
[Diary MISS ]  key="task:intel:u917"             ← diary lookup found no record (new task)
[Lock   ACQ ]  key="diary_agent-1"               ← mutex acquired
[Lock   REL ]  key="diary_agent-1"               ← mutex released
[Task  EXEC ]  key="task:intel:u917"             ← task executed by this worker
[Task  SKIP ]  key="task:intel:u917"             ← task skipped (already claimed)
[RECOVERY   ]  worker="worker-47"                ← recovery cycle triggered
[RETRY      ]  attempt=2                         ← retry after transient failure
```

**Usage:**

```typescript
import { createLogger } from "@agent-diaries/core";

// Create a logger from a CLI flag or environment variable
const log = createLogger(process.env.LOG_LEVEL ?? "progress");

log.progress("Scenario started", { scenario: "chaos", agents: 100 });
log.verbose("Iteration complete", { iteration: 42, executed: 1, skipped: 41 });
log.trace("diary:miss", { key: "task:intel:u917", worker: "worker-47" });
log.trace("lock:acquired", { key: "diary_agent-1" });
log.trace("task:executed", { key: "task:intel:u917" });
log.trace("lock:released", { key: "diary_agent-1" });
```

**Available exports:**

```typescript
import {
  createLogger,      // Factory: maps CLI flag string → Logger
  BenchmarkLogger,   // Full implementation with injectable write sink
  ConsoleLogger,     // Lightweight console-backed implementation
  NullLogger,        // Zero-cost no-op for quiet mode
} from "@agent-diaries/core";

import type { Logger, LogLevel, TraceEventType } from "@agent-diaries/core";
```

Benchmark and coordination code no longer calls `console.log()` directly. All output routes through a `Logger` instance.

---

### 3. Validation Suite

The Validation Suite now covers five production-grade scenarios:

| Scenario | What it tests |
|---|---|
| **Hot Key Contention** | 100+ agents competing for a single high-traffic task key |
| **Race Condition** | High-throughput concurrent claims across 1 000 iterations |
| **Chaos Engineering** | Injected delays, crash simulations, restart cycles — correctness under failure |
| **Agent Recovery** | Stale task recovery after simulated worker crash |
| **Distributed Workers** | Multi-worker task dispatch and deduplication at scale |

Each scenario reports:

```
✔ chaos [PASS]  2.8s  exec 1250  skip 1250  dup% 50
```

- **duration** — wall-clock scenario time
- **executed** — tasks claimed and run
- **skipped** — tasks correctly deduplicated
- **dup%** — duplicate prevention rate
- **pass/fail** — correctness verdict

The suite is designed to detect real correctness failures — not just measure throughput. A scenario fails only if an invariant is violated (e.g. `duplicate_execution`, `inconsistent_count`).

---

### 4. Regression Tests

Dedicated regression tests in `tests/chaos-regression.test.ts` permanently guard against reintroducing the lock-theft class of bug.

**Coverage:**

| Test | What it proves |
|---|---|
| Lock held > 15s — no displacement | Mutex cannot be stolen regardless of delay length |
| FIFO ordering under long delays | Strict queue ordering across 5 holders × 12s each |
| 100 concurrent workers — exactly 1 execution | End-to-end duplicate prevention at swarm scale |
| 1 000 workers × 10 tasks — 1 execution per task | Multi-key correctness at high concurrency |
| Exception releases lock — no deadlock | `finally` block guarantee |
| Multiple exceptions in sequence | Lock remains usable after repeated crashes |
| Crash mid-execution — waiter unblocked | Concurrent waiter is not permanently blocked |
| `AgentDiary` end-to-end — long hold > old TTL | Full diary pipeline correctness under 12s delay |
| `MemoryLockProvider.withLock()` serialization | Same guarantees as `MemoryStorage` |
| `acquireLock`/`releaseLock` TTL API intact | Distributed backend API not regressed |
| Independent lock namespaces | Separate instances do not share mutex state |

---

### Backward Compatibility

This release contains **no breaking changes**.

- All public APIs (`AgentDiary`, `WorkflowCoordinator`, `StorageManager`, all providers) are unchanged.
- The `LockProvider` interface is unchanged — `acquireLock`, `releaseLock`, `renewLease`, `withLock` all retain their signatures.
- The logging module is additive — no existing import paths are modified.
- Existing tests pass without modification.

### Migration Notes

No migration steps are required. Update the package version and the fix is applied automatically:

```bash
npm install @agent-diaries/core@latest
```

If you are building an external validation suite or benchmark runner and want structured logging:

```typescript
// Replace direct console.log() calls
import { createLogger } from "@agent-diaries/core";
const log = createLogger("trace"); // or "progress", "verbose", "quiet"
```

---

## 📄 License

MIT © [swapwarick_n](https://github.com/swapwarick)
