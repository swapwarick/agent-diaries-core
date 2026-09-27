/**
 * @module @agent-diaries/core/langchain
 *
 * AgentDiariesCallbackHandler — a LangChain `BaseCallbackHandler`
 * that records LLM, tool, and chain execution events into an
 * Agent Diaries diary for observability, tracing, and post-hoc analysis.
 *
 * ## Quick start
 * ```typescript
 * import { AgentDiariesCallbackHandler } from "@agent-diaries/core/langchain";
 *
 * const handler = new AgentDiariesCallbackHandler({
 *   agentId: "research-agent",
 * });
 *
 * const model = new ChatOpenAI({
 *   modelName: "gpt-4o",
 *   callbacks: [handler],
 * });
 *
 * await model.invoke("Summarize the latest AI trends");
 *
 * // Inspect recorded events
 * const events = handler.getEvents();
 * console.log(`Total LLM calls: ${handler.getStats().llmCalls}`);
 * ```
 */

import { AgentDiary } from "../diary";

// ---------------------------------------------------------------------------
// Event types
// ---------------------------------------------------------------------------

export type LangChainEventType =
  | "llm_start"
  | "llm_end"
  | "llm_error"
  | "chain_start"
  | "chain_end"
  | "chain_error"
  | "tool_start"
  | "tool_end"
  | "tool_error"
  | "retriever_start"
  | "retriever_end"
  | "retriever_error"
  | "agent_action"
  | "agent_finish";

export interface LangChainEvent {
  /** Event type identifier. */
  type: LangChainEventType;
  /** Unique run ID assigned by LangChain for this execution span. */
  runId: string;
  /** Parent run ID for correlation in nested chains. */
  parentRunId?: string;
  /** ISO-8601 timestamp of the event. */
  timestamp: string;
  /** Human-readable name (LLM model name, tool name, chain name, etc.). */
  name?: string;
  /** Event-specific payload (prompts, outputs, errors, etc.). */
  payload?: Record<string, any>;
}

export interface CallbackHandlerStats {
  llmCalls: number;
  llmErrors: number;
  toolCalls: number;
  toolErrors: number;
  chainCalls: number;
  chainErrors: number;
  retrieverCalls: number;
  retrieverErrors: number;
  totalEvents: number;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface AgentDiariesCallbackHandlerOptions {
  /**
   * Agent ID namespace for the diary that stores events.
   * @default "langchain-callbacks"
   */
  agentId?: string;

  /**
   * Shared storage adapter.
   */
  storage?: any;

  /**
   * When `true`, each event is also persisted as a task in the diary,
   * enabling cross-restart event replay. When `false` (default), events
   * are only kept in memory for the lifetime of this handler instance.
   * @default false
   */
  persistEvents?: boolean;

  /**
   * Maximum number of in-memory events to retain.
   * @default 5000
   */
  maxEvents?: number;

  /**
   * Optional callback invoked on every event.
   * Useful for streaming events to external systems
   * (e.g. a metrics pipeline or WebSocket).
   */
  onEvent?: (event: LangChainEvent) => void | Promise<void>;
}

// ---------------------------------------------------------------------------
// AgentDiariesCallbackHandler
// ---------------------------------------------------------------------------

/**
 * Records LangChain execution events into Agent Diaries for observability.
 *
 * Implements the same method names used by LangChain's `BaseCallbackHandler`,
 * so it can be passed as a callback handler to any LangChain component
 * without requiring `@langchain/core` as a dependency.
 *
 * ### Tracked events
 * - **LLM**: `handleLLMStart`, `handleLLMEnd`, `handleLLMError`
 * - **Tool**: `handleToolStart`, `handleToolEnd`, `handleToolError`
 * - **Chain**: `handleChainStart`, `handleChainEnd`, `handleChainError`
 * - **Retriever**: `handleRetrieverStart`, `handleRetrieverEnd`, `handleRetrieverError`
 * - **Agent**: `handleAgentAction`, `handleAgentFinish`
 *
 * ### Data access
 * - `getEvents()` — returns the full in-memory event log
 * - `getStats()` — returns aggregated counters
 * - `getEventsByRunId(runId)` — filters events for a specific run
 */
export class AgentDiariesCallbackHandler {
  /** Required by LangChain's callback handler contract. */
  public readonly name = "AgentDiariesCallbackHandler";

