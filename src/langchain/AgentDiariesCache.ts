/**
 * @module @agent-diaries/core/langchain
 *
 * AgentDiariesCache — implements LangChain's `BaseCache` interface
 * backed by Agent Diaries' `AgentDiary` for cross-agent LLM response
 * deduplication.
 *
 * When multiple agents (or the same agent across restarts) issue
 * identical prompts to the same LLM configuration, only the first
 * call reaches the provider. All subsequent calls return the cached
 * `Generation[]` instantly.
 *
 * ## Quick start
 * ```typescript
 * import { AgentDiariesCache } from "@agent-diaries/core/langchain";
 * import { ChatOpenAI } from "@langchain/openai";
 *
 * const cache = new AgentDiariesCache({ agentId: "research-swarm" });
 *
 * const model = new ChatOpenAI({
 *   modelName: "gpt-4o",
 *   cache,
 * });
 * ```
 *
 * ## Distributed caching
 * ```typescript
 * import { MemoryStorage } from "@agent-diaries/core";
 *
 * // Share a single MemoryStorage (or Redis/Postgres adapter) across agents
 * const sharedStorage = new MemoryStorage();
 * const cache = new AgentDiariesCache({
 *   agentId: "distributed-swarm",
 *   storage: sharedStorage,
 * });
 * ```
 */

import { AgentDiary } from "../diary";

// ---------------------------------------------------------------------------
// LangChain types (inlined to avoid hard dependency on @langchain/core)
// ---------------------------------------------------------------------------

/**
 * Mirrors LangChain's `Generation` type.
 * @see https://api.js.langchain.com/interfaces/langchain_core.outputs.Generation.html
 */
export interface Generation {
  /** Generated text output. */
  text: string;
  /** Generation-specific metadata (model, finish reason, etc.). */
  generationInfo?: Record<string, any>;
}

/**
 * Mirrors the essential surface of LangChain's `BaseCache<Generation[]>`.
 * Implementing this interface allows the class to be passed as the `cache`
 * option to any LangChain LLM or ChatModel.
 */
export interface LangChainCacheInterface {
  lookup(prompt: string, llmKey: string): Promise<Generation[] | null>;
  update(prompt: string, llmKey: string, value: Generation[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface AgentDiariesCacheOptions {
  /**
   * Agent ID used as the diary namespace.
   * All LLM cache entries for this agent share the same diary.
   * @default "langchain-cache"
   */
  agentId?: string;

  /**
   * Optional pre-configured storage adapter.
   * Pass a shared `MemoryStorage`, Redis adapter, etc. to coordinate
   * across multiple agents or processes.
   */
  storage?: any;

  /**
   * Default time-to-live in milliseconds for cached LLM responses.
   * When omitted, entries never expire.
   */
  defaultTtlMs?: number;

  /**
   * Maximum number of cached entries to retain in the diary history.
   * Older entries are evicted on a FIFO basis.
   * @default 2000
   */
  maxHistory?: number;
}

// ---------------------------------------------------------------------------
// AgentDiariesCache
// ---------------------------------------------------------------------------

/**
 * LangChain-compatible cache backed by Agent Diaries.
 *
 * Implements `lookup()` and `update()` as required by LangChain's
 * `BaseCache<Generation[]>` contract. Internally delegates to
 * `AgentDiary.executeOnce()` for atomic, exactly-once storage.
 *
 * ### How it works
 * 1. **`lookup(prompt, llmKey)`** — Checks the diary for a previously
 *    stored `Generation[]` keyed by `llm-cache:{hash(prompt+llmKey)}`.
 * 2. **`update(prompt, llmKey, value)`** — Stores the `Generation[]` in
 *    the diary so future `lookup()` calls return it instantly.
 *
 * Because the diary is shared across agents, a prompt answered by
 * Agent A is instantly available to Agent B without a second LLM call.
 */
export class AgentDiariesCache implements LangChainCacheInterface {
  private diary: AgentDiary;
  private defaultTtlMs?: number;

  constructor(options: AgentDiariesCacheOptions = {}) {
    this.defaultTtlMs = options.defaultTtlMs;
    this.diary = new AgentDiary({
      agentId: options.agentId ?? "langchain-cache",
      storage: options.storage,
      maxHistory: options.maxHistory ?? 2000,
      defaultTtlMs: options.defaultTtlMs,
    });
  }

  /**
   * Builds a deterministic cache key from prompt + LLM configuration string.
   */
  private buildCacheKey(prompt: string, llmKey: string): string {
    return `llm-cache:${AgentDiary.normalizeSignature(`${llmKey}:${prompt}`)}`;
  }

  /**
   * Look up a cached LLM response.
   *
   * @param prompt - The prompt string sent to the LLM.
   * @param llmKey - Deterministic string encoding the LLM's configuration
   *   (model name, temperature, etc.).
   * @returns Previously cached `Generation[]`, or `null` on cache miss.
   */
  async lookup(prompt: string, llmKey: string): Promise<Generation[] | null> {
    const key = this.buildCacheKey(prompt, llmKey);
    const result = await this.diary.getTaskResult(key);
    if (result === undefined || result === null) {
      return null;
    }
    try {
      return JSON.parse(result) as Generation[];
    } catch {
      return null;
    }
  }

  /**
   * Store an LLM response in the cache.
   *
   * @param prompt - The prompt string.
   * @param llmKey - LLM configuration key.
   * @param value - The `Generation[]` to cache.
   */
  async update(
    prompt: string,
    llmKey: string,
    value: Generation[],
  ): Promise<void> {
    const key = this.buildCacheKey(prompt, llmKey);
    const serialized = JSON.stringify(value);

    // Use executeOnce to atomically claim+store, preventing races
    // where two agents try to cache the same response simultaneously.
    await this.diary.executeOnce(
      key,
      async () => serialized,
      this.defaultTtlMs ? { ttlMs: this.defaultTtlMs } : undefined,
    );
  }

  /**
   * Returns the underlying `AgentDiary` for advanced introspection.
   */
  getDiary(): AgentDiary {
    return this.diary;
  }
}
