const { parentPort } = require('worker_threads');
const { AgentDiary } = require('../../dist/diary');
const { LocalFileStorage } = require('../../dist/storage');
const path = require('path');
const fs = require('fs');

async function run() {
  const testDir = path.join(__dirname, '..', '.worker-test-data');
  // Ensure the test directory exists synchronously to avoid race condition on mkdir
  if (!fs.existsSync(testDir)) {
    try { fs.mkdirSync(testDir, { recursive: true }); } catch (e) {}
  }
  
  const storage = new LocalFileStorage({ directory: testDir });
  const diary = new AgentDiary({ agentId: 'multi-process-agent', storage });
  
  const success = await diary.claimTask('multi-process-task');
  parentPort.postMessage(success);
}

run().catch(() => parentPort.postMessage(false));
