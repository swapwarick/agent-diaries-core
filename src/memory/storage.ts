import * as fs from "fs";
import * as path from "path";
import * as lockfile from "proper-lockfile";
import { randomUUID } from "crypto";

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
      console.error(`[LocalFileStorage] Error reading key ${key}:`, e);
      return null;
    }
  }

  async set(key: string, value: T): Promise<void> {
    const filePath = this.getFilePath(key);
    try {
      const data = JSON.stringify(value, null, 2);
      await fs.promises.writeFile(filePath, data, "utf-8");
    } catch (e) {
      console.error(`[LocalFileStorage] Error writing key ${key}:`, e);
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
 * @example
 * ```typescript
 * const storage = new MemoryStorage();
 * ```
 */
export class MemoryStorage<T> implements StorageAdapter<T> {
  private store = new Map<string, string>();
  private locks = new Map<string, { value: string; expiresAt: number }>();

  async get(key: string): Promise<T | null> {
    const data = this.store.get(key);
    if (!data) return null;
    try {
      return JSON.parse(data) as T;
    } catch (e) {
      console.error(`[MemoryStorage] Failed to parse JSON for key ${key}:`, e);
      return null;
    }
  }

  async set(key: string, value: T): Promise<void> {
    this.store.set(key, JSON.stringify(value));
  }

  async withLock<R>(key: string, fn: () => Promise<R>): Promise<R> {
    const lockKey = `${key}:lock`;
    const lockValue = randomUUID();
    const lockTtlMs = 10000;

    const acquireLock = (): boolean => {
      const now = Date.now();
      const existing = this.locks.get(lockKey);
      if (existing && existing.expiresAt > now) {
        return false;
      }
      this.locks.set(lockKey, {
        value: lockValue,
        expiresAt: now + lockTtlMs,
      });
      return true;
    };

    let attempt = 0;
    while (!acquireLock()) {
      const backoff = Math.min(10 * Math.pow(2, attempt), 500);
      const jitter = Math.random() * 50;
      await new Promise((resolve) => setTimeout(resolve, backoff + jitter));
      attempt++;
      if (attempt > 60) {
        throw new Error(`[MemoryStorage] Lock timeout on key: ${key}`);
      }
    }

    try {
      return await fn();
    } finally {
      const existing = this.locks.get(lockKey);
      if (existing && existing.value === lockValue) {
        this.locks.delete(lockKey);
      }
    }
  }
}
