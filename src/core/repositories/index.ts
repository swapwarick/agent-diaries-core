import { StorageManager, defaultStorageManager } from "../storage/StorageManager";
import { EventBus, defaultEventBus } from "../events/EventBus";
import {
  WorkflowRecord,
  WorkflowState,
  AgentState,
  TaskRecord,
  TaskListOptions,
  TraceRecord,
  SpanRecord,
  TimelineEvent,
  MetricRecord,
  AggregatedMetrics,
  ProviderHealthRecord,
} from "../../shared/types";
import { WorkflowStateMachine } from "../state/WorkflowStateMachine";
import { randomUUID } from "crypto";

/**
 * Domain repository managing workflow creation, state transitions, worker claims, and deduplication.
 */
export class WorkflowRepository {
  constructor(
    private storageManager: StorageManager = defaultStorageManager,
    private eventBus: EventBus = defaultEventBus,
  ) {}

  /** Creates a new workflow record. */
  async createWorkflow(
    name: string,
    payload?: any,
    options?: { signature?: string; ttlMs?: number },
  ): Promise<WorkflowRecord> {
    const now = Date.now();
    const workflow: WorkflowRecord = {
      id: randomUUID(),
      name,
      state: WorkflowState.CREATED,
      payload,
      createdAt: now,
      updatedAt: now,
      signature: options?.signature,
      ttlMs: options?.ttlMs,
    };

    await this.storageManager.getPersistence().saveWorkflow(workflow);
    await this.eventBus.emit("WorkflowCreated", { workflow });
    return workflow;
  }

  /** Claims a workflow for execution by a worker node. */
  async claimWorkflow(id: string, workerId: string): Promise<boolean> {
    const lockKey = `wf_lock_${id}`;
    return await this.storageManager.getLock().withLock(lockKey, async () => {
      const wf = await this.storageManager.getPersistence().getWorkflow(id);
      if (!wf) return false;

      WorkflowStateMachine.validateTransition(wf.state, WorkflowState.CLAIMED);

      wf.state = WorkflowState.CLAIMED;
      wf.workerId = workerId;
      wf.updatedAt = Date.now();

      await this.storageManager.getPersistence().saveWorkflow(wf);
      await this.eventBus.emit("WorkflowClaimed", { workflowId: id, workerId });
      return true;
    });
  }

  /** Completes a workflow with an optional execution result. */
  async completeWorkflow(id: string, result?: any): Promise<void> {
    const lockKey = `wf_lock_${id}`;
    await this.storageManager.getLock().withLock(lockKey, async () => {
      const wf = await this.storageManager.getPersistence().getWorkflow(id);
      if (!wf) throw new Error(`Workflow "${id}" not found.`);

      WorkflowStateMachine.validateTransition(wf.state, WorkflowState.COMPLETED);

      const now = Date.now();
      wf.state = WorkflowState.COMPLETED;
      wf.result = result;
      wf.updatedAt = now;
      wf.completedAt = now;

      await this.storageManager.getPersistence().saveWorkflow(wf);
      await this.eventBus.emit("WorkflowCompleted", { workflowId: id, result });
    });
  }

  /** Fails a workflow with an error reason. */
  async failWorkflow(id: string, reason?: string): Promise<void> {
    const lockKey = `wf_lock_${id}`;
    await this.storageManager.getLock().withLock(lockKey, async () => {
      const wf = await this.storageManager.getPersistence().getWorkflow(id);
      if (!wf) throw new Error(`Workflow "${id}" not found.`);

      WorkflowStateMachine.validateTransition(wf.state, WorkflowState.FAILED);

      const now = Date.now();
      wf.state = WorkflowState.FAILED;
      wf.failReason = reason;
      wf.updatedAt = now;

      await this.storageManager.getPersistence().saveWorkflow(wf);
      await this.eventBus.emit("WorkflowFailed", { workflowId: id, reason });
    });
  }

  /** Cancels a workflow. */
  async cancelWorkflow(id: string): Promise<void> {
    const lockKey = `wf_lock_${id}`;
    await this.storageManager.getLock().withLock(lockKey, async () => {
      const wf = await this.storageManager.getPersistence().getWorkflow(id);
      if (!wf) throw new Error(`Workflow "${id}" not found.`);

      WorkflowStateMachine.validateTransition(wf.state, WorkflowState.CANCELLED);

      wf.state = WorkflowState.CANCELLED;
      wf.updatedAt = Date.now();

      await this.storageManager.getPersistence().saveWorkflow(wf);
    });
  }

