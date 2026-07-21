export enum WorkflowState {
  CREATED = "CREATED",
  QUEUED = "QUEUED",
  CLAIMED = "CLAIMED",
  RUNNING = "RUNNING",
  WAITING = "WAITING",
  COMPLETED = "COMPLETED",
  FAILED = "FAILED",
  CANCELLED = "CANCELLED",
  EXPIRED = "EXPIRED",
}

export interface WorkflowRecord {
  id: string;
  name: string;
  state: WorkflowState;
  signature?: string;
  workerId?: string;
  payload?: any;
  result?: any;
  failReason?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  ttlMs?: number;
  metadata?: Record<string, any>;
}

export interface TaskRecord {
  title: string;
  signature: string;
  result?: string;
  status: "pending" | "done" | "failed";
  failReason?: string;
  timestamp: number;
  ttlMs?: number;
}

export interface AgentState {
  lastRun: number;
  seenSignatures: string[];
  runCount: number;
  history: TaskRecord[];
}

export interface AgentStats {
  agentId: string;
  runCount: number;
  historyCount: number;
  pendingCount: number;
  doneCount: number;
  failedCount: number;
  lastRunAt: number;
  oldestTaskAt?: number;
}

export interface TaskListOptions {
  status?: TaskRecord["status"] | TaskRecord["status"][];
  includeExpired?: boolean;
  limit?: number;
  offset?: number;
}

export interface AgentDiaryOptions {
  agentId: string;
  storage?: any;
  maxHistory?: number;
  defaultTtlMs?: number;
  hashFn?: (title: string) => string;
  onTaskExpired?: (record: TaskRecord) => void | Promise<void>;
}

export interface SpanRecord {
  spanId: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  status: "ok" | "error";
  attributes?: Record<string, any>;
}

export interface TraceRecord {
  traceId: string;
  workflowId?: string;
  name: string;
  startTime: number;
  endTime?: number;
  spans: SpanRecord[];
  status: "active" | "completed" | "failed";
}

export interface TimelineEvent {
  id: string;
  workflowId?: string;
  type: string;
  timestamp: number;
  payload?: any;
}

export interface MetricRecord {
  name: string;
  value: number;
  tags?: Record<string, string>;
  timestamp: number;
}

export interface AggregatedMetrics {
  name: string;
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
}

export interface ProviderHealthRecord {
  providerName: string;
  latencyMs: number;
  success: boolean;
  error?: string;
  timestamp: number;
}

export type WorkerStatus = "active" | "idle" | "offline";

export interface WorkerMetadata {
  workerId: string;
  hostname: string;
  pid: number;
  version: string;
  heartbeat: number;
  status: WorkerStatus;
  startedTime: number;
  lastActivity: number;
}

export interface DomainEvents {
  // ── Existing workflow events (unchanged) ─────────────────────────────────
  WorkflowCreated: { workflow: WorkflowRecord };
  WorkflowClaimed: { workflowId: string; workerId: string };
  WorkflowStarted: { workflowId: string };
  WorkflowCompleted: { workflowId: string; result?: any };
  WorkflowFailed: { workflowId: string; reason?: string };
  WorkflowReused: { workflowId: string; signature: string };
  DiaryUpdated: { agentId: string; state: AgentState };
  TraceRecorded: { trace: TraceRecord };
  ProviderFailure: { providerName: string; error: string };
  ProviderRecovered: { providerName: string };
  CacheHit: { key: string };
  CacheMiss: { key: string };
  LockAcquired: { key: string; lockToken: string };
  LockReleased: { key: string; lockToken: string };

  // ── Phase 5: Agent lifecycle events ──────────────────────────────────────
  /** Fired when an agent execution starts. */
  AgentStarted: { agentId: string; traceId: string; workflowId?: string };
  /** Fired when an agent execution completes successfully. */
  AgentCompleted: {
    agentId: string;
    traceId: string;
    workflowId?: string;
    durationMs: number;
    toolsUsed: string[];
  };
  /** Fired when an agent execution fails or is cancelled. */
  AgentFailed: {
    agentId: string;
    traceId: string;
    workflowId?: string;
    error: string;
    durationMs: number;
  };

  // ── Phase 5: Tool execution events ────────────────────────────────────────
  /** Fired each time a tool is invoked by the ToolExecutor. */
  ToolExecuted: {
    toolName: string;
    agentId?: string;
    traceId?: string;
    success: boolean;
    durationMs: number;
    cached?: boolean;
  };

  // ── Phase 5: Template events ──────────────────────────────────────────────
  /** Fired when a workflow template begins executing. */
  TemplateStarted: { templateId: string; workflowId: string };
  /** Fired when a workflow template completes all steps. */
  TemplateCompleted: {
    templateId: string;
    workflowId: string;
    durationMs: number;
  };
  /** Fired when a workflow template step fails. */
  TemplateFailed: {
    templateId: string;
    workflowId: string;
    stepId: string;
    error: string;
  };

  // ── Phase 5: Scheduler events ─────────────────────────────────────────────
  /** Fired when the adaptive scheduler records an execution outcome. */
  SchedulerOutcomeRecorded: {
    workerId: string;
    agentId: string;
    success: boolean;
    durationMs: number;
  };
}
