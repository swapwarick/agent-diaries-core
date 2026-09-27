/**
 * LangChain + Agent Diaries Integration Example
 * ───────────────────────────────────────────────
 * Demonstrates all three integration points:
 * 1. AgentDiariesCache — LLM response deduplication
 * 2. DeduplicatedTool — exactly-once tool execution
 * 3. AgentDiariesCallbackHandler — execution observability
 *
 * Run:
 *   npx tsx examples/langchain-integration/index.ts
 *
 * No API keys required — uses simulated LLM and tool calls.
 */

import { MemoryStorage } from "@agent-diaries/core";
import {
  AgentDiariesCache,
  DeduplicatedTool,
  AgentDiariesCallbackHandler,
  deduplicateTools,
} from "@agent-diaries/core/langchain";
import type { Generation, LangChainToolLike } from "@agent-diaries/core/langchain";

// ── Simulated LangChain Components ──────────────────────────────────────────

/** Simulates a LangChain tool that performs web search. */
const searchTool: LangChainToolLike = {
  name: "WebSearch",
  description: "Searches the web for information",
  invoke: async (input: string) => {
    console.log(`    🌐 [WebSearch] Executing real search for: "${input}"`);
    await new Promise((r) => setTimeout(r, 100)); // Simulate latency
    return `Search results for "${input}": AI trends, LLM advances, agent frameworks...`;
  },
};

/** Simulates a LangChain tool that calls an API. */
const apiTool: LangChainToolLike = {
  name: "WeatherAPI",
  description: "Gets current weather data",
  invoke: async (input: string) => {
    console.log(`    🌤️  [WeatherAPI] Calling API for: "${input}"`);
    await new Promise((r) => setTimeout(r, 80));
    return JSON.stringify({ city: input, temp: 22, condition: "Sunny" });
  },
};

// ── Demo Functions ──────────────────────────────────────────────────────────

async function demoCaching() {
  console.log("\n" + "═".repeat(60));
  console.log("  1. AgentDiariesCache — LLM Response Deduplication");
  console.log("═".repeat(60));

  const sharedStorage = new MemoryStorage();
  const cache = new AgentDiariesCache({
    agentId: "llm-cache-demo",
    storage: sharedStorage,
  });

  const prompt = "Explain quantum computing in simple terms";
  const llmKey = "gpt-4o:temp=0.7:max_tokens=500";

  // First lookup — cache miss
  console.log("\n  Agent-1: Looking up cached response...");
  const miss = await cache.lookup(prompt, llmKey);
  console.log(`  Agent-1: Cache ${miss ? "HIT ✓" : "MISS ✗"}`);

  // Simulate LLM response and cache it
  const generations: Generation[] = [
    {
      text: "Quantum computing uses qubits that can be 0, 1, or both simultaneously...",
      generationInfo: { finishReason: "stop", model: "gpt-4o" },
    },
  ];
  console.log("  Agent-1: Calling LLM and caching response...");
  await cache.update(prompt, llmKey, generations);

  // Second lookup by different agent — cache hit
  console.log("\n  Agent-2: Looking up same prompt...");
  const hit = await cache.lookup(prompt, llmKey);
  console.log(`  Agent-2: Cache ${hit ? "HIT ✓" : "MISS ✗"} — No LLM call needed!`);
  console.log(`  Agent-2: Got: "${hit![0].text.substring(0, 50)}..."`);

  // Third lookup with different model config — cache miss (correct behavior)
  console.log("\n  Agent-3: Same prompt, different model...");
  const differentModel = await cache.lookup(prompt, "gpt-3.5:temp=0.0");
  console.log(`  Agent-3: Cache ${differentModel ? "HIT" : "MISS ✗"} — Correct! Different config.`);
}

