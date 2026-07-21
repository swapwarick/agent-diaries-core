/**
 * @module @agent-diaries/core/runtime
 *
 * AgentRuntime — the central public facade for the Agent Diaries runtime.
 *
 * Consumer-facing API that ties together all Sprint 2 components:
 * - {@link ExecutionEnvironment} (DI container)
 * - {@link AgentLifecycle} (execution pipeline)
 * - {@link RuntimeMetricsCollector} (auto-metrics)
 *
 * ## Quick start
 * ```typescript
 * import { AgentRuntime } from "@agent-diaries/core/runtime";
 *
 * const runtime = new AgentRuntime();
 * runtime.registerTool(new HttpTool());
 * runtime.registerAgent(new SummaryAgent());
 *
 * await runtime.warmup();
 * const result = await runtime.run("summary-agent", { text: "..." });
 * console.log(runtime.metrics().getToolSnapshot("HttpTool"));
 * await runtime.shutdown();
 * ```
 *
 * ## Integrating with existing systems
 * ```typescript
 * const runtime = new AgentRuntime({
 *   eventBus: existingEventBus,    // re-use the framework's EventBus
 *   tracingService: existingTracer, // plug in existing TracingService
 * });
 * ```
 */

import { Tool } from "../tools/contracts";
import { Agent } from "../agents/contracts";
import { AgentResult } from "../agents/contracts";
import { ToolHealthStatus } from "../tools/contracts";
import { AgentHealthReport } from "../agents/AgentRegistry";
import { EventBus } from "../core/events/EventBus";
import { TracingService } from "../core/tracing/TracingService";
import { MetricsEngine } from "../core/metrics/MetricsEngine";
import { RuntimeLogger } from "./RuntimeLogger";
import { ExecutionEnvironment, ExecutionEnvironmentOptions, WarmupResult } from "./ExecutionEnvironment";
import { AgentLifecycle, AgentLifecycleOptions } from "./AgentLifecycle";
import { RuntimeMetricsCollector } from "./RuntimeMetricsCollector";

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/**
 * Construction options for {@link AgentRuntime}.
 *
 * All fields are optional — a zero-config runtime is valid for tests.
 */
export interface AgentRuntimeOptions {
  /**
   * Pre-built tools to register on startup.
   * Equivalent to calling `runtime.registerTool(tool)` for each.
   */
  tools?: Tool[];
  /**
   * Pre-built agents to register on startup.
   * Equivalent to calling `runtime.registerAgent(agent)` for each.
   */
  agents?: Agent[];
  /** Event bus. Defaults to the framework's `defaultEventBus`. */
  eventBus?: EventBus;
  /** Tracing service. Optional. */
  tracingService?: TracingService;
  /** Metrics engine. Optional. */
  metricsEngine?: MetricsEngine;
  /** Logger. Defaults to `ConsoleRuntimeLogger`. */
  logger?: RuntimeLogger;
}

// ---------------------------------------------------------------------------
// Combined health report
// ---------------------------------------------------------------------------

/** Full health report returned by {@link AgentRuntime.healthCheck}. */
export interface RuntimeHealthReport {
  tools: ToolHealthStatus[];
  agents: AgentHealthReport[];
}

// ---------------------------------------------------------------------------
// AgentRuntime
// ---------------------------------------------------------------------------

/**
 * Central public facade for the Agent Diaries runtime.
 *
 * ## Responsibilities
 * - **Registration** — accepts tools and agents and routes them to the
 *   underlying `ExecutionEnvironment`.
 * - **Execution** — delegates to `AgentLifecycle.run()` for the full
 *   11-step pipeline.
 * - **Observability** — exposes a `RuntimeMetricsCollector` that auto-
 *   collects metrics from `DomainEvents` with zero instrumentation.
 * - **Lifecycle** — `warmup()` + `shutdown()` for clean start/stop.
 *
 * ## Architecture fit
 * `AgentRuntime` sits above all other Phase 5 components and is the entry
 * point for both application code and the future CLI scaffolding.
 *
 * Future `@agent-diaries/transport-*` packages can replace the underlying
 * `ExecutionEnvironment` without changing the `AgentRuntime` public API.
 */
export class AgentRuntime {
  private readonly _env: ExecutionEnvironment;
  private readonly _lifecycle: AgentLifecycle;
  private readonly _metricsCollector: RuntimeMetricsCollector;

