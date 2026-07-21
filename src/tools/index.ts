/**
 * @module @agent-diaries/core/tools
 *
 * Tool Framework — public API surface.
 *
 * Sprint 2 additions:
 * - ToolCategory     — 11 functional categories
 * - ToolHealthState  — 6-state health model
 * - ToolHealthCheckResult — rich health check result
 * - ToolMetadata extended — id, category, estimatedLatencyMs, etc.
 * - Tool lifecycle   — initialize() and cleanup() hooks
 * - ToolRegistry     — findByCategory, findByTag, findByPermission,
 *                      findCompatible, recommend, initializeAll, cleanupAll
 * - ToolExecutor     — optional EventBus for auto-metrics emission
 */
export * from "./contracts";
export * from "./ToolRegistry";
export * from "./ToolExecutor";
