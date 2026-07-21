/**
 * @module @agent-diaries/core/runtime
 *
 * RuntimeMetricsCollector — zero-instrumentation metrics collection.
 *
 * Subscribes to `DomainEvents` on the `EventBus` and automatically builds
 * rolling statistics for every tool and agent execution.
 *
 * Tool and agent authors do NOT need to add any instrumentation code.
 * The collector operates entirely through the event system.
 *
 * @example
 * ```typescript
 * const collector = new RuntimeMetricsCollector(eventBus);
 *
 * // After some executions...
 * const snap = collector.getToolSnapshot("HttpTool");
 * console.log(snap?.p95DurationMs);
 *
 * const slowest = collector.getSlowestTools(3);
 * ```
 */

import { EventBus } from "../core/events/EventBus";

// ---------------------------------------------------------------------------
// Internal ring buffer
// ---------------------------------------------------------------------------

const MAX_OBSERVATIONS = 1_000;

/** Lightweight ring buffer with O(1) push and O(n) read. */
class RingBuffer<T> {
  private buf: T[] = [];

  constructor(private readonly cap: number = MAX_OBSERVATIONS) {}

  push(item: T): void {
    if (this.buf.length >= this.cap) this.buf.shift();
    this.buf.push(item);
  }

  values(): T[] {
    return [...this.buf];
  }

  get size(): number {
    return this.buf.length;
  }
}

// ---------------------------------------------------------------------------
// Percentile helper
// ---------------------------------------------------------------------------

/** Computes the p-th percentile of a sorted numeric array. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(idx, sorted.length - 1))];
}

// ---------------------------------------------------------------------------
// Metric snapshots
// ---------------------------------------------------------------------------

/**
 * A point-in-time snapshot of execution metrics for a single tool.
 *
 * Computed from the rolling observation window (last 1 000 executions).
 */
export interface ToolMetricSnapshot {
  /** Tool name. */
  toolName: string;
  /** Total number of executions observed. */
  executionCount: number;
  /** Fraction of executions that succeeded (0–1). */
  successRate: number;
  /** Mean execution duration in milliseconds. */
  avgDurationMs: number;
  /** 95th-percentile execution duration in milliseconds. */
  p95DurationMs: number;
  /** 99th-percentile execution duration in milliseconds. */
  p99DurationMs: number;
  /** Absolute number of failed executions. */
  failureCount: number;
  /** Total number of retry attempts observed. */
  retryCount: number;
  /** Total number of executions cancelled via AbortSignal. */
  cancellationCount: number;
  /** Total number of executions that timed out. */
  timeoutCount: number;
  /** Estimated total cost in USD (sum of `estimatedCostUSD` per call). */
  estimatedCostUSD: number;
}

/**
 * A point-in-time snapshot of execution metrics for a single agent.
 *
 * Computed from the rolling observation window (last 1 000 executions).
 */
export interface AgentMetricSnapshot {
  /** Agent ID. */
  agentId: string;
  /** Total number of executions observed. */
  executionCount: number;
  /** Fraction of executions that succeeded (0–1). */
  successRate: number;
  /** Mean execution duration in milliseconds. */
  avgDurationMs: number;
  /** 95th-percentile execution duration in milliseconds. */
  p95DurationMs: number;
  /** 99th-percentile execution duration in milliseconds. */
  p99DurationMs: number;
  /** Absolute number of failed executions. */
  failureCount: number;
}

// ---------------------------------------------------------------------------
// Internal state per tool / agent
// ---------------------------------------------------------------------------

interface ToolState {
  durations: RingBuffer<number>;
  successCount: number;
  failureCount: number;
  retryCount: number;
  cancellationCount: number;
  timeoutCount: number;
  estimatedCostUSD: number;
}

interface AgentState {
  durations: RingBuffer<number>;
  successCount: number;
  failureCount: number;
}

// ---------------------------------------------------------------------------
// RuntimeMetricsCollector
// ---------------------------------------------------------------------------

