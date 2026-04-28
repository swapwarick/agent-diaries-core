const { Worker, isMainThread, workerData, parentPort } = require('worker_threads');
const { AgentDiary } = require('../dist/diary');
const { RedisStorage } = require('../dist/adapters/redis');
const { MongoStorage } = require('../dist/adapters/mongo');
const Redis = require('ioredis');
const { MongoClient } = require('mongodb');
const dotenv = require('dotenv');

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: true });

if (!isMainThread) {
  const runWorker = async () => {
    const { storageType, agentId, taskTitle } = workerData;
    let storage, client;
    
    if (storageType === 'redis') {
      // Create a fresh connection per worker (simulating separate servers)
      client = new Redis(process.env.UPSTASH_REDIS_URL);
      storage = new RedisStorage({ redis: client });
    } else if (storageType === 'mongo') {
      client = new MongoClient(process.env.MONGO_URI);
      await client.connect();
      const collection = client.db('agent_diaries').collection('tasks');
      storage = new MongoStorage({ collection });
    }

    const diary = new AgentDiary({ agentId, storage });
    const success = await diary.claimTask(taskTitle);
    
    if (storageType === 'redis') {
      client.disconnect();
    } else {
      await client.close();
    }
    
    parentPort.postMessage(success);
  };
  
  runWorker().catch(err => {
    console.error(err);
    parentPort.postMessage(false);
  });
} else {
  const runSwarm = async (storageType, count) => {
    console.log(`\n🌪️ Spawning ${count} Multi-Process Workers for ${storageType.toUpperCase()}...`);
    const taskTitle = `viral-task-${Date.now()}`;
    const promises = [];
    
    const startTime = Date.now();
    for (let i = 0; i < count; i++) {
      promises.push(new Promise((resolve) => {
        const worker = new Worker(__filename, {
          workerData: { storageType, agentId: 'swarm-multi', taskTitle }
        });
        worker.on('message', resolve);
        worker.on('error', () => resolve(false));
        worker.on('exit', () => resolve(false));
      }));
    }
    
    const results = await Promise.all(promises);
    const duration = Date.now() - startTime;
    
    const successCount = results.filter(Boolean).length;
    console.log(`   Expected Locks: 1`);
    console.log(`   Actual Locks:   ${successCount}`);
    console.log(`   Resolution Time: ${duration}ms`);
    if (successCount === 1) {
      console.log(`   🟢 PASSED (${count - 1} race conditions prevented across OS processes)`);
    } else {
      console.log(`   ❌ FAILED! Multiple processes acquired the lock!`);
    }
  };

  const main = async () => {
    // Ensure dist is built first
    try {
      require('../dist/diary');
    } catch(e) {
      console.error("Please run 'npm run build' first!");
      process.exit(1);
    }

    if (process.env.UPSTASH_REDIS_URL) {
      await runSwarm('redis', 50);
    }
    if (process.env.MONGO_URI) {
      await runSwarm('mongo', 50);
    }
  };
  
  main().catch(console.error);
}
