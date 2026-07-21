import { describe, it, expect, beforeEach } from "vitest";
import { AgentLifecycle, AgentNotFoundError, AgentValidationError } from "../../../src/runtime/AgentLifecycle";
import { ExecutionEnvironment } from "../../../src/runtime/ExecutionEnvironment";
import { AgentRegistry } from "../../../src/agents/AgentRegistry";
import { ToolRegistry } from "../../../src/tools/ToolRegistry";
import { EventBus } from "../../../src/core/events/EventBus";
import { Agent, AgentMetadata, AgentResult, ValidationResult, CostEstimate, DurationEstimate, HealthStatus } from "../../../src/agents/contracts";
import type { AgentContext } from "../../../src/runtime/AgentContext";
import { Tool, ToolContext, ToolResult } from "../../../src/tools/contracts";
import { SilentRuntimeLogger } from "../../../src/runtime/RuntimeLogger";

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------

function makeTool(name: string, requiredCap = "test:run"): Tool {
  return {
    metadata: {
      name,
      version: "1.0.0",
      description: "stub",
      capabilities: [requiredCap],
      permissions: [],
    },
    async execute(): Promise<ToolResult> {
      return { success: true, durationMs: 5 };
    },
  };
}

function makeAgent(
  id: string,
  opts?: {
    requiredTools?: string[];
    executeImpl?: (input: unknown, ctx: AgentContext) => Promise<AgentResult>;
    validateResult?: ValidationResult;
  },
): Agent {
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
      return { success: true, durationMs: 10, agentId: id };
    },
    validate(): ValidationResult {
      return opts?.validateResult ?? { valid: true };
    },
    estimateCost(): CostEstimate { return {}; },
    estimateDuration(): DurationEstimate { return { estimatedMs: 100, confidence: "medium" }; },
    async healthCheck(): Promise<HealthStatus> { return { healthy: true }; },
  };
}