/**
 * Zero-instrumentation metrics collector for the Agent Diaries runtime.
 *
 * ## How it works
 *
 * 1. Subscribes to `ToolExecuted`, `AgentCompleted`, and `AgentFailed` events.
 * 2. Maintains a rolling ring buffer (last {@link MAX_OBSERVATIONS} observations)
 *    per tool and per agent.
 * 3. Computes P95/P99 on demand from the sorted observation window.
 *
 * ## Thread safety
 * The collector is designed for single-process, in-memory use. For distributed
 * scenarios, replace with a Redis-backed collector via the distributed extension
 * point in `src/runtime/distributed/contracts.ts`.
 *
 * ## Dashboard integration
 * Expose `getAllToolSnapshots()` and `getAllAgentSnapshots()` to the
 * `EnhancedDashboardOverview` built in Sprint 5.
 */
export class RuntimeMetricsCollector {
  private toolStates = new Map<string, ToolState>();
  private agentStates = new Map<string, AgentState>();

  // Per-tool estimated cost registry (set externally for accurate tracking)
  private toolCostPerCall = new Map<string, number>();

  constructor(eventBus: EventBus) {
    // ── ToolExecuted ─────────────────────────────────────────────────────────
    eventBus.on("ToolExecuted", (payload) => {
      const state = this.getOrCreateToolState(payload.toolName);
      state.durations.push(payload.durationMs);
      if (payload.success) {
        state.successCount++;
      } else {
        state.failureCount++;
      }
      if (payload.retryCount) state.retryCount += payload.retryCount;
      if (payload.cancelled) state.cancellationCount++;
      if (payload.timedOut) state.timeoutCount++;

      // Add estimated cost if registered
      const costPerCall = this.toolCostPerCall.get(payload.toolName) ?? 0;
      state.estimatedCostUSD += costPerCall;
    });

    // ── AgentCompleted ────────────────────────────────────────────────────────
    eventBus.on("AgentCompleted", (payload) => {
      const state = this.getOrCreateAgentState(payload.agentId);
      state.durations.push(payload.durationMs);
      state.successCount++;
    });

    // ── AgentFailed ───────────────────────────────────────────────────────────
    eventBus.on("AgentFailed", (payload) => {
      const state = this.getOrCreateAgentState(payload.agentId);
      state.durations.push(payload.durationMs);
      state.failureCount++;
    });
  }

  // ---------------------------------------------------------------------------
  // Cost registration
  // ---------------------------------------------------------------------------

  /**
   * Registers the estimated cost per call (USD) for a tool.
   * Used to accumulate estimated costs in {@link ToolMetricSnapshot.estimatedCostUSD}.
   *
   * Typically called when a tool is registered in {@link AgentRuntime}.
   *
   * @param toolName    - Tool name.
   * @param costPerCall - Estimated USD cost per invocation.
   */
  registerToolCost(toolName: string, costPerCall: number): void {
    this.toolCostPerCall.set(toolName, costPerCall);
  }

  // ---------------------------------------------------------------------------
  // Tool snapshots
  // ---------------------------------------------------------------------------

  /**
   * Returns a metric snapshot for a specific tool.
   *
   * @param toolName - Tool name to query.
   * @returns Snapshot or `undefined` if the tool has never been executed.
   */
  getToolSnapshot(toolName: string): ToolMetricSnapshot | undefined {
    const state = this.toolStates.get(toolName);
    if (!state) return undefined;
    return this.buildToolSnapshot(toolName, state);
  }

  /**
   * Returns metric snapshots for all observed tools.
   *
   * @returns Array of snapshots, one per tool.
   */
  getAllToolSnapshots(): ToolMetricSnapshot[] {
    return Array.from(this.toolStates.entries()).map(([name, state]) =>
      this.buildToolSnapshot(name, state),
    );
  }

  /**
   * Returns the `n` most-called tools, sorted by execution count descending.
   *
   * @param n - Maximum number of results (default: 10).
   */
  getMostUsedTools(n = 10): ToolMetricSnapshot[] {
    return this.getAllToolSnapshots()
      .sort((a, b) => b.executionCount - a.executionCount)
      .slice(0, n);
  }

