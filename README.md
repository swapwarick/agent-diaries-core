<div align="center">
  <h1>🧠 Agent Diaries Core</h1>
  <p><strong>The lightweight, lock-safe state management & enterprise workflow orchestration platform for AI agents.</strong></p>

[![NPM Version](https://img.shields.io/npm/v/@agent-diaries/core?style=for-the-badge&logo=npm&color=CB3837)](https://www.npmjs.com/package/@agent-diaries/core)
[![NPM Downloads](https://img.shields.io/npm/dm/@agent-diaries/core?style=for-the-badge&logo=npm&color=44CC11)](https://www.npmjs.com/package/@agent-diaries/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Build Status](https://img.shields.io/github/actions/workflow/status/swapwarick/agent-diaries-core/ci.yml?branch=main&style=for-the-badge&logo=github&label=Build)](https://github.com/swapwarick/agent-diaries-core/actions)
[![Test Status](https://img.shields.io/badge/Tests-69%2F69%20Passing-brightgreen?style=for-the-badge&logo=vitest&logoColor=white)](https://github.com/swapwarick/agent-diaries-core/actions)

</div>

<br />

## 📖 Introduction

### What is Agent Diaries?
**Agent Diaries** is a framework-agnostic state management and workflow orchestration framework built for autonomous AI agents and swarm deployments. It equips your agents with a persistent, concurrency-safe "diary" memory, enabling them to remember past actions, prevent infinite execution loops, and coordinate work across distributed worker nodes.

### What Problems Does It Solve?
- **🛑 Infinite Execution Loops:** Prevents agents from repeatedly executing the exact same LLM call or web scraping job when context windows reset or prompts repeat.
- **⚡ Multi-Agent Swarm Race Conditions:** Uses atomic spin-locks to guarantee that when 50+ serverless agents attempt to claim the exact same task simultaneously, exactly **one** agent succeeds while the others safely back off.
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

## 📄 License

MIT © [swapwarick_n](https://github.com/swapwarick)
