import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { AgentDiary } from '../src/diary';
import { LocalFileStorage } from '../src/storage';
import * as fs from 'fs';
import * as path from 'path';

describe('Atomic Concurrency & Race Condition Prevention', () => {
  const TEST_DIR = path.join(__dirname, '.test-locks');

  beforeEach(() => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
    // Clean directory
    const files = fs.readdirSync(TEST_DIR);
    for (const file of files) {
      fs.unlinkSync(path.join(TEST_DIR, file));
    }
  });

  afterAll(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('prevents race conditions when 50 agents try to claim the exact same task simultaneously', async () => {
    const storage = new LocalFileStorage({ baseDir: TEST_DIR });
    
    // We instantiate 50 separate AgentDiary instances pointing to the exact same storage/agentId
    const NUM_AGENTS = 50;
    const agents = Array.from({ length: NUM_AGENTS }, () => new AgentDiary({
      agentId: 'concurrent-bot',
      storage
    }));

    const targetTask = "Generate Monthly Report";

    // Launch all 50 agents at the EXACT same millisecond
    const claimPromises = agents.map(agent => agent.claimTask(targetTask));
    const results = await Promise.all(claimPromises);

    // Count how many agents successfully claimed the task
    const successfulClaims = results.filter(result => result === true);
    const rejectedClaims = results.filter(result => result === false);

    // ASSERTIONS
    // Exactly ONE agent should have acquired the lock and successfully claimed the task
    expect(successfulClaims.length).toBe(1);
    
    // The other 49 agents should have been blocked and safely rejected
    expect(rejectedClaims.length).toBe(NUM_AGENTS - 1);

    // Verify the state is not corrupted
    const finalState = await agents[0].readDiary();
    expect(finalState.runCount).toBe(1);
    expect(finalState.seenSignatures).toHaveLength(1);
    expect(finalState.history).toHaveLength(1);
    expect(finalState.history[0].result).toBeUndefined(); // Still marked as pending
  }, 30000); // 30s timeout for spin locks to settle
});
