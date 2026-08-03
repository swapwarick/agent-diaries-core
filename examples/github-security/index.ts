/**
 * GitHub Security Scanner Swarm
 * ─────────────────────────────
 * 200 agents. 50 repos. Zero duplicate scans.
 *
 * Without Agent Diaries: 10,000 LLM calls
 * With Agent Diaries:        50 LLM calls
 *
 * Run: npx tsx index.ts
 */

import { AgentDiary, MemoryStorage } from "@agent-diaries/core";

// ── Simulated dependencies (replace with real implementations) ──────────────

async function scanRepo(repo: string): Promise<string> {
  // In production: call GitHub API + your LLM of choice
  await new Promise(r => setTimeout(r, 20)); // simulate I/O
  const issues = Math.floor(Math.random() * 5);
  return JSON.stringify({
    repo,
    scannedAt: new Date().toISOString(),
    criticalIssues: issues,
    status: issues > 2 ? "ALERT" : "OK",
  });
}

// ── Configuration ────────────────────────────────────────────────────────────

const REPOS = [
  "vercel/next.js",
  "microsoft/vscode",
  "facebook/react",
  "vuejs/core",
  "sveltejs/svelte",
  "angular/angular",
  "denoland/deno",
  "nodejs/node",
  "prisma/prisma",
  "trpc/trpc",
  "supabase/supabase",
  "planetscale/database-js",
  "drizzle-team/drizzle-orm",
  "colinhacks/zod",
  "pmndrs/zustand",
  "tanstack/query",
  "vitejs/vite",
  "esbuild/esbuild",
  "biomejs/biome",
  "oxc-project/oxc",
  "pnpm/pnpm",
  "yarnpkg/yarn",
  "oven-sh/bun",
  "nicolo-ribaudo/jest",
  "vitest-dev/vitest",
  "microsoft/playwright",
  "cypress-io/cypress",
  "puppeteer/puppeteer",
  "expressjs/express",
  "fastify/fastify",
  "nestjs/nest",
  "honojs/hono",
  "elysiajs/elysia",
  "langchain-ai/langchainjs",
  "vercel/ai",
  "openai/openai-node",
  "anthropics/anthropic-sdk-python",
  "microsoft/autogen",
  "crewai/crewai",
  "pydantic/pydantic-ai",
  "ollama/ollama",
  "ggml-org/llama.cpp",
  "huggingface/transformers.js",
  "tensorflow/tensorflow",
  "pytorch/pytorch",
  "scikit-learn/scikit-learn",
  "apache/arrow",
  "duckdb/duckdb",
  "ClickHouse/ClickHouse",
  "redis/redis",
];

const AGENT_COUNT = 200;

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("━".repeat(60));
  console.log("  GitHub Security Scanner Swarm — Agent Diaries Demo");
  console.log("━".repeat(60));
  console.log(`  Agents:       ${AGENT_COUNT}`);
  console.log(`  Repositories: ${REPOS.length}`);
  console.log(`  Total calls:  ${AGENT_COUNT * REPOS.length}`);
  console.log("━".repeat(60));
  console.log();

  const startTime = Date.now();
  let executed = 0;
  let skipped = 0;
  let printedScans = 0;
  let printedHits = 0;

  // Shared diary memory layer for the swarm (in-memory for high concurrency)
  const diary = new AgentDiary({
    agentId: "security-swarm",
    storage: new MemoryStorage(),
  });

  // Spawn all agents concurrently — each tries to scan every repo
  await Promise.all(
    Array.from({ length: AGENT_COUNT }, (_, i) => `agent-${i}`).flatMap(agentId =>
      REPOS.map(async repo => {
        const taskId = `security-scan:${repo}`;

        const previousResult = await diary.getTaskResult(taskId);
        if (previousResult) {
          skipped++;
          if (printedHits < 3) {
            printedHits++;
            console.log(`  [${agentId.padEnd(9)}]  ↩  Cache hit: ${repo}`);
          }
          return JSON.parse(previousResult);
        }

        const result = await diary.executeOnce(taskId, async () => {
          executed++;
          if (printedScans < 5) {
            printedScans++;
            console.log(`  [${agentId.padEnd(9)}]  ✓  Scanning ${repo}...`);
          }
          return await scanRepo(repo);
        });

        return result;
      })
    )
  );
  if (skipped > printedHits) {
    console.log(`  ... and ${skipped - printedHits} more duplicate calls intercepted and served from cache instantly.`);
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const savedCalls = AGENT_COUNT * REPOS.length - executed;
  const estimatedSavings = (savedCalls * 0.015).toFixed(2); // ~$0.015/LLM call

  console.log();
  console.log("━".repeat(60));
  console.log(`  ✔ Repos scanned (unique):   ${executed}`);
  console.log(`  ✔ Duplicate calls stopped:  ${savedCalls}`);
  console.log(`  ✔ Wall time:                ${elapsed}s`);
  console.log(`  ✔ Simulated cost saved:     $${estimatedSavings}`);
  console.log("━".repeat(60));
}

main().catch(console.error);