  /** Releases a workflow back to QUEUED status. */
  async releaseWorkflow(id: string): Promise<void> {
    const lockKey = `wf_lock_${id}`;
    await this.storageManager.getLock().withLock(lockKey, async () => {
      const wf = await this.storageManager.getPersistence().getWorkflow(id);
      if (!wf) return;

      wf.state = WorkflowState.QUEUED;
      wf.workerId = undefined;
      wf.updatedAt = Date.now();

      await this.storageManager.getPersistence().saveWorkflow(wf);
    });
  }

  /** Finds a previously completed reusable workflow by signature. */
  async findReusableWorkflow(signature: string): Promise<WorkflowRecord | null> {
    const list = await this.storageManager
      .getPersistence()
      .listWorkflows({ signature, state: WorkflowState.COMPLETED });
    if (list.length === 0) return null;
    const sorted = list.sort((a, b) => b.createdAt - a.createdAt);
    const reusable = sorted[0];
    await this.eventBus.emit("WorkflowReused", {
      workflowId: reusable.id,
      signature,
    });
    return reusable;
  }

  /** Lists workflow records with optional filter. */
  async listWorkflowHistory(
    filter?: Partial<WorkflowRecord>,
  ): Promise<WorkflowRecord[]> {
    return this.storageManager.getPersistence().listWorkflows(filter);
  }
}

/**
 * Domain repository managing agent diary persistence and task indexing.
 */
export class DiaryRepository {
  constructor(
    private storageManager: StorageManager = defaultStorageManager,
    private eventBus: EventBus = defaultEventBus,
  ) {}

  private getDiaryKey(agentId: string): string {
    return `diary_${agentId}`;
  }

  /** Saves an agent's diary state. */
  async saveDiary(agentId: string, state: AgentState): Promise<void> {
    const key = this.getDiaryKey(agentId);
    await this.storageManager.getCache().set(key, state);
    await this.eventBus.emit("DiaryUpdated", { agentId, state });
  }

  /** Loads an agent's diary state. */
  async loadDiary(agentId: string): Promise<AgentState | null> {
    const key = this.getDiaryKey(agentId);
    return this.storageManager.getCache().get<AgentState>(key);
  }

  /** Records signature reuse in diary state. */
  async recordReuse(agentId: string, signature: string): Promise<void> {
    const lockKey = `${this.getDiaryKey(agentId)}:lock`;
    await this.storageManager.getLock().withLock(lockKey, async () => {
      const state = (await this.loadDiary(agentId)) || {
        lastRun: Date.now(),
        seenSignatures: [],
        runCount: 0,
        history: [],
      };
      if (!state.seenSignatures.includes(signature)) {
        state.seenSignatures.push(signature);
      }
      await this.saveDiary(agentId, state);
    });
  }

  /** Finds a task record by signature. */
  async findBySignature(
    agentId: string,
    signature: string,
  ): Promise<TaskRecord | null> {
    const state = await this.loadDiary(agentId);
    if (!state) return null;
    const record = state.history.find((r) => r.signature === signature);
    return record ? { ...record } : null;
  }

  /** Lists diary task entries. */
  async listDiaryEntries(
    agentId: string,
    options?: TaskListOptions,
  ): Promise<TaskRecord[]> {
    const state = await this.loadDiary(agentId);
    if (!state) return [];
    let entries = [...state.history];

    if (!options?.includeExpired) {
      const now = Date.now();
      entries = entries.filter(
        (r) => !r.ttlMs || now - r.timestamp <= r.ttlMs,
      );
    }

    if (options?.status) {
      const statuses = Array.isArray(options.status)
        ? options.status
        : [options.status];
      entries = entries.filter((r) => statuses.includes(r.status));
    }

    const offset = options?.offset || 0;
    const limit = options?.limit;
    const sliced = entries.slice(offset);
    return limit !== undefined ? sliced.slice(0, limit) : sliced;
  }
}

/**
 * Domain repository managing OpenTelemetry-style trace records and spans.
 */
export class TraceRepository {
  constructor(
    private storageManager: StorageManager = defaultStorageManager,
    private eventBus: EventBus = defaultEventBus,
  ) {}

  /** Records a trace. */
  async recordTrace(trace: TraceRecord): Promise<void> {
    await this.storageManager.getPersistence().saveTrace(trace);
    await this.eventBus.emit("TraceRecorded", { trace });
  }

