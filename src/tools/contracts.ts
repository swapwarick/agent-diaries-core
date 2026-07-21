/**
 * @module @agent-diaries/core/tools
 *
 * First-class Tool Framework for Agent Diaries.
 *
 * Tools are reusable, versioned, permission-scoped integrations that agents
 * consume instead of embedding external calls directly. This eliminates
 * duplication and provides a single, auditable execution path for all
 * external interactions.
 *
 * @example
 * ```typescript
 * import { HttpTool } from "@agent-diaries/core/tools";
 *
 * const http = new HttpTool();
 * const result = await http.execute({ url: "https://api.example.com" }, ctx);
 * ```
 */

// ---------------------------------------------------------------------------
// Category
// ---------------------------------------------------------------------------

/**
 * Broad functional category that a tool belongs to.
 * Used by {@link ToolRegistry.findByCategory} and the dashboard.
 *
 * Every tool belongs to exactly one category.
 */
export type ToolCategory =
  | "filesystem"    // local and remote file system operations
  | "search"        // web, semantic, or structured search
  | "database"      // SQL, NoSQL, vector databases
  | "cloud"         // cloud provider APIs (AWS, Azure, GCP)
  | "ai"            // LLM calls, embeddings, inference
  | "communication" // email, Slack, SMS, webhooks
  | "development"   // git, GitHub, CI/CD, Docker, package managers
  | "monitoring"    // metrics, logs, alerts, health checks
  | "utility"       // general purpose (hashing, parsing, compression)
  | "security"      // auth, secrets, encryption, scanning
  | "networking"    // HTTP, TCP, DNS, proxies
  | "analytics";    // data pipelines, BI, reporting

// ---------------------------------------------------------------------------
// Health state
// ---------------------------------------------------------------------------

/**
 * Six-state health model for tool instances.
 *
 * | State | Meaning |
 * |-------|---------|
 * | `healthy` | All checks pass; full capacity |
 * | `degraded` | Partially functional; retry may help |
 * | `unavailable` | External dependency is down |
 * | `maintenance` | Deliberately offline for maintenance |
 * | `disabled` | Administratively disabled |
 * | `unknown` | Health has not been checked yet |
 */
export type ToolHealthState =
  | "healthy"
  | "degraded"
  | "unavailable"
  | "maintenance"
  | "disabled"
  | "unknown";

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/**
 * Declarative permission scope required by a tool.
 * Permissions follow the format `domain:action` and are checked by
 * {@link ToolExecutor} before any tool call is dispatched.
 */
export type ToolPermission =
  | "filesystem:read"
  | "filesystem:write"
  | "network:http"
  | "network:https"
  | "shell:exec"
  | "docker:run"
  | "docker:build"
  | "db:read"
  | "db:write"
  | "email:send"
  | "slack:post"
  | "github:read"
  | "github:write"
  | "azure:read"
  | "azure:write"
  | "aws:read"
  | "aws:write"
  | (string & {}); // extensible — custom domain:action strings are valid

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

/**
 * Descriptive metadata attached to every registered tool.
 * Used for discovery, documentation, permission enforcement, and the dashboard.
 *
 * All fields added in Phase 5 are optional — existing tools work unchanged.
 */
export interface ToolMetadata {
  // ── Core identity (Sprint 1) ──────────────────────────────────────────────
  /** Unique tool name. Used as the registry key. */
  name: string;
  /** Semantic version string (e.g. "1.0.0"). */
  version: string;
  /** Human-readable description of what the tool does. */
  description: string;
  /**
   * Fine-grained capability labels this tool exposes.
   * Used by {@link ToolRegistry.find} and {@link ToolRegistry.findCompatible}.
   * @example ["http:get", "http:post"]
   */
  capabilities: string[];
  /**
   * Permissions this tool requires.
   * {@link ToolExecutor} validates these before execution.
   */
  permissions: ToolPermission[];
  /** Tool author or publishing package name. */
  author?: string;
  /** Free-form tags for filtering and discovery. */
  tags?: string[];