  private diary: AgentDiary;
  private events: LangChainEvent[] = [];
  private stats: CallbackHandlerStats = {
    llmCalls: 0,
    llmErrors: 0,
    toolCalls: 0,
    toolErrors: 0,
    chainCalls: 0,
    chainErrors: 0,
    retrieverCalls: 0,
    retrieverErrors: 0,
    totalEvents: 0,
  };
  private persistEvents: boolean;
  private maxEvents: number;
  private onEvent?: (event: LangChainEvent) => void | Promise<void>;

  constructor(options: AgentDiariesCallbackHandlerOptions = {}) {
    this.persistEvents = options.persistEvents ?? false;
    this.maxEvents = options.maxEvents ?? 5000;
    this.onEvent = options.onEvent;

    this.diary = new AgentDiary({
      agentId: options.agentId ?? "langchain-callbacks",
      storage: options.storage,
      maxHistory: this.maxEvents,
    });
  }

  // ─── Internal helpers ────────────────────────────────────────────────

  private async recordEvent(event: LangChainEvent): Promise<void> {
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
    this.stats.totalEvents++;

    if (this.onEvent) {
      await this.onEvent(event);
    }

    if (this.persistEvents) {
      const taskKey = `cb:${event.type}:${event.runId}:${Date.now()}`;
      await this.diary.executeOnce(
        taskKey,
        async () => JSON.stringify(event),
      );
    }
  }

  // ─── LLM events ─────────────────────────────────────────────────────

  async handleLLMStart(
    llm: { name: string },
    prompts: string[],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, any>,
    tags?: string[],
    metadata?: Record<string, any>,
    name?: string,
  ): Promise<void> {
    this.stats.llmCalls++;
    await this.recordEvent({
      type: "llm_start",
      runId,
      parentRunId,
      timestamp: new Date().toISOString(),
      name: name ?? llm.name,
      payload: {
        prompts,
        extraParams,
        tags,
        metadata,
      },
    });
  }

  async handleLLMEnd(
    output: any,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    await this.recordEvent({
      type: "llm_end",
      runId,
      parentRunId,
      timestamp: new Date().toISOString(),
      payload: {
        output,
        tags,
      },
    });
  }

  async handleLLMError(
    error: Error,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    this.stats.llmErrors++;
    await this.recordEvent({
      type: "llm_error",
      runId,
      parentRunId,
      timestamp: new Date().toISOString(),
      payload: {
        error: error.message,
        stack: error.stack,
        tags,
      },
    });
  }

  // ─── Tool events ────────────────────────────────────────────────────

  async handleToolStart(
    tool: { name: string },
    input: string,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, any>,
    name?: string,
  ): Promise<void> {
    this.stats.toolCalls++;
    await this.recordEvent({
      type: "tool_start",
      runId,
      parentRunId,
      timestamp: new Date().toISOString(),
      name: name ?? tool.name,
      payload: { input, tags, metadata },
    });
  }

  async handleToolEnd(
    output: string,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    await this.recordEvent({
      type: "tool_end",
      runId,
      parentRunId,
      timestamp: new Date().toISOString(),
      payload: { output, tags },
    });
  }

  async handleToolError(
    error: Error,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    this.stats.toolErrors++;
    await this.recordEvent({
      type: "tool_error",
      runId,
      parentRunId,
      timestamp: new Date().toISOString(),
      payload: {
        error: error.message,
        stack: error.stack,
        tags,
      },
    });
  }

  // ─── Chain events ───────────────────────────────────────────────────

