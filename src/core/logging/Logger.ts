/**
 * @module @agent-diaries/core/logging
 *
 * Structured logging abstraction for benchmark observability.
 *
 * Log levels (ordered least → most verbose):
 *  - `quiet`    — no output
 *  - `progress` — scenario milestones and pass/fail results
 *  - `verbose`  — general operational info (diary reads, task outcomes)
 *  - `trace`    — full event stream: lock events, diary HIT/MISS, retries, recovery
 *
 * Benchmark code must never call `console.log()` directly.
 * Use a `Logger` instance obtained from `createLogger()` instead.
 */

// ---------------------------------------------------------------------------
// Log level
// ---------------------------------------------------------------------------

/** Supported log verbosity levels, ordered from least to most verbose. */
export type LogLevel = "quiet" | "progress" | "verbose" | "trace";

/**
 * Numeric weights for log level comparison.
 * A message at level `L` is emitted only when `LogLevelOrder[L] <= LogLevelOrder[activeLevel]`.
 */
export const LogLevelOrder: Readonly<Record<LogLevel, number>> = {
  quiet: 0,
  progress: 1,
  verbose: 2,
  trace: 3,
} as const;

// ---------------------------------------------------------------------------
// Trace event types
// ---------------------------------------------------------------------------

/**
 * Named trace events emitted by the coordination pipeline.
 * All internal event paths use these string literals — never raw strings.
 */
export type TraceEventType =
  | "diary:hit"           // Diary lookup returned an existing record
  | "diary:miss"          // Diary lookup found no record (task is new)
  | "lock:acquired"       // Mutex / lock was successfully acquired
  | "lock:failed"         // Lock acquisition was rejected (already held)
  | "lock:released"       // Lock was released after task completion
  | "task:executed"       // Task was executed by this worker
  | "task:skipped"        // Task was skipped (already claimed by another)
  | "recovery:triggered"  // A recovery cycle was initiated for a stale task
  | "retry:attempt";      // A retry attempt was made after transient failure

// ---------------------------------------------------------------------------
// Logger interface
// ---------------------------------------------------------------------------

/**
 * Core logger interface. All benchmark and coordination code depends only
 * on this interface — never on a concrete implementation.
 */
export interface Logger {
  /** The active log level. */
  readonly level: LogLevel;

  /**
   * Returns `true` if messages at `level` will be emitted given the active level.
   * Use this to guard expensive context-object construction.
   */
  isEnabled(level: LogLevel): boolean;

  /**
   * Emit a progress message — visible in `progress`, `verbose`, and `trace` modes.
   * Use for scenario milestones: start, finish, pass/fail verdict.
   */
  progress(message: string, context?: Record<string, unknown>): void;

  /**
   * Emit a verbose message — visible in `verbose` and `trace` modes.
   * Use for operational info: task counts, iteration markers, timing.
   */
  verbose(message: string, context?: Record<string, unknown>): void;

  /**
   * Emit a named trace event — visible only in `trace` mode.
   * Use for the full event stream: diary HIT/MISS, lock events, retries, recovery.
   */
  trace(event: TraceEventType, context?: Record<string, unknown>): void;
}
