import { StorageAdapter } from '../storage';
import Redis from 'ioredis';
import { randomUUID } from 'crypto';

export class RedisStorage<T> implements StorageAdapter<T> {
  private redis: Redis;
  private prefix: string;

  constructor(options: { redis: Redis; prefix?: string }) {
    this.redis = options.redis;
    this.prefix = options.prefix || 'agent-diaries:';
  }

  private getKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  async get(key: string): Promise<T | null> {
    const data = await this.redis.get(this.getKey(key));
    if (!data) return null;
    try {
      return JSON.parse(data) as T;
    } catch (e) {
      console.error(`[RedisStorage] Failed to parse JSON for key ${key}`);
      return null;
    }
  }

  async set(key: string, value: T): Promise<void> {
    const data = JSON.stringify(value);
    await this.redis.set(this.getKey(key), data);
  }

  async withLock<R>(key: string, fn: () => Promise<R>): Promise<R> {
    const lockKey = `${this.getKey(key)}:lock`;
    const lockValue = randomUUID();
    const lockTtlMs = 10000; // 10 seconds max lock

    const acquireLock = async (): Promise<boolean> => {
      const result = await this.redis.set(lockKey, lockValue, 'PX', lockTtlMs, 'NX');
      return result === 'OK';
    };

    let attempt = 0;
    while (!(await acquireLock())) {
      const backoff = Math.min(10 * Math.pow(2, attempt), 500);
      const jitter = Math.random() * 50;
      await new Promise(resolve => setTimeout(resolve, backoff + jitter));
      attempt++;
      if (attempt > 60) throw new Error(`[RedisStorage] Lock timeout on key: ${key}`);
    }

    try {
      return await fn();
    } finally {
      // Safe release: ensure we only delete the lock if we still own it
      const luaScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      await this.redis.eval(luaScript, 1, lockKey, lockValue);
    }
  }
}
