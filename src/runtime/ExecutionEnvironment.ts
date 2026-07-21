/**
 * @module @agent-diaries/core/runtime
 *
 * ExecutionEnvironment — the dependency injection root for the Agent Diaries runtime.
 *
 * All shared services (ToolRegistry, AgentRegistry, EventBus, TracingService,
 * MetricsEngine, Logger) are assembled here and injected into every agent
 * execution through {@link AgentLifecycle} and {@link AgentContext}.
 *
 * This design means:
 * - Tool implementations have zero knowledge of the logger, EventBus, or storage.
 * - Agent implementations only interact with their injected {@link AgentContext}.
 * - The runtime can be swapped for a distributed backend by replacing the
 *   environment's services without touching a single tool or agent.
 *
 * @example
 * ```typescript
 * const env = ExecutionEnvironment.create({
 *   eventBus: myBus,
 *   logger: new PinoRuntimeLogger(),
 * });
 *
 * await env.warmup();     // calls initialize() on all registered tools
 * // ... run agents ...
 * await env.shutdown();   // calls cleanup() on all tools
 * ```
 */

import { ToolRegistry } from "../tools/ToolRegistry";
import { AgentRegistry } from "../agents/AgentRegistry";
import { ToolHealthStatus } from "../tools/contracts";
import { AgentHealthReport } from "../agents/AgentRegistry";
import { EventBus, defaultEventBus } from "../core/events/EventBus";
import { TracingService } from "../core/tracing/TracingService";
import { MetricsEngine } from "../core/metrics/MetricsEngine";
import { RuntimeLogger, ConsoleRuntimeLogger } from "./RuntimeLogger";

// ---------------------------------------------------------------------------
// Warmup result
// ---------------------------------------------------------------------------

/**
 * Result returned by {@link ExecutionEnvironment.warmup}.
 * Summarizes the initialization state of all registered tools and agents.
 */
export interface WarmupResult {
  /** Names of tools successfully initialized. */
  initializedTools: string[];
  /** Health statuses of all registered tools after warmup. */
  toolHealth: ToolHealthStatus[];
  /** Health reports for all registered agents after warmup. */
  agentHealth: AgentHealthReport[];
  /** Total warmup duration in milliseconds. */
  durationMs: number;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Construction options for {@link ExecutionEnvironment}.
 *
 * All fields are optional — `ExecutionEnvironment.create()` applies sensible
 * defaults so the runtime works with zero configuration in tests and scripts.
 */
export interface ExecutionEnvironmentOptions {
  /** Tool registry. Defaults to a new empty {@link ToolRegistry}. */
  toolRegistry?: ToolRegistry;
  /** Agent registry. Defaults to a new empty {@link AgentRegistry}. */
  agentRegistry?: AgentRegistry;
  /** Event bus. Defaults to {@link defaultEventBus}. */
  eventBus?: EventBus;
  /**
   * Tracing service. Optional — when absent, agent spans are not persisted
   * but traceIds are still generated and forwarded to tools.
   */
  tracingService?: TracingService;
  /**
   * Metrics engine. Optional — when absent, metrics are not persisted to
   * storage but {@link RuntimeMetricsCollector} still collects in-memory stats.
   */
  metricsEngine?: MetricsEngine;
  /** Logger. Defaults to {@link ConsoleRuntimeLogger}. */
  logger?: RuntimeLogger;
}

// ---------------------------------------------------------------------------
// ExecutionEnvironment
// ---------------------------------------------------------------------------

/**
 * Dependency injection root for the Agent Diaries runtime.
 *
 * ## Responsibilities
 * - Assembles all shared services into a single, injectable unit.
 * - Exposes `warmup()` to initialize tools before execution begins.
 * - Exposes `shutdown()` for graceful cleanup.
 * - Acts as the factory for {@link AgentContext} instances via {@link AgentLifecycle}.
 *
 * ## Extension points
 * For distributed runtimes:
 * - Replace `eventBus` with a {@link QueueTransport}-backed implementation.
 * - Replace `toolRegistry` with a remote-aware registry.
 * - Replace `tracingService` with an OpenTelemetry bridge.
 *
 * None of these swaps require changes to tool or agent implementations.
 */
export class ExecutionEnvironment {
  /** Tool registry holding all registered tools. */
  readonly tools: ToolRegistry;
  /** Agent registry holding all registered agents. */
  readonly agents: AgentRegistry;
  /** Event bus for domain event pub-sub. */
  readonly eventBus: EventBus;
  /** Optional tracing service for distributed span management. */
  readonly tracing?: TracingService;
  /** Optional metrics persistence engine. */
  readonly metrics?: MetricsEngine;
  /** Structured logger bound to this environment. */
  readonly logger: RuntimeLogger;

