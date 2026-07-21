/**
 * @module @agent-diaries/core/runtime
 *
 * AgentLifecycle — the 11-step execution pipeline runner.
 *
 * Responsibilities:
 * 1. Resolves the agent from {@link AgentRegistry}.
 * 2. Builds an {@link AbortController} wiring timeout + external cancellation.
 * 3. Creates a permission-scoped {@link ToolRegistry} view.
 * 4. Builds the {@link DefaultAgentContext} (concrete {@link AgentContext}).
 * 5. Calls `agent.validate(input)`.
 * 6. Starts a tracing span.
 * 7. Emits `AgentStarted`.
 * 8. Calls `agent.execute(input, context)`.
 * 9. Finishes the tracing span.
 * 10. Emits `AgentCompleted` or `AgentFailed`.
 * 11. Returns the {@link AgentResult}.
 *
 * @example
 * ```typescript
 * const lifecycle = new AgentLifecycle(env);
 * const result = await lifecycle.run("summarizer", "Long document text…", {
 *   timeout: 30_000,
 * });
 * ```
 */

import { randomUUID } from "crypto";
import { ExecutionEnvironment } from "./ExecutionEnvironment";
import { AgentContext } from "./AgentContext";
import { RuntimeLogger } from "./RuntimeLogger";
import { ToolRegistry } from "../tools/ToolRegistry";
import { AgentResult } from "../agents/contracts";
import { ToolPermission } from "../tools/contracts";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Per-execution options for {@link AgentLifecycle.run}.
 */
export interface AgentLifecycleOptions {
  /**
   * Maximum execution time in milliseconds.
   * When exceeded, the agent's `AbortSignal` is fired.
   * @default 60_000 (60 seconds)
   */
  timeout?: number;
  /**
   * Default maximum tool retry attempts forwarded to {@link ToolExecutor}.
   * Individual agent implementations may override this per tool call.
   * @default 0
   */
  maxToolRetries?: number;
  /**
   * Permissions explicitly granted to this execution.
   * When absent, tool permission checks rely on agent.metadata.requiredTools.
   */
  grantedPermissions?: ToolPermission[];
  /**
   * Parent workflow ID for correlation.
   */
  workflowId?: string;
  /**
   * Arbitrary metadata forwarded to the {@link AgentContext}.
   */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Thrown when an agent ID cannot be resolved in the {@link AgentRegistry}. */
export class AgentNotFoundError extends Error {
  constructor(agentId: string) {
    super(`[AgentLifecycle] Agent "${agentId}" is not registered.`);
    this.name = "AgentNotFoundError";
  }
}

/** Thrown when `agent.validate(input)` returns `valid: false`. */
export class AgentValidationError extends Error {
  constructor(
    agentId: string,
    public readonly validationErrors: string[],
  ) {
    super(
      `[AgentLifecycle] Validation failed for agent "${agentId}": ${validationErrors.join("; ")}`,
    );
    this.name = "AgentValidationError";
  }
}

// ---------------------------------------------------------------------------
// DefaultAgentContext
// ---------------------------------------------------------------------------

/**
 * Concrete implementation of {@link AgentContext}.
 *
 * Built by {@link AgentLifecycle} from the components of an
 * {@link ExecutionEnvironment}. Agents never construct this directly.
 *
 * @internal
 */
class DefaultAgentContext implements AgentContext {
  readonly traceId: string;
  readonly workflowId?: string;
  readonly agentId: string;
  readonly signal: AbortSignal;
  readonly tools: ToolRegistry;
  readonly logger: RuntimeLogger;
  readonly metadata: Record<string, unknown>;

  private readonly _controller: AbortController;

  constructor(opts: {
    traceId: string;
    workflowId?: string;
    agentId: string;
    controller: AbortController;
    tools: ToolRegistry;
    logger: RuntimeLogger;
    metadata: Record<string, unknown>;
  }) {
    this.traceId = opts.traceId;
    this.workflowId = opts.workflowId;
    this.agentId = opts.agentId;
    this._controller = opts.controller;
    this.signal = opts.controller.signal;
    this.tools = opts.tools;
    this.logger = opts.logger;
    this.metadata = opts.metadata;
  }

  cancel(): void {
    this._controller.abort();
  }
}

// ---------------------------------------------------------------------------
// AgentLifecycle
// ---------------------------------------------------------------------------

/**
 * Orchestrates the 11-step execution pipeline for a single agent invocation.
 *
 * ## Pipeline
 * ```
 * run(agentId, input, opts)
 *   1. Resolve agent         → AgentNotFoundError
 *   2. Build AbortController → wires timeout + external cancel
 *   3. Scoped ToolRegistry   → from agent.metadata.requiredTools
 *   4. Build AgentContext    → inject env, traceId, signal, tools
 *   5. agent.validate(input) → AgentValidationError
 *   6. TracingService.startSpan()
 *   7. EventBus.emit("AgentStarted")
 *   8. agent.execute(input, context)
 *   9. TracingService.finishSpan()
 *  10. EventBus.emit("AgentCompleted" | "AgentFailed")
 *  11. return AgentResult
 * ```
 *
 * ## Extension points
 * Override or wrap `AgentLifecycle` to inject additional middleware:
 * - Pre-execution hooks (cost limits, rate limiting)
 * - Post-execution hooks (logging, audit trails)
 * - Distributed tracing bridges (OpenTelemetry)
 */
export class AgentLifecycle {
  constructor(private readonly env: ExecutionEnvironment) {}

