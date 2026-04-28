import { StorageAdapter } from '../src/storage';
import { createStore, VectorStore } from 'mempalace-node';

export interface MemPalaceStorageOptions {
  palacePath: string;
  wing?: string;
  room?: string;
}

export class MemPalaceStorage<T> implements StorageAdapter<T> {
  private store: VectorStore;
  private wing: string;
  private room: string;

  constructor(options: MemPalaceStorageOptions) {
    this.store = createStore(options.palacePath);
    this.wing = options.wing || 'agent-diaries';
    this.room = options.room || 'state';
  }

  async get(key: string): Promise<T | null> {
    const result = this.store.get({
      where: { wing: this.wing, room: this.room }
    });
    
    const index = result.ids.indexOf(key);
    if (index === -1) {
      return null;
    }
    
    try {
      return JSON.parse(result.documents[index]) as T;
    } catch (e) {
      console.error(`[MemPalaceStorage] Failed to parse state for ${key}`, e);
      return null;
    }
  }

  async set(key: string, value: T): Promise<void> {
    const document = JSON.stringify(value);
    await this.store.upsert(key, document, {
      wing: this.wing,
      room: this.room,
      filed_at: new Date().toISOString()
    });
  }
}
