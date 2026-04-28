import { AgentDiary } from '../src/diary';
import { RedisStorage } from '../src/adapters/redis';
import { MongoStorage } from '../src/adapters/mongo';
import Redis from 'ioredis';
import { MongoClient } from 'mongodb';
import * as dotenv from 'dotenv';

dotenv.config();

const REAL_WORLD_TASKS = [
  "Scrape YCombinator front page",
  "Summarize Q3 Earnings Call for AAPL",
  "Analyze sentiment of Twitter hashtag #AI",
  "Extract financial tables from SEC 10-K",
  "Generate personalized email draft for Lead ID 8492",
  "Classify customer support ticket #9102",
  "Translate markdown documentation to French",
  "Detect PII in medical transcript MT-001",
  "Parse PDF invoice INV-2023-09",
  "Write unit tests for authentication module"
];

async function runSwarm(name: string, numAgents: number, getDiary: () => AgentDiary) {
  console.log(`\n=================================`);
  console.log(`🌪️ INITIALIZING ${numAgents}-AGENT SWARM: ${name}`);
  console.log(`=================================`);


  
  // ----------------------------------------------------
  // TEST 1: The Herd Effect (identical task)
  // ----------------------------------------------------
  console.log(`\n[Test 1] The Herd Effect: ${numAgents} Agents competing for exactly ONE viral task...`);
  let agents = Array.from({ length: numAgents }, () => getDiary());
  const viralTask = `Analyze breaking news: OpenAI releases GPT-5 - ${Date.now()}`;
  
  let startTime = Date.now();
  let results = await Promise.all(
    agents.map(agent => agent.claimTask(viralTask).catch(e => false))
  );
  let duration = Date.now() - startTime;

  let successful = results.filter(r => r === true).length;
  console.log(`   Expected Locks: 1`);
  console.log(`   Actual Locks:   ${successful}`);
  console.log(`   Resolution Time: ${duration}ms`);
  if (successful === 1) console.log(`   🟢 PASSED (${numAgents - 1} race conditions prevented)`);
  else console.log(`   🔴 FAILED`);

  // ----------------------------------------------------
  // TEST 2: Real World Distribution (10 tasks)
  // ----------------------------------------------------
  console.log(`\n[Test 2] Real World Distribution: ${numAgents} Agents processing 10 common data tasks...`);
  agents = Array.from({ length: numAgents }, () => getDiary());
  
  // Distribute the 10 real-world tasks
  const runToken = Date.now();
  const distributedTasks = Array.from({ length: numAgents }, (_, i) => `${REAL_WORLD_TASKS[i % 10]} - Run ${runToken}`);
  
  startTime = Date.now();
  results = await Promise.all(
    agents.map((agent, i) => agent.claimTask(distributedTasks[i]).catch(e => false))
  );
  duration = Date.now() - startTime;

  successful = results.filter(r => r === true).length;
  console.log(`   Expected Locks: 10`);
  console.log(`   Actual Locks:   ${successful}`);
  console.log(`   Resolution Time: ${duration}ms`);
  if (successful === 10) console.log(`   🟢 PASSED (${numAgents - 10} duplicate LLM calls prevented)`);
  else console.log(`   🔴 FAILED`);

  // ----------------------------------------------------
  // TEST 3: Extreme Write Contention (writing simultaneously)
  // ----------------------------------------------------
  console.log(`\n[Test 3] Extreme Write Contention: ${numAgents} Agents blasting state updates at the exact same time...`);
  agents = Array.from({ length: numAgents }, () => getDiary());
  const runToken2 = Date.now();
  const uniqueTasks = Array.from({ length: numAgents }, (_, i) => `Independent Research Topic ${i} - ${runToken2}`);
  
  // Claim them all successfully
  await Promise.all(agents.map((agent, i) => agent.claimTask(uniqueTasks[i])));

  startTime = Date.now();
  // Now blast 200 database writes concurrently
  await Promise.all(agents.map((agent, i) => agent.writeTaskResult(uniqueTasks[i], `{"status": "completed", "tokens": 4050, "data": "..."}`)));
  duration = Date.now() - startTime;

  // Verify
  const state = await agents[0].readDiary();
  const testWrites = state.history.filter(r => uniqueTasks.includes(r.title));
  
  console.log(`   Expected Written: ${numAgents}`);
  console.log(`   Actual Written:   ${testWrites.length}`);
  console.log(`   Write Duration:   ${duration}ms`);
  if (testWrites.length === numAgents) console.log(`   🟢 PASSED (Zero data corruption)`);
  else console.log(`   🔴 FAILED`);
}

async function main() {
  if (!process.env.UPSTASH_REDIS_URL && !process.env.MONGO_URI) {
    console.error("❌ Missing UPSTASH_REDIS_URL or MONGO_URI in .env file.");
    process.exit(1);
  }

  // 1. REDIS SWARM (UPSTASH)
  if (process.env.UPSTASH_REDIS_URL) {
    const redisClient = new Redis(process.env.UPSTASH_REDIS_URL!);
    const redisStorage = new RedisStorage<any>({ redis: redisClient });
    
    await runSwarm('Upstash Redis (Cloud)', 55, () => new AgentDiary({ agentId: 'cloud-swarm-bot', storage: redisStorage }));
    redisClient.disconnect();
  } else {
    console.log(`\n⏭️ Skipping Redis test (UPSTASH_REDIS_URL not provided).`);
  }

  // 2. MONGO SWARM
  if (process.env.MONGO_URI) {
    const mongoClient = new MongoClient(process.env.MONGO_URI, {
      maxPoolSize: 250 // MongoDB easily handles 250+ connections per node process
    });
    await mongoClient.connect();
    
    const collection = mongoClient.db('agent_diaries').collection('tasks');
    // Ensure index on lock _id is not needed since _id is automatically unique and indexed!
    
    const mongoStorage = new MongoStorage<any>({ collection });

    await runSwarm('MongoDB (Atomic Upserts)', 200, () => new AgentDiary({ agentId: 'swarm-bot', storage: mongoStorage }));
    await mongoClient.close();
  } else {
    console.log(`\n⏭️ Skipping MongoDB test (MONGO_URI not provided).`);
  }

  console.log(`\n🎉 CLOUD SWARM TEST COMPLETE!`);
}

main().catch(console.error);
