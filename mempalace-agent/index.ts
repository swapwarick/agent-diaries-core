import { AgentDiary, AgentState } from '../src/diary';
import { MemPalaceStorage } from './mempalace-adapter';
import * as path from 'path';

async function main() {
  console.log("🚀 Starting MemPalace Agent Diary...");

  // 1. Setup the MemPalace local database store
  const dbPath = path.join(process.cwd(), '.mempalace-local-db');
  console.log(`📁 Using MemPalace DB at: ${dbPath}`);

  const memPalaceDB = new MemPalaceStorage<AgentState>({
    palacePath: dbPath,
    wing: 'demo-agent',
    room: 'task-memory'
  });

  // 2. Initialize the Diary
  const diary = new AgentDiary({
    agentId: 'alpha-researcher',
    storage: memPalaceDB
  });

  const taskTitle = 'Research latest AI models';

  // 3. Agent workflow
  console.log(`\n🤖 Agent is asked to do: "${taskTitle}"`);

  const alreadyDone = await diary.hasProcessedTask(taskTitle);

  if (alreadyDone) {
    console.log(`✅ SKIPPING: Agent remembers doing "${taskTitle}" already!`);
  } else {
    console.log(`⚙️ EXECUTING: Agent is working on "${taskTitle}"...`);
    
    // Simulate work...
    const result = 'Found new models: GPT-4.5, Claude 3.5 Sonnet, etc.';
    
    // Save to MemPalace DB
    await diary.writeTaskResult(taskTitle, result);
    console.log(`💾 SAVED: Agent recorded the results in MemPalace local DB.`);
  }

  // Show the state
  const state = await diary.readDiary();
  console.log('\n📊 Current MemPalace Agent State:');
  console.log(JSON.stringify(state, null, 2));
}

main().catch(console.error);
