<div align="center">
  <h1>🧠 Agent Diaries Core</h1>
  <p><strong>Stop AI agents from doing the same work twice.</strong></p>
  <p>One function call. Any agent framework. Exactly-once execution across your entire swarm.</p>

[![NPM Version](https://img.shields.io/npm/v/@agent-diaries/core?style=for-the-badge&logo=npm&color=CB3837)](https://www.npmjs.com/package/@agent-diaries/core)
[![NPM Downloads](https://img.shields.io/npm/dm/@agent-diaries/core?style=for-the-badge&logo=npm&color=44CC11)](https://www.npmjs.com/package/@agent-diaries/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/Tests-69%2F69%20Passing-brightgreen?style=for-the-badge&logo=vitest&logoColor=white)](https://github.com/swapwarick/agent-diaries-core/actions)

</div>

---

## 🛑 The Problem

Autonomous agents duplicate work when scaling up.

When 50 agents run concurrently, they repeatedly fetch identical web pages, execute redundant LLM reasoning, and trigger duplicate API calls.

- **Token & API Bloat:** You pay 50× the cost for 1× the result.
- **Swarm Race Conditions:** Multiple agents attempt to process or mutate the same task at once.
- **Framework Blindness:** Frameworks like LangChain, AutoGen, CrewAI, or LlamaIndex lack cross-process coordination out of the box.

---

## ⚡ The Solution

**Agent Diaries** is a lightweight, framework-agnostic coordination layer that guarantees **exactly-once execution** for your AI agents.

### Core Benefits

- 🎯 **Exactly-Once Execution:** Guarantee tasks execute only once, no matter how many agents attempt them concurrently.
- 🌐 **Distributed Coordination:** Safely coordinate agents across processes, worker nodes, or serverless functions.
- 🚫 **Duplicate Prevention:** Intercept and deduplicate identical LLM calls, web scrapes, and API requests before they happen.
- 💾 **Persistent History:** Store execution records in-memory, Redis, PostgreSQL, or SQLite so past work survives restarts.

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

## 📖 API Reference

### Primary API (Start Here)

`executeOnce()` handles claiming, executing, error handling, result saving, and cache lookup in a single call:

```typescript
const result = await diary.executeOnce(taskId, async () => {
  return await expensiveFunction();
});
```

### Advanced Manual Control

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

### Batch Operations

```typescript
const newTasks     = await diary.filterNewTasks(taskList);
const claimedList  = await diary.batchClaimTasks(taskTitles);
```

### Distributed Backends

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

## 📚 Advanced Documentation

- [Architecture & Design](./docs/architecture.md) — How in-memory locks, distributed mutexes, and storage facades work
- [Workflow Coordinator](./docs/advanced.md) — Enterprise multi-step pipeline orchestration
- [Distributed Tracing](./docs/tracing.md) — OpenTelemetry-style span tracking and metrics
- [Plugin Framework](./docs/plugins.md) — Custom storage adapters and middleware
- [Benchmarks & Performance](./BENCHMARKS.md) — Comprehensive latency and throughput methodology

---

## 📄 License

MIT © [swapwarick_n](https://github.com/swapwarick)
