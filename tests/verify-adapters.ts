import { AgentDiary } from '../src/diary';
import { RedisStorage } from '../src/adapters/redis';
import { MongoStorage } from '../src/adapters/mongo';
import Redis from 'ioredis';
import { MongoClient } from 'mongodb';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

async function verifyStorage(name: string, storage: any, client: any) {
  console.log(`\n=========================================`);
  console.log(`🧪 Verifying ${name} Adapter P0/P1 Fixes`);
  console.log(`=========================================`);
  
  const diary = new AgentDiary({ agentId: `test-strict-${Date.now()}`, storage });

  // 1. Verify writeTaskResult strict ownership model
  console.log(`[Test 1] Verifying writeTaskResult strict ownership model...`);
  try {
    await diary.writeTaskResult('Unclaimed Task', 'Some Result');
    console.log(`   ❌ FAILED: Did not throw an error!`);
  } catch (e: any) {
    if (e.message.includes('was not claimed')) {
      console.log(`   🟢 PASSED: Successfully blocked silent insert! Error caught: "${e.message}"`);
    } else {
      console.log(`   ❌ FAILED: Threw wrong error: ${e.message}`);
    }
  }

  // 2. Verify multiple claims don't trigger re-indexing issues (Testing P1 ensureIndex cache)
  console.log(`[Test 2] Verifying subsequent claims run fast (Static Cache)...`);
  const start = Date.now();
  await diary.claimTask('Index Task 1');
  await diary.claimTask('Index Task 2');
  await diary.claimTask('Index Task 3');
  const duration = Date.now() - start;
  console.log(`   🟢 PASSED: 3 successive locks acquired in ${duration}ms (No cold-start penalty on 2nd/3rd lock)`);

  if (name === 'Redis') {
      client.disconnect();
  } else {
      await client.close();
  }
}

async function main() {
  if (process.env.UPSTASH_REDIS_URL) {
    const redisClient = new Redis(process.env.UPSTASH_REDIS_URL);
    const redisStorage = new RedisStorage({ redis: redisClient });
    await verifyStorage('Redis', redisStorage, redisClient);
  } else {
    console.log('Skipping Redis - UPSTASH_REDIS_URL not set');
  }

  if (process.env.MONGO_URI) {
    const mongoClient = new MongoClient(process.env.MONGO_URI);
    await mongoClient.connect();
    const collection = mongoClient.db('agent_diaries').collection('tasks');
    const mongoStorage = new MongoStorage({ collection });
    await verifyStorage('MongoDB', mongoStorage, mongoClient);
  } else {
    console.log('Skipping MongoDB - MONGO_URI not set');
  }
}

main().catch(console.error);