async function demoDeduplicatedTools() {
  console.log("\n\n" + "═".repeat(60));
  console.log("  2. DeduplicatedTool — Exactly-Once Tool Execution");
  console.log("═".repeat(60));

  const storage = new MemoryStorage();

  // Wrap tools with deduplication
  const [dedupedSearch, dedupedWeather] = deduplicateTools(
    [searchTool, apiTool],
    { agentId: "tool-dedup-demo", storage },
  );

  console.log("\n  Simulating 5 agents calling WebSearch with the same query...\n");

  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      dedupedSearch.invoke("latest AI news").then((r) => {
        console.log(`    Agent-${i}: Got result ✓`);
        return r;
      }),
    ),
  );

  console.log(`\n  ✔ 5 agents requested results, but WebSearch executed only ONCE.`);
  console.log(`  ✔ All 5 agents received identical results.`);

  console.log("\n  Now calling with a DIFFERENT query...\n");
  await dedupedSearch.invoke("machine learning basics");
  console.log("  ✔ New query executed (different input = new execution).");

  console.log("\n  Calling WeatherAPI for same city from 3 agents...\n");
  await Promise.all([
    dedupedWeather.invoke("Tokyo"),
    dedupedWeather.invoke("Tokyo"),
    dedupedWeather.invoke("Tokyo"),
  ]);
  console.log("  ✔ WeatherAPI called once for Tokyo, served 3 agents.");
}

async function demoCallbackHandler() {
  console.log("\n\n" + "═".repeat(60));
  console.log("  3. AgentDiariesCallbackHandler — Execution Observability");
  console.log("═".repeat(60));

  const handler = new AgentDiariesCallbackHandler({
    agentId: "callback-demo",
    storage: new MemoryStorage(),
    onEvent: (event) => {
      console.log(`    📡 [${event.type}] ${event.name ?? ""} (run: ${event.runId})`);
    },
  });

  console.log("\n  Simulating a RetrievalQA chain execution...\n");

  // Simulate chain start
  await handler.handleChainStart(
    { name: "RetrievalQAChain" },
    { question: "What are the latest AI trends?" },
    "chain-001",
  );

  // Simulate retriever
  await handler.handleRetrieverStart(
    { name: "ChromaVectorStore" },
    "AI trends 2024",
    "ret-001",
    "chain-001",
  );
  await handler.handleRetrieverEnd(
    [{ pageContent: "Doc1" }, { pageContent: "Doc2" }, { pageContent: "Doc3" }],
    "ret-001",
    "chain-001",
  );

  // Simulate LLM call
  await handler.handleLLMStart(
    { name: "gpt-4o" },
    ["Based on the following documents, summarize AI trends..."],
    "llm-001",
    "chain-001",
  );
  await handler.handleLLMEnd(
    { generations: [[{ text: "Key AI trends include..." }]] },
    "llm-001",
    "chain-001",
  );

  // Simulate tool usage
  await handler.handleToolStart(
    { name: "WebSearch" },
    "recent AI breakthroughs",
    "tool-001",
    "chain-001",
  );
  await handler.handleToolEnd(
    "Found 5 relevant articles...",
    "tool-001",
    "chain-001",
  );

  // Chain complete
  await handler.handleChainEnd(
    { answer: "The latest AI trends include..." },
    "chain-001",
  );

  // Simulate an error scenario
  await handler.handleLLMStart({ name: "gpt-4o" }, ["Another prompt"], "llm-err");
  await handler.handleLLMError(new Error("Rate limit exceeded"), "llm-err");

  // Print stats
  const stats = handler.getStats();
  console.log("\n  ── Execution Stats ──");
  console.log(`  Total events:     ${stats.totalEvents}`);
  console.log(`  LLM calls:        ${stats.llmCalls}`);
  console.log(`  LLM errors:       ${stats.llmErrors}`);
  console.log(`  Tool calls:       ${stats.toolCalls}`);
  console.log(`  Chain calls:      ${stats.chainCalls}`);
  console.log(`  Retriever calls:  ${stats.retrieverCalls}`);

  // Filter events by run
  const chainEvents = handler.getEventsByRunId("chain-001");
  console.log(`\n  Events in chain-001: ${chainEvents.length}`);

  // Filter by type
  const llmStarts = handler.getEventsByType("llm_start");
  console.log(`  Total LLM starts:    ${llmStarts.length}`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("━".repeat(60));
  console.log("  🧠 Agent Diaries × LangChain Integration Demo");
  console.log("━".repeat(60));

  await demoCaching();
  await demoDeduplicatedTools();
  await demoCallbackHandler();

  console.log("\n\n" + "━".repeat(60));
  console.log("  ✔ All demos completed successfully!");
  console.log("━".repeat(60));
}

main().catch(console.error);
