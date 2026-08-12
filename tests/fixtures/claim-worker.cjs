/**
 * Worker thread that attempts to claim a task using AgentDiary.
 *
 * Uses tsx/cjs to register TypeScript support, allowing direct
 * imports from src/ without needing a prior build step.
 * Falls back to dist/ imports if tsx is not available.
 */
require("tsx/cjs");

const { parentPort } = require("worker_threads");
const path = require("path");
const fs = require("fs");

// Import directly from TypeScript source
const { AgentDiary } = require("../../src/diary.ts");
const { LocalFileStorage } = require("../../src/memory/storage.ts");

async function run() {
  const testDir = path.join(__dirname, "..", ".worker-test-data");
  // Ensure the test directory exists synchronously to avoid race condition on mkdir
  if (!fs.existsSync(testDir)) {
    try {
      fs.mkdirSync(testDir, { recursive: true });
    } catch (_e) {
      // directory may already exist, ignore
    }
  }

  const storage = new LocalFileStorage({ baseDir: testDir });
  const diary = new AgentDiary({ agentId: "multi-process-agent", storage });

  const success = await diary.claimTask("multi-process-task");
  parentPort.postMessage(success);
}

run().catch((err) => {
  console.error("Worker error:", err);
  parentPort.postMessage(false);
});
