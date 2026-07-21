/**
 * @module @agent-diaries/core/runtime/distributed
 *
 * Distributed runtime extension point contracts.
 *
 * These interfaces define the pluggable slots for future distributed backends.
 * Sprint 2 introduces the interfaces only — no implementations are provided.
 *
 * ## Planned packages
 *
 * | Package | Implements |
 * |---------|-----------|
 * | `@agent-diaries/transport-redis` | `QueueTransport` via Redis Streams |
 * | `@agent-diaries/transport-rabbitmq` | `QueueTransport` via AMQP |
 * | `@agent-diaries/transport-kafka` | `QueueTransport` via Kafka |
 * | `@agent-diaries/scheduler-temporal` | `DistributedSchedulerBackend` |
 * | `@agent-diaries/workers-k8s` | `RemoteWorkerRegistry` |
 *
 * ## Design rules
 * - All methods are async.
 * - Consumers only depend on these interfaces, never on transport implementations.
 * - The `ExecutionEnvironment` accepts optional implementations via its options.
 * - No implementation in `@agent-diaries/core` — keeps the core bundle lightweight.
 */

// ---------------------------------------------------------------------------
// Queue transport
// ---------------------------------------------------------------------------

/**
 * Abstraction over message queue transports.
 *
 * Implement this interface to allow `@agent-diaries/core` to dispatch
 * workflow messages to a distributed queue (Redis Streams, RabbitMQ, Kafka, etc.).
 *
 * @example
 * ```typescript
 * // Future: @agent-diaries/transport-redis
 * class RedisQueueTransport implements QueueTransport {
 *   async publish(queue, message) { await redisClient.xadd(queue, "*", "data", JSON.stringify(message)); }
 *   async subscribe(queue, handler) { /* poll Redis Streams *\/ }
 *   async ack(messageId) { /* XACK *\/ }
 *   async nack(messageId) { /* move to DLQ *\/ }
 * }
 * ```
 */
export interface QueueTransport {
  /**
   * Publishes a message to the named queue.
   *
   * @param queue   - Queue identifier (e.g. `"workflow-queue"`).
   * @param message - Serializable message payload.
   */
  publish(queue: string, message: unknown): Promise<void>;

  /**
   * Subscribes a handler to messages from the named queue.
   *
   * @param queue   - Queue identifier.
   * @param handler - Async handler called for each received message.
   * @returns Unsubscribe function — call to stop consuming.
   */
  subscribe(
    queue: string,
    handler: (message: unknown) => Promise<void>,
  ): Promise<() => void>;

  /**
   * Acknowledges successful processing of a message.
   *
   * @param messageId - Transport-specific message identifier.
   */
  ack(messageId: string): Promise<void>;

  /**
   * Negatively acknowledges a message (signals processing failure).
   * The transport may re-queue or dead-letter the message.
   *
   * @param messageId - Transport-specific message identifier.
   */
  nack(messageId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Distributed scheduler backend
// ---------------------------------------------------------------------------

/**
 * Extension point for distributed cron/scheduled execution.
 *
 * When implemented (e.g. `@agent-diaries/scheduler-temporal`), the
 * `AdaptiveScheduler` (Sprint 3) delegates scheduling decisions here
 * instead of executing synchronously.
 */
export interface DistributedSchedulerBackend {
  /**
   * Schedules a workflow for execution on a cron expression.
   *
   * @param workflowId - Workflow to schedule.
   * @param cronExpr   - Standard 5-field cron expression.
   * @returns Schedule ID (for cancellation).
   */
  schedule(workflowId: string, cronExpr: string): Promise<string>;

  /**
   * Cancels a previously scheduled workflow.
   *
   * @param scheduleId - ID returned by `schedule()`.
   */
  cancel(scheduleId: string): Promise<void>;

  /**
   * Returns all active schedules.
   */
  listSchedules(): Promise<{ scheduleId: string; workflowId: string; cronExpr: string }[]>;
}

// ---------------------------------------------------------------------------
// Remote worker registry
// ---------------------------------------------------------------------------

/**
 * Extension point for distributed worker mesh.
 *
 * When implemented (e.g. `@agent-diaries/workers-k8s`), the
 * `AdaptiveScheduler` discovers and dispatches to remote workers instead
 * of in-process workers.
 */
export interface RemoteWorkerRegistry {
  /**
   * Discovers all available remote workers.
   *
   * @returns Array of worker descriptors with health information.
   */
  discover(): Promise<RemoteWorkerDescriptor[]>;

  /**
   * Dispatches a workflow to a specific remote worker.
   *
   * @param workerId   - Target worker identifier.
   * @param workflowId - Workflow to dispatch.
   * @param payload    - Serializable workflow input.
   */
  dispatch(workerId: string, workflowId: string, payload: unknown): Promise<void>;

  /**
   * Returns the current health of a specific worker.
   *
   * @param workerId - Worker to inspect.
   */
  healthCheck(workerId: string): Promise<RemoteWorkerHealth>;
}

/** Descriptor for a remote worker in the distributed mesh. */
export interface RemoteWorkerDescriptor {
  /** Unique worker identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Worker endpoint (URL or connection string). */
  endpoint: string;
  /** Worker capabilities (agent categories it can handle). */
  capabilities: string[];
  /** Current load factor (0 = idle, 1 = fully loaded). */
  loadFactor?: number;
}

/** Health status of a remote worker. */
export interface RemoteWorkerHealth {
  workerId: string;
  healthy: boolean;
  latencyMs?: number;
  message?: string;
}

// ---------------------------------------------------------------------------
// Distributed metrics backend
// ---------------------------------------------------------------------------

/**
 * Extension point for persisting metrics to a distributed backend.
 *
 * When implemented, {@link RuntimeMetricsCollector} delegates
 * persistence here instead of keeping data in-memory only.
 */
export interface DistributedMetricsBackend {
  /**
   * Records a single metric observation.
   *
   * @param toolName   - Tool name.
   * @param durationMs - Execution duration.
   * @param success    - Whether the execution succeeded.
   * @param tags       - Optional tags for filtering.
   */
  record(
    toolName: string,
    durationMs: number,
    success: boolean,
    tags?: Record<string, string>,
  ): Promise<void>;

  /**
   * Queries aggregated stats for a tool.
   *
   * @param toolName - Tool to query.
   */
  query(toolName: string): Promise<{
    p95: number;
    p99: number;
    successRate: number;
    executionCount: number;
  } | null>;
}
