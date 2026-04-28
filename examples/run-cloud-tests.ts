import { AgentDiary } from '../src/diary';
import { RedisStorage } from '../src/adapters/redis';
import { PostgresStorage } from '../src/adapters/postgres';
import Redis from 'ioredis';
import { Pool } from 'pg';

async function runBarrage(name: string, getDiary: () => AgentDiary) {
  console.log(`\n=================================`);
  console.log(`🔥 Starting Massive 50-Agent Stress Tests: ${name}`);
  console.log(`=================================`);

  const NUM_AGENTS = 50;
  
  // ----------------------------------------------------
  // TEST 1: 50 agents hitting ONE single task simultaneously
  // ----------------------------------------------------
  console.log(`\n[Test 1] 50 Agents competing for ONE task...`);
  let agents = Array.from({ length: NUM_AGENTS }, () => getDiary());
  const targetTask1 = `Massive Single Task ${Date.now()}`;
  
  let results = await Promise.all(
    agents.map(agent => agent.claimTask(targetTask1).catch(() => false))
  );

  let successful = results.filter(r => r === true).length;
  console.log(`   Expected Locks: 1`);
  console.log(`   Actual Locks:   ${successful}`);
  if (successful === 1) console.log(`   🟢 PASSED`);
  else console.log(`   🔴 FAILED`);

  // ----------------------------------------------------
  // TEST 2: 50 agents hitting 5 DIFFERENT tasks simultaneously
  // ----------------------------------------------------
  console.log(`\n[Test 2] 50 Agents competing for 5 DIFFERENT tasks...`);
  agents = Array.from({ length: NUM_AGENTS }, () => getDiary());
  const tasks = Array.from({ length: 5 }, (_, i) => `Multi Task ${i} - ${Date.now()}`);
  
  results = await Promise.all(
    agents.map((agent, i) => agent.claimTask(tasks[i % 5]).catch(() => false))
  );

  successful = results.filter(r => r === true).length;
  console.log(`   Expected Locks: 5`);
  console.log(`   Actual Locks:   ${successful}`);
  if (successful === 5) console.log(`   🟢 PASSED`);
  else console.log(`   🔴 FAILED`);

  // ----------------------------------------------------
  // TEST 3: 50 agents writing results simultaneously
  // ----------------------------------------------------
  console.log(`\n[Test 3] 50 Agents writing results for 50 completely different tasks...`);
  agents = Array.from({ length: NUM_AGENTS }, () => getDiary());
  const writeTasks = Array.from({ length: NUM_AGENTS }, (_, i) => `Write Task ${i} - ${Date.now()}`);
  
  // Claim them first
  await Promise.all(agents.map((agent, i) => agent.claimTask(writeTasks[i])));

  // Now blast the writes
  await Promise.all(agents.map((agent, i) => agent.writeTaskResult(writeTasks[i], `Result ${i}`)));

  // Verify
  const state = await agents[0].readDiary();
  // Filter history to just the writeTasks for this run
  const testWrites = state.history.filter(r => writeTasks.includes(r.title));
  
  console.log(`   Expected Written: 50`);
  console.log(`   Actual Written:   ${testWrites.length}`);
  if (testWrites.length === 50) console.log(`   🟢 PASSED`);
  else console.log(`   🔴 FAILED`);
}

async function main() {
  // 1. REDIS TEST
  const redisClient = new Redis('redis://localhost:6379');
  const redisStorage = new RedisStorage<any>({ redis: redisClient });
  
  await runBarrage('RedisStorage', () => new AgentDiary({ agentId: 'stress-bot', storage: redisStorage }));

  // 2. POSTGRES TEST
  const pgPool = new Pool({
    user: 'testuser',
    password: 'testpassword',
    host: 'localhost',
    port: 5432,
    database: 'agent_diaries',
    max: 100 // Huge pool for 50 concurrent agents!
  });
  
  const pgStorage = new PostgresStorage<any>({ pool: pgPool });
  await pgStorage.initialize(); // Create table

  await runBarrage('PostgresStorage (Advisory Locks)', () => new AgentDiary({ agentId: 'stress-bot', storage: pgStorage }));

  // Cleanup
  redisClient.disconnect();
  await pgPool.end();
  
  console.log(`\n🎉 All massive 50-agent stress tests complete!`);
}

main().catch(console.error);
