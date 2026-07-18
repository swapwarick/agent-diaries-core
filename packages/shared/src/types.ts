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
}
