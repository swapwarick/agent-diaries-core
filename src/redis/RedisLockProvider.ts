import { LockProvider } from "../core/storage/contracts";

export interface RedisLockProviderOptions {
  client?: any;
  prefix?: string;
}

export class RedisLockProvider implements LockProvider {
  constructor(private options: RedisLockProviderOptions = {}) {}

  async acquireLock(_key: string, _ttlMs?: number): Promise<string | null> {
    throw new Error("[RedisLockProvider] Redis implementation placeholder. Implement in future phase.");
  }

  async releaseLock(_key: string, _lockToken: string): Promise<boolean> {
    throw new Error("[RedisLockProvider] Redis implementation placeholder. Implement in future phase.");
  }

  async withLock<R>(_key: string, _fn: () => Promise<R>): Promise<R> {
    throw new Error("[RedisLockProvider] Redis implementation placeholder. Implement in future phase.");
  }
}
