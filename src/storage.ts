import * as fs from 'fs';
import * as path from 'path';
import * as lockfile from 'proper-lockfile';

export interface StorageAdapter<T> {
  get(key: string): Promise<T | null>;
  set(key: string, value: T): Promise<void>;
  /**
   * Acquires a lock on the key, executes the critical section, and releases the lock.
   */
  withLock<R>(key: string, fn: () => Promise<R>): Promise<R>;
}

export class LocalFileStorage<T> implements StorageAdapter<T> {
  private baseDir: string;

  constructor(options: { baseDir?: string } = {}) {
    this.baseDir = options.baseDir || path.join(process.cwd(), '.agent-diaries');
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
    }
  }

  private getFilePath(key: string): string {
    const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.baseDir, `${safeKey}.json`);
  }

  async get(key: string): Promise<T | null> {
    const filePath = this.getFilePath(key);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    try {
      const data = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(data) as T;
    } catch (e) {
      console.error(`[LocalFileStorage] Error reading key ${key}:`, e);
      return null;
    }
  }

  async set(key: string, value: T): Promise<void> {
    const filePath = this.getFilePath(key);
    try {
      const data = JSON.stringify(value, null, 2);
      await fs.promises.writeFile(filePath, data, 'utf-8');
    } catch (e) {
      console.error(`[LocalFileStorage] Error writing key ${key}:`, e);
      throw e;
    }
  }

  async withLock<R>(key: string, fn: () => Promise<R>): Promise<R> {
    const filePath = this.getFilePath(key);
    
    // Ensure the file exists so we can lock it (proper-lockfile requires the file/dir to exist)
    if (!fs.existsSync(filePath)) {
      await fs.promises.writeFile(filePath, "null", 'utf-8');
    }

    const release = await lockfile.lock(filePath, { 
      retries: { retries: 100, minTimeout: 10, maxTimeout: 100 }, 
      realpath: false 
    });
    try {
      return await fn();
    } finally {
      await release();
    }
  }
}
