import { StorageAdapter } from '../storage';
import { Pool } from 'pg';
import * as crypto from 'crypto';

export class PostgresStorage<T> implements StorageAdapter<T> {
  private pool: Pool;
  private tableName: string;

  constructor(options: { pool: Pool; tableName?: string }) {
    this.pool = options.pool;
    this.tableName = options.tableName || 'agent_diaries';
  }

  /**
   * Initializes the database table. Must be called before first use.
   */
  public async initialize(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.tableName} (
        id VARCHAR(255) PRIMARY KEY,
        data JSONB NOT NULL
      );
    `);
  }

  async get(key: string): Promise<T | null> {
    const res = await this.pool.query(`SELECT data FROM ${this.tableName} WHERE id = $1`, [key]);
    if (res.rows.length === 0) return null;
    return res.rows[0].data as T;
  }

  async set(key: string, value: T): Promise<void> {
    await this.pool.query(`
      INSERT INTO ${this.tableName} (id, data)
      VALUES ($1, $2)
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data;
    `, [key, JSON.stringify(value)]);
  }

  async withLock<R>(key: string, fn: () => Promise<R>): Promise<R> {
    const client = await this.pool.connect();
    // Convert string key to a 32-bit integer for Postgres advisory locks
    const lockId = crypto.createHash('sha256').update(key).digest().readInt32BE(0);
    
    try {
      await client.query('SELECT pg_advisory_lock($1)', [lockId]);
      return await fn();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [lockId]);
      client.release();
    }
  }
}
