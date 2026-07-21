import { describe, it, expect, beforeEach } from "vitest";
import { EventBus } from "../../../src/core/events/EventBus";
import { RuntimeMetricsCollector } from "../../../src/runtime/RuntimeMetricsCollector";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function emitToolSuccess(bus: EventBus, toolName: string, durationMs: number) {
  await bus.emit("ToolExecuted", { toolName, success: true, durationMs });
}

async function emitToolFailure(bus: EventBus, toolName: string, durationMs: number, opts?: { retryCount?: number; cancelled?: boolean; timedOut?: boolean }) {
  await bus.emit("ToolExecuted", {
    toolName,
    success: false,
    durationMs,
    retryCount: opts?.retryCount,
    cancelled: opts?.cancelled,
    timedOut: opts?.timedOut,
  });
}

async function emitAgentComplete(bus: EventBus, agentId: string, durationMs: number) {
  await bus.emit("AgentCompleted", { agentId, traceId: "t1", toolsUsed: [], durationMs });
}

async function emitAgentFail(bus: EventBus, agentId: string, durationMs: number) {
  await bus.emit("AgentFailed", { agentId, traceId: "t1", error: "oops", durationMs });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("RuntimeMetricsCollector", () => {
  let bus: EventBus;
  let collector: RuntimeMetricsCollector;

  beforeEach(() => {
    bus = new EventBus();
    collector = new RuntimeMetricsCollector(bus);
  });

  // ── Tool snapshot ─────────────────────────────────────────────────────────

  it("returns undefined for a tool with no executions", () => {
    expect(collector.getToolSnapshot("Unknown")).toBeUndefined();
  });

  it("tracks successful executions", async () => {
    await emitToolSuccess(bus, "Http", 100);
    await emitToolSuccess(bus, "Http", 200);
    const snap = collector.getToolSnapshot("Http")!;
    expect(snap.executionCount).toBe(2);
    expect(snap.successRate).toBe(1);
    expect(snap.failureCount).toBe(0);
  });

  it("tracks failed executions", async () => {
    await emitToolSuccess(bus, "Http", 50);
    await emitToolFailure(bus, "Http", 50);
    const snap = collector.getToolSnapshot("Http")!;
    expect(snap.successRate).toBeCloseTo(0.5);
    expect(snap.failureCount).toBe(1);
  });

  it("tracks retry count", async () => {
    await emitToolFailure(bus, "Http", 100, { retryCount: 2 });
    await emitToolFailure(bus, "Http", 100, { retryCount: 1 });
    const snap = collector.getToolSnapshot("Http")!;
    expect(snap.retryCount).toBe(3);
  });

  it("tracks cancellation count", async () => {
    await emitToolFailure(bus, "Http", 10, { cancelled: true });
    await emitToolFailure(bus, "Http", 10, { cancelled: true });
    expect(collector.getToolSnapshot("Http")!.cancellationCount).toBe(2);
  });

  it("tracks timeout count", async () => {
    await emitToolFailure(bus, "Http", 30000, { timedOut: true });
    expect(collector.getToolSnapshot("Http")!.timeoutCount).toBe(1);
  });

  it("computes p95 and p99 from sorted observations", async () => {
    // Emit 100 executions with durations 1ms..100ms
    for (let i = 1; i <= 100; i++) {
      await emitToolSuccess(bus, "Bench", i);
    }
    const snap = collector.getToolSnapshot("Bench")!;
    expect(snap.p95DurationMs).toBe(95);
    expect(snap.p99DurationMs).toBe(99);
    expect(snap.avgDurationMs).toBe(51); // ceil(50.5)
  });

  // ── Cost tracking ─────────────────────────────────────────────────────────

  it("accumulates estimated cost when registered", async () => {
    collector.registerToolCost("GPT4", 0.002);
    await emitToolSuccess(bus, "GPT4", 500);
    await emitToolSuccess(bus, "GPT4", 500);
    const snap = collector.getToolSnapshot("GPT4")!;
    expect(snap.estimatedCostUSD).toBeCloseTo(0.004);
  });

  // ── getAllToolSnapshots ────────────────────────────────────────────────────

  it("getAllToolSnapshots returns one entry per unique tool", async () => {
    await emitToolSuccess(bus, "A", 10);
    await emitToolSuccess(bus, "B", 20);
    await emitToolSuccess(bus, "B", 30);
    const all = collector.getAllToolSnapshots();
    expect(all.map((s) => s.toolName).sort()).toEqual(["A", "B"]);
  });

  // ── getMostUsedTools ──────────────────────────────────────────────────────

  it("getMostUsedTools returns tools sorted by execution count", async () => {
    for (let i = 0; i < 5; i++) await emitToolSuccess(bus, "Popular", 10);
    for (let i = 0; i < 2; i++) await emitToolSuccess(bus, "Rare", 10);
    const top = collector.getMostUsedTools(2);
    expect(top[0].toolName).toBe("Popular");
    expect(top[1].toolName).toBe("Rare");
  });

  // ── getSlowestTools ───────────────────────────────────────────────────────

  it("getSlowestTools returns tools sorted by p95 descending", async () => {
    for (let i = 1; i <= 100; i++) await emitToolSuccess(bus, "Slow", i * 10);
    for (let i = 1; i <= 100; i++) await emitToolSuccess(bus, "Fast", i);
    const slowest = collector.getSlowestTools(2);
    expect(slowest[0].toolName).toBe("Slow");
  });

  // ── getFailingTools ───────────────────────────────────────────────────────

  it("getFailingTools returns tools below success threshold", async () => {
    for (let i = 0; i < 3; i++) await emitToolFailure(bus, "Flaky", 10);
    for (let i = 0; i < 7; i++) await emitToolSuccess(bus, "Flaky", 10);
    await emitToolSuccess(bus, "Good", 10);

    const failing = collector.getFailingTools(0.9);
    expect(failing.map((f) => f.toolName)).toContain("Flaky");
    expect(failing.map((f) => f.toolName)).not.toContain("Good");
  });

  // ── Agent snapshots ───────────────────────────────────────────────────────

  it("tracks agent completions", async () => {
    await emitAgentComplete(bus, "agent-a", 500);
    await emitAgentComplete(bus, "agent-a", 1000);
    const snap = collector.getAgentSnapshot("agent-a")!;
    expect(snap.executionCount).toBe(2);
    expect(snap.successRate).toBe(1);
  });

  it("tracks agent failures", async () => {
    await emitAgentComplete(bus, "agent-b", 100);
    await emitAgentFail(bus, "agent-b", 200);
    const snap = collector.getAgentSnapshot("agent-b")!;
    expect(snap.successRate).toBeCloseTo(0.5);
    expect(snap.failureCount).toBe(1);
  });

  it("returns undefined for agent with no executions", () => {
    expect(collector.getAgentSnapshot("ghost")).toBeUndefined();
  });

  // ── reset ─────────────────────────────────────────────────────────────────

  it("reset clears all collected data", async () => {
    await emitToolSuccess(bus, "Http", 10);
    await emitAgentComplete(bus, "agent-a", 100);
    collector.reset();
    expect(collector.getToolSnapshot("Http")).toBeUndefined();
    expect(collector.getAgentSnapshot("agent-a")).toBeUndefined();
    expect(collector.getAllToolSnapshots()).toHaveLength(0);
  });
});
