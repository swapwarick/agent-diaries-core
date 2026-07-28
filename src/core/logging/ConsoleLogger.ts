import { Logger, LogLevel, LogLevelOrder, TraceEventType } from "./Logger";

/**
 * A thin `console`-backed implementation of {@link Logger}.
 *
 * Output goes to `process.stdout` (progress/verbose) and `process.stderr`
 * is never touched — the benchmark runner controls all output routing.
 *
 * Suitable for direct use in tests or when no custom write sink is needed.
 *
 * @example
 * ```typescript
 * const log = new ConsoleLogger("verbose");
 * log.progress("Scenario started", { scenario: "chaos" });
 * log.trace("diary:miss", { key: "task:intel:u917", worker: "worker-47" });
 * ```
 */
export class ConsoleLogger implements Logger {
  readonly level: LogLevel;

  constructor(level: LogLevel = "progress") {
    this.level = level;
  }

  isEnabled(level: LogLevel): boolean {
    return LogLevelOrder[level] <= LogLevelOrder[this.level];
  }

  progress(message: string, context?: Record<string, unknown>): void {
    if (this.isEnabled("progress")) {
      process.stdout.write(this._format(message, context) + "\n");
    }
  }

  verbose(message: string, context?: Record<string, unknown>): void {
    if (this.isEnabled("verbose")) {
      process.stdout.write("  » " + this._format(message, context) + "\n");
    }
  }

  trace(event: TraceEventType, context?: Record<string, unknown>): void {
    if (this.isEnabled("trace")) {
      const label = ConsoleLogger._eventLabel(event);
      const ctx = context ? " " + this._kvs(context) : "";
      process.stdout.write(`    [${label}]${ctx}\n`);
    }
  }

  private _format(message: string, context?: Record<string, unknown>): string {
    if (!context || Object.keys(context).length === 0) return message;
    return `${message} ${this._kvs(context)}`;
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
