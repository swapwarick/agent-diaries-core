import { CacheProvider, LockProvider, PersistenceProvider } from "./contracts";
import {
  MemoryCacheProvider,
  MemoryLockProvider,
  MemoryPersistenceProvider,
} from "../../memory/MemoryProviders";

export interface StorageManagerOptions {
  cache?: CacheProvider;
  lock?: LockProvider;
  persistence?: PersistenceProvider;
  legacyAdapter?: any;
}

/**
 * Bridge adapter wrapping legacy key-value storage adapters into unified Cache, Lock, and Persistence providers.
 */
export class StorageAdapterBridge
  implements CacheProvider, LockProvider, PersistenceProvider
{
  /**
   * Constructs a bridge adapter wrapping a legacy storage driver.
   * @param adapter The legacy StorageAdapter instance.
   */
  constructor(private adapter: any) {}

  async get<T>(key: string): Promise<T | null> {
    return this.adapter.get(key);
  }

  async set<T>(key: string, value: T): Promise<void> {
    await this.adapter.set(key, value);
  }

  async delete(key: string): Promise<boolean> {
    const existing = await this.adapter.get(key);
    if (existing === null) return false;
    await this.adapter.set(key, null as any);
    return true;
  }

  async searchKeys(_pattern: string): Promise<string[]> {
    return [];
  }

  async acquireLock(key: string, _ttlMs?: number): Promise<string | null> {
    try {
      return `legacy-lock:${key}`;
    } catch {
      return null;
    }
  }

  async releaseLock(_key: string, _lockToken: string): Promise<boolean> {
    return true;
  }

  async withLock<R>(key: string, fn: () => Promise<R>): Promise<R> {
    return this.adapter.withLock(key, fn);
  }

  async saveWorkflow(workflow: any): Promise<void> {
    await this.set(`workflow_${workflow.id}`, workflow);
  }

  async getWorkflow(id: string): Promise<any | null> {
    return this.get(`workflow_${id}`);
  }

  async listWorkflows(): Promise<any[]> {
    return [];
  }

  async saveTrace(trace: any): Promise<void> {
    await this.set(`trace_${trace.traceId}`, trace);
  }

  async getTrace(id: string): Promise<any | null> {
    return this.get(`trace_${id}`);
  }

  async saveTimelineEvent(event: any): Promise<void> {
    const events = (await this.get<any[]>("timeline_events")) || [];
    events.push(event);
    await this.set("timeline_events", events);
  }

  async getTimeline(workflowId?: string): Promise<any[]> {
    const events = (await this.get<any[]>("timeline_events")) || [];
    if (!workflowId) return events;
    return events.filter((e) => e.workflowId === workflowId);
  }

  async saveMetric(metric: any): Promise<void> {
    const metrics = (await this.get<any[]>("metrics_history")) || [];
    metrics.push(metric);
    await this.set("metrics_history", metrics);
  }

  async getMetrics(): Promise<any[]> {
    return (await this.get<any[]>("metrics_history")) || [];
  }
}

/**
 * Infrastructure storage manager orchestrating CacheProvider, LockProvider, and PersistenceProvider abstractions.
 *
 * @example
 * ```typescript
 * const storageManager = new StorageManager({
 *   cache: new MemoryCacheProvider(),
 *   lock: new MemoryLockProvider(),
 *   persistence: new MemoryPersistenceProvider(),
 * });
 * ```
 */
export class StorageManager {
  private cacheProvider: CacheProvider;
  private lockProvider: LockProvider;
  private persistenceProvider: PersistenceProvider;

  /**
   * Constructs a new StorageManager.
   * @param options Configuration options providing custom providers or legacy adapter bridge.
   */
  constructor(options: StorageManagerOptions = {}) {
    if (options.legacyAdapter) {
      const bridge = new StorageAdapterBridge(options.legacyAdapter);
      this.cacheProvider = options.cache || bridge;
      this.lockProvider = options.lock || bridge;
      this.persistenceProvider = options.persistence || bridge;
    } else {
      this.cacheProvider = options.cache || new MemoryCacheProvider();
      this.lockProvider = options.lock || new MemoryLockProvider();
      this.persistenceProvider =
        options.persistence || new MemoryPersistenceProvider();
    }
  }

  /** Gets the active CacheProvider instance. */
  public getCache(): CacheProvider {
    return this.cacheProvider;
  }

  /** Gets the active LockProvider instance. */
  public getLock(): LockProvider {
    return this.lockProvider;
  }

  /** Gets the active PersistenceProvider instance. */
  public getPersistence(): PersistenceProvider {
    return this.persistenceProvider;
  }

  /** Sets the active CacheProvider. */
  public setCache(provider: CacheProvider): void {
    this.cacheProvider = provider;
  }

  /** Sets the active LockProvider. */
  public setLock(provider: LockProvider): void {
    this.lockProvider = provider;
  }

  /** Sets the active PersistenceProvider. */
  public setPersistence(provider: PersistenceProvider): void {
    this.persistenceProvider = provider;
  }
}

export const defaultStorageManager = new StorageManager();