  /** Records a span under a trace. */
  async recordSpan(traceId: string, span: SpanRecord): Promise<void> {
    const trace = await this.storageManager.getPersistence().getTrace(traceId);
    if (trace) {
      trace.spans.push(span);
      await this.recordTrace(trace);
    }
  }

  /** Loads a trace by ID. */
  async loadTrace(traceId: string): Promise<TraceRecord | null> {
    return this.storageManager.getPersistence().getTrace(traceId);
  }

  /** Loads traces for a workflow ID. */
  async loadWorkflowTrace(workflowId: string): Promise<TraceRecord[]> {
    const persistence = this.storageManager.getPersistence();
    if (persistence.loadWorkflowTrace) {
      return persistence.loadWorkflowTrace(workflowId);
    }
    return [];
  }
}

/**
 * Domain repository managing sequenced timeline audit log events.
 */
export class TimelineRepository {
  constructor(
    private storageManager: StorageManager = defaultStorageManager,
  ) {}

  /** Appends a timeline audit event. */
  async appendEvent(
    event: Omit<TimelineEvent, "id" | "timestamp"> & {
      id?: string;
      timestamp?: number;
    },
  ): Promise<TimelineEvent> {
    const fullEvent: TimelineEvent = {
      id: event.id || randomUUID(),
      timestamp: event.timestamp || Date.now(),
      type: event.type,
      workflowId: event.workflowId,
      payload: event.payload,
    };
    await this.storageManager.getPersistence().saveTimelineEvent(fullEvent);
    return fullEvent;
  }

  /** Loads timeline events. */
  async loadTimeline(workflowId?: string): Promise<TimelineEvent[]> {
    return this.storageManager.getPersistence().getTimeline(workflowId);
  }

  /** Loads workflow timeline events. */
  async loadWorkflowTimeline(workflowId: string): Promise<TimelineEvent[]> {
    return this.loadTimeline(workflowId);
  }
}

/**
 * Domain repository managing metrics recording and aggregation.
 */
export class MetricsRepository {
  constructor(
    private storageManager: StorageManager = defaultStorageManager,
  ) {}

  /** Records a metric value. */
  async recordMetric(
    name: string,
    value: number,
    tags?: Record<string, string>,
  ): Promise<MetricRecord> {
    const metric: MetricRecord = {
      name,
      value,
      tags,
      timestamp: Date.now(),
    };
    await this.storageManager.getPersistence().saveMetric(metric);
    return metric;
  }

  /** Loads metric records. */
  async loadMetrics(name?: string): Promise<MetricRecord[]> {
    const all = await this.storageManager.getPersistence().getMetrics();
    if (!name) return all;
    return all.filter((m) => m.name === name);
  }

  /** Computes aggregated metric summary. */
  async aggregateMetrics(name: string): Promise<AggregatedMetrics | null> {
    const list = await this.loadMetrics(name);
    if (list.length === 0) return null;

    let sum = 0;
    let min = Infinity;
    let max = -Infinity;

    for (const m of list) {
      sum += m.value;
      if (m.value < min) min = m.value;
      if (m.value > max) max = m.value;
    }

    return {
      name,
      count: list.length,
      sum,
      avg: sum / list.length,
      min,
      max,
    };
  }
}

/**
 * Domain repository tracking search provider latencies and failures.
 */
export class ProviderRepository {
  private healthRecords = new Map<string, ProviderHealthRecord[]>();

  constructor(
    private eventBus: EventBus = defaultEventBus,
  ) {}

  /** Records provider latency. */
  async recordProviderLatency(
    providerName: string,
    latencyMs: number,
  ): Promise<void> {
    const list = this.healthRecords.get(providerName) || [];
    list.push({
      providerName,
      latencyMs,
      success: true,
      timestamp: Date.now(),
    });
    this.healthRecords.set(providerName, list.slice(-100));
  }

  /** Records provider failure. */
  async recordProviderFailure(
    providerName: string,
    error: string,
  ): Promise<void> {
    const list = this.healthRecords.get(providerName) || [];
    list.push({
      providerName,
      latencyMs: 0,
      success: false,
      error,
      timestamp: Date.now(),
    });
    this.healthRecords.set(providerName, list.slice(-100));
    await this.eventBus.emit("ProviderFailure", { providerName, error });
  }

  /** Loads provider health records. */
  async loadProviderHealth(providerName: string): Promise<ProviderHealthRecord[]> {
    return this.healthRecords.get(providerName) || [];
  }
}
