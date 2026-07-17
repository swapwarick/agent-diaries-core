import { describe, it, expect } from "vitest";
import { AgentDiary } from "../src/diary";
import { MemoryStorage } from "../src/storage";

function makeDiary(agentId: string) {
  return new AgentDiary({ agentId, storage: new MemoryStorage<any>() });
}

describe("Query features", () => {
  it("lists tasks by status and supports limit and offset", async () => {
    const diary = makeDiary("query-status");

    await diary.claimTask("Pending Task");

    await diary.claimTask("Done Task");
    await diary.writeTaskResult("Done Task", "ok");

    await diary.claimTask("Failed Task");
    await diary.failTask("Failed Task", "oops");

    await diary.claimTask("Newest Done");
    await diary.writeTaskResult("Newest Done", "latest");

    expect((await diary.getPendingTasks()).map((task) => task.title)).toEqual([
      "Pending Task",
    ]);
    expect((await diary.getDoneTasks()).map((task) => task.title)).toEqual([
      "Newest Done",
      "Done Task",
    ]);
    expect((await diary.getFailedTasks()).map((task) => task.title)).toEqual([
      "Failed Task",
    ]);

    const filtered = await diary.listTasks({
      status: ["done", "failed"],
      offset: 1,
      limit: 2,
    });

    expect(filtered.map((task) => task.title)).toEqual([
      "Failed Task",
      "Done Task",
    ]);
  });

  it("keeps expired records out of default lists and understands legacy snapshots", async () => {
    const expiringDiary = makeDiary("query-expiry");

    await expiringDiary.claimTask("Short Task", { ttlMs: 20 });
    await expiringDiary.writeTaskResult("Short Task", "done");

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(await expiringDiary.listTasks()).toHaveLength(0);
    expect(
      (await expiringDiary.listTasks({ includeExpired: true })).map(
        (task) => task.title,
      ),
    ).toEqual(["Short Task"]);

    const legacyStorage = new MemoryStorage<any>();
    await legacyStorage.set("diary_legacy", {
      lastRun: 100,
      runCount: 1,
      seenSignatures: [AgentDiary.normalizeSignature("Legacy Done")],
      history: [
        {
          title: "Legacy Done",
          signature: AgentDiary.normalizeSignature("Legacy Done"),
          result: "old result",
          timestamp: 100,
        },
      ],
    });

    const legacyDiary = new AgentDiary({
      agentId: "legacy",
      storage: legacyStorage,
    });

    expect((await legacyDiary.getDoneTasks()).map((task) => task.title)).toEqual([
      "Legacy Done",
    ]);

    const stats = await legacyDiary.getStats();
    expect(stats.doneCount).toBe(1);
    expect(stats.pendingCount).toBe(0);
  });
});