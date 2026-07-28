import { Logger, LogLevel, LogLevelOrder, TraceEventType } from "./Logger";

// ---------------------------------------------------------------------------
// NullLogger
// ---------------------------------------------------------------------------

/**
 * A no-op logger that discards all output.
 *
 * Use in `quiet` mode or in production paths where benchmark observability
 * output is not desired. Zero allocations beyond the call itself.
 *
 * @example
 * ```typescript
 * const log: Logger = new NullLogger();
 * log.progress("this is silently dropped");
 * ```
 */
export class NullLogger implements Logger {
  readonly level: LogLevel = "quiet";

  isEnabled(_level: LogLevel): boolean {
    return false;
  }

  progress(_message: string, _context?: Record<string, unknown>): void {}
  verbose(_message: string, _context?: Record<string, unknown>): void {}
  trace(_event: TraceEventType, _context?: Record<string, unknown>): void {}
}

// ---------------------------------------------------------------------------
// BenchmarkLogger
// ---------------------------------------------------------------------------

/**
 * Benchmark-aware structured logger that formats output for the validation suite.
 *
 * All scenario progress, lock events, diary events, and recovery events flow
 * through this abstraction. Benchmark code must **never** call `console.log()`
 * directly — use this logger instead.
 *
 * ## Output format by level
 *
 * **progress** (scenario milestones):
 * ```
 * Running Hot Key  iterations=200/500 executed=1 skipped=199
 * ✔ hot-key [PASS]  duration=30.9s
 * ```
 *
 * **verbose** (operational info):
 * ```
 *   » Diary read  key="task:intel:u917"
 *   » Lock acquired  worker="worker-47"
 *   » Task executed  key="task:intel:u917"
 * ```
 *
 * **trace** (full event stream):
 * ```
 *     [Diary MISS ]  key="task:intel:u917" worker="worker-47"
 *     [Lock   ACQ ]  key="diary_agent-1"   worker="worker-47"
 *     [Task  EXEC ]  key="task:intel:u917" worker="worker-47"
 *     [Lock   REL ]  key="diary_agent-1"   worker="worker-47"
 * ```
 *
 * @example
 * ```typescript
 * const log = new BenchmarkLogger("trace");
 * log.progress("Scenario started", { scenario: "chaos", agents: 100 });
 * log.trace("diary:miss", { key: "task:intel:u917", worker: "worker-47" });
 * log.trace("lock:acquired", { key: "diary_agent-1", worker: "worker-47" });
 * log.trace("task:executed", { key: "task:intel:u917" });
 * log.trace("lock:released", { key: "diary_agent-1" });
 * ```
 */
export class BenchmarkLogger implements Logger {
  readonly level: LogLevel;
  private readonly _write: (line: string) => void;

  /**
   * @param level  Active log level — controls which messages are emitted.
   * @param write  Optional custom write sink. Defaults to `process.stdout`.
   *               Inject a custom sink in tests to capture output without
   *               polluting the test runner's output stream.
   */
  constructor(
    level: LogLevel = "progress",
    write?: (line: string) => void,
  ) {
    this.level = level;
    this._write = write ?? ((line) => process.stdout.write(line + "\n"));
  }

  isEnabled(level: LogLevel): boolean {
    return LogLevelOrder[level] <= LogLevelOrder[this.level];
  }

  progress(message: string, context?: Record<string, unknown>): void {
    if (this.isEnabled("progress")) {
      this._emit(message, context);
    }
  }

  verbose(message: string, context?: Record<string, unknown>): void {
    if (this.isEnabled("verbose")) {
      this._emit("  » " + message, context);
    }
  }

  trace(event: TraceEventType, context?: Record<string, unknown>): void {
    if (this.isEnabled("trace")) {
      const label = BenchmarkLogger._eventLabel(event);
      const ctx = context ? " " + this._kvs(context) : "";
      this._write(`    [${label}]${ctx}`);
    }
  }

  private _emit(message: string, context?: Record<string, unknown>): void {
    const ctx =
      context && Object.keys(context).length > 0
        ? " " + this._kvs(context)
        : "";
    this._write(message + ctx);
  }

  private _kvs(context: Record<string, unknown>): string {
    return Object.entries(context)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
      .join(" ");
  }

  private static _eventLabel(event: TraceEventType): string {
    const labels: Record<TraceEventType, string> = {
      "diary:hit":          "Diary  HIT ",
      "diary:miss":         "Diary MISS ",
      "lock:acquired":      "Lock   ACQ ",
      "lock:failed":        "Lock  FAIL ",
      "lock:released":      "Lock   REL ",
      "task:executed":      "Task  EXEC ",
      "task:skipped":       "Task  SKIP ",
      "recovery:triggered": "RECOVERY   ",
      "retry:attempt":      "RETRY      ",
    };
    return labels[event] ?? event;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a {@link Logger} from a CLI flag string (e.g. `--trace`, `--verbose`).
 *
 * Maps any unrecognised string to `"progress"` as a safe default so callers
 * never need to validate the input themselves.
 *
 * @param level  Raw string from a CLI flag (e.g. `process.argv` value).
 * @param write  Optional custom write sink forwarded to {@link BenchmarkLogger}.
 *
 * @example
 * ```typescript
 * // In your CLI entry point:
 * const log = createLogger(args["--log-level"]);
 * log.progress("Validation Suite started");
 * ```
 */
export function createLogger(
  level: string | undefined,
  write?: (line: string) => void,
): Logger {
  const valid: LogLevel[] = ["quiet", "progress", "verbose", "trace"];
  const resolved: LogLevel = valid.includes(level as LogLevel)
    ? (level as LogLevel)
    : "progress";

  if (resolved === "quiet") {
    return new NullLogger();
  }

  return new BenchmarkLogger(resolved, write);
}