  // ── Phase 5 extended metadata (all optional) ──────────────────────────────
  /**
   * Unique tool identifier.
   * Defaults to `name` when absent. May differ from `name` when the same
   * tool class is instantiated multiple times with different configurations.
   */
  id?: string;
  /** Functional category this tool belongs to. Used for registry filtering. */
  category?: ToolCategory;
  /**
   * Expected p50 execution latency in milliseconds.
   * Used by {@link ToolRegistry.recommend} to rank candidate tools.
   */
  estimatedLatencyMs?: number;
  /**
   * Expected cost per tool call in USD.
   * Used by {@link RuntimeMetricsCollector} for cost tracking.
   */
  estimatedCostUSD?: number;
  /**
   * Last known health state of this tool.
   * Updated by {@link ToolRegistry.healthCheck}.
   */
  healthState?: ToolHealthState;
  /**
   * Platforms on which this tool is supported.
   * @example ["linux", "macos"]
   */
  supportedPlatforms?: ("linux" | "windows" | "macos" | "any")[];
}

// ---------------------------------------------------------------------------
// Execution context
// ---------------------------------------------------------------------------

/**
 * Contextual data passed to every tool execution.
 * Carries tracing, cancellation, and workflow correlation information.
 */
export interface ToolContext {
  /** Trace ID from the parent {@link TracingService} span. */
  traceId?: string;
  /** Workflow ID this tool execution belongs to. */
  workflowId?: string;
  /** Agent ID that is invoking this tool. */
  agentId?: string;
  /**
   * Execution timeout in milliseconds. Defaults to 30 000 ms.
   * {@link ToolExecutor} enforces this via {@link AbortSignal}.
   */
  timeout?: number;
  /** Cancellation signal — abort means cancel immediately. */
  signal?: AbortSignal;
  /** Arbitrary metadata forwarded from the agent runtime. */
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/**
 * Strongly-typed result returned by every tool execution.
 *
 * @typeParam T - The shape of the successful output data.
 */
export interface ToolResult<T = unknown> {
  /** Whether the tool call succeeded. */
  success: boolean;
  /** Output payload on success. */
  data?: T;
  /** Human-readable error description on failure. */
  error?: string;
  /** Wall-clock execution duration in milliseconds. */
  durationMs: number;
  /** Whether the result was served from a cache layer. */
  cached?: boolean;
}

// ---------------------------------------------------------------------------
// Health check results
// ---------------------------------------------------------------------------

/**
 * Rich health check result returned by Phase 5 tools.
 *
 * Replaces the legacy `{ healthy: boolean; message? }` shape with a
 * 6-state model that includes latency measurement and diagnostic data.
 *
 * @see {@link ToolHealthState} for the state enum.
 */
export interface ToolHealthCheckResult {
  /** Current health state. */
  state: ToolHealthState;
  /** Optional human-readable diagnostic message. */
  message?: string;
  /** Wall-clock time taken by the health check itself, in milliseconds. */
  latencyMs?: number;
  /** Arbitrary diagnostic key-value pairs (connection pool stats, etc.). */
  diagnostics?: Record<string, unknown>;
  /** Unix timestamp (ms) when the check was performed. */
  checkedAt: number;
}

/**
 * Legacy health check shape — accepted by {@link ToolRegistry.healthCheck}.
 * @deprecated Use {@link ToolHealthCheckResult} for new tools.
 */
export interface LegacyHealthCheckResult {
  healthy: boolean;
  message?: string;
}

/**
 * Union of both legacy and rich health check shapes.
 * {@link ToolRegistry} normalizes this into {@link ToolHealthStatus}.
 */
export type AnyHealthCheckResult = ToolHealthCheckResult | LegacyHealthCheckResult;

/**
 * Normalizes either the old or new `healthCheck()` return value into a
 * canonical {@link ToolHealthCheckResult}.
 *
 * @param raw - Output from `tool.healthCheck()`.
 * @returns Normalized result with `state` and `checkedAt` always populated.
 */
export function normalizeHealthCheckResult(
  raw: AnyHealthCheckResult,
): ToolHealthCheckResult {
  if ("state" in raw) return raw as ToolHealthCheckResult;
  const legacy = raw as LegacyHealthCheckResult;
  return {
    state: legacy.healthy ? "healthy" : "unavailable",
    message: legacy.message,
    checkedAt: Date.now(),
  };
}

/**
 * Result stored in {@link ToolRegistry} after a health check sweep.
 * Extends {@link ToolHealthCheckResult} with the tool name and
 * a convenience `healthy` boolean for backward compatibility.
 */
export interface ToolHealthStatus extends ToolHealthCheckResult {
  /** Tool name. */
  name: string;
  /**
   * Convenience alias: `state === "healthy"`.
   * @deprecated Prefer checking `state` directly.
   */
  healthy: boolean;
}

// ---------------------------------------------------------------------------
// Tool interface
// ---------------------------------------------------------------------------

/**
 * The core contract every Agent Diaries tool must satisfy.
 *
 * Implement this interface to create a reusable, permission-scoped tool
 * that agents can request through {@link AgentContext.tools}.
 *
 * @typeParam TInput  - Shape of the input accepted by this tool.
 * @typeParam TOutput - Shape of the output returned by this tool.
 *
 * @example
 * ```typescript
 * class MyHttpTool implements Tool<{ url: string }, { body: string }> {
 *   readonly metadata: ToolMetadata = {
 *     name: "HttpTool",
 *     version: "1.0.0",
 *     description: "Makes HTTP requests",
 *     capabilities: ["http:get", "http:post"],
 *     permissions: ["network:http", "network:https"],
 *     category: "networking",
 *     estimatedLatencyMs: 500,
 *   };
 *
 *   async execute(input, ctx) {
 *     const res = await fetch(input.url, { signal: ctx.signal });
 *     const body = await res.text();
 *     return { success: true, data: { body }, durationMs: 0 };
 *   }
 * }
 * ```
 */
export interface Tool<TInput = unknown, TOutput = unknown> {
  /** Immutable metadata describing this tool. */
  readonly metadata: ToolMetadata;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Optional initialization hook. Called once before the first `execute()`.
   *
   * Use to establish connections, load configuration, or warm up caches.
   * Called by {@link ToolRegistry} when `autoInit: true`, or by
   * {@link ExecutionEnvironment.warmup}.
   *
   * Default: no-op.
   */
  initialize?(): Promise<void>;

