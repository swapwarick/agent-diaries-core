import { Worker } from "worker_threads";
import path from "path";
import fs from "fs";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

describe("Multi-process Concurrency", () => {
  const TEST_DIR = path.join(__dirname, ".worker-test-data");

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  afterEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  it("holds lock across worker threads preventing race conditions", async () => {
    // The worker executes a simple claimTask and returns a boolean
    // We run 10 workers simultaneously
    const results: boolean[] = await Promise.all(
      Array.from(
        { length: 10 },
        () =>
          new Promise<boolean>((resolve) => {
            // Pointing to a worker script that tries to acquire a lock
            const w = new Worker(
              path.join(__dirname, "fixtures", "claim-worker.cjs"),
            );
            w.on("message", resolve);
            w.on("error", (err) => {
              console.error("Worker process error event:", err);
              resolve(false);
            });
            w.on("exit", (code) => {
              if (code !== 0) {
                console.error(`Worker process exited with code ${code}`);
              }
              resolve(false);
            });
          }),
      ),
    );

    // Exactly 1 worker should have acquired the lock successfully
    const successCount = results.filter((r) => r === true).length;
    expect(successCount).toBe(1);
  }, 15000); // Allow 15 seconds for worker spins
});
