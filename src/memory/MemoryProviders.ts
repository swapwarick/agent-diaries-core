import {
  CacheProvider,
  LockProvider,
  PersistenceProvider,
} from "../core/storage/contracts";
import {
  WorkflowRecord,
  TraceRecord,
  TimelineEvent,
  MetricRecord,
} from "../shared/types";
import { randomUUID } from "crypto";

export class MemoryCacheProvider implements CacheProvider {
  private cache = new Map<string, { value: any; expiresAt?: number }>();

  async get<T>(key: string): Promise<T | null> {
    const item = this.cache.get(key);
    if (!item) return null;
    if (item.expiresAt && Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return item.value as T;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    const expiresAt = ttlMs ? Date.now() + ttlMs : undefined;
    this.cache.set(key, { value, expiresAt });
  }

  async delete(key: string): Promise<boolean> {
    return this.cache.delete(key);
  }

  async searchKeys(pattern: string): Promise<string[]> {
    const now = Date.now();
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    const result: string[] = [];

    for (const [key, item] of this.cache.entries()) {
      if (item.expiresAt && now > item.expiresAt) {
        this.cache.delete(key);
        continue;
      }
      if (regex.test(key)) {
        result.push(key);
      }
    }
    return result;
  }

  async clear(): Promise<void> {
    this.cache.clear();
  }
}

/**
 * In-memory lock provider.
 *
 * `acquireLock` / `releaseLock` / `renewLease` retain TTL semantics because
 * they model the interface for distributed backends (Redis, Postgres) where
 * TTL-based leases are the correct primitive.
 *
 * `withLock` — the method used by all internal coordination paths including
 * `WorkflowRepository.claimWorkflow()` — uses a chained-Promise FIFO mutex
 * with **no TTL**. This is safe for single-process use and eliminates the
 * lock-theft race condition observed during chaos testing (where injected
 * delays exceeding the TTL allowed a second waiter to steal the lock while
 * the original holder was still executing).
 */
export class MemoryLockProvider implements LockProvider {
  private locks = new Map<string, { token: string; expiresAt: number }>();

  /**
   * Per-key FIFO mutex queues backing `withLock()`. Separate from the TTL
   * `locks` map used by `acquireLock`/`releaseLock`.
   */
  private mutexQueues = new Map<string, Promise<void>>();

  async acquireLock(key: string, ttlMs: number = 10000): Promise<string | null> {
    const now = Date.now();
    const existing = this.locks.get(key);
    if (existing && existing.expiresAt > now) {
      return null;
    }
    const token = randomUUID();
    this.locks.set(key, { token, expiresAt: now + ttlMs });
    return token;
  }

  async releaseLock(key: string, lockToken: string): Promise<boolean> {
    const existing = this.locks.get(key);
    if (existing && existing.token === lockToken) {
      this.locks.delete(key);
      return true;
    }
    return false;
  }

  async renewLease(
    key: string,
    lockToken: string,
    ttlMs: number = 10000,
  ): Promise<boolean> {
    const existing = this.locks.get(key);
    if (existing && existing.token === lockToken) {
      existing.expiresAt = Date.now() + ttlMs;
      return true;
    }
    return false;
  }

  /**
   * Acquires a per-key FIFO mutex and executes `fn` inside the critical section.
   *
   * Guarantees:
   * - Exactly one caller executes `fn` at a time per key.
   * - The mutex is always released in `finally` — exceptions cannot deadlock.
   * - No TTL: the mutex cannot be stolen while `fn` is executing, regardless
   *   of how long execution takes. This is the core fix for the chaos race.
   */
  async withLock<R>(key: string, fn: () => Promise<R>): Promise<R> {
    const mutexKey = `${key}:mutex`;

    // Grab the tail of the current queue (a resolved Promise when idle).
    const prev = this.mutexQueues.get(mutexKey) ?? Promise.resolve();

    // Create a release handle for this entry.
    let releaseMutex!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseMutex = resolve;
    });

    // Append to the queue: next caller must wait for prev AND our hold.
    this.mutexQueues.set(mutexKey, prev.then(() => hold));

    // Wait our turn — no polling, no TTL, purely event-loop-driven.
    await prev;

    try {
      return await fn();
    } finally {
      // Always release so the next queued waiter can proceed.
      releaseMutex();
    }
  }
}

export class MemoryPersistenceProvider implements PersistenceProvider {
  private workflows = new Map<string, WorkflowRecord>();
  private traces = new Map<string, TraceRecord>();
  private timeline: TimelineEvent[] = [];
  private metrics: MetricRecord[] = [];
  private reports = new Map<string, any>();

  async saveWorkflow(workflow: WorkflowRecord): Promise<void> {
    this.workflows.set(workflow.id, { ...workflow });
  }

  async getWorkflow(id: string): Promise<WorkflowRecord | null> {
    const wf = this.workflows.get(id);
    return wf ? { ...wf } : null;
  }

  async listWorkflows(
    filter?: Partial<WorkflowRecord>,
  ): Promise<WorkflowRecord[]> {
    let list = Array.from(this.workflows.values());
    if (filter) {
      list = list.filter((wf) => {
        for (const [k, v] of Object.entries(filter)) {
          if ((wf as any)[k] !== v) return false;
        }
        return true;
      });
    }
    return list.map((wf) => ({ ...wf }));
  }

  async deleteWorkflow(id: string): Promise<boolean> {
    return this.workflows.delete(id);
  }

  async saveTrace(trace: TraceRecord): Promise<void> {
    this.traces.set(trace.traceId, { ...trace });
  }

  async getTrace(id: string): Promise<TraceRecord | null> {
    const tr = this.traces.get(id);
    return tr ? JSON.parse(JSON.stringify(tr)) : null;
  }

  async loadWorkflowTrace(workflowId: string): Promise<TraceRecord[]> {
    return Array.from(this.traces.values())
      .filter((t) => t.workflowId === workflowId)
      .map((t) => JSON.parse(JSON.stringify(t)));
  }

  async saveTimelineEvent(event: TimelineEvent): Promise<void> {
    this.timeline.push({ ...event });
  }

  async getTimeline(workflowId?: string): Promise<TimelineEvent[]> {
    if (!workflowId) return [...this.timeline];
    return this.timeline.filter((e) => e.workflowId === workflowId);
  }

  async saveMetric(metric: MetricRecord): Promise<void> {
    this.metrics.push({ ...metric });
  }

  async getMetrics(): Promise<MetricRecord[]> {
    return [...this.metrics];
  }

  async saveReport(name: string, report: any): Promise<void> {
    this.reports.set(name, report);
  }

  async getBenchmarkHistory(): Promise<any[]> {
    return Array.from(this.reports.values());
  }
}
