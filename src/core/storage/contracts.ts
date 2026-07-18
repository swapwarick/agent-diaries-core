import {
  WorkflowRecord,
  TraceRecord,
  TimelineEvent,
  MetricRecord,
} from "../../shared/types";

export interface CacheProvider {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<boolean>;
  searchKeys(pattern: string): Promise<string[]>;
  clear?(): Promise<void>;
}

export interface LockProvider {
  acquireLock(key: string, ttlMs?: number): Promise<string | null>;
  releaseLock(key: string, lockToken: string): Promise<boolean>;
  withLock<R>(key: string, fn: () => Promise<R>): Promise<R>;
  renewLease?(key: string, lockToken: string, ttlMs?: number): Promise<boolean>;
}

export interface PersistenceProvider {
  saveWorkflow(workflow: WorkflowRecord): Promise<void>;
  getWorkflow(id: string): Promise<WorkflowRecord | null>;
  listWorkflows(filter?: Partial<WorkflowRecord>): Promise<WorkflowRecord[]>;
  deleteWorkflow?(id: string): Promise<boolean>;

  saveTrace(trace: TraceRecord): Promise<void>;
  getTrace(id: string): Promise<TraceRecord | null>;
  loadWorkflowTrace?(workflowId: string): Promise<TraceRecord[]>;

  saveTimelineEvent(event: TimelineEvent): Promise<void>;
  getTimeline(workflowId?: string): Promise<TimelineEvent[]>;

  saveMetric(metric: MetricRecord): Promise<void>;
  getMetrics(): Promise<MetricRecord[]>;

  saveReport?(name: string, report: any): Promise<void>;
  getBenchmarkHistory?(): Promise<any[]>;
}
