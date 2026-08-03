/**
 * Research Swarm
 * ──────────────
 * 100 research agents. Each topic gets exactly one LLM call.
 * Run: npx tsx index.ts
 */

import { AgentDiary } from "@agent-diaries/core";

const RESEARCH_TOPICS = [
  "quantum computing breakthroughs 2024",
  "CRISPR gene editing applications",
  "fusion energy latest progress",
  "AI alignment research",
  "climate change mitigation strategies",
  "new battery technology",
  "autonomous vehicle regulations",
  "blockchain use cases beyond crypto",
  "longevity research findings",
  "space colonization plans",
];

const AGENT_COUNT = 100;

async function researchTopic(topic: string): Promise<string> {
  // Replace with: await fetchAndSummarize(topic) using your LLM
  await new Promise(r => setTimeout(r, 50));
  return `Research summary for: "${topic}" — [generated at ${new Date().toISOString()}]`;
}

async function main() {
  console.log(`Launching ${AGENT_COUNT} agents for ${RESEARCH_TOPICS.length} topics...\n`);
  const start = Date.now();
  let llmCalls = 0;

  await Promise.all(
    Array.from({ length: AGENT_COUNT }, (_, agentIdx) =>
      RESEARCH_TOPICS.map(async topic => {
        const diary = new AgentDiary({ agentId: "research-swarm" });
        return diary.executeOnce(`research:${topic}`, async () => {
          llmCalls++;
          console.log(`  [agent-${agentIdx}] Researching: ${topic}`);
          return researchTopic(topic);
        });
      })
    ).flat()
  );

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n✔ ${RESEARCH_TOPICS.length} topics researched`);
  console.log(`✔ ${llmCalls} LLM calls made (out of ${AGENT_COUNT * RESEARCH_TOPICS.length} attempted)`);
  console.log(`✔ Completed in ${elapsed}s`);
}

main().catch(console.error);
