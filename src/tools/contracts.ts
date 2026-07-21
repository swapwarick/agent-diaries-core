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
 * Used for discovery, documentation, and permission enforcement.
 */
export interface ToolMetadata {
  /** Unique tool name. Used as the registry key. */
  name: string;
  /** Semantic version string (e.g. "1.0.0"). */
  version: string;
  /** Human-readable description of what the tool does. */
  description: string;
  /**
   * Fine-grained capability labels this tool exposes.
   * Used by {@link ToolRegistry.find} for capability-based lookup.
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
   * @returns Health status and optional diagnostic message.
   */
  healthCheck?(): Promise<{ healthy: boolean; message?: string }>;
}

// ---------------------------------------------------------------------------
// Tool health check result
// ---------------------------------------------------------------------------

/** Result of a {@link ToolRegistry} health check sweep. */
export interface ToolHealthStatus {
  /** Tool name. */
  name: string;
  /** Whether the tool is healthy. */
  healthy: boolean;
  /** Optional message from the tool's `healthCheck()`. */
  message?: string;
}
