/**
 * @module @agent-diaries/core/langchain
 *
 * DeduplicatedTool — wraps any LangChain `StructuredTool` (or `DynamicTool`)
 * with Agent Diaries' `executeOnce()` to guarantee that identical tool
 * invocations are only executed once, even when called concurrently by
 * multiple agents.
 *
 * ## Quick start
 * ```typescript
 * import { DeduplicatedTool } from "@agent-diaries/core/langchain";
 * import { TavilySearchResults } from "@langchain/community/tools/tavily_search";
 *
 * const search = new TavilySearchResults({ maxResults: 3 });
 * const deduped = new DeduplicatedTool(search, {
 *   agentId: "research-swarm",
 * });
 *
 * // 50 agents can call `.invoke("latest AI news")` simultaneously.
 * // Only 1 network request is made. The other 49 get the cached result.
 * const result = await deduped.invoke("latest AI news");
 * ```
 */

import { AgentDiary } from "../diary";

// ---------------------------------------------------------------------------
// Minimal LangChain tool contracts (inlined to avoid hard @langchain/core dep)
// ---------------------------------------------------------------------------

/**
 * Minimal interface describing a LangChain tool's public surface.
 * Compatible with `StructuredTool`, `DynamicTool`, and the `tool()` factory.
 */
export interface LangChainToolLike {
  name: string;
  description: string;
  invoke(input: any, config?: any): Promise<any>;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface DeduplicatedToolOptions {
  /**
   * Agent ID namespace used by the backing diary.
   * @default "langchain-tools"
   */
  agentId?: string;

  /**
   * Shared storage adapter for cross-process deduplication.
   * When omitted, an in-memory store is used.
   */
  storage?: any;

  /**
   * TTL in milliseconds for cached tool results.
   * Set this for tools whose output is time-sensitive
   * (e.g. web search results that go stale).
   */
  ttlMs?: number;

  /**
   * Custom key builder. By default, the tool name + JSON-serialized input
   * are concatenated and normalized. Override this when the default key
   * is too coarse or too fine.
   *
   * @param toolName The tool's `name` property.
   * @param input The raw input passed to `invoke()`.
   * @returns A string used as the deduplication key.
   */
  keyBuilder?: (toolName: string, input: any) => string;

  /**
   * Maximum history entries to retain in the diary.
   * @default 2000
   */
  maxHistory?: number;
}

// ---------------------------------------------------------------------------
// DeduplicatedTool
// ---------------------------------------------------------------------------

/**
 * Wraps any LangChain-compatible tool with Agent Diaries' `executeOnce()`
 * to provide exactly-once execution and cross-agent result caching.
 *
 * The wrapper is a drop-in replacement: it exposes the same `name`,
 * `description`, and `invoke()` surface as the underlying tool. Agents
 * and chains that call `invoke()` are transparently routed through the
 * diary's deduplication logic.
 *
 * ### Deduplication key
 * By default: `tool:{toolName}:{normalizedInput}`.
 * Supply a custom `keyBuilder` for more granular or coarser grouping.
 *
 * ### Result caching
 * - First call → executes the real tool and stores the result.
 * - Subsequent calls with the same key → returns cached result instantly.
 * - Concurrent calls with the same key → only one executes; the rest wait
 *   for the lock and return the winner's result.
 */
export class DeduplicatedTool implements LangChainToolLike {
  public readonly name: string;
  public readonly description: string;

  private innerTool: LangChainToolLike;
  private diary: AgentDiary;
  private ttlMs?: number;
  private keyBuilder: (toolName: string, input: any) => string;

  constructor(tool: LangChainToolLike, options: DeduplicatedToolOptions = {}) {
    this.innerTool = tool;
    this.name = tool.name;
    this.description = tool.description;
    this.ttlMs = options.ttlMs;

    this.keyBuilder =
      options.keyBuilder ??
      ((toolName, input) => {
        const inputStr =
          typeof input === "string" ? input : JSON.stringify(input);
        return `tool:${toolName}:${inputStr}`;
      });

    this.diary = new AgentDiary({
      agentId: options.agentId ?? "langchain-tools",
      storage: options.storage,
      maxHistory: options.maxHistory ?? 2000,
      defaultTtlMs: options.ttlMs,
    });
  }

  /**
   * Invokes the tool through Agent Diaries' deduplication layer.
   *
   * @param input - Tool input (string or structured object).
   * @param config - Optional LangChain `RunnableConfig` (forwarded to inner tool).
   * @returns The tool's output, either freshly executed or served from cache.
   */
  async invoke(input: any, config?: any): Promise<any> {
    const cacheKey = this.keyBuilder(this.name, input);

    const result = await this.diary.executeOnce(
      cacheKey,
      async () => {
        const output = await this.innerTool.invoke(input, config);
        return typeof output === "string" ? output : JSON.stringify(output);
      },
      this.ttlMs ? { ttlMs: this.ttlMs } : undefined,
    );

    return result;
  }

  /**
   * Returns the underlying `AgentDiary` for advanced introspection
   * (e.g. checking stats, listing cached tool results).
   */
  getDiary(): AgentDiary {
    return this.diary;
  }

  /**
   * Returns the original unwrapped tool.
   */
  getInnerTool(): LangChainToolLike {
    return this.innerTool;
  }
}

/**
 * Convenience factory: wraps multiple tools at once with the same options.
 *
 * @example
 * ```typescript
 * const [search, calculator] = deduplicateTools(
 *   [searchTool, calculatorTool],
 *   { agentId: "my-swarm", ttlMs: 60_000 },
 * );
 * ```
 */
export function deduplicateTools(
  tools: LangChainToolLike[],
  options: DeduplicatedToolOptions = {},
): DeduplicatedTool[] {
  return tools.map((tool) => new DeduplicatedTool(tool, options));
}
