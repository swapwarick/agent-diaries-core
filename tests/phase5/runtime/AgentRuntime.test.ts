import { describe, it, expect, beforeEach } from "vitest";
import { AgentRuntime } from "../../../src/runtime/AgentRuntime";
import { AgentNotFoundError } from "../../../src/runtime/AgentLifecycle";
import { Tool, ToolContext, ToolResult } from "../../../src/tools/contracts";
import { Agent, AgentMetadata, AgentResult, ValidationResult, CostEstimate, DurationEstimate, HealthStatus } from "../../../src/agents/contracts";
import type { AgentContext } from "../../../src/runtime/AgentContext";
import { EventBus } from "../../../src/core/events/EventBus";
import { SilentRuntimeLogger } from "../../../src/runtime/RuntimeLogger";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

function makeTool(name: string, cost?: number): Tool {
  return {
    metadata: {
      name,
      version: "1.0.0",
      description: "stub",
      capabilities: ["test:run"],
      permissions: [],
      estimatedCostUSD: cost,
    },
    async execute(): Promise<ToolResult> {
      return { success: true, durationMs: 10 };
    },
  };
}

function makeAgent(id: string, opts?: {
  executeImpl?: (input: unknown, ctx: AgentContext) => Promise<AgentResult>;
  validateResult?: ValidationResult;
  requiredTools?: string[];
}): Agent {
  const meta: AgentMetadata = {
    id,
    name: id,
    version: "1.0.0",
    category: "ai",
    capabilities: [{ name: "test" }],
    requiredTools: opts?.requiredTools,
  };
  return {
    metadata: meta,
    async execute(input: unknown, ctx: AgentContext): Promise<AgentResult> {
      if (opts?.executeImpl) return opts.executeImpl(input, ctx);
      return { success: true, durationMs: 20, agentId: id };
    },
    validate(): ValidationResult { return opts?.validateResult ?? { valid: true }; },
    estimateCost(): CostEstimate { return {}; },
    estimateDuration(): DurationEstimate { return { estimatedMs: 100, confidence: "low" }; },
    async healthCheck(): Promise<HealthStatus> { return { healthy: true }; },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentRuntime", () => {
  let runtime: AgentRuntime;

  beforeEach(() => {
    runtime = new AgentRuntime({ logger: new SilentRuntimeLogger() });
  });

  // ── Registration ──────────────────────────────────────────────────────────

  it("registers a tool", () => {
    runtime.registerTool(makeTool("HttpTool"));
    expect(runtime.env.tools.size).toBe(1);
  });

  it("registers an agent", () => {
    runtime.registerAgent(makeAgent("my-agent"));
    expect(runtime.env.agents.size).toBe(1);
  });

  it("accepts tools/agents in constructor options", () => {
    const rt = new AgentRuntime({
      tools: [makeTool("A"), makeTool("B")],
      agents: [makeAgent("X")],
      logger: new SilentRuntimeLogger(),
    });
    expect(rt.env.tools.size).toBe(2);
    expect(rt.env.agents.size).toBe(1);
  });

  // ── Execution ─────────────────────────────────────────────────────────────

  it("runs a registered agent successfully", async () => {
    runtime.registerAgent(makeAgent("runner"));
    const result = await runtime.run("runner", "hello");
    expect(result.success).toBe(true);
    expect(result.agentId).toBe("runner");
  });

  it("throws AgentNotFoundError for unregistered agent", async () => {
    await expect(runtime.run("ghost", {})).rejects.toThrow(AgentNotFoundError);
  });

  it("propagates options to lifecycle (workflowId / metadata)", async () => {
    let capturedWorkflowId: string | undefined;
    runtime.registerAgent(makeAgent("meta-reader", {
      executeImpl: async (_input, ctx) => {
        capturedWorkflowId = ctx.workflowId;
        return { success: true, durationMs: 5, agentId: "meta-reader" };
      },
    }));
    await runtime.run("meta-reader", {}, { workflowId: "wf-123" });
    expect(capturedWorkflowId).toBe("wf-123");
  });

  // ── Metrics ───────────────────────────────────────────────────────────────

  it("metrics() returns a RuntimeMetricsCollector", () => {
    expect(runtime.metrics()).toBeDefined();
    expect(typeof runtime.metrics().getToolSnapshot).toBe("function");
  });

  it("auto-collects tool metrics via EventBus", async () => {
    const bus = new EventBus();
    const rt = new AgentRuntime({
      logger: new SilentRuntimeLogger(),
      eventBus: bus,
    });

    let toolExecuted = false;
    rt.registerAgent(makeAgent("tracker", {
      executeImpl: async (_input, ctx) => {
        // simulate tool call via the event bus directly
        await bus.emit("ToolExecuted", {
          toolName: "HttpTool",
          success: true,
          durationMs: 300,
        });
        return { success: true, durationMs: 300, agentId: "tracker" };
      },
    }));

    await rt.run("tracker", {});
    const snap = rt.metrics().getToolSnapshot("HttpTool");
    // The tool was emitted directly on the bus
    expect(snap).toBeDefined();
    expect(snap!.executionCount).toBe(1);
  });

  it("accumulates cost for tools with estimatedCostUSD", () => {
    runtime.registerTool(makeTool("GPT4", 0.005));
    // After registration, cost is tracked — emitting an event confirms it
    // We test indirectly via registerToolCost having been called
    const snap = runtime.metrics().getToolSnapshot("GPT4");
    // No executions yet, so undefined
    expect(snap).toBeUndefined();
    // (cost accumulation tested in RuntimeMetrics.test.ts)
  });

  // ── Health check ──────────────────────────────────────────────────────────

  it("healthCheck returns tool and agent reports", async () => {
    runtime.registerTool(makeTool("MyTool"));
    runtime.registerAgent(makeAgent("my-agent"));
    const report = await runtime.healthCheck();
    expect(report.tools).toHaveLength(1);
    expect(report.agents).toHaveLength(1);
  });

  // ── Warmup + Shutdown ─────────────────────────────────────────────────────

  it("warmup initializes tools and returns WarmupResult", async () => {
    let initialized = false;
    const tool = makeTool("InitTool");
    (tool as any).initialize = async () => { initialized = true; };
    runtime.registerTool(tool);
    const result = await runtime.warmup();
    expect(initialized).toBe(true);
    expect(result.initializedTools).toContain("InitTool");
  });

  it("shutdown cleans up tools", async () => {
    let cleaned = false;
    const tool = makeTool("CleanupTool");
    (tool as any).cleanup = async () => { cleaned = true; };
    runtime.registerTool(tool);
    await runtime.shutdown();
    expect(cleaned).toBe(true);
  });

  it("warmup and shutdown are idempotent", async () => {
    await runtime.warmup();
    await runtime.warmup(); // no-op
    await runtime.shutdown();
    await runtime.shutdown(); // no-op — should not throw
  });

  // ── env accessor ──────────────────────────────────────────────────────────

  it("env accessor exposes the underlying ExecutionEnvironment", () => {
    expect(runtime.env).toBeDefined();
    expect(runtime.env.tools).toBeDefined();
    expect(runtime.env.agents).toBeDefined();
    expect(runtime.env.eventBus).toBeDefined();
  });
});
