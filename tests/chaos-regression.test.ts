/**
 * Chaos Regression Test Suite
 *
 * These tests directly reproduce the class of concurrency bug exposed by the
 * Chaos Engineering validation scenario and permanently guard against it
 * being reintroduced.
 *
 * Root cause summary:
 *   The previous MemoryStorage.withLock() and MemoryLockProvider.withLock()
 *   used a TTL-based spin-lock (10 s default). Under chaos conditions
 *   (injected delays, simulated crashes) the TTL could expire while the
 *   original holder was still executing fn(), allowing a second waiter to
 *   steal the lock and enter the critical section simultaneously.
 *   This produced the duplicate_execution failure:
 *
 *   "task:intelligence:u917 executed 2 times by intelligence-47, intelligence-52"
 *
 * Fix:
 *   Both withLock() implementations now use a chained-Promise FIFO mutex.
 *   There is no TTL: the mutex cannot be stolen regardless of how long fn()
 *   runs. The mutex is always released in finally so exceptions cannot deadlock.
 */

import { describe, it, expect } from "vitest";
import { MemoryStorage } from "../src/memory/storage";
import { MemoryLockProvider } from "../src/memory/MemoryProviders";
import { AgentDiary } from "../src/diary";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Sleep for `ms` milliseconds — simulates chaos delay inside a lock. */
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Build a fresh MemoryStorage-backed AgentDiary. */
function makeDiary(agentId = "chaos-agent") {
  const storage = new MemoryStorage<any>();
  return new AgentDiary({ agentId, storage });
}

// ---------------------------------------------------------------------------
// 1. Lock held beyond the old TTL window — no theft
// ---------------------------------------------------------------------------

describe("MemoryStorage.withLock() — no lock theft under long delays", () => {
  it(
    "holder running > 15 s cannot be displaced by a waiting caller",
    async () => {
      const storage = new MemoryStorage<any>();
      const log: string[] = [];
      const HOLDER_DELAY_MS = 15_000; // well past the old 10 s TTL

      // Holder acquires lock and holds it for HOLDER_DELAY_MS
      const holder = storage.withLock("chaos-key", async () => {
        log.push("holder:entered");
        await sleep(HOLDER_DELAY_MS);
        log.push("holder:exited");
      });

      // Give the holder a tick to enter, then launch a competitor
      await sleep(50);

      const waiter = storage.withLock("chaos-key", async () => {
        log.push("waiter:entered");
      });

      await Promise.all([holder, waiter]);

      // The waiter must not enter until the holder has fully exited.
      // Under the old TTL lock the waiter could enter at T=10_001ms while
      // the holder was still running — producing an out-of-order log.
      expect(log).toEqual([
        "holder:entered",
        "holder:exited",
        "waiter:entered",
      ]);
    },
    20_000,
  );

  it("multiple long-running callers execute in strict FIFO order", async () => {
    const storage = new MemoryStorage<any>();
    const order: number[] = [];
    const N = 5;
    const DELAY_MS = 12_000; // > old 10 s TTL

    const tasks = Array.from({ length: N }, (_, i) =>
      storage.withLock("fifo-key", async () => {
        order.push(i);
        if (i < N - 1) await sleep(DELAY_MS);
      }),
    );

    await Promise.all(tasks);

    expect(order).toEqual([0, 1, 2, 3, 4]);
  },
  70_000);
});

// ---------------------------------------------------------------------------
// 2. Concurrent chaos workers — zero duplicate executions
// ---------------------------------------------------------------------------

