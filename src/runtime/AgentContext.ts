import { ToolRegistry } from "../tools/ToolRegistry";

/**
 * Runtime logger interface — thin, structured logging surface.
 * Implementations can bridge to pino, winston, console, or OpenTelemetry.
 */
export interface RuntimeLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Immutable per-execution context injected into every {@link Agent.execute} call.
 *
 * `AgentContext` provides:
 * - **Tracing** — a `traceId` correlated to the parent workflow's trace span
 * - **Cancellation** — an `AbortSignal` that fires when the runtime cancels the agent
 * - **Tool access** — a permission-scoped {@link ToolRegistry} view
 * - **Structured logging** — a `logger` bound to this execution's trace context
 * - **Metadata** — arbitrary key-value pairs forwarded from the workflow
 *
 * Agents MUST propagate `signal` to any async I/O they perform.
 *
 * @example
 * ```typescript
 * async execute(input: string, ctx: AgentContext) {
 *   const http = ctx.tools.get("HttpTool");
 *   if (!http) throw new Error("HttpTool not available");
 *
 *   ctx.logger.info("Fetching resource", { url: input });
 *   const result = await http.execute({ url: input }, {
 *     traceId: ctx.traceId,
 *     signal: ctx.signal,
 *   });
 *   return { success: true, data: result.data, durationMs: 0, agentId: "my-agent" };
 * }
 * ```
 */
export interface AgentContext {
  /**
   * Trace ID from the parent {@link TracingService} span.
   * Forward this to tool calls and nested operations for distributed tracing.
   */
  readonly traceId: string;

  /**
   * Workflow ID this execution belongs to, if any.
   */
  readonly workflowId?: string;

  /**
   * ID of the agent being executed (mirrors `AgentMetadata.id`).
   */
  readonly agentId: string;

  /**
   * Cancellation signal. Fired by the runtime when:
   * - A timeout is exceeded
   * - The parent workflow is cancelled
   * - `ctx.cancel()` is called explicitly
   *
   * Agents MUST propagate this to all async I/O.
   */
  readonly signal: AbortSignal;

  /**
   * Permission-scoped tool registry.
   * Only contains tools declared in {@link AgentMetadata.requiredTools}.
   */
  readonly tools: ToolRegistry;

  /**
   * Structured logger bound to this execution's trace context.
   */
  readonly logger: RuntimeLogger;

  /**
   * Arbitrary metadata forwarded from the workflow payload or template step.
   */
  readonly metadata: Record<string, unknown>;

  /**
   * Requests cancellation of this agent execution.
   * Triggers `signal.abort()` and propagates through tool calls.
   */
  cancel(): void;
}

/**
 * Default console-based logger — used when no custom logger is provided.
 * @internal
 */
export class ConsoleRuntimeLogger implements RuntimeLogger {
  constructor(private readonly prefix: string = "[Runtime]") {}

  debug(message: string, meta?: Record<string, unknown>): void {
    if (meta) console.debug(`${this.prefix} ${message}`, meta);
    else console.debug(`${this.prefix} ${message}`);
  }

  info(message: string, meta?: Record<string, unknown>): void {
    if (meta) console.info(`${this.prefix} ${message}`, meta);
    else console.info(`${this.prefix} ${message}`);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    if (meta) console.warn(`${this.prefix} ${message}`, meta);
    else console.warn(`${this.prefix} ${message}`);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    if (meta) console.error(`${this.prefix} ${message}`, meta);
    else console.error(`${this.prefix} ${message}`);
  }
}
