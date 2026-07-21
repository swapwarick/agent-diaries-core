/**
 * @module @agent-diaries/core/agents
 *
 * Agent Framework contracts for Agent Diaries.
 *
 * Defines the `Agent` interface that all agents must implement, along with
 * supporting types for lifecycle, metadata, results, costs, and health.
 *
 * @example
 * ```typescript
 * import type { Agent, AgentContext, AgentResult } from "@agent-diaries/core/agents";
 *
 * class MySummarizationAgent implements Agent<string, string> {
 *   readonly metadata = {
 *     id: "summarization-agent",
 *     name: "SummarizationAgent",
 *     version: "1.0.0",
 *     category: "ai" as AgentCategory,
 *     capabilities: [{ name: "summarize" }],
 *   };
 *
 *   async execute(input: string, ctx: AgentContext): Promise<AgentResult<string>> {
 *     // ... call ctx.tools.get("HttpTool") etc.
 *     return { success: true, data: "summary", durationMs: 100, agentId: this.metadata.id };
 *   }
 *
 *   validate(input: string) { return { valid: input.length > 0 }; }
 *   estimateCost() { return { apiCalls: 1, estimatedUSD: 0.001 }; }
 *   estimateDuration() { return { estimatedMs: 2000, confidence: "medium" as const }; }
 *   async healthCheck() { return { healthy: true }; }
 * }
 * ```
 */

// Forward-reference — AgentContext is defined in src/runtime/AgentContext.ts
// We use `unknown` here to avoid a circular import; AgentRuntime wires the
// concrete type through dependency injection.
import type { AgentContext } from "../runtime/AgentContext";

// ---------------------------------------------------------------------------
// Category
// ---------------------------------------------------------------------------

/**
 * Broad functional category that an agent belongs to.
 * Used for registry filtering and dashboard grouping.
 */
export type AgentCategory =
  | "search"
  | "ai"
  | "documents"
  | "infrastructure"
  | "devops"
  | "business"
  | "communication"
  | "system";

// ---------------------------------------------------------------------------
// Capability
// ---------------------------------------------------------------------------

/**
 * A fine-grained capability label declared by an agent.
 *
 * {@link CapabilityRouter} uses these labels to match agent candidates
 * when a workflow step requests a capability (e.g. `"summarize"`).
 */
export interface AgentCapability {
  /** Capability label, e.g. `"summarize"`, `"ocr"`, `"docker"`. */
  name: string;
  /** Optional semantic version of the capability implementation. */
  version?: string;
  /** Optional human-readable description. */
  description?: string;
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

/**
 * Descriptive metadata attached to every registered agent.
 * Registered in {@link AgentRegistry} and used by {@link CapabilityRouter}.
 */
export interface AgentMetadata {
  /** Unique agent identifier. Used as the registry key. */
  id: string;
  /** Human-readable display name. */
  name: string;
  /** Semantic version string. */
  version: string;
  /** Functional category. */
  category: AgentCategory;
  /** Capabilities this agent exposes. */
  capabilities: AgentCapability[];
  /** Human-readable description of what the agent does. */
  description?: string;
  /** Author or publishing package name. */
  author?: string;
  /** Tool names this agent depends on (must be registered in ToolRegistry). */
  requiredTools?: string[];
  /** Tags for filtering and discovery. */
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Cost & duration estimates
// ---------------------------------------------------------------------------

/**
 * Estimated cost of running an agent with a given input.
 * Used by {@link AdaptiveScheduler} and the cost dashboard.
 */
export interface CostEstimate {
  /** Estimated LLM token usage (input + output). */
  tokens?: number;
  /** Number of API calls the agent will make. */
  apiCalls?: number;
  /** Estimated monetary cost in USD. */
  estimatedUSD?: number;
}

/**
 * Estimated execution duration for a given input.
 * Used to prioritize workflows and warn on slow agents.
 */
export interface DurationEstimate {
  /** Best-guess execution time in milliseconds. */
  estimatedMs: number;
  /** Confidence level of the estimate. */
  confidence: "low" | "medium" | "high";
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/**
 * Result returned by every agent execution.
 *
 * @typeParam T - Shape of the successful output data.
 */
export interface AgentResult<T = unknown> {
  /** Whether the execution succeeded. */
  success: boolean;
  /** Output payload on success. */
  data?: T;
  /** Human-readable error description on failure. */
  error?: string;
  /** Wall-clock execution duration in milliseconds. */
  durationMs: number;
  /** ID of the agent that produced this result. */
  agentId: string;
  /** Trace ID from the TracingService span. */
  traceId?: string;
  /** Names of tools called during execution. */
  toolsUsed?: string[];
  /** Cost incurred during this execution. */
  cost?: CostEstimate;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Result of calling {@link Agent.validate}.
 */
export interface ValidationResult {
  /** Whether the input is valid. */
  valid: boolean;
  /** Array of validation error messages, if any. */
  errors?: string[];
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

/**
 * Health status returned by {@link Agent.healthCheck}.
 */
export interface HealthStatus {
  /** Whether the agent (and its dependencies) are healthy. */
  healthy: boolean;
  /** Optional diagnostic message. */
  message?: string;
  /** Timestamp of when the check was performed. */
  lastChecked?: number;
}

// ---------------------------------------------------------------------------
// Agent interface
// ---------------------------------------------------------------------------

/**
 * The core contract every Agent Diaries agent must satisfy.
 *
 * Implement this interface to create a reusable agent that can be registered
 * in {@link AgentRegistry}, discovered by {@link CapabilityRouter}, and
 * executed by {@link AgentRuntime} with full lifecycle management.
 *
 * @typeParam TInput  - Shape of the input accepted by this agent.
 * @typeParam TOutput - Shape of the output returned by this agent.
 */
export interface Agent<TInput = unknown, TOutput = unknown> {
  /** Immutable metadata describing this agent. */
  readonly metadata: AgentMetadata;

  /**
   * Execute the agent's primary task.
   *
   * @param input   - Agent-specific input payload.
   * @param context - Runtime context with tools, tracing, and cancellation.
   * @returns A fully resolved {@link AgentResult}.
   */
  execute(input: TInput, context: AgentContext): Promise<AgentResult<TOutput>>;

  /**
   * Validate the input before execution.
   * Called by {@link AgentRuntime} before `execute`.
   *
   * @param input - Raw input to validate.
   * @returns {@link ValidationResult} — if invalid, execution is aborted.
   */
  validate(input: TInput): ValidationResult;

  /**
   * Estimate the cost of running this agent with the given input.
   * Used for pre-flight cost checks and scheduling decisions.
   *
   * @param input - Input that would be passed to `execute`.
   */
  estimateCost(input: TInput): CostEstimate;

  /**
   * Estimate the execution duration for the given input.
   * Used for scheduling, timeout configuration, and SLA tracking.
   *
   * @param input - Input that would be passed to `execute`.
   */
  estimateDuration(input: TInput): DurationEstimate;

  /**
   * Check whether this agent and its external dependencies are healthy.
   * Called periodically by {@link AgentRegistry.healthCheck}.
   */
  healthCheck(): Promise<HealthStatus>;
}

// Re-export AgentContext so consumers can import from a single module.
export type { AgentContext };
