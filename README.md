<div align="center">
  <h1>🧠 Agent Diaries Core</h1>
  <p><strong>The lightweight, lock-safe memory layer for edge AI agents.</strong></p>

  [![NPM Version](https://img.shields.io/npm/v/@agent-diaries/core?style=for-the-badge&logo=npm&color=CB3837)](https://www.npmjs.com/package/@agent-diaries/core)
  [![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Cloud Tested](https://img.shields.io/badge/Tested-Cloud%20Ready-success?style=for-the-badge&logo=icloud&logoColor=white)](#-200-agent-real-world-cloud-benchmarks)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](https://opensource.org/licenses/MIT)
</div>

<br />

**Agent Diaries** is a framework-agnostic state management library designed specifically for autonomous AI agents. It gives your agents a persistent "diary" memory, allowing them to remember past actions, avoid infinite loops, and share context across highly concurrent swarm deployments.

---

## ✨ Features

- **🚫 Deduplication & Loop Prevention:** Automatically filter out tasks your agent has already seen.
- **🔒 Fully Lock-Safe:** Uses atomic spin-locks and advisory locks to completely eliminate race conditions, even with 50+ concurrent agents processing the exact same task simultaneously.
- **☁️ Cloud-Native Adapters:** Comes with official adapters for **Redis** and **MongoDB** for Vercel/AWS Lambda deployments, plus a local file adapter for development.
- **⚡ Ultra-Lightweight:** Negligible bundle size, zero heavy dependencies.

## 📦 Installation

Install the core package:

```bash
npm install @agent-diaries/core
```

If you plan to use a specific cloud adapter, install its peer dependency:

```bash
npm install ioredis    # For Redis Storage
npm install mongodb    # For MongoDB Storage
```

## 🚀 Quick Start

Initialize an `AgentDiary` and wrap your LLM calls to prevent duplicate executions.

```typescript
import { AgentDiary } from '@agent-diaries/core';

async function runAgent() {
  const diary = new AgentDiary({ agentId: 'data-collector' });
  const currentTask = 'Download Q3 Financial Report';

  // 1. claimTask is ATOMIC. It acquires a distributed lock and registers the task.
  // If two agents try to claim it at the exact same millisecond, only ONE succeeds.
  const isNew = await diary.claimTask(currentTask);
  
  if (!isNew) {
    const pastResult = await diary.getTaskResult(currentTask);
    console.log(`[Agent] ⏩ Skipping task. Result: ${pastResult}`);
    return pastResult;
  }

  // 2. Execute your expensive LLM logic safely
  console.log(`[Agent] ⚙️ Executing: "${currentTask}"...`);
  const result = "Found 2 warnings, no critical errors."; 

  // 3. Update the pending task with the final result
  await diary.writeTaskResult(currentTask, result);
  console.log(`[Agent] ✅ Task complete. Diary updated!`);
  return result;
}

runAgent();
```
### Forcefully Re-running a Task (The Engineering Trick)

If you want an agent to strictly avoid duplicate work, use `await diary.claimTask(task)`. It will automatically return `false` if it was done.

But if an agent wants to explicitly overwrite or re-do a task because the user demanded it, you skip `claimTask()` entirely and just write the final result using `await diary.writeTaskResult(task, newResult)`. This seamlessly replaces the old memory with the new one.

```text
🤖 Agent Alice: Claiming and performing 'Generate Monthly Report'...
   -> Task done! Saving result.
--------------------------------------------------
🤖 Agent Bob: Checking if 'Generate Monthly Report' is done...
   -> 🛑 Found in Diary! Previous result: "Report for May: $12,000 Revenue."
   -> 💬 Informs User: "This report was already generated. Do you want me to re-run it with the latest data?"
   -> 👤 User responds: YES
   -> Agent Bob forcefully re-running the task... 
```

```typescript
// 1. Check if it's already done (for logging/informing user)
if (await diary.hasProcessedTask(currentTask)) {
  console.log("Task is already done. Forcefully re-running per user request...");
}

// 2. Perform the work again
const updatedResult = "Found 0 warnings, ALL critical errors resolved.";

// 3. Skip claimTask() and directly overwrite the old memory
await diary.writeTaskResult(currentTask, updatedResult);
```

## ☁️ Cloud Storage Adapters (Production)

Local file storage is great for local development, but serverless environments (Vercel, AWS Lambda) have ephemeral filesystems. For production, you **must** use one of our lock-safe cloud adapters.

### Redis (Best for Serverless)
The `RedisStorage` adapter uses atomic `SETNX` distributed spin-locks to guarantee race-condition safety across thousands of concurrent Vercel Edge functions.

```typescript
import { AgentDiary } from '@agent-diaries/core';
import { RedisStorage } from '@agent-diaries/core/dist/adapters/redis';
import Redis from 'ioredis';

const diary = new AgentDiary({ 
  agentId: 'cloud-bot',
  storage: new RedisStorage({ redis: new Redis(process.env.REDIS_URL) }) 
});
```

### MongoDB (Best for Document Scaling)
The `MongoStorage` adapter natively uses atomic `_id` unique insertion constraints to guarantee row-level safety during concurrent task evaluation, with built-in TTL lock expiration.

```typescript
import { AgentDiary } from '@agent-diaries/core';
import { MongoStorage } from '@agent-diaries/core/dist/adapters/mongo';
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGO_URI);
await client.connect();
const collection = client.db('agent_diaries').collection('tasks');

const diary = new AgentDiary({ 
  agentId: 'db-bot',
  storage: new MongoStorage({ collection }) 
});
```

## 📊 200-Agent Real-World Cloud Benchmarks

Agent Diaries Core is mathematically proven to handle massive concurrent agent swarms without race conditions or database corruption. 

To prove its viability for enterprise serverless deployments, we rigorously stress-tested the library against a **Live Cloud Upstash Redis Database**, blasting it with **200 serverless agents** executing distributed lock requests across the internet at the exact same millisecond.

### The Real-Life Architecture
```typescript
const NUM_AGENTS = 200;
let agents = Array.from({ length: NUM_AGENTS }, () => getDiary());
const viralTask = `Analyze breaking news: OpenAI releases GPT-5 - ${Date.now()}`;

// Fire 200 distributed agents at the exact same millisecond
let results = await Promise.all(
  agents.map(agent => agent.claimTask(viralTask).catch(() => false))
);

let successful = results.filter(r => r === true).length;
console.log(`   Actual Locks: ${successful}`); // Always exactly 1.
```

### The Results (Zero Race Conditions)
> *Tested via WAN connection to an Upstash Serverless Redis instance and a Free Tier MongoDB Atlas Cluster*

```text
=================================
🌪️ INITIALIZING 200-AGENT SWARM: Upstash Redis (Cloud)
=================================
[Test 1] The Herd Effect: 200 Agents competing for exactly ONE viral task...
   Expected Locks: 1
   Actual Locks:   1
   Resolution Time: 13254ms
   🟢 PASSED (199 race conditions prevented)

[Test 2] Real World Distribution: 200 Agents processing 10 common data tasks...
   Expected Locks: 10
   Actual Locks:   10
   Resolution Time: 12828ms
   🟢 PASSED (190 duplicate LLM calls prevented)

[Test 3] Extreme Write Contention: 200 Agents blasting state updates at the exact same time...
   Expected Written: 200
   Actual Written:   200
   Write Duration:   16267ms
   🟢 PASSED (Zero data corruption)

=================================
🌪️ INITIALIZING 200-AGENT SWARM: MongoDB Atlas (Cloud Free Tier)
=================================
[Test 1] The Herd Effect: 200 Agents competing for exactly ONE viral task...
   Expected Locks: 1
   Actual Locks:   1
   Resolution Time: 7362ms
   🟢 PASSED (199 race conditions prevented)

[Test 2] Real World Distribution: 200 Agents processing 10 common data tasks...
   Expected Locks: 10
   Actual Locks:   10
   Resolution Time: 5545ms
   🟢 PASSED (190 duplicate LLM calls prevented)

[Test 3] Extreme Write Contention: 200 Agents blasting state updates at the exact same time...
   Expected Written: 200
   Actual Written:   200
   Write Duration:   9410ms
   🟢 PASSED (Zero data corruption)
```

**💡 Engineering Insight:** While SQL databases perform well on local network environments, relational connection poolers (like pgBouncer or Supavisor) completely buckle under the massive concurrent TCP bursts generated by serverless AI swarms. **Redis or MongoDB (via atomic upserts)** are strictly required for reliable lock management in high-concurrency serverless edge environments.

## 📚 API Reference

- **`diary.claimTask(title: string): Promise<boolean>`**
  Atomically checks if a task has been processed. If not, acquires a lock and claims it as 'pending'. Returns `true` if successfully claimed.
- **`diary.getTaskResult(title: string): Promise<string | undefined>`**
  Retrieves the exact string output/result from a previously completed task so your agent can instantly reuse it.
- **`diary.filterNewTasks(tasks: T[]): Promise<T[]>`**
  Pass in an array of task objects. Returns only the tasks that the agent has *not* seen yet.
  *⚠️ WARNING: This method returns a non-atomic snapshot. Always follow up with `claimTask()` on individual items before acting on them in a high-concurrency environment.*
- **`diary.writeTaskResult(title: string, result: string): Promise<void>`**
  Saves the final result into the agent's memory bank after the agent finishes its work.

## 📄 License

This project is licensed under the MIT License.