  /**
   * Runs the full 11-step execution pipeline for the given agent.
   *
   * @param agentId - Registered agent ID.
   * @param input   - Input payload passed to `agent.execute()`.
   * @param opts    - Per-execution options.
   * @returns Resolved {@link AgentResult} — never throws (errors are captured in the result).
   */
  async run<TIn, TOut>(
    agentId: string,
    input: TIn,
    opts: AgentLifecycleOptions = {},
  ): Promise<AgentResult<TOut>> {
    const {
      timeout = 60_000,
      workflowId,
      metadata = {},
    } = opts;

    const startTime = Date.now();

    // ── Step 1: Resolve agent ──────────────────────────────────────────────
    const agent = this.env.agents.get(agentId);
    if (!agent) {
      throw new AgentNotFoundError(agentId);
    }

    // ── Step 2: Build AbortController ─────────────────────────────────────
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    // ── Step 3: Scoped ToolRegistry ────────────────────────────────────────
    const requiredTools = agent.metadata.requiredTools ?? [];
    const scopedTools =
      requiredTools.length > 0
        ? this.env.tools.scoped(new Set(requiredTools))
        : this.env.tools; // no restriction if agent doesn't declare tools

    // ── Step 4: Build AgentContext ─────────────────────────────────────────
    const traceId = randomUUID();
    const ctx = new DefaultAgentContext({
      traceId,
      workflowId,
      agentId,
      controller,
      tools: scopedTools,
      logger: this.env.logger,
      metadata,
    });

    // ── Step 5: Validate input ─────────────────────────────────────────────
    let validationResult: { valid: boolean; errors?: string[] };
    try {
      validationResult = agent.validate(input);
    } catch (err: any) {
      clearTimeout(timer);
      throw new AgentValidationError(agentId, [err?.message ?? "validate() threw"]);
    }

    if (!validationResult.valid) {
      clearTimeout(timer);
      throw new AgentValidationError(agentId, validationResult.errors ?? ["invalid input"]);
    }

    // ── Steps 6–7: Trace + event ───────────────────────────────────────────
    let spanId: string | undefined;
    let traceRecord: { traceId: string } | undefined;

    try {
      if (this.env.tracing) {
        traceRecord = await this.env.tracing.startTrace(`agent.${agentId}`, workflowId);
        const span = await this.env.tracing.startSpan(traceRecord.traceId, "agent.execute");
        spanId = span.spanId;
      }
    } catch {
      // tracing failure must never block execution
    }

    await this.safeEmit("AgentStarted", { agentId, traceId, workflowId });

    // ── Step 8: Execute agent ──────────────────────────────────────────────
    let result: AgentResult<TOut>;
    try {
      const raw = await (agent.execute as (i: TIn, c: AgentContext) => Promise<AgentResult<TOut>>)(
        input,
        ctx,
      );
      clearTimeout(timer);

      result = {
        ...raw,
        durationMs: Date.now() - startTime,
        traceId,
      };

      // ── Steps 9–10: Finish trace + emit completed ────────────────────────
      await this.finishTrace(traceRecord?.traceId, spanId, "ok");
      await this.safeEmit("AgentCompleted", {
        agentId,
        traceId,
        workflowId,
        durationMs: result.durationMs,
        toolsUsed: result.toolsUsed ?? [],
      });
    } catch (err: any) {
      clearTimeout(timer);
      const durationMs = Date.now() - startTime;

      await this.finishTrace(traceRecord?.traceId, spanId, "error");
      await this.safeEmit("AgentFailed", {
        agentId,
        traceId,
        workflowId,
        error: err?.message ?? String(err),
        durationMs,
      });

      result = {
        success: false,
        error: err?.message ?? String(err),
        durationMs,
        agentId,
        traceId,
      };
    }

    return result;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async safeEmit<K extends "AgentStarted" | "AgentCompleted" | "AgentFailed">(
    event: K,
    payload: any,
  ): Promise<void> {
    try {
      await this.env.eventBus.emit(event, payload);
    } catch {
      // never let event emission failure block execution
    }
  }

  private async finishTrace(
    traceId: string | undefined,
    spanId: string | undefined,
    status: "ok" | "error",
  ): Promise<void> {
    if (!this.env.tracing || !traceId) return;
    try {
      if (spanId) await this.env.tracing.finishSpan(traceId, spanId, status);
      await this.env.tracing.finishTrace(
        traceId,
        status === "ok" ? "completed" : "failed",
      );
    } catch {
      // tracing failure must never block execution
    }
  }
}
