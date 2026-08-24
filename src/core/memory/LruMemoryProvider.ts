// src/core/memory/LruMemoryProvider.ts
import { LRUCache } from 'lru-cache';
import { CacheProvider } from '../storage/contracts';

/**
 * LRU cache wrapper that decorates any underlying CacheProvider.
 * Uses the popular `lru-cache` package for eviction policy.
 */
export class LruMemoryProvider implements CacheProvider {
  private underlying: CacheProvider;
  private cache: LRUCache<string, any>;

  /**
   * @param underlying The cache provider to store actual values (e.g., MemoryCacheProvider).
   * @param maxSize Maximum number of items to keep in the LRU cache (default 500).
   */
  constructor(underlying: CacheProvider, maxSize: number = Number(process.env.AG_DIARIES_CACHE_SIZE) || 500) {
    this.underlying = underlying;
    this.cache = new LRUCache<string, any>({ max: maxSize });
  }

  async get<T>(key: string): Promise<T | null> {
    if (this.cache.has(key)) {
      return this.cache.get(key) as T;
    }
    const value = await this.underlying.get<T>(key);
    if (value !== null) this.cache.set(key, value);
    return value;
  }

  async set<T>(key: string, value: T, ttlMs?: number): Promise<void> {
    await this.underlying.set<T>(key, value, ttlMs);
    if (ttlMs) {
      this.cache.set(key, value, { ttl: ttlMs });
    } else {
      this.cache.set(key, value);
    }
  }

  async delete(key: string): Promise<boolean> {
    const deleted = await this.underlying.delete(key);
    this.cache.delete(key);
    return deleted;
  }

  async searchKeys(pattern: string): Promise<string[]> {
    return this.underlying.searchKeys(pattern);
  }

  async clear(): Promise<void> {
    if ((this.underlying as any).clear) {
      await (this.underlying as any).clear();
    }
    this.cache.clear();
  }
}
