<div align="center">
  <h1>🧠 Agent Diaries Core</h1>
  <p><strong>Stop AI agents from doing the same work twice.</strong></p>
  <p>One function call. Any agent framework. Exactly-once execution across your entire swarm.</p>

[![NPM Version](https://img.shields.io/npm/v/@agent-diaries/core?style=for-the-badge&logo=npm&color=CB3837)](https://www.npmjs.com/package/@agent-diaries/core)
[![NPM Downloads](https://img.shields.io/npm/dm/@agent-diaries/core?style=for-the-badge&logo=npm&color=44CC11)](https://www.npmjs.com/package/@agent-diaries/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/Tests-224%2F224%20Passing-brightgreen?style=for-the-badge&logo=vitest&logoColor=white)](https://github.com/swapwarick/agent-diaries-core/actions)

</div>

---

## 🛑 The Problem

Autonomous agents duplicate work when scaling up.

When 50 agents run concurrently, they repeatedly fetch identical web pages, execute redundant LLM reasoning, and trigger duplicate API calls.

- **Token & API Bloat:** You pay 50× the cost for 1× the result.
- **Swarm Race Conditions:** Multiple agents attempt to process or mutate the same task at once.
- **Memory Growth & OOM Risk:** Unbounded in-memory caches grow indefinitely as swarms run 24/7.
- **Framework Blindness:** Frameworks like LangChain, AutoGen, CrewAI, or LlamaIndex lack cross-process coordination out of the box.

---

## ⚡ The Solution

**Agent Diaries** is a lightweight, framework-agnostic coordination layer that guarantees **exactly-once execution** for your AI agents.

### Core Benefits

- 🎯 **Exactly-Once Execution:** Guarantee tasks execute only once, no matter how many agents attempt them concurrently.
- 🌐 **Distributed Coordination:** Safely coordinate agents across processes, worker nodes, or serverless functions with zero-polling FIFO mutexes.
- 🚫 **Duplicate Prevention:** Intercept and deduplicate identical LLM calls, web scrapes, and API requests before they happen.
- 🚀 **Multi-Tiered LRU Caching:** Automatic bounded in-memory L1 cache with configurable eviction prevents memory bloat and delivers sub-millisecond lookups.
- 📦 **Binary Serialization:** Built-in MessagePack encoding for compact network transmission and fast disk/DB persistence.
- 💾 **Persistent History:** Store execution records in-memory, Redis, PostgreSQL, MongoDB, or SQLite so past work survives restarts.
- 🦜 **LangChain Integration:** Drop-in LLM response caching, exactly-once tool execution, and observability for LangChain swarms.

---

## 🚀 30-Second Quick Start

### Installation

```bash
npm install @agent-diaries/core
```

Zero required setup or external database drivers. Works in-memory out of the box.

---

## 💡 One Memorable Code Example

Wrap any expensive agent operation in `executeOnce()`.

```typescript
import { AgentDiary } from "@agent-diaries/core";

const diary = new AgentDiary({ agentId: "research-agent" });

// 100 agents call executeOnce() concurrently.
// Exactly 1 agent executes the LLM call. The remaining 99 reuse the cached result instantly.
const summary = await diary.executeOnce("research:openai-q4-2024", async () => {
  const page = await fetchWebPage("https://openai.com/blog/q4-2024");
  return await summarizeWithLLM(page);
});
```

> `executeOnce` — if this task already ran, returns the cached result. If another agent is running it right now, waits, then returns their result. If it's new, runs your function exactly once.

---

## ⚡ Performance & Scalability Upgrades

Agent Diaries is engineered for high-throughput multi-agent swarms:

| Feature / Metric | Without Agent Diaries | With Agent Diaries | Performance Impact |
|---|---|---|---|
| **Hot Key Read Latency** | Direct Database / Network Roundtrip | In-Memory `O(1)` L1 Cache Hit | **< 1 ms (Sub-millisecond)** |
| **Memory Footprint** | Unbounded growth (OOM leak risk) | Strictly bounded LRU eviction | **Guaranteed constant max memory** |
| **Payload Size (Traces/State)** | Verbose UTF-8 JSON strings | Binary MessagePack buffers | **30–60% reduction in byte size** |
| **Concurrency Locking** | Spinlocks / Polling loops (`sleep`) | Chained-Promise FIFO Mutex | **Zero CPU spin & zero lock-theft races** |
| **Concurrent Redundant Calls** | 50× redundant LLM/API invocations | Deduplicated down to 1 call | **Up to 98% token & cost savings** |

---

## 🌍 Real-World Use Cases

| Use Case | How Agent Diaries Solves It |
|---|---|
| 🌐 **Browser Agents** | Playwright/Puppeteer swarms deduplicate URL visits so identical web pages are never scraped twice. |
| 🔬 **Research Agents** | Multi-agent swarms researching 100 topics execute exactly 1 LLM call per topic, preventing redundant synthesis. |
| 🛡️ **GitHub Security Scanning** | 200 security bots scanning 50 repos execute exactly 50 scans, skipping 9,950 duplicate calls and saving $150+ in LLM tokens. |
| 🔌 **MCP Server Swarms** | Model Context Protocol tools coordinate execution across agents without repeating expensive tool calls. |
| 📚 **Multi-Agent RAG** | Vector retrieval and document embedding pipelines prevent duplicate index queries and chunk processing across workers. |

---

## ❓ Why Not Redis?

> "Can't I just build this with Redis?"

Building coordination yourself requires writing distributed locks, Lua scripts, expiration handling, crash recovery, and result serialization.

| Outcome | DIY with Redis | Agent Diaries |
|---|---|---|
| **Atomic Task Ownership** | Complex Lua scripts + `SET NX` | `diary.executeOnce()` |
| **Crash-Safe Locks** | Manual dead-letter queue + cron cleanup | Built-in |
| **Execution History** | Custom key schemas & TTL management | Built-in |
| **Duplicate Interception** | Manual checks before every LLM call | Automatic |
| **Zero Infrastructure Setup** | ❌ Requires Redis running | ✅ Works in-memory out of the box |
| **Distributed Scale** | Manual backend wiring | 1 line to enable Redis / Postgres |

---

## 📖 API Reference & Examples

### Primary API (Start Here)

`executeOnce()` handles claiming, executing, error handling, result saving, and cache lookup in a single call:

```typescript
const result = await diary.executeOnce(taskId, async () => {
  return await expensiveFunction();
});
```

---

### Bounded Memory Caching with `LruMemoryProvider`

Wrap any cache provider with an LRU layer to enforce strict memory bounds:

```typescript
import { StorageManager, MemoryCacheProvider } from "@agent-diaries/core";
import { LruMemoryProvider } from "@agent-diaries/core/memory";

// Initialize with a maximum capacity (or configure via AG_DIARIES_CACHE_SIZE env var)
const boundedCache = new LruMemoryProvider(new MemoryCacheProvider(), 1000);

const storage = new StorageManager({
  cache: boundedCache,
});

// Cache writes support optional TTL (in milliseconds)
await boundedCache.set("agent:context:101", { state: "active" }, 60_000);
```

---

### Binary MessagePack Serialization (`codec`)

For high-frequency telemetry, binary persistence, or network streaming of complex agent records:

```typescript
import { encode, decode } from "@agent-diaries/core";

// Fast binary encoding to Uint8Array
const tracePayload = {
  workflowId: "wf-9812",
  agentId: "summarizer",
  timestamp: Date.now(),
  metadata: { tokensUsed: 1420, model: "gemini-2.5-flash" },
};

const binaryData: Uint8Array = encode(tracePayload);

// Binary decoding back to typed object
const decoded = decode<typeof tracePayload>(binaryData);
console.log(decoded.workflowId); // "wf-9812"
```

---

### Advanced Manual Lifecycle Control

When you need granular control over the lifecycle:

```typescript
// 1. Manually claim task
const claimed = await diary.claimTask("task-id");

if (claimed) {
  try {
    const result = await doWork();
    // 2. Complete task & store result
    await diary.writeTaskResult("task-id", result);
  } catch (err) {
    await diary.failTask("task-id", err.message);
  }
} else {
  // 3. Retrieve existing result from winning agent
  const cached = await diary.getTaskResult("task-id");
}
```

---

### Batch Operations

```typescript
const newTasks     = await diary.filterNewTasks(taskList);
const claimedList  = await diary.batchClaimTasks(taskTitles);
```

---

### Distributed Backends (Redis, PostgreSQL, MongoDB, SQLite)

Switch from in-memory to Redis or PostgreSQL when scaling to distributed nodes:

```typescript
import { StorageManager } from "@agent-diaries/core";
import { RedisCacheProvider, RedisLockProvider } from "@agent-diaries/core/redis";

const storageManager = new StorageManager({
  cache: new RedisCacheProvider(redisClient),
  lock: new RedisLockProvider(redisClient),
});

const diary = new AgentDiary({ agentId: "distributed-agent", storageManager });
```

---

## 🦜 LangChain Integration (New in v2.3.0)

Import directly from `@agent-diaries/core/langchain` or `@agent-diaries/core`. Agent Diaries provides three seamless integration points for LangChain applications:

### 1. `AgentDiariesCache` — LLM Response Deduplication

Plugs directly into LangChain's `ChatOpenAI`, `ChatAnthropic`, or any `BaseChatModel` via `cache`. Prevents duplicate token spend when multiple agents or prompt templates ask the same question:

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { AgentDiariesCache } from "@agent-diaries/core/langchain";

const cache = new AgentDiariesCache({
  ttlMs: 3600_000, // 1 hour TTL (default: 24h)
  keyPrefix: "my-app:llm",
});

const model = new ChatOpenAI({
  modelName: "gpt-4o",
  cache,
});

// 50 agents call the model with identical prompts simultaneously
// -> Exactly 1 LLM request is made. The other 49 return instantly from cache.
const res1 = await model.invoke("Analyze quarterly revenue for Q3 2024");
const res2 = await model.invoke("Analyze quarterly revenue for Q3 2024");
```

### 2. `DeduplicatedTool` — Exactly-Once Tool Execution & Mutexes

Wraps any LangChain tool (or custom tool) with Agent Diaries' deduplication engine and concurrency mutex. Crucial for non-idempotent operations like API payments, webhooks, ticket creation, or heavy web scrapes:

```typescript
import { DeduplicatedTool } from "@agent-diaries/core/langchain";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";

const chargeCardTool = new DynamicStructuredTool({
  name: "charge_customer",
  description: "Charges a customer credit card",
  schema: z.object({ customerId: z.string(), amountCents: z.number() }),
  func: async ({ customerId, amountCents }) => stripe.charges.create({ ... }),
});

// Wrap tool with exactly-once execution guarantee
const safeTool = new DeduplicatedTool(chargeCardTool, {
  ttlMs: 300_000,
  keyResolver: (input) => `charge:${input.customerId}:${input.amountCents}`,
});

// Even if two agents race to trigger this tool with identical parameters,
// it executes strictly once.
const result = await safeTool.invoke({ customerId: "cus_123", amountCents: 5000 });
```

### 3. `AgentDiariesCallbackHandler` — Observability & Tracing

LangChain `BaseCallbackHandler` that captures LLM calls, tool executions, chain lifecycle, agent actions, and errors directly into an Agent Diary for full auditability and post-hoc debugging:

```typescript
import { AgentDiariesCallbackHandler } from "@agent-diaries/core/langchain";
import { AgentDiary } from "@agent-diaries/core";

const diary = new AgentDiary({ agentId: "langchain-supervisor" });
const handler = new AgentDiariesCallbackHandler({ diary });

// Attach to any chain, agent, or run
await myAgentExecutor.invoke({ input: "Deploy release v2.3.0" }, {
  callbacks: [handler],
});

// Access execution metrics & audit trail
console.log(handler.getStats());
// { totalLlmCalls: 4, totalToolCalls: 2, totalErrors: 0, totalTokensUsed: 3120, avgLlmLatencyMs: 412 }
```

> 📖 **Full LangChain Guide & Architecture:** Check out [`docs/langchain.md`](./docs/langchain.md) and runnable demo in [`examples/langchain-integration/`](./examples/langchain-integration).

---

## 📊 Performance Metrics & Monitoring

The library ships with a lightweight **MetricsEngine** that records key operational counters (workflow successes/failures, cache hits/misses, etc.). You can plug any metrics exporter (Prometheus, StatsD, OpenTelemetry) by subscribing to the `MetricsEngine` events.

### Example: Exporting to Prometheus

```ts
import { MetricsEngine } from "@agent-diaries/core";
import client from "prom-client";

const register = new client.Registry();
const workflowSuccess = new client.Counter({
  name: "agent_diaries_workflow_success_total",
  help: "Total successful workflow executions",
});
register.registerMetric(workflowSuccess);

const metricsEngine = new MetricsEngine(/* repository instance */);

metricsEngine.on("recorded", ({ name, value }) => {
  if (name === "workflow_success_count") workflowSuccess.inc(value);
  if (name === "workflow_failure_count") workflowFailure.inc(value);
  if (name === "cache_hit_count") cacheHit.inc(value);
  if (name === "cache_miss_count") cacheMiss.inc(value);
});

// expose HTTP endpoint
import http from "http";
http.createServer(async (_, res) => {
  res.setHeader("Content-Type", register.contentType);
  res.end(await register.metrics());
}).listen(9464);
```

> **Tip:** The `MetricsEngine` emits a generic `recorded` event for every metric you record, letting you map names to your own monitoring schema.

---

## 📚 Advanced Documentation

- [Architecture & Design](./docs/architecture.md) — How in-memory locks, distributed mutexes, and storage facades work
- [Workflow Coordinator](./docs/advanced.md) — Enterprise multi-step pipeline orchestration
- [Distributed Tracing](./docs/tracing.md) — OpenTelemetry-style span tracking and metrics
- [Plugin Framework](./docs/plugins.md) — Custom storage adapters and middleware
- [LangChain Integration](./docs/langchain.md) — LLM cache, deduplicated tools, and callback handler for LangChain
- [Benchmarks & Performance](./BENCHMARKS.md) — Comprehensive latency and throughput methodology

---

## 📄 License

MIT © [swapwarick_n](https://github.com/swapwarick)
