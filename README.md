<div align="center">
  <h1>🧠 Agent Diaries Core</h1>
  <p><strong>The Distributed Coordination Layer for Multi-Agent Systems.</strong></p>
  <p>Stop agents from repeating identical work. Coordinate concurrent execution. Record history that survives restarts.</p>

[![NPM Version](https://img.shields.io/npm/v/@agent-diaries/core?style=for-the-badge&logo=npm&color=CB3837)](https://www.npmjs.com/package/@agent-diaries/core)
[![NPM Downloads](https://img.shields.io/npm/dm/@agent-diaries/core?style=for-the-badge&logo=npm&color=44CC11)](https://www.npmjs.com/package/@agent-diaries/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Build Status](https://img.shields.io/github/actions/workflow/status/swapwarick/agent-diaries-core/codecov.yml?branch=main&style=for-the-badge&logo=github&label=Build)](https://github.com/swapwarick/agent-diaries-core/actions)
[![Test Status](https://img.shields.io/badge/Tests-69%2F69%20Passing-brightgreen?style=for-the-badge&logo=vitest&logoColor=white)](https://github.com/swapwarick/agent-diaries-core/actions)

</div>

<br />

## The Problem

When you run 50 agents in parallel, they ask the same question:

> **"Should I execute this task — or has another agent already done it?"**

Without a coordination layer, each agent answers independently. The same LLM call fires 50 times. The same web scrape runs 50 times. Costs multiply. Results conflict.

**Agent Diaries** is the answer to that question. It gives every agent in your swarm a shared, distributed source of truth: a coordination layer that guarantees exactly-once execution across any number of concurrent workers.

```
Agent
  ↓
Should I execute?
  ↓
Coordination lookup          ← "Has anyone claimed this task?"
  ↓
Atomic claim                 ← Exactly one agent wins. All others back off.
  ↓
Exactly-once execution       ← Your logic runs once, ever.
  ↓
Execution record stored      ← All future agents read the cached result.
```

---

## 📖 What Is Agent Diaries?

**Agent Diaries Core** is a framework-agnostic **distributed execution coordination library** for autonomous AI agent swarms. It answers three questions that every production multi-agent system eventually has to solve:

1. **Has this work been done before?** — Signature-based deduplication with sub-millisecond lookup.
2. **Who is doing it right now?** — Atomic distributed claims with provider-appropriate locking (Promise-FIFO for in-process, TTL+backoff for cross-process).
3. **What was the result?** — Persistent execution records that survive process restarts, context window resets, and agent crashes.

### Core Concepts

Agent Diaries uses four precise terms. No more, no less.

| Term | What it means |
|---|---|
| **Claim** | An atomic operation that lets exactly one agent "own" a task. All competitors back off immediately. |
| **Execution Record** | The persistent result of a claimed task. Stored in your chosen backend. Reused by all future agents. |
| **Coordination** | The full pipeline: claim → execute → record. Guaranteed to run exactly once per unique task signature. |
| **Worker** | Any autonomous process (agent, node, thread) participating in the swarm. |

---

## 🚀 Quick Start — The Three-Step Model

Every interaction with Agent Diaries follows the same pattern:

```typescript
import { AgentDiary } from "@agent-diaries/core";

const diary = new AgentDiary({ agentId: "researcher-01" });

// Step 1 — CLAIM: Atomic. Only one agent wins.
const claimed = await diary.claimTask("analyze:Q3-earnings-report");

if (!claimed) {
  // Step 2 (skip path) — READ the cached result from the agent that won.
  const existing = await diary.getTaskResult("analyze:Q3-earnings-report");
  return existing;
}

// Step 2 (execute path) — Your logic runs exactly once across the entire swarm.
const result = await runLLMAnalysis("Q3-earnings-report.pdf");

// Step 3 — RECORD: Persist the result. All future agents will skip directly to it.
await diary.writeTaskResult("analyze:Q3-earnings-report", result);
return result;
```

> **That's it.** `claimTask` → `execute` → `writeTaskResult`. The entire coordination contract is three calls.

---

## 🔥 Killer Use Case — 100 Agents, Zero Duplicate Work

Imagine 100 agents simultaneously researching the same set of 20 GitHub repositories for security vulnerabilities.

Without coordination, each of the 100 agents would independently call the GitHub API, run the LLM analysis, and produce 100 identical reports — wasting 99% of compute and API budget.

With Agent Diaries:

```typescript
import { AgentDiary } from "@agent-diaries/core";

// Each of the 100 agents runs this same function
async function analyzeRepo(repoSlug: string, agentId: string) {
  const diary = new AgentDiary({ agentId });

  // CLAIM — atomic across all 100 agents
  const claimed = await diary.claimTask(`github:security-scan:${repoSlug}`);

  if (!claimed) {
    // 99 agents hit this path — instant return, zero API calls
    return diary.getTaskResult(`github:security-scan:${repoSlug}`);
  }

  // Only ONE agent reaches here per repo
  console.log(`[${agentId}] Scanning ${repoSlug}...`);
  const findings = await runSecurityScan(repoSlug);   // GitHub API + LLM

  await diary.writeTaskResult(`github:security-scan:${repoSlug}`, findings);
  return findings;
}

// Launch all 100 agents concurrently
const agents = Array.from({ length: 100 }, (_, i) => `agent-${i}`);
const repos  = ["org/repo-a", "org/repo-b", /* ...18 more */ ];

await Promise.all(
  agents.flatMap(agentId => repos.map(repo => analyzeRepo(repo, agentId)))
);

// Result: 20 scans executed (1 per repo). 1980 calls skipped. Finished 3× faster.
```

**What just happened:**
- 2000 total calls attempted (`100 agents × 20 repos`)
- **20 executions** — exactly one per unique repo, regardless of concurrency
- **1980 skips** — instant cache returns, no API calls, no LLM spend
- Zero coordination code in your business logic — `claimTask` handles all of it

---

## 🏛️ Architecture

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
                       │ CacheProvider │ LockProvider │ Persist │
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

## ❓ Why Not Redis / Temporal / LangGraph / CrewAI?

This is the right question to ask. Here's the honest answer:

| | Redis | Temporal | LangGraph | CrewAI | **Agent Diaries** |
|---|---|---|---|---|---|
| **Distributed locking** | ✅ Manual `SET NX` | ✅ Activity locks | ❌ | ❌ | ✅ Built-in, automatic |
| **Exactly-once execution** | ❌ DIY | ✅ Durable workflows | ❌ | ❌ | ✅ Built-in, one call |
| **Deduplication by signature** | ❌ DIY | ❌ DIY | ❌ | ❌ | ✅ Native |
| **Framework agnostic** | ✅ | ✅ | ❌ LangChain-tied | ❌ | ✅ |
| **Zero required infrastructure** | ❌ Needs Redis | ❌ Needs Temporal server | ❌ | ❌ | ✅ In-memory by default |
| **Swarm-scale coordination** | ❌ App-layer only | ✅ | ⚠️ Limited | ✅ | ✅ |
| **Execution history** | ❌ TTL-only | ✅ | ⚠️ In-memory | ❌ | ✅ Persistent records |
| **Drop-in for existing agents** | ❌ | ❌ Requires rewrite | ❌ | ❌ | ✅ 3 API calls |

**The key distinction:**

- **Redis** gives you primitives. You still write all the coordination logic yourself.
- **Temporal** gives you durable workflows but requires adopting its entire execution model and running a Temporal server.
- **LangGraph/CrewAI** are orchestration frameworks — you build *inside* them. Agent Diaries is a coordination *layer* you add *to* any existing system.

Agent Diaries is the answer to: *"I already have agents. I need them to stop duplicating work — without rewriting everything."*

---

## ✨ Features

- **🔄 Workflow Orchestration:** End-to-end multi-agent workflow submission, atomic worker claims, execution coordination, and state transitions.
- **🔎 Signature-Based Deduplication:** Deduplicate expensive web research, scraping, or LLM calls by caching results against a content-derived hash.
- **☁️ Distributed-Ready Storage:** Decoupled `StorageManager` providing unified interfaces for caching (`CacheProvider`), distributed locking (`LockProvider`), and durable storage (`PersistenceProvider`).
- **🚦 Workflow Lifecycle State Machine:** Enforces valid status transitions (`CREATED` → `QUEUED` → `CLAIMED` → `RUNNING` → `COMPLETED` / `FAILED` / `CANCELLED` / `EXPIRED`).
- **📡 Strongly-Typed Event Bus:** Decoupled pub-sub `EventBus` emitting domain events (`WorkflowCreated`, `WorkflowCompleted`, `DiaryUpdated`, `TraceRecorded`) for real-time observability.
- **👷 Worker Heartbeat Registry:** Track active worker nodes, PIDs, hostnames, and heartbeats with automated stale worker pruning.
- **🔌 Modular Plugin Framework:** Register custom storage, search, metrics, and tracing plugins via `PluginRegistry`.
- **📊 Real-Time Metrics & Timelines:** Automated metrics aggregation (counts, latencies, success rates) and sequenced audit log trails.
- **🔭 Distributed Tracing:** OpenTelemetry-style trace recording and span tracking across multi-step agent pipelines.

---

## 📦 Installation

```bash
npm install @agent-diaries/core
```

Optional peer dependencies for database storage adapters:

```bash
npm install better-sqlite3 # For SQLite storage
npm install ioredis        # For Redis distributed coordination
npm install mongodb        # For MongoDB storage
npm install pg             # For PostgreSQL durable storage
```

> **Zero required dependencies.** The in-memory backend works out of the box. Add Redis or PostgreSQL only when you need cross-process or cross-machine coordination.

---

## 🏛️ Advanced Workflow Orchestration

For enterprise swarm coordination, use `WorkflowCoordinator` and `WorkflowRepository` directly:

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

// 1. Initialize storage (swap for Redis/Postgres in production)
const storageManager = new StorageManager();

// 2. Initialize repositories
const workflowRepo  = new WorkflowRepository(storageManager, defaultEventBus);
const diaryRepo     = new DiaryRepository(storageManager, defaultEventBus);
const traceRepo     = new TraceRepository(storageManager, defaultEventBus);
const timelineRepo  = new TimelineRepository(storageManager);
const metricsRepo   = new MetricsRepository(storageManager);
const providerRepo  = new ProviderRepository(defaultEventBus);

// 3. Initialize coordinator
const coordinator = new WorkflowCoordinator(
  workflowRepo,
  diaryRepo,
  traceRepo,
  timelineRepo,
  metricsRepo,
  providerRepo,
);

async function runSwarmWorkflow() {
  // Submit with signature — duplicate submissions are rejected automatically
  const wf = await coordinator.submitWorkflow("Sync Customer Accounts", { batchSize: 50 }, {
    signature: "sync-cust-accounts-batch-50",
  });

  // Execute under atomic worker claim — exactly one worker runs the body
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
// Core entry point (all exports)
import { AgentDiary, WorkflowCoordinator } from "@agent-diaries/core";

// Domain & framework core
import { StorageManager, WorkflowStateMachine, EventBus } from "@agent-diaries/core/core";

// Memory & local storage
import { MemoryCacheProvider, MemoryLockProvider, LocalFileStorage } from "@agent-diaries/core/memory";

// Distributed Redis hooks
import { RedisCacheProvider, RedisLockProvider } from "@agent-diaries/core/redis";

// Durable PostgreSQL hooks
import { PostgresPersistenceProvider, PostgresLockProvider } from "@agent-diaries/core/postgres";

// Types & utilities
import { WorkflowState, TaskRecord, normalizeSignature } from "@agent-diaries/core/shared";

// Legacy storage adapters
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
[Diary  HIT ]  key="task:intel:u917"             ← execution record found — skip
[Diary MISS ]  key="task:intel:u917"             ← no record — will claim
[Lock   ACQ ]  key="diary_agent-1"               ← claim acquired
[Lock   REL ]  key="diary_agent-1"               ← claim released
[Task  EXEC ]  key="task:intel:u917"             ← task executed by this worker
[Task  SKIP ]  key="task:intel:u917"             ← task skipped (already claimed)
[RECOVERY   ]  worker="worker-47"                ← recovery cycle triggered
[RETRY      ]  attempt=2                         ← retry after transient failure
```

**Usage:**

```typescript
import { createLogger } from "@agent-diaries/core";

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
| `AgentDiary` end-to-end — long hold > old TTL | Full coordination pipeline correctness under 12s delay |
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