  /**
   * Optional cleanup hook. Called when the tool is unregistered or the
   * runtime shuts down via {@link ExecutionEnvironment.shutdown}.
   *
   * Use to close connections, flush buffers, or release resources.
   *
   * Default: no-op.
   */
  cleanup?(): Promise<void>;

  // ── Core execution ────────────────────────────────────────────────────────

  /**
   * Execute the tool with the given input and context.
   *
   * @param input - Tool-specific input payload.
   * @param context - Execution context carrying trace, timeout, and signal.
   * @returns A {@link ToolResult} with typed output or an error description.
   */
  execute(input: TInput, context: ToolContext): Promise<ToolResult<TOutput>>;

  /**
   * Optional input validation hook.
   * Called by {@link ToolExecutor} before `execute`.
   *
   * @param input - Raw input to validate.
   * @returns Validation result with optional error messages.
   */
  validate?(input: TInput): { valid: boolean; errors?: string[] };

  /**
   * Optional health check. Called by {@link ToolRegistry.healthCheck}.
   * Should verify connectivity to external dependencies.
   *
   * Accepts both the legacy `{ healthy: boolean }` shape and the new
   * {@link ToolHealthCheckResult} shape. Both are normalized by the registry.
   *
   * @returns Health result (legacy or rich shape).
   */
  healthCheck?(): Promise<AnyHealthCheckResult>;
}
