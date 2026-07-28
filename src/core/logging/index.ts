/**
 * @module @agent-diaries/core/logging
 *
 * Structured logging abstractions for benchmark observability.
 *
 * @example
 * ```typescript
 * import { createLogger } from "@agent-diaries/core/logging";
 *
 * const log = createLogger(process.env.LOG_LEVEL ?? "progress");
 * log.progress("Scenario started", { scenario: "chaos" });
 * log.trace("diary:miss", { key: "task:intel:u917" });
 * ```
 */

export type { Logger, LogLevel, TraceEventType } from "./Logger";
export { LogLevelOrder } from "./Logger";
export { ConsoleLogger } from "./ConsoleLogger";
export { NullLogger, BenchmarkLogger, createLogger } from "./BenchmarkLogger";
