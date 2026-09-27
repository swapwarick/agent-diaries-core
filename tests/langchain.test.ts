/**
 * LangChain Integration Test Suite
 * ─────────────────────────────────
 * Tests for AgentDiariesCache, DeduplicatedTool, and AgentDiariesCallbackHandler.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { MemoryStorage } from "../src/memory/storage";
import {
  AgentDiariesCache,
  DeduplicatedTool,
  AgentDiariesCallbackHandler,
  deduplicateTools,
} from "../src/langchain";
import type { Generation, LangChainToolLike } from "../src/langchain";

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════════

function makeStorage() {
  return new MemoryStorage<any>();
}

function makeMockTool(
  name = "MockSearch",
  fn?: (input: any) => Promise<string>,
): LangChainToolLike {
  return {
    name,
    description: `A mock tool named ${name}`,
    invoke: fn ?? (async (input: any) => `Result for: ${input}`),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. AgentDiariesCache
// ═══════════════════════════════════════════════════════════════════════════════

describe("AgentDiariesCache", () => {
  let cache: AgentDiariesCache;

  beforeEach(() => {
    cache = new AgentDiariesCache({
      agentId: "test-cache",
      storage: makeStorage(),
    });
  });

  it("returns null on cache miss", async () => {
    const result = await cache.lookup("What is AI?", "gpt-4o:temp=0.7");
    expect(result).toBeNull();
  });

  it("stores and retrieves Generation[] via update/lookup", async () => {
    const generations: Generation[] = [
      { text: "AI is artificial intelligence.", generationInfo: { finishReason: "stop" } },
    ];

    await cache.update("What is AI?", "gpt-4o:temp=0.7", generations);
    const result = await cache.lookup("What is AI?", "gpt-4o:temp=0.7");

    expect(result).toEqual(generations);
  });

  it("returns null for different llmKey (same prompt)", async () => {
    const generations: Generation[] = [{ text: "AI response" }];

    await cache.update("What is AI?", "gpt-4o:temp=0.7", generations);
    const result = await cache.lookup("What is AI?", "gpt-3.5:temp=0.0");

    expect(result).toBeNull();
  });

  it("returns null for different prompt (same llmKey)", async () => {
    const generations: Generation[] = [{ text: "AI response" }];

    await cache.update("What is AI?", "gpt-4o", generations);
    const result = await cache.lookup("What is ML?", "gpt-4o");

    expect(result).toBeNull();
  });

  it("handles multiple generations per prompt", async () => {
    const generations: Generation[] = [
      { text: "Response A" },
      { text: "Response B", generationInfo: { index: 1 } },
      { text: "Response C", generationInfo: { index: 2 } },
    ];

    await cache.update("Multi response", "gpt-4o:n=3", generations);
    const result = await cache.lookup("Multi response", "gpt-4o:n=3");

    expect(result).toHaveLength(3);
    expect(result![0].text).toBe("Response A");
    expect(result![2].text).toBe("Response C");
  });

  it("deduplicates concurrent update calls for the same key", async () => {
    let callCount = 0;
    const sharedStorage = makeStorage();

    // Create two caches sharing the same storage
    const cache1 = new AgentDiariesCache({
      agentId: "shared-cache",
      storage: sharedStorage,
    });
    const cache2 = new AgentDiariesCache({
      agentId: "shared-cache",
      storage: sharedStorage,
    });

    const generations: Generation[] = [{ text: "Shared result" }];

    // Both update concurrently
    await Promise.all([
      cache1.update("prompt", "llm", generations),
      cache2.update("prompt", "llm", generations),
    ]);

    // Both should read the same result
    const r1 = await cache1.lookup("prompt", "llm");
    const r2 = await cache2.lookup("prompt", "llm");
    expect(r1).toEqual(generations);
    expect(r2).toEqual(generations);
  });

  it("exposes the underlying diary via getDiary()", () => {
    expect(cache.getDiary()).toBeDefined();
  });

  it("supports TTL-based expiration", async () => {
    const ttlCache = new AgentDiariesCache({
      agentId: "ttl-cache",
      storage: makeStorage(),
      defaultTtlMs: 50, // 50ms TTL
    });

    const generations: Generation[] = [{ text: "Ephemeral" }];
    await ttlCache.update("temp", "llm", generations);

    // Immediately available
    const immediate = await ttlCache.lookup("temp", "llm");
    expect(immediate).toEqual(generations);

    // Wait for TTL expiration
    await new Promise((r) => setTimeout(r, 80));

    const expired = await ttlCache.lookup("temp", "llm");
    expect(expired).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. DeduplicatedTool
// ═══════════════════════════════════════════════════════════════════════════════

describe("DeduplicatedTool", () => {
  it("executes the inner tool and returns the result", async () => {
    const tool = makeMockTool("Search");
    const deduped = new DeduplicatedTool(tool, {
      agentId: "test-dedup",
      storage: makeStorage(),
    });

    const result = await deduped.invoke("latest news");
    expect(result).toBe("Result for: latest news");
  });

  it("preserves name and description from the inner tool", () => {
    const tool = makeMockTool("Calculator");
    const deduped = new DeduplicatedTool(tool);

    expect(deduped.name).toBe("Calculator");
    expect(deduped.description).toBe("A mock tool named Calculator");
  });

  it("deduplicates identical calls — inner tool only called once", async () => {
    let callCount = 0;
    const tool = makeMockTool("Expensive", async (input) => {
      callCount++;
      return `Computed: ${input}`;
    });

    const storage = makeStorage();
    const deduped = new DeduplicatedTool(tool, {
      agentId: "dedup-test",
      storage,
    });

    // First call executes
    const r1 = await deduped.invoke("query");
    expect(r1).toBe("Computed: query");
    expect(callCount).toBe(1);

    // Second call with same input — returns cached
    const r2 = await deduped.invoke("query");
    expect(r2).toBe("Computed: query");
    expect(callCount).toBe(1); // Still 1 — not called again
  });

  it("executes separately for different inputs", async () => {
    let callCount = 0;
    const tool = makeMockTool("Multi", async (input) => {
      callCount++;
      return `Result ${callCount}: ${input}`;
    });

    const deduped = new DeduplicatedTool(tool, {
      agentId: "multi-test",
      storage: makeStorage(),
    });

    await deduped.invoke("alpha");
    await deduped.invoke("beta");
    expect(callCount).toBe(2);
  });

  it("handles concurrent calls — only one execution per unique input", async () => {
    let callCount = 0;
    const tool = makeMockTool("Concurrent", async (input) => {
      callCount++;
      await new Promise((r) => setTimeout(r, 50));
      return `Done: ${input}`;
    });

    const storage = makeStorage();
    const deduped = new DeduplicatedTool(tool, {
      agentId: "concurrent-test",
      storage,
    });

    // 10 concurrent calls with the same input
    const results = await Promise.all(
      Array.from({ length: 10 }, () => deduped.invoke("same-query")),
    );

    // All should return the same result
    for (const r of results) {
      expect(r).toBe("Done: same-query");
    }
    // But only 1 actual execution
    expect(callCount).toBe(1);
  });

  it("supports custom keyBuilder", async () => {
    let callCount = 0;
    const tool = makeMockTool("Custom", async () => {
      callCount++;
      return "result";
    });

    const deduped = new DeduplicatedTool(tool, {
      agentId: "custom-key",
      storage: makeStorage(),
      keyBuilder: (_toolName, input) => `custom:${input.category}`,
    });

    // Same category → deduplicated
    await deduped.invoke({ category: "A", id: 1 });
    await deduped.invoke({ category: "A", id: 2 });
    expect(callCount).toBe(1);

    // Different category → new execution
    await deduped.invoke({ category: "B", id: 3 });
    expect(callCount).toBe(2);
  });

  it("exposes inner tool and diary", () => {
    const tool = makeMockTool("Inner");
    const deduped = new DeduplicatedTool(tool);

    expect(deduped.getInnerTool()).toBe(tool);
    expect(deduped.getDiary()).toBeDefined();
  });
});

describe("deduplicateTools()", () => {
  it("wraps multiple tools at once", () => {
    const tools = [makeMockTool("A"), makeMockTool("B"), makeMockTool("C")];
    const wrapped = deduplicateTools(tools, { agentId: "batch" });

    expect(wrapped).toHaveLength(3);
    expect(wrapped[0].name).toBe("A");
    expect(wrapped[1].name).toBe("B");
    expect(wrapped[2].name).toBe("C");
    wrapped.forEach((w) => expect(w).toBeInstanceOf(DeduplicatedTool));
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. AgentDiariesCallbackHandler
// ═══════════════════════════════════════════════════════════════════════════════

describe("AgentDiariesCallbackHandler", () => {
  let handler: AgentDiariesCallbackHandler;

  beforeEach(() => {
    handler = new AgentDiariesCallbackHandler({
      agentId: "test-callbacks",
      storage: makeStorage(),
    });
  });

  it("has the correct name property", () => {
    expect(handler.name).toBe("AgentDiariesCallbackHandler");
  });

  it("records LLM start/end events and updates stats", async () => {
    await handler.handleLLMStart(
      { name: "gpt-4o" },
      ["What is AI?"],
      "run-1",
    );
    await handler.handleLLMEnd(
      { generations: [[{ text: "AI is..." }]] },
      "run-1",
    );

    const events = handler.getEvents();
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("llm_start");
    expect(events[0].name).toBe("gpt-4o");
    expect(events[0].runId).toBe("run-1");
    expect(events[1].type).toBe("llm_end");

    const stats = handler.getStats();
    expect(stats.llmCalls).toBe(1);
    expect(stats.totalEvents).toBe(2);
  });

  it("records LLM error events", async () => {
    await handler.handleLLMStart({ name: "gpt-4o" }, ["prompt"], "run-err");
    await handler.handleLLMError(
      new Error("Rate limit exceeded"),
      "run-err",
    );

    const stats = handler.getStats();
    expect(stats.llmCalls).toBe(1);
    expect(stats.llmErrors).toBe(1);

    const errors = handler.getEventsByType("llm_error");
    expect(errors).toHaveLength(1);
    expect(errors[0].payload?.error).toBe("Rate limit exceeded");
  });

  it("records tool start/end events", async () => {
    await handler.handleToolStart(
      { name: "TavilySearch" },
      "latest AI news",
      "tool-1",
      "parent-1",
    );
    await handler.handleToolEnd("Search results...", "tool-1");

    const stats = handler.getStats();
    expect(stats.toolCalls).toBe(1);
    expect(stats.totalEvents).toBe(2);

    const events = handler.getEventsByRunId("tool-1");
    expect(events).toHaveLength(2);
    expect(events[0].name).toBe("TavilySearch");
    expect(events[0].parentRunId).toBe("parent-1");
  });

  it("records tool error events", async () => {
    await handler.handleToolStart({ name: "API" }, "input", "terr-1");
    await handler.handleToolError(new Error("Timeout"), "terr-1");

    const stats = handler.getStats();
    expect(stats.toolErrors).toBe(1);
  });

  it("records chain start/end events", async () => {
    await handler.handleChainStart(
      { name: "RetrievalQA" },
      { question: "What is AI?" },
      "chain-1",
    );
    await handler.handleChainEnd({ answer: "AI is..." }, "chain-1");

    const stats = handler.getStats();
    expect(stats.chainCalls).toBe(1);
    expect(stats.totalEvents).toBe(2);
  });

  it("records chain error events", async () => {
    await handler.handleChainStart({ name: "Chain" }, {}, "cerr-1");
    await handler.handleChainError(new Error("Chain failed"), "cerr-1");

    expect(handler.getStats().chainErrors).toBe(1);
  });

  it("records retriever events", async () => {
    await handler.handleRetrieverStart(
      { name: "VectorStore" },
      "AI trends",
      "ret-1",
    );
    await handler.handleRetrieverEnd(
      [{ pageContent: "doc1" }, { pageContent: "doc2" }],
      "ret-1",
    );

    const stats = handler.getStats();
    expect(stats.retrieverCalls).toBe(1);

    const retEnd = handler.getEventsByType("retriever_end");
    expect(retEnd[0].payload?.documentCount).toBe(2);
  });

  it("records retriever error events", async () => {
    await handler.handleRetrieverStart({ name: "Ret" }, "q", "rerr-1");
    await handler.handleRetrieverError(new Error("Index missing"), "rerr-1");

    expect(handler.getStats().retrieverErrors).toBe(1);
  });

  it("records agent action and finish events", async () => {
    await handler.handleAgentAction(
      { tool: "Search", toolInput: "query", log: "Calling search..." },
      "agent-1",
    );
    await handler.handleAgentFinish(
      { returnValues: { output: "Done" }, log: "Final answer" },
      "agent-1",
    );

    const events = handler.getEventsByRunId("agent-1");
    expect(events).toHaveLength(2);
    expect(events[0].type).toBe("agent_action");
    expect(events[0].name).toBe("Search");
    expect(events[1].type).toBe("agent_finish");
  });

  it("supports parent-child run ID correlation", async () => {
    await handler.handleChainStart({ name: "Agent" }, {}, "parent-run");
    await handler.handleLLMStart({ name: "gpt-4o" }, ["prompt"], "child-run", "parent-run");
    await handler.handleToolStart({ name: "Search" }, "q", "tool-run", "child-run");

    const events = handler.getEvents();
    expect(events[1].parentRunId).toBe("parent-run");
    expect(events[2].parentRunId).toBe("child-run");
  });

  it("respects maxEvents limit", async () => {
    const smallHandler = new AgentDiariesCallbackHandler({
      maxEvents: 5,
      storage: makeStorage(),
    });

    for (let i = 0; i < 10; i++) {
      await smallHandler.handleLLMStart({ name: "m" }, ["p"], `run-${i}`);
    }

    expect(smallHandler.getEvents()).toHaveLength(5);
    // Should keep the most recent events
    expect(smallHandler.getEvents()[0].runId).toBe("run-5");
    expect(smallHandler.getEvents()[4].runId).toBe("run-9");
  });

  it("fires onEvent callback for every event", async () => {
    const captured: string[] = [];
    const customHandler = new AgentDiariesCallbackHandler({
      storage: makeStorage(),
      onEvent: (event) => {
        captured.push(event.type);
      },
    });

    await customHandler.handleLLMStart({ name: "m" }, ["p"], "r1");
    await customHandler.handleToolStart({ name: "t" }, "i", "r2");

    expect(captured).toEqual(["llm_start", "tool_start"]);
  });

  it("reset() clears events and stats", async () => {
    await handler.handleLLMStart({ name: "m" }, ["p"], "r1");
    await handler.handleToolStart({ name: "t" }, "i", "r2");

    expect(handler.getEvents()).toHaveLength(2);
    expect(handler.getStats().totalEvents).toBe(2);

    handler.reset();

    expect(handler.getEvents()).toHaveLength(0);
    expect(handler.getStats().totalEvents).toBe(0);
    expect(handler.getStats().llmCalls).toBe(0);
    expect(handler.getStats().toolCalls).toBe(0);
  });

  it("exposes the underlying diary via getDiary()", () => {
    expect(handler.getDiary()).toBeDefined();
  });

  it("persists events when persistEvents is true", async () => {
    const storage = makeStorage();
    const persistHandler = new AgentDiariesCallbackHandler({
      agentId: "persist-test",
      storage,
      persistEvents: true,
    });

    await persistHandler.handleLLMStart({ name: "gpt-4o" }, ["p"], "persist-1");

    // The diary should have a task recorded
    const diary = persistHandler.getDiary();
    const state = await diary.readDiary();
    expect(state.history.length).toBeGreaterThan(0);
  });

  it("includes timestamps in ISO format", async () => {
    await handler.handleLLMStart({ name: "m" }, ["p"], "ts-1");

    const event = handler.getEvents()[0];
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