  async handleChainStart(
    chain: { name: string },
    inputs: Record<string, any>,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, any>,
    runType?: string,
    name?: string,
  ): Promise<void> {
    this.stats.chainCalls++;
    await this.recordEvent({
      type: "chain_start",
      runId,
      parentRunId,
      timestamp: new Date().toISOString(),
      name: name ?? chain.name,
      payload: { inputs, tags, metadata, runType },
    });
  }

  async handleChainEnd(
    outputs: Record<string, any>,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    await this.recordEvent({
      type: "chain_end",
      runId,
      parentRunId,
      timestamp: new Date().toISOString(),
      payload: { outputs, tags },
    });
  }

  async handleChainError(
    error: Error,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    this.stats.chainErrors++;
    await this.recordEvent({
      type: "chain_error",
      runId,
      parentRunId,
      timestamp: new Date().toISOString(),
      payload: {
        error: error.message,
        stack: error.stack,
        tags,
      },
    });
  }

  // ─── Retriever events ───────────────────────────────────────────────

  async handleRetrieverStart(
    retriever: { name: string },
    query: string,
    runId: string,
    parentRunId?: string,
    tags?: string[],
    metadata?: Record<string, any>,
    name?: string,
  ): Promise<void> {
    this.stats.retrieverCalls++;
    await this.recordEvent({
      type: "retriever_start",
      runId,
      parentRunId,
      timestamp: new Date().toISOString(),
      name: name ?? retriever.name,
      payload: { query, tags, metadata },
    });
  }

  async handleRetrieverEnd(
    documents: any[],
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    await this.recordEvent({
      type: "retriever_end",
      runId,
      parentRunId,
      timestamp: new Date().toISOString(),
      payload: { documentCount: documents.length, tags },
    });
  }

  async handleRetrieverError(
    error: Error,
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    this.stats.retrieverErrors++;
    await this.recordEvent({
      type: "retriever_error",
      runId,
      parentRunId,
      timestamp: new Date().toISOString(),
      payload: {
        error: error.message,
        stack: error.stack,
        tags,
      },
    });
  }

  // ─── Agent events ───────────────────────────────────────────────────

  async handleAgentAction(
    action: { tool: string; toolInput: string; log: string },
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    await this.recordEvent({
      type: "agent_action",
      runId,
      parentRunId,
      timestamp: new Date().toISOString(),
      name: action.tool,
      payload: {
        toolInput: action.toolInput,
        log: action.log,
        tags,
      },
    });
  }

  async handleAgentFinish(
    finish: { returnValues: Record<string, any>; log: string },
    runId: string,
    parentRunId?: string,
    tags?: string[],
  ): Promise<void> {
    await this.recordEvent({
      type: "agent_finish",
      runId,
      parentRunId,
      timestamp: new Date().toISOString(),
      payload: {
        returnValues: finish.returnValues,
        log: finish.log,
        tags,
      },
    });
  }

  // ─── Public accessors ───────────────────────────────────────────────

  /**
   * Returns the full list of recorded events (most recent last).
   */
  getEvents(): LangChainEvent[] {
    return [...this.events];
  }

  /**
   * Returns events filtered by a specific run ID.
   */
  getEventsByRunId(runId: string): LangChainEvent[] {
    return this.events.filter((e) => e.runId === runId);
  }

  /**
   * Returns events filtered by type.
   */
  getEventsByType(type: LangChainEventType): LangChainEvent[] {
    return this.events.filter((e) => e.type === type);
  }

  /**
   * Returns aggregated execution counters.
   */
  getStats(): CallbackHandlerStats {
    return { ...this.stats };
  }

  /**
   * Clears the in-memory event log and resets counters.
   */
  reset(): void {
    this.events = [];
    this.stats = {
      llmCalls: 0,
      llmErrors: 0,
      toolCalls: 0,
      toolErrors: 0,
      chainCalls: 0,
      chainErrors: 0,
      retrieverCalls: 0,
      retrieverErrors: 0,
      totalEvents: 0,
    };
  }

  /**
   * Returns the underlying `AgentDiary` for direct access.
   */
  getDiary(): AgentDiary {
    return this.diary;
  }
}