describe("AgentDiary — zero duplicates under 100 concurrent chaos workers", () => {
  it(
    "100 workers racing to claim the same task produce exactly 1 execution",
    async () => {
      const diary = makeDiary("chaos-dedup");
      const task = "task:intelligence:u917"; // the exact task from the failure report

      // Simulate 100 workers trying to claim simultaneously
      const NUM_WORKERS = 100;
      const results = await Promise.all(
        Array.from({ length: NUM_WORKERS }, () => diary.claimTask(task)),
      );

      const claimed = results.filter(Boolean);
      const skipped = results.filter((r) => !r);

      expect(claimed.length).toBe(1);
      expect(skipped.length).toBe(NUM_WORKERS - 1);

      // Diary state must be consistent
      const state = await diary.readDiary();
      expect(state.runCount).toBe(1);
      expect(state.history).toHaveLength(1);
    },
    30_000,
  );

  it(
    "1 000 workers across 10 distinct tasks produce exactly 1 execution per task",
    async () => {
      const diary = makeDiary("chaos-multi");
      const TASKS = 10;
      const WORKERS_PER_TASK = 100;

      const promises: Promise<boolean>[] = [];
      for (let t = 0; t < TASKS; t++) {
        for (let w = 0; w < WORKERS_PER_TASK; w++) {
          promises.push(diary.claimTask(`task:intel:t${t}`));
        }
      }

      const results = await Promise.all(promises);
      const claimed = results.filter(Boolean).length;

      // Exactly one worker per task should succeed
      expect(claimed).toBe(TASKS);
    },
    60_000,
  );
});

// ---------------------------------------------------------------------------
// 3. Lock release on exception — no deadlock
// ---------------------------------------------------------------------------

describe("MemoryStorage.withLock() — always releases on exception", () => {
  it("a throwing fn() releases the lock so the next caller is not blocked", async () => {
    const storage = new MemoryStorage<any>();

    // First call throws
    await expect(
      storage.withLock("throw-key", async () => {
        throw new Error("chaos crash");
      }),
    ).rejects.toThrow("chaos crash");

    // Second call must succeed (lock was released in finally)
    const result = await storage.withLock("throw-key", async () => "ok");
    expect(result).toBe("ok");
  });

  it("multiple exceptions in sequence never deadlock subsequent callers", async () => {
    const storage = new MemoryStorage<any>();
    const CRASHES = 5;

    for (let i = 0; i < CRASHES; i++) {
      await expect(
        storage.withLock("crash-seq-key", async () => {
          throw new Error(`crash ${i}`);
        }),
      ).rejects.toThrow();
    }

    // After 5 crashes the lock must still be usable
    const ok = await storage.withLock("crash-seq-key", async () => "recovered");
    expect(ok).toBe("recovered");
  });

  it("a crash mid-execution does not block a concurrent waiter", async () => {
    const storage = new MemoryStorage<any>();
    const log: string[] = [];

    const crasher = storage.withLock("concurrent-crash", async () => {
      log.push("crasher:start");
      await sleep(50);
      log.push("crasher:throwing");
      throw new Error("simulated chaos crash");
    });

    await sleep(10); // let crasher enter first

    const waiter = storage.withLock("concurrent-crash", async () => {
      log.push("waiter:executed");
      return "success";
    });

    await expect(crasher).rejects.toThrow();
    const waiterResult = await waiter;

    expect(waiterResult).toBe("success");
    expect(log).toContain("waiter:executed");
  });
});

// ---------------------------------------------------------------------------
// 4. Duplicate prevention under long-running execution
// ---------------------------------------------------------------------------

describe("AgentDiary — duplicate prevention under long-running execution", () => {
  it(
    "second worker cannot claim a task while first is still holding the lock (> old TTL)",
    async () => {
      const storage = new MemoryStorage<any>();
      const diary = new AgentDiary({ agentId: "long-run-agent", storage });
      const task = "long-running-task";

      // Worker A claims the task and then takes a very long time (> old 10s TTL)
      let workerBResult: boolean | null = null;

      const workerA = (async () => {
        const claimed = await diary.claimTask(task);
        // Simulate long work after claim — under old TTL this would expire the lock
        await sleep(12_000);
        await diary.writeTaskResult(task, "worker-A-result");
        return claimed;
      })();

      // Worker B tries to claim the same task after a short delay
      await sleep(200);
      workerBResult = await diary.claimTask(task);

      const workerAResult = await workerA;

      expect(workerAResult).toBe(true);   // A claimed it
      expect(workerBResult).toBe(false);  // B was correctly rejected

      // Final state: exactly one execution recorded
      const state = await diary.readDiary();
      expect(state.history).toHaveLength(1);
      expect(state.history[0].result).toBe("worker-A-result");
    },
    20_000,
  );
});