  private _warmedUp = false;
  private _shutdown = false;

  constructor(opts: ExecutionEnvironmentOptions = {}) {
    this.tools = opts.toolRegistry ?? new ToolRegistry();
    this.agents = opts.agentRegistry ?? new AgentRegistry();
    this.eventBus = opts.eventBus ?? defaultEventBus;
    this.tracing = opts.tracingService;
    this.metrics = opts.metricsEngine;
    this.logger = opts.logger ?? new ConsoleRuntimeLogger("[ExecutionEnvironment]");
  }

  // ---------------------------------------------------------------------------
  // Factory
  // ---------------------------------------------------------------------------

  /**
   * Creates an `ExecutionEnvironment` with sensible defaults.
   * All options are optional — a zero-config environment is valid for testing.
   *
   * @param opts - Partial options; missing values use defaults.
   */
  static create(opts: Partial<ExecutionEnvironmentOptions> = {}): ExecutionEnvironment {
    return new ExecutionEnvironment(opts);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Warms up the environment:
   * 1. Calls `initialize()` on all registered tools that implement it.
   * 2. Runs a health check sweep on all tools.
   * 3. Runs a health check sweep on all agents.
   *
   * Should be called once before the first agent execution.
   * Idempotent — subsequent calls are no-ops.
   *
   * @returns {@link WarmupResult} with initialization and health information.
   */
  async warmup(): Promise<WarmupResult> {
    if (this._warmedUp) {
      this.logger.warn("warmup() called more than once — ignoring.");
      return {
        initializedTools: [],
        toolHealth: [],
        agentHealth: [],
        durationMs: 0,
      };
    }

    const start = Date.now();
    this.logger.info("Warming up execution environment…");

    const initializedTools = await this.tools.initializeAll();
    const toolHealth = await this.tools.healthCheck();
    const agentHealth = await this.agents.healthCheck();

    this._warmedUp = true;
    const durationMs = Date.now() - start;

    const degraded = toolHealth.filter(
      (h) => !h.healthy || h.state === "degraded",
    );
    if (degraded.length > 0) {
      this.logger.warn(`Warmup complete with ${degraded.length} degraded tool(s).`, {
        degradedTools: degraded.map((h) => h.name),
        durationMs,
      });
    } else {
      this.logger.info("Warmup complete — all tools healthy.", {
        initializedTools,
        durationMs,
      });
    }

    return { initializedTools, toolHealth, agentHealth, durationMs };
  }

  /**
   * Gracefully shuts down the environment:
   * 1. Calls `cleanup()` on all registered tools.
   * 2. Marks the environment as shut down.
   *
   * After `shutdown()`, the environment should not be used for new executions.
   * Idempotent — subsequent calls are no-ops.
   */
  async shutdown(): Promise<void> {
    if (this._shutdown) return;

    this.logger.info("Shutting down execution environment…");
    await this.tools.cleanupAll();
    this._shutdown = true;
    this.logger.info("Execution environment shut down.");
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** Whether `warmup()` has been called and completed. */
  get isWarmedUp(): boolean {
    return this._warmedUp;
  }

  /** Whether `shutdown()` has been called and completed. */
  get isShutdown(): boolean {
    return this._shutdown;
  }
}
