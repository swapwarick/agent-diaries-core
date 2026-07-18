import { CacheProvider } from "@agent-diaries/core";

export interface RedisCacheProviderOptions {
  client?: any;
  prefix?: string;
  globalTtlMs?: number;
}

export class RedisCacheProvider implements CacheProvider {
  constructor(private options: RedisCacheProviderOptions = {}) {}

  async get<T>(_key: string): Promise<T | null> {
    throw new Error("[RedisCacheProvider] Redis implementation placeholder. Implement in future phase.");
  }

  async set<T>(_key: string, _value: T, _ttlMs?: number): Promise<void> {
    throw new Error("[RedisCacheProvider] Redis implementation placeholder. Implement in future phase.");
  }

  async delete(_key: string): Promise<boolean> {
    throw new Error("[RedisCacheProvider] Redis implementation placeholder. Implement in future phase.");
  }

  async searchKeys(_pattern: string): Promise<string[]> {
    throw new Error("[RedisCacheProvider] Redis implementation placeholder. Implement in future phase.");
  }
}
