<div align="center">
  <h1>🧠 Agent Diaries Core</h1>
  <p><strong>Stop your AI agents from doing the same work twice.</strong></p>
  <p>One function call. Any agent framework. Exactly-once execution across your entire swarm.</p>

[![NPM Version](https://img.shields.io/npm/v/@agent-diaries/core?style=for-the-badge&logo=npm&color=CB3837)](https://www.npmjs.com/package/@agent-diaries/core)
[![NPM Downloads](https://img.shields.io/npm/dm/@agent-diaries/core?style=for-the-badge&logo=npm&color=44CC11)](https://www.npmjs.com/package/@agent-diaries/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/Tests-69%2F69%20Passing-brightgreen?style=for-the-badge&logo=vitest&logoColor=white)](https://github.com/swapwarick/agent-diaries-core/actions)

</div>

---

```typescript
import { AgentDiary } from "@agent-diaries/core";

const diary = new AgentDiary({ agentId: "research-agent" });

// 100 agents. 1 LLM call. The rest return from cache instantly.
const report = await diary.executeOnce("research:openai-q4-2024", async () => {
  const page = await fetchWebPage("https://openai.com/blog/q4-2024");
  return await summarizeWithLLM(page);
});
```

> `executeOnce` — if this task already ran, returns the cached result. If another agent is running it right now, waits, then returns their result. If it's new, runs your function exactly once.

---

## The Problem

Your agents are duplicating work.

When 50 agents run in parallel, each one independently fetches the same data, calls the same LLM, and produces the same output. You pay 50×. You get 1× the value.

There's no built-in answer in LangChain, AutoGen, CrewAI, or BullMQ for:

- **Who is running this task right now?**
- **Has it already been done?**
- **What was the result?**

Agent Diaries answers all three. In one call.

---

## Quick Start

```bash
npm install @agent-diaries/core
```

```typescript
import { AgentDiary } from "@agent-diaries/core";

const diary = new AgentDiary({ agentId: "my-agent" });

// Run exactly once — even with 100 concurrent agents
const result = await diary.executeOnce("task-id", async () => {
  return await yourExpensiveOperation();
});
```

No Redis. No configuration. Works in-memory by default.

---

## Killer Demo — 200 Agents, 50 Repos, Zero Duplicate Scans

```typescript
import { AgentDiary } from "@agent-diaries/core";

const repos = [
  "vercel/next.js", "microsoft/vscode", "facebook/react",
  // ... 47 more
];

// Spawn 200 agents concurrently
const agents = Array.from({ length: 200 }, (_, i) => `agent-${i}`);

await Promise.all(
  agents.flatMap(agentId =>
    repos.map(async repo => {
      const diary = new AgentDiary({ agentId });

      return diary.executeOnce(`security-scan:${repo}`, async () => {
        console.log(`[${agentId}] Scanning ${repo}...`);
        return await scanRepo(repo); // GitHub API + LLM analysis
      });
    })
  )
);
```

**Output:**
```
[agent-0]  Scanning vercel/next.js...       ← 1 scan executed
[agent-1]  Cache hit: vercel/next.js        ← returned instantly
[agent-2]  Cache hit: vercel/next.js        ← returned instantly
...
✔ 50 scans executed (1 per repo)
✔ 9,950 duplicate calls prevented
✔ Estimated LLM cost saved: $148
```

**10,000 total calls. 50 executions. The math is automatic.**

---

## Why Not Redis?

> "Can I build this myself with Redis?"

Yes. Here's what you'd build:

| What you need | DIY with Redis | Agent Diaries |
|---|---|---|
| Atomic task ownership | Lua script + `SET NX` | `executeOnce()` |
| Crash-safe locks | Dead-letter queue + cron | Built-in |
| Execution history | Custom key schema + TTL | Built-in |
| Duplicate interception | Manual check before every call | Automatic |
| Works without infrastructure | ❌ Needs Redis running | ✅ In-memory by default |
| Add Redis when ready | — | One line of config |

Agent Diaries is that week of Redis work. Already built, chaos-tested, and shipped.

---

## API

```typescript
// ✦ Primary API — start here
const result = await diary.executeOnce(taskId, fn);

// ✦ Manual control (when you need it)
const claimed = await diary.claimTask(taskId);
await diary.writeTaskResult(taskId, result);
const cached  = await diary.getTaskResult(taskId);
const done    = await diary.hasProcessedTask(taskId);

// ✦ Batch operations
const newOnly = await diary.filterNewTasks(tasks);
const claimed = await diary.batchClaimTasks(titles);
```

**Switch to Redis or PostgreSQL when you go distributed:**

```typescript
import { RedisCacheProvider, RedisLockProvider } from "@agent-diaries/core/redis";

const diary = new AgentDiary({
  agentId: "my-agent",
  storage: new StorageAdapter({
    cache: new RedisCacheProvider(redis),
    lock:  new RedisLockProvider(redis),
  }),
});
```

---

## Benchmarks

| Metric | Result |
|---|---|
| Claim latency (in-memory) | < 1 ms |
| Dedup throughput | > 50,000 ops/s |
| Duplicate prevention rate | 99.9% |
| Overhead per LLM call | < 0.5% |

Full benchmark methodology → [BENCHMARKS.md](./BENCHMARKS.md)

---

## More Examples

| Example | What it shows |
|---|---|
| [`examples/github-security/`](./examples/github-security/) | 200 agents scanning 50 repos — zero duplicates |
| [`examples/research-swarm/`](./examples/research-swarm/) | 100 research agents, 1 result per topic |
| [`examples/customer-support/`](./examples/customer-support/) | Deduplicate support ticket LLM calls |
| [`examples/langchain-integration/`](./examples/langchain-integration/) | Drop-in with LangChain agents |
| [`examples/basic/`](./examples/basic/) | 5-minute hello world |

---

## Backends

| Backend | Use case |
|---|---|
| **In-memory** (default) | Single process, development, testing |
| **Redis** | Distributed, cross-process coordination |
| **PostgreSQL** | Durable persistence, audit logs |
| **SQLite** | Edge deployments, single-machine |

---

## Advanced

- [WorkflowCoordinator](./docs/advanced.md) — enterprise multi-step pipeline orchestration
- [Distributed Tracing](./docs/tracing.md) — OpenTelemetry-style span tracking
- [Plugin Registry](./docs/plugins.md) — custom backends and middleware
- [Architecture](./docs/architecture.md) — how it works under the hood

---

## 📄 License

MIT © [swapwarick_n](https://github.com/swapwarick)
