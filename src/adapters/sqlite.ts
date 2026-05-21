import { StorageAdapter } from '../storage';
import type { Database } from 'better-sqlite3';

export interface SqliteStorageOptions {
  db: Database;
  tableName?: string;
  locksTableName?: string;
}

export class SqliteStorage<T> implements StorageAdapter<T> {
  private db: Database;
  private tableName: string;
  private locksTableName: string;

  constructor(options: SqliteStorageOptions) {
    if (!options.db) {
      throw new Error('[SqliteStorage] database instance (db) is required.');
    }
    this.db = options.db;
    this.tableName = options.tableName || 'agent_diaries_storage';
    this.locksTableName = options.locksTableName || 'agent_diaries_locks';

    // Initialize tables synchronously as better-sqlite3 is fully synchronous
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS ${this.locksTableName} (
        key TEXT PRIMARY KEY,
        locked_at INTEGER
      );
    `);
  }

  async get(key: string): Promise<T | null> {
    try {
      const row = this.db
        .prepare(`SELECT value FROM ${this.tableName} WHERE key = ?`)
        .get(key) as { value: string } | undefined;

      if (!row) return null;
      return JSON.parse(row.value) as T;
    } catch (e) {
      console.error(`[SqliteStorage] Failed to get key ${key}:`, e);
      return null;
    }
  }

  async set(key: string, value: T): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      this.db
        .prepare(`
          INSERT INTO ${this.tableName} (key, value)
          VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `)
        .run(key, serialized);
    } catch (e) {
      console.error(`[SqliteStorage] Failed to set key ${key}:`, e);
      throw e;
    }
  }

  async withLock<R>(key: string, fn: () => Promise<R>): Promise<R> {
    const lockKey = `lock:${key}`;
    const lockTtlMs = 10000; // 10 seconds max lock

    const acquireLock = (): boolean => {
      const now = Date.now();
      try {
        this.db
          .prepare(`INSERT INTO ${this.locksTableName} (key, locked_at) VALUES (?, ?)`)
          .run(lockKey, now);
        return true;
      } catch (error: any) {
        if (
          error.code === 'SQLITE_CONSTRAINT_PRIMARYKEY' ||
          error.code === 'SQLITE_CONSTRAINT' ||
          (error.message && error.message.includes('UNIQUE constraint failed'))
        ) {
          // Check if the lock has expired
          const existing = this.db
            .prepare(`SELECT locked_at FROM ${this.locksTableName} WHERE key = ?`)
            .get(lockKey) as { locked_at: number } | undefined;

          if (existing && now - existing.locked_at > lockTtlMs) {
            // Attempt to clear the expired lock and acquire it
            try {
              // Wrap cleanup and acquire in a transaction for atomicity
              const runCleanupAndAcquire = this.db.transaction(() => {
                this.db
                  .prepare(`DELETE FROM ${this.locksTableName} WHERE key = ? AND locked_at = ?`)
                  .run(lockKey, existing.locked_at);
                this.db
                  .prepare(`INSERT INTO ${this.locksTableName} (key, locked_at) VALUES (?, ?)`)
                  .run(lockKey, now);
              });
              runCleanupAndAcquire();
              return true;
            } catch (retryError) {
              // Conflict during retry, lock is still held or acquired by another concurrent process
              return false;
            }
          }
          return false;
        }
        throw error;
      }
    };

    let attempt = 0;
    while (!acquireLock()) {
      const backoff = Math.min(10 * Math.pow(2, attempt), 500);
      const jitter = Math.random() * 50;
      await new Promise(resolve => setTimeout(resolve, backoff + jitter));
      attempt++;
      if (attempt > 60) {
        throw new Error(`[SqliteStorage] Lock timeout on key: ${key}`);
      }
    }

    try {
      return await fn();
    } finally {
      try {
        this.db
          .prepare(`DELETE FROM ${this.locksTableName} WHERE key = ?`)
          .run(lockKey);
      } catch (e) {
        console.error(`[SqliteStorage] Failed to release lock on key ${key}:`, e);
      }
    }
  }
}
