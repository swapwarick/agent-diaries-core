import { StorageAdapter } from '../storage';
import { Collection } from 'mongodb';
import crypto from 'crypto';

interface MongoStorageOptions {
  collection: Collection;
}

export class MongoStorage<T> implements StorageAdapter<T> {
  private collection: Collection;
  private static indexedCollections = new Set<string>();

  constructor(options: MongoStorageOptions) {
    this.collection = options.collection;
  }

  private async ensureIndex() {
    const ns = this.collection.namespace;
    if (MongoStorage.indexedCollections.has(ns)) return;

    try {
      await this.collection.createIndex(
        { lockedAt: 1 },
        { expireAfterSeconds: 10, partialFilterExpression: { lockedAt: { $exists: true } } }
      );
    } catch (e) {
      console.warn('[MongoStorage] Failed to create TTL index:', e);
    }

    MongoStorage.indexedCollections.add(ns);
  }

  private hashString(str: string): string {
    return crypto.createHash('sha256').update(str).digest('hex');
  }

  async get(key: string): Promise<T | null> {
    const hash = this.hashString(key);
    const doc = await this.collection.findOne({ _id: hash as any });
    if (!doc || !doc.data) return null;
    return JSON.parse(doc.data) as T;
  }

  async set(key: string, data: T): Promise<void> {
    const hash = this.hashString(key);
    await this.collection.updateOne(
      { _id: hash as any },
      { $set: { data: JSON.stringify(data) } },
      { upsert: true }
    );
  }

  async withLock<R>(key: string, fn: () => Promise<R>): Promise<R> {
    await this.ensureIndex();
    const hash = this.hashString(key);
    const lockId = `lock:${hash}`;

    const acquireLock = async () => {
      try {
        await this.collection.insertOne({ _id: lockId as any, lockedAt: new Date() });
        return true;
      } catch (error: any) {
        if (error.code === 11000) return false;
        throw error;
      }
    };

    let attempt = 0;
    while (!(await acquireLock())) {
      const backoff = Math.min(10 * Math.pow(2, attempt), 500);
      const jitter = Math.random() * 50;
      await new Promise(resolve => setTimeout(resolve, backoff + jitter));
      attempt++;
      if (attempt > 150) {
        throw new Error(`[MongoStorage] Lock timeout on key: ${key}`);
      }
    }

    try {
      return await fn();
    } finally {
      await this.collection.deleteOne({ _id: lockId as any });
    }
  }
}
