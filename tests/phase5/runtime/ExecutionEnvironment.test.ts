import { describe, it, expect, beforeEach } from "vitest";
import { ExecutionEnvironment } from "../../../src/runtime/ExecutionEnvironment";
import { ToolRegistry } from "../../../src/tools/ToolRegistry";
import { AgentRegistry } from "../../../src/agents/AgentRegistry";
import { EventBus } from "../../../src/core/events/EventBus";
import { Tool, ToolMetadata, ToolContext, ToolResult } from "../../../src/tools/contracts";
import { Agent, AgentMetadata, AgentResult, ValidationResult, CostEstimate, DurationEstimate, HealthStatus } from "../../../src/agents/contracts";
import type { AgentContext } from "../../../src/runtime/AgentContext";
import { SilentRuntimeLogger } from "../../../src/runtime/RuntimeLogger";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

function makeTool(name: string, opts?: { failInit?: boolean; failCleanup?: boolean }): Tool {
  return {
    metadata: {
      name,
      version: "1.0.0",
      description: "Test",
      capabilities: ["test"],
      permissions: [],
      category: "utility",
    },
    async execute(): Promise<ToolResult> {
      return { success: true, durationMs: 5 };
    },
    async initialize() {
      if (opts?.failInit) throw new Error("init failed");
    },
    async cleanup() {
      if (opts?.failCleanup) throw new Error("cleanup failed");
    },
    async healthCheck() {
      return { state: "healthy" as const, checkedAt: Date.now() };
    },
  };
}

function makeAgent(id: string): Agent {
  const meta: AgentMetadata = {
    id,
    name: id,
    version: "1.0.0",
    category: "ai",
    capabilities: [{ name: "test" }],
  };
  return {
    metadata: meta,
    async execute(): Promise<AgentResult> {
      return { success: true, durationMs: 10, agentId: id };
    },
    validate(): ValidationResult { return { valid: true }; },
    estimateCost(): CostEstimate { return {}; },
    estimateDuration(): DurationEstimate { return { estimatedMs: 100, confidence: "medium" }; },
    async healthCheck(): Promise<HealthStatus> { return { healthy: true }; },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExecutionEnvironment", () => {
  let env: ExecutionEnvironment;

  beforeEach(() => {
    env = ExecutionEnvironment.create({ logger: new SilentRuntimeLogger() });
  });

  // ── Construction ─────────────────────────────────────────────────────────

  it("creates with default empty registries", () => {
    expect(env.tools.size).toBe(0);
    expect(env.agents.size).toBe(0);
  });

  it("accepts injected registries", async () => {
    const tools = new ToolRegistry();
    const agents = new AgentRegistry();
    await tools.register(makeTool("MyTool"));
    const custom = ExecutionEnvironment.create({ toolRegistry: tools, agentRegistry: agents });
    expect(custom.tools.size).toBe(1);
    expect(custom.agents.size).toBe(0);
  });

  it("accepts injected event bus", () => {
    const bus = new EventBus();
    const custom = ExecutionEnvironment.create({ eventBus: bus });
    expect(custom.eventBus).toBe(bus);
  });

  // ── State flags ───────────────────────────────────────────────────────────

  it("isWarmedUp is false before warmup", () => {
    expect(env.isWarmedUp).toBe(false);
  });

  it("isShutdown is false before shutdown", () => {
    expect(env.isShutdown).toBe(false);
  });

  // ── Warmup ────────────────────────────────────────────────────────────────

  it("warmup calls initialize on all tools", async () => {
    let inited = false;
    const tool = makeTool("T");
    (tool as any).initialize = async () => { inited = true; };
    await env.tools.register(tool);
    await env.warmup();
    expect(inited).toBe(true);
    expect(env.isWarmedUp).toBe(true);
  });

  it("warmup returns tool health statuses", async () => {
    await env.tools.register(makeTool("A"));
    const result = await env.warmup();
    expect(result.toolHealth).toHaveLength(1);
    expect(result.toolHealth[0].name).toBe("A");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("warmup is idempotent — second call is a no-op", async () => {
    await env.warmup();
    const r2 = await env.warmup();
    expect(r2.initializedTools).toHaveLength(0);
    expect(r2.toolHealth).toHaveLength(0);
  });

  it("warmup continues even when a tool's initialize() throws", async () => {
    const bad = makeTool("Bad", { failInit: true });
    const good = makeTool("Good");
    await env.tools.register(bad);
    await env.tools.register(good);
    const result = await env.warmup();
    // "Good" initialized, "Bad" failed but didn't block
    expect(result.initializedTools).toContain("Good");
    expect(result.initializedTools).not.toContain("Bad");
  });

  // ── Shutdown ──────────────────────────────────────────────────────────────

  it("shutdown calls cleanup on all tools", async () => {
    let cleaned = false;
    const tool = makeTool("T");
    (tool as any).cleanup = async () => { cleaned = true; };
    await env.tools.register(tool);
    await env.shutdown();
    expect(cleaned).toBe(true);
    expect(env.isShutdown).toBe(true);
  });

  it("shutdown is idempotent — second call is a no-op", async () => {
    let cleanupCount = 0;
    const tool = makeTool("T");
    (tool as any).cleanup = async () => { cleanupCount++; };
    await env.tools.register(tool);
    await env.shutdown();
    await env.shutdown();
    expect(cleanupCount).toBe(1);
  });

  it("shutdown swallows cleanup errors", async () => {
    const bad = makeTool("Bad", { failCleanup: true });
    await env.tools.register(bad);
    // Should not throw
    await expect(env.shutdown()).resolves.toBeUndefined();
  });
});
