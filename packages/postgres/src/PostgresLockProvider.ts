import { LockProvider } from "@agent-diaries/core";

export interface PostgresLockProviderOptions {
  connectionString?: string;
  locksTableName?: string;
}

export class PostgresLockProvider implements LockProvider {
  constructor(private options: PostgresLockProviderOptions = {}) {}

  async acquireLock(_key: string, _ttlMs?: number): Promise<string | null> {
    throw new Error("[PostgresLockProvider] PostgreSQL implementation placeholder. Implement in future phase.");
  }

  async releaseLock(_key: string, _lockToken: string): Promise<boolean> {
    throw new Error("[PostgresLockProvider] PostgreSQL implementation placeholder. Implement in future phase.");
  }

  async withLock<R>(_key: string, _fn: () => Promise<R>): Promise<R> {
    throw new Error("[PostgresLockProvider] PostgreSQL implementation placeholder. Implement in future phase.");
  }
}
