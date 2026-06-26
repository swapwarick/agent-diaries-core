/**
 * Test suite covering all new features and bug fixes introduced in v1.2.0:
 *  - status field ("pending" | "done" | "failed")
 *  - failTask()
 *  - batchClaimTasks()
 *  - getStats()
 *  - exportHistory() / importHistory()
 *  - pruneExpiredTasks() + onTaskExpired hook
 *  - Custom hashFn
 *  - MemoryStorage isolation fix (no more static shared state)
 */

import { describe, it, expect, vi } from "vitest";
import { AgentDiary } from "../src/diary";
import { MemoryStorage } from "../src/storage";

// Helper: create a fresh isolated AgentDiary + MemoryStorage per test
function makeDiary(
  agentId = "test-agent",
  opts: Partial<ConstructorParameters<typeof AgentDiary>[0]> = {},
) {
  const storage = new MemoryStorage<any>();
  return new AgentDiary({ agentId, storage, ...opts });
}

// ─────────────────────────────────────────────────────────
// Bug Fix: MemoryStorage isolation
// ─────────────────────────────────────────────────────────
describe("Bug Fix: MemoryStorage instance isolation", () => {
  it("two MemoryStorage instances should NOT share state", async () => {
    const storageA = new MemoryStorage<any>();
    const storageB = new MemoryStorage<any>();

    await storageA.set("key", { from: "A" });
    const fromB = await storageB.get("key");

    expect(fromB).toBeNull(); // B must not see A's data
  });

  it("two AgentDiary instances with separate MemoryStorage should be fully isolated", async () => {
    const agentA = new AgentDiary({
      agentId: "agent-A",
      storage: new MemoryStorage<any>(),
    });
    const agentB = new AgentDiary({
      agentId: "agent-A", // same agentId, but different storage instance
      storage: new MemoryStorage<any>(),
    });

    await agentA.claimTask("Shared Task");
    await agentA.writeTaskResult("Shared Task", "A's result");

    // B has no knowledge of A's task
    expect(await agentB.hasProcessedTask("Shared Task")).toBe(false);
    expect(await agentB.getTaskResult("Shared Task")).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────
// Feature: status field on TaskRecord
// ─────────────────────────────────────────────────────────
describe("Feature: TaskRecord status field", () => {
  it("status should be 'pending' after claimTask", async () => {
    const diary = makeDiary();
    await diary.claimTask("My Task");
    const state = await diary.readDiary();
    expect(state.history[0].status).toBe("pending");
  });

  it("status should be 'done' after writeTaskResult", async () => {
    const diary = makeDiary();
    await diary.claimTask("My Task");
    await diary.writeTaskResult("My Task", "ok");
    const state = await diary.readDiary();
    expect(state.history[0].status).toBe("done");
    expect(state.history[0].result).toBe("ok");
  });

  it("status should be 'failed' after failTask", async () => {
    const diary = makeDiary();
    await diary.claimTask("Bad Task");
    await diary.failTask("Bad Task", "timeout exceeded");
    const state = await diary.readDiary();
    expect(state.history[0].status).toBe("failed");
    expect(state.history[0].failReason).toBe("timeout exceeded");
  });
});

// ─────────────────────────────────────────────────────────
// Feature: failTask()
// ─────────────────────────────────────────────────────────
describe("Feature: failTask()", () => {
  it("should mark task as failed with reason", async () => {
    const diary = makeDiary();
    await diary.claimTask("Task A");
    await diary.failTask("Task A", "network error");

    const state = await diary.readDiary();
    expect(state.history[0].status).toBe("failed");
    expect(state.history[0].failReason).toBe("network error");
  });

  it("should mark task as failed without a reason", async () => {
    const diary = makeDiary();
    await diary.claimTask("Task B");
    await diary.failTask("Task B");

    const state = await diary.readDiary();
    expect(state.history[0].status).toBe("failed");
    expect(state.history[0].failReason).toBeUndefined();
  });

  it("should throw if task was never claimed", async () => {
    const diary = makeDiary();
    await expect(diary.failTask("Not Claimed")).rejects.toThrow(/was not claimed/);
  });

  it("failed task should still be visible in hasProcessedTask", async () => {
    const diary = makeDiary();
    await diary.claimTask("Failed One");
    await diary.failTask("Failed One", "oops");

    // A failed task is still a processed task (was claimed)
    expect(await diary.hasProcessedTask("Failed One")).toBe(true);
  });

  it("getTasksCompletedSince should NOT include failed tasks (no result)", async () => {
    const diary = makeDiary();
    const since = Date.now() - 100;
    await diary.claimTask("Failed Task");
    await diary.failTask("Failed Task", "error");

    const completed = await diary.getTasksCompletedSince(since);
    expect(completed).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────
// Feature: batchClaimTasks()
// ─────────────────────────────────────────────────────────
describe("Feature: batchClaimTasks()", () => {
  it("should claim all new tasks in a single lock acquisition", async () => {
    const diary = makeDiary();
    const claimed = await diary.batchClaimTasks(["Task 1", "Task 2", "Task 3"]);
    expect(claimed).toEqual(["Task 1", "Task 2", "Task 3"]);

    const state = await diary.readDiary();
    expect(state.runCount).toBe(3);
    expect(state.history).toHaveLength(3);
  });

  it("should skip already-processed tasks and only claim new ones", async () => {
    const diary = makeDiary();
    await diary.claimTask("Existing Task");
    await diary.writeTaskResult("Existing Task", "done");

    const claimed = await diary.batchClaimTasks([
      "Existing Task",
      "Brand New Task",
    ]);
    expect(claimed).toEqual(["Brand New Task"]);
  });

  it("should re-claim expired tasks in a batch", async () => {
    const diary = makeDiary();
    await diary.claimTask("Expiring Task", { ttlMs: 50 });
    await diary.writeTaskResult("Expiring Task", "old result");

    await new Promise((r) => setTimeout(r, 100)); // wait for expiry

    const claimed = await diary.batchClaimTasks(["Expiring Task"]);
    expect(claimed).toEqual(["Expiring Task"]);
  });

  it("should mark each batch-claimed task as pending", async () => {
    const diary = makeDiary();
    await diary.batchClaimTasks(["A", "B"]);
    const state = await diary.readDiary();
    expect(state.history.every((r) => r.status === "pending")).toBe(true);
  });

  it("should return an empty array when all tasks already exist", async () => {
    const diary = makeDiary();
    await diary.batchClaimTasks(["X", "Y"]);
    const claimed = await diary.batchClaimTasks(["X", "Y"]);
    expect(claimed).toEqual([]);
  });

  it("should respect maxHistory when claiming a batch", async () => {
    const diary = makeDiary("batch-max", { maxHistory: 3 });
    await diary.batchClaimTasks(["A", "B", "C", "D", "E"]);
    const state = await diary.readDiary();
    expect(state.history).toHaveLength(3);
  });
});

// ─────────────────────────────────────────────────────────
// Feature: getStats()
// ─────────────────────────────────────────────────────────
describe("Feature: getStats()", () => {
  it("should return correct counts for a fresh diary", async () => {
    const diary = makeDiary("stats-agent");
    const stats = await diary.getStats();
    expect(stats.agentId).toBe("stats-agent");
    expect(stats.runCount).toBe(0);
    expect(stats.historyCount).toBe(0);
    expect(stats.pendingCount).toBe(0);
    expect(stats.doneCount).toBe(0);
    expect(stats.failedCount).toBe(0);
    expect(stats.oldestTaskAt).toBeUndefined();
  });

  it("should count pending, done, and failed tasks correctly", async () => {
    const diary = makeDiary("stats-counts");
    await diary.claimTask("Pending Task");

    await diary.claimTask("Done Task");
    await diary.writeTaskResult("Done Task", "result");

    await diary.claimTask("Failed Task");
    await diary.failTask("Failed Task", "reason");

    const stats = await diary.getStats();
    expect(stats.pendingCount).toBe(1);
    expect(stats.doneCount).toBe(1);
    expect(stats.failedCount).toBe(1);
    expect(stats.historyCount).toBe(3);
    expect(stats.runCount).toBe(3);
  });

  it("should exclude expired tasks from active counts", async () => {
    const diary = makeDiary("stats-ttl");
    await diary.claimTask("Short Task", { ttlMs: 50 });
    await diary.writeTaskResult("Short Task", "done");

    await new Promise((r) => setTimeout(r, 100));

    const stats = await diary.getStats();
    expect(stats.historyCount).toBe(0); // expired task not counted
    expect(stats.doneCount).toBe(0);
  });

  it("should provide oldestTaskAt as a valid timestamp", async () => {
    const before = Date.now();
    const diary = makeDiary("stats-oldest");
    await diary.claimTask("Task A");
    const after = Date.now();

    const stats = await diary.getStats();
    expect(stats.oldestTaskAt).toBeGreaterThanOrEqual(before);
    expect(stats.oldestTaskAt).toBeLessThanOrEqual(after);
  });
});

// ─────────────────────────────────────────────────────────
// Feature: exportHistory() / importHistory()
// ─────────────────────────────────────────────────────────
describe("Feature: exportHistory() / importHistory()", () => {
  it("should export and re-import state into a fresh diary", async () => {
    const source = makeDiary("export-source");
    await source.claimTask("Task Alpha");
    await source.writeTaskResult("Task Alpha", "alpha result");

    const snapshot = await source.exportHistory();

    const target = makeDiary("export-target");
    await target.importHistory(snapshot);

    expect(await target.hasProcessedTask("Task Alpha")).toBe(true);
    expect(await target.getTaskResult("Task Alpha")).toBe("alpha result");
  });

  it("importHistory should replace existing state by default", async () => {
    const diary = makeDiary("import-replace");
    await diary.claimTask("Old Task");
    await diary.writeTaskResult("Old Task", "old result");

    const freshSnapshot = {
      lastRun: Date.now(),
      runCount: 1,
      seenSignatures: ["new task"],
      history: [
        {
          title: "New Task",
          signature: "new task",
          status: "done" as const,
          result: "new result",
          timestamp: Date.now(),
        },
      ],
    };

    await diary.importHistory(freshSnapshot);

    expect(await diary.hasProcessedTask("Old Task")).toBe(false);
    expect(await diary.getTaskResult("New Task")).toBe("new result");
  });

  it("importHistory with merge:true should combine states without duplicates", async () => {
    const diaryA = makeDiary("merge-A");
    await diaryA.claimTask("Task 1");
    await diaryA.writeTaskResult("Task 1", "r1");

    const diaryB = makeDiary("merge-B");
    await diaryB.claimTask("Task 2");
    await diaryB.writeTaskResult("Task 2", "r2");

    const snapshotB = await diaryB.exportHistory();
    await diaryA.importHistory(snapshotB, { merge: true });

    expect(await diaryA.hasProcessedTask("Task 1")).toBe(true);
    expect(await diaryA.hasProcessedTask("Task 2")).toBe(true);
  });

  it("merge should not create duplicates when importing overlapping tasks", async () => {
    const diary = makeDiary("merge-dedup");
    await diary.claimTask("Shared");
    await diary.writeTaskResult("Shared", "local");

    const snapshot = await diary.exportHistory();
    await diary.importHistory(snapshot, { merge: true });

    const state = await diary.readDiary();
    const sharedRecords = state.history.filter((r) => r.title === "Shared");
    expect(sharedRecords).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────
// Feature: pruneExpiredTasks() + onTaskExpired hook
// ─────────────────────────────────────────────────────────
describe("Feature: pruneExpiredTasks() + onTaskExpired hook", () => {
  it("should remove expired tasks and return them", async () => {
    const diary = makeDiary("prune-agent");
    await diary.claimTask("Ephemeral", { ttlMs: 50 });
    await diary.writeTaskResult("Ephemeral", "done");
    await diary.claimTask("Permanent"); // no TTL

    await new Promise((r) => setTimeout(r, 100));

    const pruned = await diary.pruneExpiredTasks();
    expect(pruned).toHaveLength(1);
    expect(pruned[0].title).toBe("Ephemeral");

    const state = await diary.readDiary();
    expect(state.history).toHaveLength(1);
    expect(state.history[0].title).toBe("Permanent");
  });

  it("should return empty array when no tasks are expired", async () => {
    const diary = makeDiary("prune-none");
    await diary.claimTask("Active");
    const pruned = await diary.pruneExpiredTasks();
    expect(pruned).toHaveLength(0);
  });

  it("onTaskExpired hook should fire when claimTask reclaims an expired task", async () => {
    const expired: string[] = [];
    const diary = makeDiary("hook-claim", {
      onTaskExpired: (record) => {
        expired.push(record.title);
      },
    });

    await diary.claimTask("Expiring Task", { ttlMs: 50 });
    await new Promise((r) => setTimeout(r, 100));

    await diary.claimTask("Expiring Task"); // re-claim after expiry
    expect(expired).toContain("Expiring Task");
  });

  it("onTaskExpired hook should fire for all pruned tasks in pruneExpiredTasks()", async () => {
    const expired: string[] = [];
    const diary = makeDiary("hook-prune", {
      onTaskExpired: async (record) => {
        expired.push(record.title);
      },
    });

    await diary.claimTask("A", { ttlMs: 50 });
    await diary.claimTask("B", { ttlMs: 50 });
    await diary.claimTask("C"); // no TTL — should not fire

    await new Promise((r) => setTimeout(r, 100));

    await diary.pruneExpiredTasks();
    expect(expired).toContain("A");
    expect(expired).toContain("B");
    expect(expired).not.toContain("C");
  });

  it("onTaskExpired hook should fire in batchClaimTasks when reclaiming expired tasks", async () => {
    const expired: string[] = [];
    const diary = makeDiary("hook-batch", {
      onTaskExpired: (record) => {
        expired.push(record.title);
      },
    });

    await diary.claimTask("X", { ttlMs: 50 });
    await new Promise((r) => setTimeout(r, 100));

    await diary.batchClaimTasks(["X", "Y"]);
    expect(expired).toContain("X");
    expect(expired).not.toContain("Y");
  });
});

// ─────────────────────────────────────────────────────────
// Feature: Custom hashFn
// ─────────────────────────────────────────────────────────
describe("Feature: Custom hashFn", () => {
  it("should use custom hashFn for signature computation", async () => {
    const diary = makeDiary("hash-agent", {
      hashFn: (title) => title.toUpperCase(), // custom: uppercase key
    });

    await diary.claimTask("my task");
    await diary.writeTaskResult("my task", "result");

    // Custom hash makes "my task" and "MY TASK" different signatures
    // because hashFn("my task") = "MY TASK" and hashFn("MY TASK") = "MY TASK"
    expect(await diary.hasProcessedTask("MY TASK")).toBe(true);
    expect(await diary.getTaskResult("MY TASK")).toBe("result");
  });

  it("custom hashFn allows structural deduplication by prefix", async () => {
    // Hash to the first 5 chars — so "task-123" and "task-456" map to same key
    const diary = makeDiary("prefix-hash", {
      hashFn: (title) => title.slice(0, 5).toLowerCase(),
    });

    await diary.claimTask("task-123");
    // "task-456" shares the same prefix hash "task-"
    const claimed = await diary.claimTask("task-456");
    expect(claimed).toBe(false); // treated as a duplicate
  });

  it("custom hashFn does not affect normalizeSignature static method", () => {
    // Static method is independent of instance options
    expect(AgentDiary.normalizeSignature("  HELLO  WORLD  ")).toBe(
      "hello world",
    );
  });

  it("default behavior still uses normalizeSignature when no hashFn is set", async () => {
    const diary = makeDiary("default-hash");
    await diary.claimTask("Download Q3 Report");
    // Case-insensitive variant — default normalizer handles this
    expect(await diary.hasProcessedTask("DOWNLOAD Q3 REPORT")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────
// Bug Fix: Consistent timestamp in writeTaskResult
// ─────────────────────────────────────────────────────────
describe("Bug Fix: Consistent timestamp in writeTaskResult", () => {
  it("record.timestamp and state.lastRun should be identical after writeTaskResult", async () => {
    const diary = makeDiary("timestamp-agent");
    await diary.claimTask("T1");
    await diary.writeTaskResult("T1", "done");

    const state = await diary.readDiary();
    expect(state.history[0].timestamp).toBe(state.lastRun);
  });
});
