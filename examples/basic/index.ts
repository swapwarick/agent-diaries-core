/**
 * Basic — Hello World
 * ───────────────────
 * The simplest possible Agent Diaries example.
 * Run: npx tsx index.ts
 */

import { AgentDiary } from "@agent-diaries/core";

const diary = new AgentDiary({ agentId: "hello-agent" });

async function main() {
  console.log("Running 5 agents concurrently for the same task...\n");

  // Simulate 5 agents all trying to run the same expensive task
  const results = await Promise.all(
    Array.from({ length: 5 }, (_, i) =>
      diary.executeOnce("expensive-llm-call", async () => {
        console.log(`  Agent ${i}: → executing LLM call`);
        await new Promise(r => setTimeout(r, 500)); // simulate LLM latency
        return "The answer to everything is 42.";
      }).then(result => {
        console.log(`  Agent ${i}: ← got result`);
        return result;
      })
    )
  );

  console.log("\nAll results:");
  results.forEach((r, i) => console.log(`  Agent ${i}: "${r}"`));
  console.log("\n✔ LLM called exactly once. All 5 agents got the same result.");
}

main().catch(console.error);
