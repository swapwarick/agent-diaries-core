import { StorageAdapter } from "../storage";
import type { Pool } from "pg";
import { randomUUID } from "crypto";

export interface PostgresStorageOptions {
  /** A `pg` Pool instance (from the `pg` npm package). */
  pool: Pool;
  /** Table name for diary state blobs. Default: "agent_diaries_storage" */
  tableName?: string;
  /** Table name for distributed locks. Default: "agent_diaries_locks" */
  locksTableName?: string;
  /** Max lock hold time in milliseconds before it can be stolen. Default: 10000 */
  lockTtlMs?: number;
}

/**
 * PostgreSQL storage adapter for Agent Diaries.
 *
 * Uses a standard lock table with atomic INSERT + conflict detection for distributed
 * locking — similar to the SQLite adapter, but for PostgreSQL / Supabase / Neon.
 *
 * For true atomic advisory locking you can wrap the pool with pg_try_advisory_lock,
 * but the lock-table approach used here is universally compatible across all
 * managed Postgres providers (Supabase, Railway, Neon, RDS, etc.).
 *
 * @example
 * ```typescript
 * import { AgentDiary } from "@agent-diaries/core";
 * import { PostgresStorage } from "@agent-diaries/core/dist/adapters/postgres";
 * import { Pool } from "pg";
 *
 * const pool = new Pool({ connectionString: process.env.DATABASE_URL });
 * const diary = new AgentDiary({
 *   agentId: "pg-bot",
 *   storage: new PostgresStorage({ pool }),
 * });
 * ```
 *
 * @peer-dependency `pg` >= 8
 */
export class PostgresStorage<T> implements StorageAdapter<T> {
  private pool: Pool;
  private tableName: string;
  private locksTableName: string;
  private lockTtlMs: number;
  private initialized = false;

  constructor(options: PostgresStorageOptions) {
    if (!options.pool) {
      throw new Error("[PostgresStorage] A pg Pool instance (pool) is required.");
    }
    this.pool = options.pool;
    this.tableName = options.tableName || "agent_diaries_storage";
    this.locksTableName = options.locksTableName || "agent_diaries_locks";
    this.lockTtlMs = options.lockTtlMs ?? 10000;

    // Validate table names to prevent SQL injection
    const nameRegex = /^[a-zA-Z0-9_]+$/;
    if (!nameRegex.test(this.tableName)) {
      throw new Error(
        `[PostgresStorage] Invalid tableName: "${this.tableName}". Only alphanumeric characters and underscores are allowed.`,
      );
    }
    if (!nameRegex.test(this.locksTableName)) {
      throw new Error(
        `[PostgresStorage] Invalid locksTableName: "${this.locksTableName}". Only alphanumeric characters and underscores are allowed.`,
      );
    }
  }

  /** Idempotently creates the required tables and indexes (runs once per instance). */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        key  TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ${this.locksTableName} (
        key       TEXT PRIMARY KEY,
        locked_at BIGINT NOT NULL,
        lock_id   TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_${this.locksTableName}_locked_at
        ON ${this.locksTableName} (locked_at);
    `);
    this.initialized = true;
  }

  async get(key: string): Promise<T | null> {
    await this.ensureInitialized();
    try {
      const result = await this.pool.query(
        `SELECT value FROM ${this.tableName} WHERE key = $1`,
        [key],
      );
      if (result.rows.length === 0) return null;
      return JSON.parse(result.rows[0].value) as T;
    } catch (e) {
      console.error(`[PostgresStorage] Failed to get key ${key}:`, e);
      return null;
    }
  }

  async set(key: string, value: T): Promise<void> {
    await this.ensureInitialized();
    const data = JSON.stringify(value);
    await this.pool.query(
      `INSERT INTO ${this.tableName} (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, data],
    );
  }

  async withLock<R>(key: string, fn: () => Promise<R>): Promise<R> {
    await this.ensureInitialized();
    const lockKey = `lock:${key}`;
    const lockId = randomUUID();

    const acquireLock = async (): Promise<boolean> => {
      const now = Date.now();
      try {
        await this.pool.query(
          `INSERT INTO ${this.locksTableName} (key, locked_at, lock_id) VALUES ($1, $2, $3)`,
          [lockKey, now, lockId],
        );
        return true;
      } catch (e: any) {
        // 23505 = unique_violation in PostgreSQL
        if (e.code === "23505") {
          // Lock exists — check if it has expired and can be stolen
          const result = await this.pool.query(
            `SELECT locked_at FROM ${this.locksTableName} WHERE key = $1`,
            [lockKey],
          );
          if (result.rows.length > 0) {
            const lockedAt = Number(result.rows[0].locked_at);
            if (now - lockedAt > this.lockTtlMs) {
              // Atomically steal the expired lock by matching the exact old timestamp
              const updated = await this.pool.query(
                `UPDATE ${this.locksTableName}
                 SET locked_at = $1, lock_id = $2
                 WHERE key = $3 AND locked_at = $4`,
                [now, lockId, lockKey, lockedAt],
              );
              return (updated.rowCount ?? 0) > 0;
            }
          }
          return false;
        }
        throw e;
      }
    };

    let attempt = 0;
    while (!(await acquireLock())) {
      const backoff = Math.min(10 * Math.pow(2, attempt), 500);
      const jitter = Math.random() * 50;
      await new Promise((resolve) => setTimeout(resolve, backoff + jitter));
      attempt++;
      if (attempt > 60) {
        throw new Error(`[PostgresStorage] Lock timeout on key: ${key}`);
      }
    }

    try {
      return await fn();
    } finally {
      try {
        // Only delete if our lock_id still owns the lock (safe release)
        await this.pool.query(
          `DELETE FROM ${this.locksTableName} WHERE key = $1 AND lock_id = $2`,
          [lockKey, lockId],
        );
      } catch (e) {
        console.error(
          `[PostgresStorage] Failed to release lock on key ${key}:`,
          e,
        );
      }
    }
  }
}
