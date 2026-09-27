/**
 * @module @agent-diaries/core/langchain
 *
 * LangChain integration for Agent Diaries.
 *
 * Provides three integration points:
 * 1. **AgentDiariesCache** — LangChain `BaseCache` implementation for LLM response deduplication.
 * 2. **DeduplicatedTool** — Wraps any LangChain tool with `executeOnce()` for exactly-once execution.
 * 3. **AgentDiariesCallbackHandler** — Records all LLM/tool/chain events for observability.
 *
 * @example
 * ```typescript
 * import {
 *   AgentDiariesCache,
 *   DeduplicatedTool,
 *   AgentDiariesCallbackHandler,
 *   deduplicateTools,
 * } from "@agent-diaries/core/langchain";
 * ```
 */

export {
  AgentDiariesCache,
  type AgentDiariesCacheOptions,
  type Generation,
  type LangChainCacheInterface,
} from "./AgentDiariesCache";

export {
  DeduplicatedTool,
  deduplicateTools,
  type DeduplicatedToolOptions,
  type LangChainToolLike,
} from "./DeduplicatedTool";

export {
  AgentDiariesCallbackHandler,
  type AgentDiariesCallbackHandlerOptions,
  type LangChainEvent,
  type LangChainEventType,
  type CallbackHandlerStats,
} from "./AgentDiariesCallbackHandler";
