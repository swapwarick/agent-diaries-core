import { AgentDiary, AgentState } from '../src/diary';
import { MemPalaceStorage } from './mempalace-adapter';
import * as path from 'path';
import * as fs from 'fs';

async function runRigorousTests() {
  console.log("🛠️ Starting Rigorous MemPalace Agent Diaries Tests...");

  const dbPath = path.join(process.cwd(), '.mempalace-test-db');
  
  // Clean up any existing test DB to start fresh
  if (fs.existsSync(dbPath)) {
    fs.rmSync(dbPath, { recursive: true, force: true });
  }

  // Helper to create a fresh diary instance (to test persistence)
  const createDiaryInstance = () => {
    const storage = new MemPalaceStorage<AgentState>({
      palacePath: dbPath,
      wing: 'test-wing',
      room: 'test-room'
    });
    return new AgentDiary({ agentId: 'test-agent', storage });
  };

  const diary1 = createDiaryInstance();

  // Test 1: Initial state is empty
  console.log("Test 1: Initial state");
  const state1 = await diary1.readDiary();
  if (state1.runCount !== 0 || state1.history.length !== 0) {
    throw new Error("Test 1 Failed: Initial state should be empty");
  }

  // Test 2: Writing a task correctly saves it
  console.log("Test 2: Write task result");
  await diary1.writeTaskResult('Scrape website X', 'Success');
  let hasProcessed = await diary1.hasProcessedTask('Scrape website X');
  if (!hasProcessed) {
    throw new Error("Test 2 Failed: Task was not marked as processed");
  }

  // Test 3: Normalization logic check (case/whitespace insensitivity)
  console.log("Test 3: Signature normalization check");
  const isNormalizedMatch = await diary1.hasProcessedTask('  scrape WEBSITE x   ');
  if (!isNormalizedMatch) {
    throw new Error("Test 3 Failed: Normalization did not match the task correctly");
  }

  // Test 4: Multiple tasks write
  console.log("Test 4: Batch write and multiple tasks");
  await diary1.writeTaskResult('Download file Y', 'Downloaded');
  await diary1.writeTaskResult('Format disk Z', 'Done');
  
  const state2 = await diary1.readDiary();
  if (state2.runCount !== 3 || state2.history.length !== 3) {
    throw new Error(`Test 4 Failed: Expected 3 runs, got ${state2.runCount}`);
  }

  // Test 5: filterNewTasks function
  console.log("Test 5: filterNewTasks validation");
  const incoming = [
    { title: 'Download file Y' }, // Already done
    { title: 'Compute SHA256' },  // New
    { title: 'scrape website x' } // Already done
  ];
  const newTasks = await diary1.filterNewTasks(incoming);
  if (newTasks.length !== 1 || newTasks[0].title !== 'Compute SHA256') {
    throw new Error("Test 5 Failed: filterNewTasks did not correctly exclude processed tasks");
  }

  // Test 6: Persistence across instances (closing and re-opening the "DB")
  console.log("Test 6: DB Persistence across separate instances");
  const diary2 = createDiaryInstance();
  const restoredState = await diary2.readDiary();
  
  if (restoredState.runCount !== 3) {
    throw new Error("Test 6 Failed: Restored runCount does not match");
  }
  if (!restoredState.seenSignatures.includes('format disk z')) {
    throw new Error("Test 6 Failed: Restored signatures missing expected data");
  }

  // Test 7: Duplicate execution handling (deduplication simulation)
  console.log("Test 7: Write duplicate task");
  await diary2.writeTaskResult('Download file Y', 'Duplicate write');
  const state3 = await diary2.readDiary();
  // Depending on how AgentDiary is implemented, it might either bump runCount or keep signatures unique
  // Let's ensure the signature array length does not increase unnecessarily
  if (state3.seenSignatures.length !== 3) {
    throw new Error("Test 7 Failed: Signatures array duplicated entries");
  }
  
  console.log("\n✅ ALL TESTS PASSED! The MemPalace StorageAdapter is robust and persistent.");

  // Cleanup after test
  try {
    if (fs.existsSync(dbPath)) {
      fs.rmSync(dbPath, { recursive: true, force: true });
    }
  } catch (e) {
    // Ignore EBUSY if MemPalace holds an active SQLite lock on Windows
  }
}

runRigorousTests().catch(err => {
  console.error("❌ TEST FAILED:", err);
  process.exit(1);
});
