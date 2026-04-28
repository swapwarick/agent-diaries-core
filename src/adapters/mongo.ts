import { StorageAdapter } from '../storage';
import { Collection } from 'mongodb';
import crypto from 'crypto';

export class MongoStorage<T> implements StorageAdapter<T> {
  private collection: Collection;

  constructor(config: { collection: Collection }) {
    this.collection = config.collection;
  }

  private hashString(str: string): string {
    return crypto.createHash('sha256').update(str).digest('hex');
  }

  async read(key: string): Promise<T | null> {
    const hash = this.hashString(key);
    const doc = await this.collection.findOne({ _id: hash as any });
    if (!doc || !doc.data) return null;
    return JSON.parse(doc.data) as T;
  }

  async write(key: string, data: T): Promise<void> {
    const hash = this.hashString(key);
    await this.collection.updateOne(
      { _id: hash as any },
      { $set: { data: JSON.stringify(data) } },
      { upsert: true }
    );
  }

  async withLock<R>(key: string, fn: () => Promise<R>): Promise<R | null> {
    const hash = this.hashString(key);
    const lockId = `lock:${hash}`;

    try {
      // Atomic lock acquisition via Unique _id insertion.
      // If two edge functions hit this concurrently, MongoDB guarantees
      // exactly one will succeed and the other will throw a Duplicate Key (11000) error.
      await this.collection.insertOne({ _id: lockId as any, lockedAt: new Date() });
      
      try {
        return await fn();
      } finally {
        await this.collection.deleteOne({ _id: lockId as any });
      }
    } catch (error: any) {
      if (error.code === 11000) {
        // Lock already held by another concurrent agent
        return null;
      }
      throw error;
    }
  }
}