  constructor(opts: AgentRuntimeOptions = {}) {
    const envOpts: ExecutionEnvironmentOptions = {
      eventBus: opts.eventBus,
      tracingService: opts.tracingService,
      metricsEngine: opts.metricsEngine,
      logger: opts.logger,
    };

    this._env = new ExecutionEnvironment(envOpts);
    this._lifecycle = new AgentLifecycle(this._env);
    this._metricsCollector = new RuntimeMetricsCollector(this._env.eventBus);

    // Register pre-supplied tools and agents
    if (opts.tools) {
      for (const tool of opts.tools) {
        this.registerTool(tool);
      }
    }
    if (opts.agents) {
      for (const agent of opts.agents) {
        this.registerAgent(agent);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  /**
   * Registers a tool in the runtime's tool registry.
   *
   * @param tool - Tool instance implementing the {@link Tool} interface.
   */
  registerTool(tool: Tool): void {
    // ToolRegistry.register is now async (for autoInit support),
    // but we call it synchronously here (autoInit=false default).
    // initialize() is deferred to warmup().
    void this._env.tools.register(tool);

    // Register estimated cost for metrics collection
    if (tool.metadata.estimatedCostUSD !== undefined) {
      this._metricsCollector.registerToolCost(
        tool.metadata.name,
        tool.metadata.estimatedCostUSD,
      );
    }
  }

  /**
   * Registers an agent in the runtime's agent registry.
   *
   * @param agent - Agent instance implementing the {@link Agent} interface.
   */
  registerAgent(agent: Agent): void {
    void this._env.agents.register(agent);
  }

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------

  /**
   * Executes an agent through the full 11-step lifecycle pipeline.
   *
   * @param agentId - Registered agent ID.
   * @param input   - Input payload for the agent.
   * @param opts    - Per-execution options (timeout, metadata, etc.).
   * @returns Resolved {@link AgentResult}.
   * @throws {@link AgentNotFoundError} when the agent is not registered.
   * @throws {@link AgentValidationError} when `agent.validate(input)` fails.
   */
  async run<TIn = unknown, TOut = unknown>(
    agentId: string,
    input: TIn,
    opts?: AgentLifecycleOptions,
  ): Promise<AgentResult<TOut>> {
    return this._lifecycle.run<TIn, TOut>(agentId, input, opts);
  }

  // ---------------------------------------------------------------------------
  // Observability
  // ---------------------------------------------------------------------------

  /**
   * Returns the {@link RuntimeMetricsCollector} for this runtime.
   *
   * Use it to query tool and agent execution statistics:
   * - `metrics().getToolSnapshot("HttpTool")`
   * - `metrics().getMostUsedTools(5)`
   * - `metrics().getSlowestTools(3)`
   * - `metrics().getFailingTools(0.95)`
   */
  metrics(): RuntimeMetricsCollector {
    return this._metricsCollector;
  }

  /**
   * Runs health checks on all registered tools and agents.
   *
   * @returns {@link RuntimeHealthReport} with tool and agent health statuses.
   */
  async healthCheck(): Promise<RuntimeHealthReport> {
    const [tools, agents] = await Promise.all([
      this._env.tools.healthCheck(),
      this._env.agents.healthCheck(),
    ]);
    return { tools, agents };
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Warms up the runtime by initializing all registered tools.
   *
   * Should be called once before the first `run()` invocation.
   * Idempotent — subsequent calls are no-ops.
   *
   * @returns {@link WarmupResult} with initialization details.
   */
  async warmup(): Promise<WarmupResult> {
    return this._env.warmup();
  }

  /**
   * Gracefully shuts down the runtime by cleaning up all registered tools.
   *
   * Should be called when the application is stopping.
   * Idempotent — subsequent calls are no-ops.
   */
  async shutdown(): Promise<void> {
    return this._env.shutdown();
  }

  // ---------------------------------------------------------------------------
  // Advanced access
  // ---------------------------------------------------------------------------

  /**
   * Provides direct access to the underlying {@link ExecutionEnvironment}.
   *
   * Use for advanced scenarios such as:
   * - Registering plugins that need access to the full DI context.
   * - Inspecting the tool registry directly.
   * - Extending the runtime with custom lifecycle hooks.
   */
  get env(): ExecutionEnvironment {
    return this._env;
  }
}
