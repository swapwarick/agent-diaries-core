import { Worker } from 'worker_threads';
import path from 'path';
import { describe, it, expect } from 'vitest';

describe('Multi-process Concurrency', () => {
  it('holds lock across worker threads preventing race conditions', async () => {
    // The worker executes a simple claimTask and returns a boolean
    // We run 10 workers simultaneously
    const results: boolean[] = await Promise.all(
      Array.from({ length: 10 }, () =>
        new Promise<boolean>(resolve => {
          // Pointing to a worker script that tries to acquire a lock
          const w = new Worker(path.join(__dirname, 'fixtures', 'claim-worker.js'));
          w.on('message', resolve);
          w.on('error', () => resolve(false));
          w.on('exit', () => resolve(false));
        })
      )
    );
    
    // Exactly 1 worker should have acquired the lock successfully
    const successCount = results.filter(r => r === true).length;
    expect(successCount).toBe(1);
  }, 15000); // Allow 15 seconds for worker spins
});