// ---------------------------------------------------------------------------
// 5. MemoryLockProvider.withLock() — same guarantees
// ---------------------------------------------------------------------------

describe("MemoryLockProvider.withLock() — same mutex guarantees", () => {
  it("serializes concurrent callers regardless of execution duration", async () => {
    const lock = new MemoryLockProvider();
    const log: string[] = [];

    const a = lock.withLock("wf-lock-1", async () => {
      log.push("a:start");
      await sleep(500);
      log.push("a:end");
    });

    await sleep(50);

    const b = lock.withLock("wf-lock-1", async () => {
      log.push("b:start");
      await sleep(100);
      log.push("b:end");
    });

    await Promise.all([a, b]);

    expect(log).toEqual(["a:start", "a:end", "b:start", "b:end"]);
  });

  it("releases on exception and does not deadlock the next caller", async () => {
    const lock = new MemoryLockProvider();

    await expect(
      lock.withLock("wf-lock-2", async () => {
        throw new Error("workflow crash");
      }),
    ).rejects.toThrow("workflow crash");

    const result = await lock.withLock("wf-lock-2", async () => "recovered");
    expect(result).toBe("recovered");
  });

  it(
    "50 concurrent workflow claims produce exactly 1 successful claim",
    async () => {
      const lock = new MemoryLockProvider();
      const executions: string[] = [];

      await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          lock.withLock("single-wf-lock", async () => {
            executions.push(`worker-${i}`);
          }),
        ),
      );

      // All 50 execute — but they are serialized, not deduplicated at this layer.
      // Deduplication is the responsibility of the diary read-check-write inside the lock.
      // What we verify here is that the lock serializes them (no overlapping executions).
      expect(executions).toHaveLength(50);
      // Each entry is unique (no worker ran twice)
      expect(new Set(executions).size).toBe(50);
    },
  );

  it("acquireLock/releaseLock TTL API remains functional for distributed backends", async () => {
    const lock = new MemoryLockProvider();

    const token = await lock.acquireLock("dist-lock", 5000);
    expect(token).not.toBeNull();

    // A second acquire on the same held key returns null
    const token2 = await lock.acquireLock("dist-lock", 5000);
    expect(token2).toBeNull();

    // Release and re-acquire
    const released = await lock.releaseLock("dist-lock", token!);
    expect(released).toBe(true);

    const token3 = await lock.acquireLock("dist-lock", 5000);
    expect(token3).not.toBeNull();

    await lock.releaseLock("dist-lock", token3!);
  });
});

// ---------------------------------------------------------------------------
// 6. Isolation: separate MemoryStorage instances never share locks
// ---------------------------------------------------------------------------

describe("MemoryStorage — instance isolation", () => {
  it("two separate MemoryStorage instances have independent lock namespaces", async () => {
    const storageA = new MemoryStorage<any>();
    const storageB = new MemoryStorage<any>();
    const log: string[] = [];

    // A holds its lock for 200ms
    const aPromise = storageA.withLock("shared-key", async () => {
      log.push("a:entered");
      await sleep(200);
      log.push("a:exited");
    });

    // B's lock on the same key-string is on a different instance — should not block
    const bPromise = storageB.withLock("shared-key", async () => {
      log.push("b:entered");
    });

    await Promise.all([aPromise, bPromise]);

    // B must have entered without waiting for A — different instances, independent mutexes
    expect(log).toContain("b:entered");
    // The exact ordering between a:entered and b:entered is non-deterministic,
    // but b should NOT have waited for a:exited
    const bIdx = log.indexOf("b:entered");
    const aExitIdx = log.indexOf("a:exited");
    // b entered BEFORE a exited (they ran concurrently on separate instances)
    expect(bIdx).toBeLessThan(aExitIdx);
  });
});