function makeEnv(agents: Agent[] = [], tools: Tool[] = []): ExecutionEnvironment {
  const toolReg = new ToolRegistry();
  const agentReg = new AgentRegistry();
  for (const t of tools) void toolReg.register(t);
  for (const a of agents) agentReg.register(a);
  return ExecutionEnvironment.create({
    toolRegistry: toolReg,
    agentRegistry: agentReg,
    eventBus: new EventBus(),
    logger: new SilentRuntimeLogger(),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentLifecycle", () => {
  // ── Agent not found ───────────────────────────────────────────────────────

  it("throws AgentNotFoundError when agent is not registered", async () => {
    const lifecycle = new AgentLifecycle(makeEnv());
    await expect(lifecycle.run("ghost", {})).rejects.toThrow(AgentNotFoundError);
  });

  // ── Happy path ────────────────────────────────────────────────────────────

  it("runs an agent and returns a successful AgentResult", async () => {
    const agent = makeAgent("summarizer");
    const lifecycle = new AgentLifecycle(makeEnv([agent]));
    const result = await lifecycle.run("summarizer", "some text");
    expect(result.success).toBe(true);
    expect(result.agentId).toBe("summarizer");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(result.traceId).toBeDefined();
  });

  // ── Input validation ─────────────────────────────────────────────────────

  it("throws AgentValidationError when validate() returns invalid", async () => {
    const agent = makeAgent("bad", {
      validateResult: { valid: false, errors: ["input is required"] },
    });
    const lifecycle = new AgentLifecycle(makeEnv([agent]));
    await expect(lifecycle.run("bad", null)).rejects.toThrow(AgentValidationError);
  });

  it("validation error message includes the agent errors", async () => {
    const agent = makeAgent("strict", {
      validateResult: { valid: false, errors: ["must be a string", "too short"] },
    });
    const lifecycle = new AgentLifecycle(makeEnv([agent]));
    try {
      await lifecycle.run("strict", 123);
    } catch (err: any) {
      expect(err.validationErrors).toEqual(["must be a string", "too short"]);
    }
  });

  // ── Tool injection ────────────────────────────────────────────────────────

  it("injects scoped tools from agent.metadata.requiredTools", async () => {
    let receivedTools: string[] = [];
    const agent = makeAgent("tool-user", {
      requiredTools: ["ToolA"],
      executeImpl: async (_input, ctx) => {
        receivedTools = ctx.tools.list().map((m) => m.name);
        return { success: true, durationMs: 5, agentId: "tool-user" };
      },
    });
    const toolA = makeTool("ToolA");
    const toolB = makeTool("ToolB");
    const lifecycle = new AgentLifecycle(makeEnv([agent], [toolA, toolB]));
    await lifecycle.run("tool-user", {});
    // Only ToolA should be visible
    expect(receivedTools).toContain("ToolA");
    expect(receivedTools).not.toContain("ToolB");
  });

  it("injects all tools when agent declares no requiredTools", async () => {
    let toolCount = 0;
    const agent = makeAgent("all-tools", {
      executeImpl: async (_input, ctx) => {
        toolCount = ctx.tools.size;
        return { success: true, durationMs: 5, agentId: "all-tools" };
      },
    });
    const lifecycle = new AgentLifecycle(makeEnv([agent], [makeTool("A"), makeTool("B")]));
    await lifecycle.run("all-tools", {});
    expect(toolCount).toBe(2);
  });

  // ── AgentContext ──────────────────────────────────────────────────────────

  it("injects traceId into AgentContext", async () => {
    let capturedTraceId = "";
    const agent = makeAgent("tracer", {
      executeImpl: async (_input, ctx) => {
        capturedTraceId = ctx.traceId;
        return { success: true, durationMs: 5, agentId: "tracer" };
      },
    });
    const lifecycle = new AgentLifecycle(makeEnv([agent]));
    const result = await lifecycle.run("tracer", {});
    expect(capturedTraceId).toBe(result.traceId);
    expect(capturedTraceId).toMatch(/[0-9a-f-]{36}/); // UUID format
  });

  it("injects metadata into AgentContext", async () => {
    let capturedMeta: Record<string, unknown> = {};
    const agent = makeAgent("meta-user", {
      executeImpl: async (_input, ctx) => {
        capturedMeta = ctx.metadata;
        return { success: true, durationMs: 5, agentId: "meta-user" };
      },
    });
    const lifecycle = new AgentLifecycle(makeEnv([agent]));
    await lifecycle.run("meta-user", {}, { metadata: { env: "test", version: 2 } });
    expect(capturedMeta).toMatchObject({ env: "test", version: 2 });
  });

  // ── Failure handling ──────────────────────────────────────────────────────

  it("returns failed AgentResult when agent.execute() throws", async () => {
    const agent = makeAgent("exploder", {
      executeImpl: async () => { throw new Error("agent crashed"); },
    });
    const lifecycle = new AgentLifecycle(makeEnv([agent]));
    const result = await lifecycle.run("exploder", {});
    expect(result.success).toBe(false);
    expect(result.error).toContain("agent crashed");
  });

  // ── Domain events ─────────────────────────────────────────────────────────

  it("emits AgentStarted and AgentCompleted on success", async () => {
    const started: string[] = [];
    const completed: string[] = [];
    const bus = new EventBus();
    bus.on("AgentStarted", ({ agentId }) => started.push(agentId));
    bus.on("AgentCompleted", ({ agentId }) => completed.push(agentId));

    const toolReg = new ToolRegistry();
    const agentReg = new AgentRegistry();
    agentReg.register(makeAgent("eventer"));
    const env = ExecutionEnvironment.create({
      toolRegistry: toolReg,
      agentRegistry: agentReg,
      eventBus: bus,
      logger: new SilentRuntimeLogger(),
    });

    await new AgentLifecycle(env).run("eventer", {});
    expect(started).toContain("eventer");
    expect(completed).toContain("eventer");
  });

  it("emits AgentFailed on execution error", async () => {
    const failed: string[] = [];
    const bus = new EventBus();
    bus.on("AgentFailed", ({ agentId }) => failed.push(agentId));

    const agentReg = new AgentRegistry();
    agentReg.register(makeAgent("crasher", {
      executeImpl: async () => { throw new Error("boom"); },
    }));
    const env = ExecutionEnvironment.create({
      agentRegistry: agentReg,
      eventBus: bus,
      logger: new SilentRuntimeLogger(),
    });

    await new AgentLifecycle(env).run("crasher", {});
    expect(failed).toContain("crasher");
  });

  // ── Timeout ───────────────────────────────────────────────────────────────

  it("returns a failed result after timeout and signal is aborted", async () => {
    const agent = makeAgent("slow", {
      executeImpl: async (_input, ctx) => {
        await new Promise<void>((_, reject) => {
          ctx.signal.addEventListener("abort", () => {
            const e = new Error("AbortError"); e.name = "AbortError"; reject(e);
          });
        });
        return { success: true, durationMs: 0, agentId: "slow" };
      },
    });
    const lifecycle = new AgentLifecycle(makeEnv([agent]));
    const result = await lifecycle.run("slow", {}, { timeout: 100 });
    expect(result.success).toBe(false);
  });
});
