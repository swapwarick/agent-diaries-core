import { Tool, ToolContext, ToolResult, ToolPermission } from "./contracts";
import { EventBus } from "../core/events/EventBus";

/**
 * Options controlling a single {@link ToolExecutor.run} call.
 */
export interface ToolExecutorOptions {
  /**
   * Maximum number of retry attempts on failure.
   * Does not retry on `AbortError` (cancellation) or permission errors.
   * @default 0
   */
  maxRetries?: number;
  /**
   * Delay in milliseconds between retry attempts.
   * @default 500
   */
  retryDelayMs?: number;
  /**
   * List of permissions the calling agent has been granted.
   * If provided, the executor validates the tool's declared permissions
   * against this list before execution.
   */
  grantedPermissions?: ToolPermission[];
  /**
   * Optional event bus. When provided, the executor emits a `ToolExecuted`
   * domain event after each tool invocation, enabling zero-instrumentation
   * metrics collection via {@link RuntimeMetricsCollector}.
   */
  eventBus?: EventBus;
}

/**
 * Sandboxed execution engine for {@link Tool} instances.
 *
 * Wraps tool calls with:
 * - **Timeout enforcement** via `AbortSignal`
 * - **Permission validation** against declared permissions
 * - **Optional input validation** via `tool.validate()`
 * - **Retry logic** with configurable backoff
 * - **Execution timing** (populates `ToolResult.durationMs`)
 *
 * @example
 * ```typescript
 * const executor = new ToolExecutor();
 * const result = await executor.run(httpTool, { url: "https://example.com" }, ctx, {
 *   maxRetries: 2,
 *   grantedPermissions: ["network:https"],
 * });
 * ```
 */
export class ToolExecutor {
  /**
   * Executes a tool with full lifecycle management.
   *
   * @param tool    - Tool instance to execute.
   * @param input   - Input payload for the tool.
   * @param context - Execution context with tracing and cancellation.
   * @param options - Executor options (retries, permissions, timeout).
   * @returns A resolved {@link ToolResult} — never throws.
   */
  async run<TIn, TOut>(
    tool: Tool<TIn, TOut>,
    input: TIn,
    context: ToolContext,
    options: ToolExecutorOptions = {},
  ): Promise<ToolResult<TOut>> {
    const { maxRetries = 0, retryDelayMs = 500, grantedPermissions, eventBus } = options;

    // -----------------------------------------------------------------------
    // 1. Permission check
    // -----------------------------------------------------------------------
    if (grantedPermissions !== undefined) {
      const denied = tool.metadata.permissions.filter(
        (p) => !grantedPermissions.includes(p),
      );
      if (denied.length > 0) {
        const result: ToolResult<TOut> = {
          success: false,
          error: `[ToolExecutor] Permission denied for "${tool.metadata.name}". Missing: ${denied.join(", ")}`,
          durationMs: 0,
        };
        await this.emitEvent(eventBus, tool.metadata.name, context, result, 0, false, false);
        return result;
      }
    }

    // -----------------------------------------------------------------------
    // 2. Input validation
    // -----------------------------------------------------------------------
    if (tool.validate) {
      const validation = tool.validate(input);
      if (!validation.valid) {
        const result: ToolResult<TOut> = {
          success: false,
          error: `[ToolExecutor] Input validation failed for "${tool.metadata.name}": ${(validation.errors || []).join("; ")}`,
          durationMs: 0,
        };
        await this.emitEvent(eventBus, tool.metadata.name, context, result, 0, false, false);
        return result;
      }
    }

    // -----------------------------------------------------------------------
    // 3. Execution with timeout + retry
    // -----------------------------------------------------------------------
    let attempt = 0;
    const timeoutMs = context.timeout ?? 30_000;

    while (attempt <= maxRetries) {
      const startTime = Date.now();

      // Build a merged AbortSignal combining caller signal + timeout
      const merged = this.buildSignal(context.signal, timeoutMs);

      try {
        const result = await tool.execute(input, { ...context, signal: merged.signal });
        merged.cleanup();
        const finalResult: ToolResult<TOut> = {
          ...result,
          durationMs: Date.now() - startTime,
        };
        await this.emitEvent(eventBus, tool.metadata.name, context, finalResult, attempt, false, false);
        return finalResult;
      } catch (err: any) {
        merged.cleanup();
        const durationMs = Date.now() - startTime;
        const timedOut = merged.signal.aborted && err?.name !== "AbortError" === false;

        // Never retry on cancellation
        if (err?.name === "AbortError" || merged.signal.aborted) {
          const result: ToolResult<TOut> = {
            success: false,
            error: `[ToolExecutor] Execution cancelled for "${tool.metadata.name}"`,
            durationMs,
          };
          await this.emitEvent(eventBus, tool.metadata.name, context, result, attempt, true, timedOut);
          return result;
        }

        attempt++;
        if (attempt > maxRetries) {
          const result: ToolResult<TOut> = {
            success: false,
            error: `[ToolExecutor] "${tool.metadata.name}" failed after ${attempt} attempt(s): ${err?.message || String(err)}`,
            durationMs,
          };
          await this.emitEvent(eventBus, tool.metadata.name, context, result, attempt, false, false);
          return result;
        }

        // Exponential-ish backoff
        await this.delay(retryDelayMs * attempt);
      }
    }

    // Should not be reached
    return { success: false, error: "ToolExecutor: unexpected exit", durationMs: 0 };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /**
   * Emits a `ToolExecuted` domain event if an EventBus is provided.
   * Silently swallows errors to never disrupt the execution path.
   */
  private async emitEvent<T>(
    eventBus: EventBus | undefined,
    toolName: string,
    context: ToolContext,
    result: ToolResult<T>,
    retryCount: number,
    cancelled: boolean,
    timedOut: boolean,
  ): Promise<void> {
    if (!eventBus) return;
    try {
      await eventBus.emit("ToolExecuted", {
        toolName,
        agentId: context.agentId,
        traceId: context.traceId,
        success: result.success,
        durationMs: result.durationMs,
        cached: result.cached,
        retryCount,
        cancelled,
        timedOut,
      });
    } catch {
      // never fail execution due to metrics emission
    }
  }

  /**
   * Builds a combined AbortSignal from an optional caller signal and a timeout.
   *
   * @param callerSignal - Optional signal from the parent AgentContext.
   * @param timeoutMs    - Maximum execution time.
   * @returns `{ signal, cleanup }` — call cleanup() to clear the timer.
   */
  private buildSignal(
    callerSignal: AbortSignal | undefined,
    timeoutMs: number,
  ): { signal: AbortSignal; cleanup: () => void } {
    const controller = new AbortController();

    // Propagate caller cancellation
    let callerUnsubscribe: (() => void) | undefined;
    if (callerSignal) {
      if (callerSignal.aborted) {
        controller.abort();
      } else {
        const handler = () => controller.abort();
        callerSignal.addEventListener("abort", handler, { once: true });
        callerUnsubscribe = () =>
          callerSignal.removeEventListener("abort", handler);
      }
    }

    // Enforce timeout
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    return {
      signal: controller.signal,
      cleanup: () => {
        clearTimeout(timer);
        callerUnsubscribe?.();
      },
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/** Shared default tool executor singleton. */
export const defaultToolExecutor = new ToolExecutor();
