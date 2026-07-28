import * as fs from "fs";
import * as path from "path";
import * as lockfile from "proper-lockfile";

/**
 * Interface contract for legacy storage adapters.
 */
export interface StorageAdapter<T> {
  get(key: string): Promise<T | null>;
  set(key: string, value: T): Promise<void>;
  withLock<R>(key: string, fn: () => Promise<R>): Promise<R>;
}

/**
 * Local file-system storage adapter storing state as JSON files with proper-lockfile file locking.
 *
 * @example
 * ```typescript
 * const storage = new LocalFileStorage({ baseDir: "./.agent-diaries" });
 * ```
 */
export class LocalFileStorage<T> implements StorageAdapter<T> {
  private baseDir: string;

  /**
   * Constructs a LocalFileStorage adapter.
   * @param options Directory configuration.
   */
  constructor(options: { baseDir?: string } = {}) {
    this.baseDir =
      options.baseDir || path.join(process.cwd(), ".agent-diaries");
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private getFilePath(key: string): string {
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "_");
    return path.join(this.baseDir, `${safeKey}.json`);
  }

  async get(key: string): Promise<T | null> {
    const filePath = this.getFilePath(key);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    try {
      const data = await fs.promises.readFile(filePath, "utf-8");
      return JSON.parse(data) as T;
    } catch (e) {
      process.stderr.write(`[LocalFileStorage] Error reading key ${key}: ${e}\n`);
      return null;
    }
  }

  async set(key: string, value: T): Promise<void> {
    const filePath = this.getFilePath(key);
    try {
      const data = JSON.stringify(value, null, 2);
      await fs.promises.writeFile(filePath, data, "utf-8");
    } catch (e) {
      process.stderr.write(`[LocalFileStorage] Error writing key ${key}: ${e}\n`);
      throw e;
    }
  }

  async withLock<R>(key: string, fn: () => Promise<R>): Promise<R> {
    const filePath = this.getFilePath(key);

    if (!fs.existsSync(filePath)) {
      await fs.promises.writeFile(filePath, "null", "utf-8");
    }

    const release = await lockfile.lock(filePath, {
      retries: { retries: 100, minTimeout: 10, maxTimeout: 100 },
      realpath: false,
    });
    try {
      return await fn();
    } finally {
      await release();
    }
  }
}

/**
 * In-memory storage adapter for testing and ephemeral process execution.
 *
 * Uses a chained-Promise mutex for serializing concurrent access. Unlike the
 * previous TTL-based spin-lock, this mutex cannot expire while the holder is
 * executing, which eliminates the lock-theft race condition observed under
 * chaos conditions (injected delays, simulated crashes, slow I/O).
 *
 * **Why no TTL?** In a single-process in-memory context, if the lock holder
 * crashes the entire process crashes — there is no surviving process to steal
 * the lock from. A TTL only introduces risk: any delay exceeding the TTL
 * allowed a second caller to enter the critical section while the first was
 * still running, causing duplicate task execution.
 *
 * @example
 * ```typescript
 * const storage = new MemoryStorage();
 * ```
 */
export class MemoryStorage<T> implements StorageAdapter<T> {
  private store = new Map<string, string>();

  /**
   * Per-key FIFO mutex queues. Each key maps to a Promise that resolves only
   * after all previously-enqueued holders have finished. New callers chain off
   * the tail of this queue so execution is always serialized.
   */
  private mutexQueues = new Map<string, Promise<void>>();

  async get(key: string): Promise<T | null> {
    const data = this.store.get(key);
    if (!data) return null;
    try {
      return JSON.parse(data) as T;
    } catch (e) {
      process.stderr.write(`[MemoryStorage] Failed to parse JSON for key ${key}: ${e}\n`);
      return null;
    }
  }

  async set(key: string, value: T): Promise<void> {
    this.store.set(key, JSON.stringify(value));
  }

  /**
   * Acquires a per-key FIFO mutex and executes `fn` inside the critical section.
   *
   * Guarantees:
   * - Exactly one caller executes `fn` at a time per key.
   * - The mutex is always released in `finally` — exceptions cannot deadlock.
   * - No TTL: the mutex cannot expire while `fn` is running, regardless of
   *   how long execution takes. This is the direct fix for the chaos race.
   */
  async withLock<R>(key: string, fn: () => Promise<R>): Promise<R> {
    const mutexKey = `${key}:mutex`;

    // Grab the tail of the current queue (a resolved Promise when key is idle).
    const prev = this.mutexQueues.get(mutexKey) ?? Promise.resolve();

    // Create a release handle for this entry.
    let releaseMutex!: () => void;
    const hold = new Promise<void>((resolve) => {
      releaseMutex = resolve;
    });

    // Append to the queue: the next caller must wait for prev AND our hold.
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
