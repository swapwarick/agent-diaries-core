# LangChain Integration

> **`@agent-diaries/core/langchain`** — Framework-level integration that connects Agent Diaries' deduplication engine to LangChain's LLM, tool, and chain infrastructure.

## Overview

The integration provides three drop-in components:

| Component | Purpose | LangChain Interface |
|---|---|---|
| **`AgentDiariesCache`** | Deduplicates LLM responses across agents | `BaseCache<Generation[]>` |
| **`DeduplicatedTool`** | Wraps any tool with `executeOnce()` | `StructuredTool` / `DynamicTool` |
| **`AgentDiariesCallbackHandler`** | Records all execution events for observability | `BaseCallbackHandler` |

### Zero Hard Dependencies

All three components implement the same method signatures as LangChain's interfaces **without requiring `@langchain/core` as a dependency**. This means:
- No version conflicts between `@langchain/core` versions
- Works with any LangChain-compatible framework (LangGraph, LangServe, etc.)
- Types are inlined and fully compatible

---

## Installation

```bash
npm install @agent-diaries/core
# LangChain is a peer — install whichever version you use:
npm install @langchain/core @langchain/openai
```

---

## 1. AgentDiariesCache — LLM Response Deduplication

When 50 agents send the same prompt to GPT-4, only 1 API call is made. The remaining 49 get the cached result instantly.

```typescript
import { AgentDiariesCache } from "@agent-diaries/core/langchain";
import { ChatOpenAI } from "@langchain/openai";

const cache = new AgentDiariesCache({
  agentId: "research-swarm",
  // Optional: share storage across processes for distributed dedup
  // storage: new RedisCacheAdapter(redisClient),
});

const model = new ChatOpenAI({
  modelName: "gpt-4o",
  cache, // ← plug in directly
});

// First call → hits the API
const r1 = await model.invoke("Summarize Q4 earnings");

// Same prompt by another agent → returns cached instantly
const r2 = await model.invoke("Summarize Q4 earnings");
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `agentId` | `string` | `"langchain-cache"` | Diary namespace |
| `storage` | `StorageAdapter` | In-memory | Shared storage for cross-agent dedup |
| `defaultTtlMs` | `number` | `undefined` | Auto-expire cached responses |
| `maxHistory` | `number` | `2000` | Max cached entries |

---

## 2. DeduplicatedTool — Exactly-Once Tool Execution

Wraps any LangChain tool so that identical invocations execute only once across your entire swarm.

```typescript
import { DeduplicatedTool, deduplicateTools } from "@agent-diaries/core/langchain";
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";

// Wrap a single tool
const search = new DeduplicatedTool(
  new TavilySearchResults({ maxResults: 3 }),
  {
    agentId: "research-swarm",
    ttlMs: 300_000, // Cache results for 5 minutes
  },
);

// Or wrap multiple tools at once
const [search, calculator, weather] = deduplicateTools(
  [searchTool, calcTool, weatherTool],
  { agentId: "my-swarm", ttlMs: 60_000 },
);
```

### Concurrency Behavior

```
Agent-1: invoke("AI news")  →  Executes real search  →  Caches result
Agent-2: invoke("AI news")  →  Waits for lock        →  Returns cached result
Agent-3: invoke("AI news")  →  Waits for lock        →  Returns cached result
Agent-4: invoke("ML basics") →  Different input       →  Executes real search
```

### Custom Key Builder

By default, deduplication keys are `tool:{name}:{serialized_input}`. Override for custom grouping:

```typescript
const deduped = new DeduplicatedTool(tool, {
  keyBuilder: (toolName, input) => `${toolName}:${input.category}`,
  // Now all inputs with the same category share one execution
});
```

---

## 3. AgentDiariesCallbackHandler — Execution Observability

Records every LLM call, tool invocation, chain execution, and retriever query into Agent Diaries for post-hoc analysis.

```typescript
import { AgentDiariesCallbackHandler } from "@agent-diaries/core/langchain";

const handler = new AgentDiariesCallbackHandler({
  agentId: "observability",
  persistEvents: true, // Survive restarts
  onEvent: (event) => {
    // Stream to your monitoring pipeline
    console.log(`[${event.type}] ${event.name} — run: ${event.runId}`);
  },
});

// Attach to any LangChain component
const result = await chain.invoke(
  { question: "What is AI?" },
  { callbacks: [handler] },
);

// Inspect execution
console.log(handler.getStats());
// → { llmCalls: 1, toolCalls: 2, chainCalls: 1, totalEvents: 8, ... }

// Filter events
const llmEvents = handler.getEventsByType("llm_start");
const runTrace = handler.getEventsByRunId("run-abc-123");
```

### Tracked Event Types

| Category | Start | End | Error |
|---|---|---|---|
| **LLM** | `llm_start` | `llm_end` | `llm_error` |
| **Tool** | `tool_start` | `tool_end` | `tool_error` |
| **Chain** | `chain_start` | `chain_end` | `chain_error` |
| **Retriever** | `retriever_start` | `retriever_end` | `retriever_error` |
| **Agent** | `agent_action` | `agent_finish` | — |

---

## Full Integration Example

Combining all three for a production multi-agent system:

```typescript
import { MemoryStorage } from "@agent-diaries/core";
import {
  AgentDiariesCache,
  DeduplicatedTool,
  AgentDiariesCallbackHandler,
  deduplicateTools,
} from "@agent-diaries/core/langchain";

// Shared storage layer for the entire swarm
const sharedStorage = new MemoryStorage();

// 1. LLM cache
const cache = new AgentDiariesCache({
  agentId: "swarm",
  storage: sharedStorage,
});

// 2. Deduplicated tools
const tools = deduplicateTools([searchTool, calcTool], {
  agentId: "swarm",
  storage: sharedStorage,
  ttlMs: 300_000,
});

// 3. Observability handler
const handler = new AgentDiariesCallbackHandler({
  agentId: "swarm",
  storage: sharedStorage,
  persistEvents: true,
});

// Wire into LangChain
const model = new ChatOpenAI({ cache, callbacks: [handler] });
const agent = createReactAgent({ llm: model, tools });

// 50 agents can now run concurrently with zero duplicate work
await Promise.all(
  agents.map((a) => agent.invoke({ input: a.task })),
);
```

---

## Running the Example

```bash
npx tsx examples/langchain-integration/index.ts
```

No API keys required — the example uses simulated LLM and tool calls.
