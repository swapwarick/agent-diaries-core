<div align="center">
  <h1>🧠 Agent Diaries Core</h1>
  <p><strong>The lightweight, lock-safe memory layer for edge AI agents.</strong></p>

[![NPM Version](https://img.shields.io/npm/v/@agent-diaries/core?style=for-the-badge&logo=npm&color=CB3837)](https://www.npmjs.com/package/@agent-diaries/core)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Cloud Tested](https://img.shields.io/badge/Tested-Cloud%20Ready-success?style=for-the-badge&logo=icloud&logoColor=white)](#-200-agent-real-world-cloud-benchmarks)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![Coverage](https://img.shields.io/badge/coverage-92.68%25-brightgreen)](https://github.com/swapwarick/agent-diaries-core#readme)

</div>

<br />

**Agent Diaries** is a framework-agnostic state management library designed specifically for autonomous AI agents. It gives your agents a persistent "diary" memory, allowing them to remember past actions, avoid infinite loops, and share context across highly concurrent swarm deployments.

---

## ✨ Features

- **🚫 Deduplication & Loop Prevention:** Automatically filter out tasks your agent has already seen.
- **🔒 Fully Lock-Safe:** Uses atomic spin-locks to completely eliminate race conditions, even with 50+ concurrent agents processing the exact same task simultaneously.
- **☁️ Cloud-Native Adapters:** Official adapters for **Redis**, **MongoDB**, **PostgreSQL**, **SQLite**, and in-memory storage.
- **📋 Task Lifecycle Tracking:** Tasks now carry a `status` field — `"pending"`, `"done"`, or `"failed"` — for richer observability and retry logic.
- **⚡ Batch Operations:** Claim hundreds of tasks in a single atomic lock with `batchClaimTasks()`.
- **📊 Built-in Diagnostics:** `getStats()` returns live agent health metrics for monitoring dashboards.
- **🔁 Export / Import:** Snapshot and restore agent state across environments with `exportHistory()` / `importHistory()`.
- **🪝 Expiry Hooks:** React to task expiration events via the `onTaskExpired` callback.
- **🔑 Custom Hashing:** Override the task signature function with your own `hashFn` for domain-specific deduplication.
- **⚡ Ultra-Lightweight:** Negligible bundle size, zero heavy runtime dependencies.

---

## 📦 Installation

Install the core package:

```bash
npm install @agent-diaries/core
```

If you plan to use a specific storage adapter, install its peer dependency:

```bash
npm install better-sqlite3 # For SQLite Storage
npm install ioredis        # For Redis Storage
npm install mongodb        # For MongoDB Storage
npm install pg             # For PostgreSQL / Supabase / Neon Storage
```

---

## 🚀 Quick Start

Initialize an `AgentDiary` and wrap your LLM calls to prevent duplicate executions.

```typescript
import { AgentDiary } from "@agent-diaries/core";

async function runAgent() {
  const diary = new AgentDiary({ agentId: "data-collector" });
  const currentTask = "Download Q3 Financial Report";

  // 1. claimTask is ATOMIC. It acquires a distributed lock and registers the task.
  // If two agents try to claim it at the exact same millisecond, only ONE succeeds.
  const isNew = await diary.claimTask(currentTask);

  if (!isNew) {
    const pastResult = await diary.getTaskResult(currentTask);
    console.log(`[Agent] ⏩ Skipping task. Result: ${pastResult}`);
    return pastResult;
  }

  // 2. Execute your expensive LLM logic safely
  console.log(`[Agent] ⚙️ Executing: "${currentTask}"...`);
  const result = "Found 2 warnings, no critical errors.";

  // 3. Update the pending task with the final result
  await diary.writeTaskResult(currentTask, result);
  console.log(`[Agent] ✅ Task complete. Diary updated!`);
  return result;
}

runAgent();
```

### Forcefully Re-running a Task (The Engineering Trick)

If you want an agent to strictly avoid duplicate work, use `await diary.claimTask(task)`. It will automatically return `false` if it was done.

But if an agent wants to explicitly overwrite or re-do a task because the user demanded it, you skip `claimTask()` entirely and just write the final result using `await diary.writeTaskResult(task, newResult)`. This seamlessly replaces the old memory with the new one.

```text
🤖 Agent Alice: Claiming and performing 'Generate Monthly Report'...
   -> Task done! Saving result.
--------------------------------------------------
🤖 Agent Bob: Checking if 'Generate Monthly Report' is done...
   -> 🛑 Found in Diary! Previous result: "Report for May: $12,000 Revenue."
   -> 💬 Informs User: "This report was already generated. Do you want me to re-run it with the latest data?"
   -> 👤 User responds: YES
   -> Agent Bob forcefully re-running the task...
```

```typescript
// 1. Check if it's already done (for logging/informing user)
if (await diary.hasProcessedTask(currentTask)) {
  console.log(
    "Task is already done. Forcefully re-running per user request...",
  );
}

// 2. Perform the work again
const updatedResult = "Found 0 warnings, ALL critical errors resolved.";

// 3. Skip claimTask() and directly overwrite the old memory
await diary.writeTaskResult(currentTask, updatedResult);
```

---

## 🗄️ Storage Adapters (Cloud & Local Databases)

Local file storage is great for local development, but serverless environments (Vercel, AWS Lambda) have ephemeral filesystems and require lock-safe cloud adapters, while local tools and desktops benefit from relational SQLite coordination.

### SQLite (Best for Desktop / Local Apps)

The `SqliteStorage` adapter uses a local SQLite database (`better-sqlite3`) with atomic UNIQUE constraint insertions and transactional TTL locks for highly reliable multi-process coordination.

```typescript
import { AgentDiary } from "@agent-diaries/core";
import { SqliteStorage } from "@agent-diaries/core/dist/adapters/sqlite";
import Database from "better-sqlite3";

const db = new Database("diary.db");
const diary = new AgentDiary({
  agentId: "sqlite-bot",
  storage: new SqliteStorage({ db }),
});
```

### Redis (Best for Serverless / Swarms)

The `RedisStorage` adapter uses atomic `SETNX` distributed spin-locks to guarantee race-condition safety across thousands of concurrent Vercel Edge functions.

The optional `globalTtlMs` option sets an expiry on the diary state blob in Redis, preventing orphaned keys from accumulating indefinitely.

```typescript
import { AgentDiary } from "@agent-diaries/core";
import { RedisStorage } from "@agent-diaries/core/dist/adapters/redis";
import Redis from "ioredis";

const diary = new AgentDiary({
  agentId: "cloud-bot",
  storage: new RedisStorage({
    redis: new Redis(process.env.REDIS_URL),
    globalTtlMs: 30 * 24 * 60 * 60 * 1000, // Optional: expire diary blobs after 30 days
  }),
});
```

### MongoDB (Best for Document Scaling)

The `MongoStorage` adapter natively uses atomic `_id` unique insertion constraints to guarantee row-level safety during concurrent task evaluation, with built-in TTL lock expiration.

```typescript
import { AgentDiary } from "@agent-diaries/core";
import { MongoStorage } from "@agent-diaries/core/dist/adapters/mongo";
import { MongoClient } from "mongodb";

const client = new MongoClient(process.env.MONGO_URI);
await client.connect();
const collection = client.db("agent_diaries").collection("tasks");

const diary = new AgentDiary({
  agentId: "db-bot",
  storage: new MongoStorage({ collection }),
});
```

### PostgreSQL / Supabase / Neon (Best for Managed SQL)

The `PostgresStorage` adapter uses a lock table with atomic `INSERT` + conflict detection, an indexed `locked_at` column for TTL-based lock stealing, and `lock_id`-safe release. It works with any managed Postgres provider — Supabase, Neon, Railway, AWS RDS, etc. Tables and indexes are created automatically on first use.

```typescript
import { AgentDiary } from "@agent-diaries/core";
import { PostgresStorage } from "@agent-diaries/core/dist/adapters/postgres";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const diary = new AgentDiary({
  agentId: "pg-bot",
  storage: new PostgresStorage({ pool }),
});
```

### Memory (Best for Prototyping / Testing)

The `MemoryStorage` adapter stores tasks and locks fully in memory. It is ideal for fast, isolated unit testing and temporary agent deployments without configuring database instances or writing files.

Each `MemoryStorage` instance maintains its own completely independent store — no shared state between instances.

```typescript
import { AgentDiary, MemoryStorage } from "@agent-diaries/core";

const diary = new AgentDiary({
  agentId: "test-bot",
  storage: new MemoryStorage(),
});
```

---

## ⏱️ Task Expiration (TTL)

You can specify a Time-to-Live (TTL) for tasks. Once the TTL expires, the task is treated as unprocessed/new, allowing the agent to automatically reclaim and execute it again.

This can be configured globally or overridden on a per-task basis:

```typescript
// 1. Configure default TTL globally (e.g., 24 hours)
const diary = new AgentDiary({
  agentId: "data-collector",
  defaultTtlMs: 24 * 60 * 60 * 1000,
});

// 2. Override TTL on claimTask
const claimed = await diary.claimTask("Update report", { ttlMs: 60 * 1000 }); // 1 minute

// 3. Override/assign TTL on writeTaskResult
await diary.writeTaskResult("Update report", "Success result", {
  ttlMs: 10 * 60 * 1000,
});
```

---

## 📋 Task Lifecycle & Status Tracking _(New in v1.2.0)_

Every `TaskRecord` now includes a `status` field that tracks the task through its full lifecycle:

| Status | Set By | Meaning |
|--------|--------|---------|
| `"pending"` | `claimTask()` / `batchClaimTasks()` | Task is claimed but the result hasn't been written yet |
| `"done"` | `writeTaskResult()` | Task completed successfully |
| `"failed"` | `failTask()` | Task failed; optional `failReason` is available |

```typescript
// Claim a task (status → "pending")
await diary.claimTask("Analyze report");

try {
  const result = await runExpensiveLLMCall();
  // Mark as done with result (status → "done")
  await diary.writeTaskResult("Analyze report", result);
} catch (err) {
  // Explicitly mark as failed with reason (status → "failed")
  await diary.failTask("Analyze report", err.message);
}

// Read the status back
const state = await diary.readDiary();
console.log(state.history[0].status);     // "failed"
console.log(state.history[0].failReason); // "network timeout"
```

---

## ⚡ Batch Claiming _(New in v1.2.0)_

Instead of calling `claimTask()` in a loop (N lock acquisitions), `batchClaimTasks()` claims all new tasks atomically inside a single lock. This drastically reduces round-trips to Redis/MongoDB/SQLite for batch workloads.

```typescript
const incomingTasks = [
  "Scrape AAPL stock data",
  "Scrape GOOGL stock data",
  "Scrape TSLA stock data",
  "Generate summary report",
];

// One lock acquisition instead of four
const claimed = await diary.batchClaimTasks(incomingTasks);
console.log(claimed);
// → ["Scrape AAPL stock data", "Scrape TSLA stock data", "Generate summary report"]
// (GOOGL was already done — silently skipped)

// Process only the claimed tasks
for (const title of claimed) {
  const result = await scrapeData(title);
  await diary.writeTaskResult(title, result);
}
```

---

## 📊 Agent Health Diagnostics _(New in v1.2.0)_

`getStats()` returns a live diagnostic summary of the agent's diary state. Expired tasks are automatically excluded from all counts.

```typescript
const stats = await diary.getStats();
console.log(stats);
// {
//   agentId:      "data-collector",
//   runCount:     142,
//   historyCount: 38,    // active (non-expired) records
//   pendingCount: 3,
//   doneCount:    31,
//   failedCount:  4,
//   lastRunAt:    1750000000000,
//   oldestTaskAt: 1749990000000
// }
```

---

## 📤 Export & Import History _(New in v1.2.0)_

Snapshot and restore agent state for backups, migrations, or cross-agent context sharing.

```typescript
// Export the full diary state
const snapshot = await diaryA.exportHistory();

// Restore into another agent (replaces existing state)
await diaryB.importHistory(snapshot);

// Or merge — adds only tasks not already in diaryB, without overwriting existing ones
await diaryB.importHistory(snapshot, { merge: true });
```

---

## 🧹 Pruning Expired Tasks _(New in v1.2.0)_

`pruneExpiredTasks()` atomically removes all expired records from history and returns them. Pair it with the `onTaskExpired` hook for automated re-queuing or audit logging.

```typescript
const diary = new AgentDiary({
  agentId: "data-collector",
  defaultTtlMs: 60 * 60 * 1000, // 1 hour
  onTaskExpired: async (record) => {
    // Called for every expired record during claimTask(), batchClaimTasks(), or pruneExpiredTasks()
    console.log(`Task expired: ${record.title} (status: ${record.status})`);
    await requeueTask(record.title); // re-add to your work queue
  },
});

// Run on a schedule (e.g., every hour) to keep history clean
const pruned = await diary.pruneExpiredTasks();
console.log(`Pruned ${pruned.length} expired tasks.`);
```

---

## 🔑 Custom Task Hashing _(New in v1.2.0)_

By default, tasks are deduplicated by lowercasing and trimming the title string. You can replace this with any function via `hashFn` — useful for structured task IDs, semantic deduplication, or domain-specific normalization.

```typescript
// Example: use the task's unique ID field as the deduplication key
const diary = new AgentDiary({
  agentId: "structured-bot",
  hashFn: (title) => title.split(":")[0].trim(), // use prefix as key
});

// "job:abc123" and "job:xyz789" share the prefix "job" → treated as duplicates
await diary.claimTask("job:abc123");
const isDup = await diary.claimTask("job:xyz789");
console.log(isDup); // false — same hash "job"
```

---

## 📊 Enterprise Concurrency Benchmarks

Agent Diaries Core is mathematically proven to handle massive concurrent agent swarms without race conditions or database corruption.

### 1. Multi-Process OS-Level Concurrency (Worker Threads)

To verify true operating-system level process isolation, we spawned 50 independent Node.js `worker_threads` to aggressively hit the cloud databases at the exact same millisecond.

```text
🌪️ Spawning 50 Multi-Process Workers for REDIS...
   Expected Locks: 1
   Actual Locks:   1
   Resolution Time: ~4300ms
   🟢 PASSED (49 race conditions prevented across OS processes)

🌪️ Spawning 50 Multi-Process Workers for MONGO...
   Expected Locks: 1
   Actual Locks:   1
   Resolution Time: 8192ms
   🟢 PASSED (49 race conditions prevented across OS processes)
```

### 2. 200-Agent Real-World Cloud Scale

To prove its viability for global serverless deployments, we rigorously stress-tested the library against live instances, blasting them with **200 serverless agents** executing distributed lock requests across the internet simultaneously.

#### The Real-Life Architecture

```typescript
const NUM_AGENTS = 200;
let agents = Array.from({ length: NUM_AGENTS }, () => getDiary());
const viralTask = `Analyze breaking news: OpenAI releases GPT-5 - ${Date.now()}`;

// Fire 200 distributed agents at the exact same millisecond
let results = await Promise.all(
  agents.map((agent) => agent.claimTask(viralTask).catch(() => false)),
);

let successful = results.filter((r) => r === true).length;
console.log(`   Actual Locks: ${successful}`); // Always exactly 1.
```

### The Results (Zero Race Conditions)

> _Tested via WAN connection to an Upstash Serverless Redis instance and a Free Tier MongoDB Atlas Cluster_

```text
=================================
🌪️ INITIALIZING 200-AGENT SWARM: Upstash Redis (Cloud)
=================================
[Test 1] The Herd Effect: 200 Agents competing for exactly ONE viral task...
   Expected Locks: 1
   Actual Locks:   1
   Resolution Time: 13254ms
   🟢 PASSED (199 race conditions prevented)

[Test 2] Real World Distribution: 200 Agents processing 10 common data tasks...
   Expected Locks: 10
   Actual Locks:   10
   Resolution Time: 12828ms
   🟢 PASSED (190 duplicate LLM calls prevented)

[Test 3] Extreme Write Contention: 200 Agents blasting state updates at the exact same time...
   Expected Written: 200
   Actual Written:   200
   Write Duration:   16267ms
   🟢 PASSED (Zero data corruption)

=================================
🌪️ INITIALIZING 200-AGENT SWARM: MongoDB Atlas (Cloud Free Tier)
=================================
[Test 1] The Herd Effect: 200 Agents competing for exactly ONE viral task...
   Expected Locks: 1
   Actual Locks:   1
   Resolution Time: 7362ms
   🟢 PASSED (199 race conditions prevented)

[Test 2] Real World Distribution: 200 Agents processing 10 common data tasks...
   Expected Locks: 10
   Actual Locks:   10
   Resolution Time: 5545ms
   🟢 PASSED (190 duplicate LLM calls prevented)

[Test 3] Extreme Write Contention: 200 Agents blasting state updates at the exact same time...
   Expected Written: 200
   Actual Written:   200
   Write Duration:   9410ms
   🟢 PASSED (Zero data corruption)
```

**💡 Engineering Insight:** While SQL databases perform well on local network environments, relational connection poolers (like pgBouncer or Supavisor) completely buckle under the massive concurrent TCP bursts generated by serverless AI swarms. **Redis or MongoDB (via atomic upserts)** are strictly required for reliable lock management in high-concurrency serverless edge environments.

---

## 📚 API Reference

### Constructor

**`new AgentDiary(options: AgentDiaryOptions)`**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `agentId` | `string` | _(required)_ | Unique identifier for this agent |
| `storage` | `StorageAdapter` | `LocalFileStorage` | Storage backend to use |
| `maxHistory` | `number` | `500` | Max task records to retain in history |
| `defaultTtlMs` | `number` | `undefined` | Default TTL (ms) for all claimed tasks |
| `hashFn` | `(title: string) => string` | `normalizeSignature` | Custom task signature function _(v1.2.0)_ |
| `onTaskExpired` | `(record: TaskRecord) => void \| Promise<void>` | `undefined` | Callback fired on task expiry _(v1.2.0)_ |

---

### Core Methods

- **`diary.claimTask(title: string, options?: { ttlMs?: number }): Promise<boolean>`**
  Atomically checks if a task has been processed. If not (or if expired), acquires a lock and claims it with `status: "pending"`. Returns `true` if successfully claimed, `false` otherwise.

- **`diary.batchClaimTasks(titles: string[], options?: { ttlMs?: number }): Promise<string[]>`** _(v1.2.0)_
  Atomically claims multiple tasks in a **single lock acquisition**. Returns the array of titles that were successfully claimed. Tasks already processed (and not expired) are silently skipped.

- **`diary.writeTaskResult(title: string, result?: string, options?: { ttlMs?: number }): Promise<void>`**
  Saves the final result of a task and sets `status: "done"`. Throws if `claimTask()` was never called first.

- **`diary.failTask(title: string, reason?: string): Promise<void>`** _(v1.2.0)_
  Marks a previously claimed task as `status: "failed"` with an optional `failReason` string. Throws if `claimTask()` was never called first.

- **`diary.hasProcessedTask(title: string): Promise<boolean>`**
  Returns `true` if the task exists in history and has not expired.
  _⚠️ Non-atomic snapshot. Follow with `claimTask()` in concurrent environments._

- **`diary.getTaskResult(title: string): Promise<string | undefined>`**
  Returns the stored result string, or `undefined` if the task doesn't exist or has expired.
  _⚠️ Non-atomic snapshot. Follow with `claimTask()` in concurrent environments._

- **`diary.filterNewTasks<T extends { title: string }>(tasks: T[]): Promise<T[]>`**
  Returns the subset of tasks that are new or expired.
  _⚠️ Non-atomic snapshot. Always follow with `claimTask()` before acting on results._

---

### Query Methods

- **`diary.getTasksCompletedSince(timestamp: number): Promise<TaskRecord[]>`**
  Returns completed, unexpired tasks with `timestamp >= timestamp`.

- **`diary.findTasksByKeyword(keyword: string): Promise<TaskRecord[]>`**
  Case-insensitive substring search across task titles and results, excluding expired tasks.

- **`diary.getStats(): Promise<AgentStats>`** _(v1.2.0)_
  Returns a diagnostic summary: `agentId`, `runCount`, `historyCount`, `pendingCount`, `doneCount`, `failedCount`, `lastRunAt`, `oldestTaskAt`.

---

### Management Methods

- **`diary.deleteTask(title: string): Promise<boolean>`**
  Removes a task record from history. Returns `true` if deleted, `false` if not found.

- **`diary.pruneExpiredTasks(): Promise<TaskRecord[]>`** _(v1.2.0)_
  Atomically removes all expired task records from history. Fires `onTaskExpired` for each. Returns the list of evicted records.

- **`diary.exportHistory(): Promise<AgentState>`** _(v1.2.0)_
  Exports the full agent state as a plain serializable object.

- **`diary.importHistory(snapshot: AgentState, options?: { merge?: boolean }): Promise<void>`** _(v1.2.0)_
  Imports a snapshot. Pass `merge: true` to combine with existing state instead of replacing it.

- **`diary.clearHistory(): Promise<void>`**
  Empties all task history and signatures for this agent.

- **`diary.readDiary(): Promise<AgentState>`**
  Reads the raw state object without locking. Useful for debugging.
  _⚠️ Non-atomic — do not rely on this in high-concurrency flows._

- **`AgentDiary.normalizeSignature(title: string): string`** _(static)_
  The default signature function: lowercases, trims, and collapses whitespace.

---

## 🗓️ Version History

### v1.2.0 — 2026-06-26

**New Features**
- `status` field on `TaskRecord` — `"pending"` | `"done"` | `"failed"` + optional `failReason`
- `diary.failTask(title, reason?)` — atomically mark a claimed task as failed
- `diary.batchClaimTasks(titles[])` — claim N tasks in one lock (huge performance win for swarms)
- `diary.getStats()` — live agent health diagnostics (pending/done/failed counts)
- `diary.exportHistory()` / `diary.importHistory()` — state backup, restore, and cross-agent sync
- `diary.pruneExpiredTasks()` — manual cleanup with `onTaskExpired` callback support
- `onTaskExpired` callback option — fires on any task expiry across `claimTask`, `batchClaimTasks`, and `pruneExpiredTasks`
- `hashFn` option — plug in a custom task signature function
- **PostgreSQL / Supabase / Neon adapter** (`PostgresStorage`) — lock table with atomic INSERT, lock-id-safe release, lazy table init
- `RedisStorage.globalTtlMs` option — prevent unbounded Redis key growth

**Bug Fixes**
- `MemoryStorage` fields made instance-level (was `static` — caused cross-instance state pollution)
- `writeTaskResult` now captures a single `Date.now()` for both `timestamp` and `lastRun`
- Added ⚠️ non-atomic warnings to `hasProcessedTask()` and `getTaskResult()` JSDoc
- Added SQLite index on `locked_at` for faster TTL expiry scans

### v1.1.6 — 2026-06-10

- `MemoryStorage` adapter for prototyping and unit testing
- Task TTL (`defaultTtlMs`, per-task `ttlMs` on `claimTask` / `writeTaskResult`)
- `diary.deleteTask()`, `diary.getTasksCompletedSince()`, `diary.findTasksByKeyword()`, `diary.clearHistory()`
- SQL injection protection on `SqliteStorage` table names
- Multi-process worker fixture fix (`claim-worker.cjs` + `dist/package.json`)

---

## 📄 License

This project is licensed under the MIT License.
