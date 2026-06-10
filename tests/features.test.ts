import { describe, it, expect, beforeEach } from "vitest";
import { AgentDiary } from "../src/diary";
import { MemoryStorage } from "../src/storage";

describe("New Features Test Suite", () => {
  describe("MemoryStorage Adapter", () => {
    it("should get and set values correctly", async () => {
      const storage = new MemoryStorage<any>();
      await storage.set("test_key", { value: "hello" });
      const val = await storage.get("test_key");
      expect(val).toEqual({ value: "hello" });
    });

    it("should acquire and release locks correctly, preventing concurrent overlap", async () => {
      const storage = new MemoryStorage<any>();
      let executionCount = 0;
      let insideLock = false;

      const runSection = async () => {
        await storage.withLock("shared_lock", async () => {
          expect(insideLock).toBe(false);
          insideLock = true;
          executionCount++;
          // Simulate some async delay
          await new Promise((resolve) => setTimeout(resolve, 50));
          insideLock = false;
        });
      };

      // Run 5 tasks concurrently, lock should serialize them
      await Promise.all([
        runSection(),
        runSection(),
        runSection(),
        runSection(),
        runSection(),
      ]);

      expect(executionCount).toBe(5);
    });
  });

  describe("Task TTL (Expiration)", () => {
    let storage: MemoryStorage<any>;

    beforeEach(() => {
      // MemoryStorage uses static storage, but we can clear it using AgentDiary clearHistory or by creating a new agent ID.
      storage = new MemoryStorage<any>();
    });

    it("should expire a task after its TTL", async () => {
      const agent = new AgentDiary({
        agentId: "ttl-agent",
        storage,
      });

      // Claim a task with a very short TTL (100ms)
      const claim1 = await agent.claimTask("Short TTL Task", { ttlMs: 100 });
      expect(claim1).toBe(true);

      // Try to claim again immediately - should fail
      const claim2 = await agent.claimTask("Short TTL Task", { ttlMs: 100 });
      expect(claim2).toBe(false);

      expect(await agent.hasProcessedTask("Short TTL Task")).toBe(true);

      // Write a result
      await agent.writeTaskResult("Short TTL Task", "Done");
      expect(await agent.getTaskResult("Short TTL Task")).toBe("Done");

      // Wait 150ms for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Check after expiration
      expect(await agent.hasProcessedTask("Short TTL Task")).toBe(false);
      expect(await agent.getTaskResult("Short TTL Task")).toBeUndefined();

      // Should be able to claim again!
      const claim3 = await agent.claimTask("Short TTL Task", { ttlMs: 100 });
      expect(claim3).toBe(true);
    });

    it("should use defaultTtlMs from diary configuration if provided", async () => {
      const agent = new AgentDiary({
        agentId: "default-ttl-agent",
        storage,
        defaultTtlMs: 100,
      });

      const claim1 = await agent.claimTask("Default TTL Task");
      expect(claim1).toBe(true);

      // Wait 150ms for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(await agent.hasProcessedTask("Default TTL Task")).toBe(false);
    });

    it("should treat expired tasks as new when filtering", async () => {
      const agent = new AgentDiary({
        agentId: "filter-ttl-agent",
        storage,
        defaultTtlMs: 100,
      });

      await agent.claimTask("Task 1");
      await agent.claimTask("Task 2");

      let filtered = await agent.filterNewTasks([
        { title: "Task 1" },
        { title: "Task 2" },
        { title: "Task 3" },
      ]);
      expect(filtered).toHaveLength(1);
      expect(filtered[0].title).toBe("Task 3");

      // Wait 150ms for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      filtered = await agent.filterNewTasks([
        { title: "Task 1" },
        { title: "Task 2" },
        { title: "Task 3" },
      ]);
      // All tasks should now be considered new/expired
      expect(filtered).toHaveLength(3);
    });
  });

  describe("Task Deletion (deleteTask)", () => {
    it("should delete task successfully and allow reclaiming", async () => {
      const storage = new MemoryStorage<any>();
      const agent = new AgentDiary({ agentId: "delete-agent", storage });

      await agent.claimTask("Task to Delete");
      await agent.writeTaskResult("Task to Delete", "Val");

      expect(await agent.hasProcessedTask("Task to Delete")).toBe(true);

      const deleted = await agent.deleteTask("Task to Delete");
      expect(deleted).toBe(true);

      expect(await agent.hasProcessedTask("Task to Delete")).toBe(false);
      expect(await agent.getTaskResult("Task to Delete")).toBeUndefined();

      // Deleting again should return false
      const deletedAgain = await agent.deleteTask("Task to Delete");
      expect(deletedAgain).toBe(false);

      // Should be able to claim again
      const claim = await agent.claimTask("Task to Delete");
      expect(claim).toBe(true);
    });
  });

  describe("Query and Cleanup APIs", () => {
    it("should filter by keyword and timestamp, and support clearHistory", async () => {
      const storage = new MemoryStorage<any>();
      const agent = new AgentDiary({ agentId: "query-agent", storage });

      const startTime = Date.now() - 100;

      await agent.claimTask("Fetch Apple stock price");
      await agent.writeTaskResult(
        "Fetch Apple stock price",
        "Apple stock is $180",
      );

      await agent.claimTask("Fetch Google stock price");
      await agent.writeTaskResult(
        "Fetch Google stock price",
        "Google stock is $150",
      );

      await agent.claimTask("Generate generic report");
      // Not writing a result for this one (remains pending/no result)

      // 1. Keyword search (case-insensitive)
      const stockTasks = await agent.findTasksByKeyword("STOCK");
      expect(stockTasks).toHaveLength(2);
      expect(stockTasks.map((t) => t.title)).toContain(
        "Fetch Apple stock price",
      );
      expect(stockTasks.map((t) => t.title)).toContain(
        "Fetch Google stock price",
      );

      const appleTasks = await agent.findTasksByKeyword("Apple");
      expect(appleTasks).toHaveLength(1);
      expect(appleTasks[0].title).toBe("Fetch Apple stock price");

      // 2. getTasksCompletedSince
      const completed = await agent.getTasksCompletedSince(startTime);
      expect(completed).toHaveLength(2); // stock tasks have results, report does not

      const futureTime = Date.now() + 5000;
      const completedFuture = await agent.getTasksCompletedSince(futureTime);
      expect(completedFuture).toHaveLength(0);

      // 3. clearHistory
      await agent.clearHistory();
      expect(await agent.hasProcessedTask("Fetch Apple stock price")).toBe(
        false,
      );
      expect(await agent.getTasksCompletedSince(startTime)).toHaveLength(0);
    });
  });
});
