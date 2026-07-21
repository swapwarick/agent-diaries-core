/**
 * @module @agent-diaries/core/runtime
 *
 * Structured logger interface for the Agent Diaries runtime.
 *
 * By extracting `RuntimeLogger` from `AgentContext.ts` into its own module,
 * we avoid circular dependency chains when `ExecutionEnvironment` needs the
 * logger type without depending on `AgentContext`.
 *
 * Implementations can bridge to any logging library:
 * - `ConsoleRuntimeLogger` — zero-dependency default
 * - `PinoRuntimeLogger`    — high-performance structured logging
 * - `WinstonRuntimeLogger` — enterprise-grade logging
 * - `OpenTelemetryLogger`  — OTel-compatible logging
 */

/**
 * Thin, structured logging interface used across the Agent Diaries runtime.
 *
 * All runtime components (AgentRuntime, AgentLifecycle, ToolExecutor, etc.)
 * receive a `RuntimeLogger` via dependency injection rather than relying on
 * `console.*` directly, enabling full observability without coupling to a
 * specific logging library.
 */
export interface RuntimeLogger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Default `console`-based `RuntimeLogger` implementation.
 *
 * Used when no custom logger is provided to `ExecutionEnvironment` or
 * `AgentRuntime`. Binds a configurable prefix to every log line.
 *
 * @example
 * ```typescript
 * const logger = new ConsoleRuntimeLogger("[MyAgent]");
 * logger.info("Starting execution", { traceId: "abc" });
 * // → [MyAgent] Starting execution { traceId: 'abc' }
 * ```
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

/** Shared no-op logger — useful in tests when log output is unwanted. */
export class SilentRuntimeLogger implements RuntimeLogger {
  debug(_m: string, _meta?: Record<string, unknown>): void {}
  info(_m: string, _meta?: Record<string, unknown>): void {}
  warn(_m: string, _meta?: Record<string, unknown>): void {}
  error(_m: string, _meta?: Record<string, unknown>): void {}
}