  /**
   * Returns the `n` slowest tools by P95 duration, descending.
   *
   * @param n - Maximum number of results (default: 10).
   */
  getSlowestTools(n = 10): ToolMetricSnapshot[] {
    return this.getAllToolSnapshots()
      .sort((a, b) => b.p95DurationMs - a.p95DurationMs)
      .slice(0, n);
  }

  /**
   * Returns tools whose success rate falls below `threshold`.
   *
   * @param threshold - Success rate threshold (0–1). Defaults to 0.9 (90%).
   */
  getFailingTools(threshold = 0.9): ToolMetricSnapshot[] {
    return this.getAllToolSnapshots().filter(
      (s) => s.successRate < threshold && s.executionCount > 0,
    );
  }

  // ---------------------------------------------------------------------------
  // Agent snapshots
  // ---------------------------------------------------------------------------

  /**
   * Returns a metric snapshot for a specific agent.
   *
   * @param agentId - Agent ID to query.
   * @returns Snapshot or `undefined` if the agent has never been executed.
   */
  getAgentSnapshot(agentId: string): AgentMetricSnapshot | undefined {
    const state = this.agentStates.get(agentId);
    if (!state) return undefined;
    return this.buildAgentSnapshot(agentId, state);
  }

  /**
   * Returns metric snapshots for all observed agents.
   */
  getAllAgentSnapshots(): AgentMetricSnapshot[] {
    return Array.from(this.agentStates.entries()).map(([id, state]) =>
      this.buildAgentSnapshot(id, state),
    );
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  /**
   * Resets all collected metrics.
   * Primarily useful in test environments between test cases.
   */
  reset(): void {
    this.toolStates.clear();
    this.agentStates.clear();
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getOrCreateToolState(toolName: string): ToolState {
    if (!this.toolStates.has(toolName)) {
      this.toolStates.set(toolName, {
        durations: new RingBuffer(),
        successCount: 0,
        failureCount: 0,
        retryCount: 0,
        cancellationCount: 0,
        timeoutCount: 0,
        estimatedCostUSD: 0,
      });
    }
    return this.toolStates.get(toolName)!;
  }

  private getOrCreateAgentState(agentId: string): AgentState {
    if (!this.agentStates.has(agentId)) {
      this.agentStates.set(agentId, {
        durations: new RingBuffer(),
        successCount: 0,
        failureCount: 0,
      });
    }
    return this.agentStates.get(agentId)!;
  }

  private buildToolSnapshot(toolName: string, state: ToolState): ToolMetricSnapshot {
    const durations = state.durations.values().sort((a, b) => a - b);
    const total = state.successCount + state.failureCount;
    const avg = total > 0 ? durations.reduce((s, d) => s + d, 0) / durations.length : 0;

    return {
      toolName,
      executionCount: total,
      successRate: total > 0 ? state.successCount / total : 0,
      avgDurationMs: Math.round(avg),
      p95DurationMs: percentile(durations, 95),
      p99DurationMs: percentile(durations, 99),
      failureCount: state.failureCount,
      retryCount: state.retryCount,
      cancellationCount: state.cancellationCount,
      timeoutCount: state.timeoutCount,
      estimatedCostUSD: state.estimatedCostUSD,
    };
  }

  private buildAgentSnapshot(agentId: string, state: AgentState): AgentMetricSnapshot {
    const durations = state.durations.values().sort((a, b) => a - b);
    const total = state.successCount + state.failureCount;
    const avg = total > 0 ? durations.reduce((s, d) => s + d, 0) / durations.length : 0;

    return {
      agentId,
      executionCount: total,
      successRate: total > 0 ? state.successCount / total : 0,
      avgDurationMs: Math.round(avg),
      p95DurationMs: percentile(durations, 95),
      p99DurationMs: percentile(durations, 99),
      failureCount: state.failureCount,
    };
  }
}
