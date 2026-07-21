/**
 * @module @agent-diaries/core/runtime
 *
 * Agent Runtime — public API surface.
 *
 * Sprint 2 additions:
 * - RuntimeLogger        — structured logger interface + implementations
 * - ExecutionEnvironment — DI container for all shared services
 * - RuntimeMetricsCollector — zero-instrumentation auto-metrics
 * - AgentLifecycle       — 11-step execution pipeline
 * - AgentRuntime         — central public facade
 */
export * from "./RuntimeLogger";
export * from "./AgentContext";
export * from "./ExecutionEnvironment";
export * from "./RuntimeMetricsCollector";
export * from "./AgentLifecycle";
export * from "./AgentRuntime";
// Distributed contracts — extension points only, no implementations
export * from "./distributed/contracts";
