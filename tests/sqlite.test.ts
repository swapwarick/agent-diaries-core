import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { AgentDiary } from "../src/diary";
import { SqliteStorage } from "../src/adapters/sqlite";

describe("SqliteStorage Adapter & AgentDiary Integration", () => {
  let db: Database.Database;
  let storage: SqliteStorage<any>;

  beforeEach(() => {
    // Initialize a fresh in-memory SQLite database for each test to ensure isolation
    db = new Database(":memory:");
    storage = new SqliteStorage({ db });
  });

  afterEach(() => {
    // Close the database connection
    db.close();
  });

  it("should support basic get and set operations", async () => {
    const key = "test-key";
    const val = { success: true, count: 42 };

    expect(await storage.get(key)).toBeNull();

    await storage.set(key, val);
    expect(await storage.get(key)).toEqual(val);
  });

  it("should prevent silent inserts via strict ownership (AgentDiary integration)", async () => {
    const diary = new AgentDiary({ agentId: "sqlite-agent", storage });

    // Try to write without claiming first
    await expect(
      diary.writeTaskResult("Unclaimed Task", "Success Result"),
    ).rejects.toThrow(/was not claimed/);

    // Now claim it, then write the result
    const claimed = await diary.claimTask("Claimed Task");
    expect(claimed).toBe(true);

    await diary.writeTaskResult("Claimed Task", "Success Result");
    expect(await diary.getTaskResult("Claimed Task")).toBe("Success Result");
  });

  it("should remember processed tasks and support concurrency locking", async () => {
    const diary = new AgentDiary({ agentId: "concurrency-agent", storage });

    const results = await Promise.all([
      diary.claimTask("Shared Task"),
      diary.claimTask("Shared Task"),
      diary.claimTask("Shared Task"),
    ]);

    // Only one of the concurrent claims should succeed
    const successfulClaims = results.filter((r) => r === true);
    expect(successfulClaims).toHaveLength(1);
  });

  it("should recover from expired locks", async () => {
    const lockKey = "lock:expired-task";

    // Manually write an expired lock into the locks table (older than 10 seconds)
    const expiredTime = Date.now() - 15000;
    db.prepare(
      "INSERT INTO agent_diaries_locks (key, locked_at) VALUES (?, ?)",
    ).run(lockKey, expiredTime);

    // Call withLock, which should see the expired lock, clean it up, acquire the lock, and run
    let executed = false;
    await storage.withLock("expired-task", async () => {
      executed = true;
    });

    expect(executed).toBe(true);

    // Verify the lock was deleted after executing
    const lock = db
      .prepare("SELECT locked_at FROM agent_diaries_locks WHERE key = ?")
      .get(lockKey);
    expect(lock).toBeUndefined();
  });
});
