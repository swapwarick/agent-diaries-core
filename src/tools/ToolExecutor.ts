import { Tool, ToolContext, ToolResult, ToolPermission } from "./contracts";

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
    const { maxRetries = 0, retryDelayMs = 500, grantedPermissions } = options;

    // -----------------------------------------------------------------------
    // 1. Permission check
    // -----------------------------------------------------------------------
    if (grantedPermissions !== undefined) {
      const denied = tool.metadata.permissions.filter(
        (p) => !grantedPermissions.includes(p),
      );
      if (denied.length > 0) {
        return {
          success: false,
          error: `[ToolExecutor] Permission denied for "${tool.metadata.name}". Missing: ${denied.join(", ")}`,
          durationMs: 0,
        };
      }
    }

    // -----------------------------------------------------------------------
    // 2. Input validation
    // -----------------------------------------------------------------------
    if (tool.validate) {
      const validation = tool.validate(input);
      if (!validation.valid) {
        return {
          success: false,
          error: `[ToolExecutor] Input validation failed for "${tool.metadata.name}": ${(validation.errors || []).join("; ")}`,
          durationMs: 0,
        };
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
        return {
          ...result,
          durationMs: Date.now() - startTime,
        };
      } catch (err: any) {
        merged.cleanup();
        const durationMs = Date.now() - startTime;

        // Never retry on cancellation
        if (err?.name === "AbortError" || merged.signal.aborted) {
          return {
            success: false,
            error: `[ToolExecutor] Execution cancelled for "${tool.metadata.name}"`,
            durationMs,
          };
        }

        attempt++;
        if (attempt > maxRetries) {
          return {
            success: false,
            error: `[ToolExecutor] "${tool.metadata.name}" failed after ${attempt} attempt(s): ${err?.message || String(err)}`,
            durationMs,
          };
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
