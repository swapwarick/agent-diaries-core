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
} from "@agent-diaries/shared";
import { WorkflowStateMachine } from "../state/WorkflowStateMachine";
import { randomUUID } from "crypto";

export class WorkflowRepository {
  constructor(
    private storageManager: StorageManager = defaultStorageManager,
    private eventBus: EventBus = defaultEventBus,
  ) {}

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

  async listWorkflowHistory(
    filter?: Partial<WorkflowRecord>,
  ): Promise<WorkflowRecord[]> {
    return this.storageManager.getPersistence().listWorkflows(filter);
  }
}

export class DiaryRepository {
  constructor(
    private storageManager: StorageManager = defaultStorageManager,
    private eventBus: EventBus = defaultEventBus,
  ) {}

  private getDiaryKey(agentId: string): string {
    return `diary_${agentId}`;
  }

  async saveDiary(agentId: string, state: AgentState): Promise<void> {
    const key = this.getDiaryKey(agentId);
    await this.storageManager.getCache().set(key, state);
    await this.eventBus.emit("DiaryUpdated", { agentId, state });
  }

  async loadDiary(agentId: string): Promise<AgentState | null> {
    const key = this.getDiaryKey(agentId);
    return this.storageManager.getCache().get<AgentState>(key);
  }

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

  async findBySignature(
    agentId: string,
    signature: string,
  ): Promise<TaskRecord | null> {
    const state = await this.loadDiary(agentId);
    if (!state) return null;
    const record = state.history.find((r) => r.signature === signature);
    return record ? { ...record } : null;
  }

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

export class TraceRepository {
  constructor(
    private storageManager: StorageManager = defaultStorageManager,
    private eventBus: EventBus = defaultEventBus,
  ) {}

  async recordTrace(trace: TraceRecord): Promise<void> {
    await this.storageManager.getPersistence().saveTrace(trace);
    await this.eventBus.emit("TraceRecorded", { trace });
  }

  async recordSpan(traceId: string, span: SpanRecord): Promise<void> {
    const trace = await this.storageManager.getPersistence().getTrace(traceId);
    if (trace) {
      trace.spans.push(span);
      await this.recordTrace(trace);
    }
  }

  async loadTrace(traceId: string): Promise<TraceRecord | null> {
    return this.storageManager.getPersistence().getTrace(traceId);
  }

  async loadWorkflowTrace(workflowId: string): Promise<TraceRecord[]> {
    const persistence = this.storageManager.getPersistence();
    if (persistence.loadWorkflowTrace) {
      return persistence.loadWorkflowTrace(workflowId);
    }
    return [];
  }
}

export class TimelineRepository {
  constructor(
    private storageManager: StorageManager = defaultStorageManager,
  ) {}

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

  async loadTimeline(workflowId?: string): Promise<TimelineEvent[]> {
    return this.storageManager.getPersistence().getTimeline(workflowId);
  }

  async loadWorkflowTimeline(workflowId: string): Promise<TimelineEvent[]> {
    return this.loadTimeline(workflowId);
  }
}

export class MetricsRepository {
  constructor(
    private storageManager: StorageManager = defaultStorageManager,
  ) {}

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

  async loadMetrics(name?: string): Promise<MetricRecord[]> {
    const all = await this.storageManager.getPersistence().getMetrics();
    if (!name) return all;
    return all.filter((m) => m.name === name);
  }

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

export class ProviderRepository {
  private healthRecords = new Map<string, ProviderHealthRecord[]>();

  constructor(
    private eventBus: EventBus = defaultEventBus,
  ) {}

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

  async loadProviderHealth(providerName: string): Promise<ProviderHealthRecord[]> {
    return this.healthRecords.get(providerName) || [];
  }
}
