# LangChain Integration Example

Demonstrates all three Agent Diaries × LangChain integration points using simulated LLM and tool calls (no API keys required).

## What's Demonstrated

1. **`AgentDiariesCache`** — LLM response deduplication across agents
2. **`DeduplicatedTool`** — Exactly-once tool execution with `executeOnce()`
3. **`AgentDiariesCallbackHandler`** — Full execution observability and tracing

## Run

```bash
npx tsx examples/langchain-integration/index.ts
```

## Using with Real LangChain

```typescript
import { ChatOpenAI } from "@langchain/openai";
import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
import {
  AgentDiariesCache,
  DeduplicatedTool,
  AgentDiariesCallbackHandler,
} from "@agent-diaries/core/langchain";

// 1. Cache LLM responses across your agent swarm
const cache = new AgentDiariesCache({ agentId: "research-swarm" });
const model = new ChatOpenAI({ modelName: "gpt-4o", cache });

// 2. Deduplicate tool calls
const search = new DeduplicatedTool(
  new TavilySearchResults({ maxResults: 3 }),
  { agentId: "research-swarm", ttlMs: 300_000 },
);

// 3. Record all execution events
const handler = new AgentDiariesCallbackHandler({
  agentId: "research-swarm",
  onEvent: (e) => console.log(`[${e.type}] ${e.name}`),
});

const result = await model.invoke("Summarize recent AI trends", {
  callbacks: [handler],
});
```
