import { AgentDiary } from '../src/diary';

async function main() {
  // To share memories across multiple agents, they must use the same agentId namespace
  const sharedDiaryA = new AgentDiary({ agentId: 'company-swarm' });
  const sharedDiaryB = new AgentDiary({ agentId: 'company-swarm' });

  const taskTitle = 'Generate Monthly Report';

  // 1. Agent Alice performs the task for the first time
  console.log("🤖 Agent Alice: Claiming and performing 'Generate Monthly Report'...");
  const claimed = await sharedDiaryA.claimTask(taskTitle);
  if (claimed) {
    console.log("   -> Task done! Saving result.");
    await sharedDiaryA.writeTaskResult(taskTitle, 'Report for May: $12,000 Revenue.');
  }

  console.log("--------------------------------------------------");

  // 2. Later, Agent Bob needs to do the same task
  console.log("\n🤖 Agent Bob: Checking if 'Generate Monthly Report' is done...");
  const hasDone = await sharedDiaryB.hasProcessedTask(taskTitle);
  
  if (hasDone) {
    const previousResult = await sharedDiaryB.getTaskResult(taskTitle);
    console.log(`   -> 🛑 Found in Diary! Previous result: "${previousResult}"`);
    console.log(`   -> 💬 Informs User: "This report was already generated. Do you want me to re-run it with the latest data?"`);
    
    // Simulate user responding with "Yes, run it again"
    const userWantsRetry = true;
    console.log(`   -> 👤 User responds: YES`);

    if (userWantsRetry) {
      console.log(`   -> Agent Bob forcefully re-running the task...`);
      
      // We skip claimTask() because the task is technically 'done', but we want to overwrite it!
      // We just perform the new work and call writeTaskResult() to update the memory.
      const updatedResult = 'Report for May (UPDATED): $15,500 Revenue.';
      await sharedDiaryB.writeTaskResult(taskTitle, updatedResult);
      
      console.log(`   -> Task successfully re-run and memory updated!`);
    }
  }

  // 3. Verify final memory state
  const finalResult = await sharedDiaryA.getTaskResult(taskTitle);
  console.log(`\n✅ Final Vault Memory State: "${finalResult}"`);
}

main().catch(console.error);
