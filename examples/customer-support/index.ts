/**
 * Customer Support Deduplication
 * ────────────────────────────────
 * When 50 agents process a ticket queue, identical tickets
 * get analyzed exactly once. All others return from cache.
 * Run: npx tsx index.ts
 */

import { AgentDiary } from "@agent-diaries/core";

interface SupportTicket {
  id: string;
  message: string;
  category: string;
}

// Simulate a ticket queue with duplicates (common in real support systems)
const TICKET_QUEUE: SupportTicket[] = [
  { id: "t-001", message: "Can't login to my account", category: "auth" },
  { id: "t-002", message: "Payment failed on checkout", category: "billing" },
  { id: "t-003", message: "Can't login to my account", category: "auth" }, // duplicate
  { id: "t-004", message: "App crashes on startup", category: "technical" },
  { id: "t-005", message: "Payment failed on checkout", category: "billing" }, // duplicate
  { id: "t-006", message: "How do I export my data?", category: "feature" },
  { id: "t-007", message: "Can't login to my account", category: "auth" }, // duplicate
  { id: "t-008", message: "Invoice missing from dashboard", category: "billing" },
  { id: "t-009", message: "App crashes on startup", category: "technical" }, // duplicate
  { id: "t-010", message: "How do I export my data?", category: "feature" }, // duplicate
];

async function analyzeTicket(ticket: SupportTicket): Promise<string> {
  // Replace with: await llm.complete(`Suggest resolution for: ${ticket.message}`)
  await new Promise(r => setTimeout(r, 100));
  const resolutions: Record<string, string> = {
    auth: "Reset password via /account/reset. If persists, clear browser cache.",
    billing: "Check payment method in billing settings. Retry or use different card.",
    technical: "Uninstall and reinstall the latest version from our downloads page.",
    feature: "Go to Settings → Export → Download CSV. Full guide at docs.example.com/export",
  };
  return resolutions[ticket.category] ?? "Please contact support@example.com";
}

async function main() {
  console.log("Processing support ticket queue with 10 agents...\n");
  const diary = new AgentDiary({ agentId: "support-agent" });
  let analyzed = 0;
  let deduplicated = 0;

  // Process all tickets with 10 concurrent agents
  await Promise.all(
    Array.from({ length: 10 }, () =>
      TICKET_QUEUE.map(async ticket => {
        // Use category+message as the dedup key (same issue = same resolution)
        const taskId = `support:${ticket.category}:${ticket.message.toLowerCase().trim()}`;

        const resolution = await diary.executeOnce(taskId, async () => {
          analyzed++;
          console.log(`  ✓ Analyzing [${ticket.category}]: "${ticket.message}"`);
          return analyzeTicket(ticket);
        });

        if (resolution !== undefined) {
          deduplicated++;
        }
        return { ticket, resolution };
      })
    ).flat()
  );

  console.log(`\n✔ Unique issues analyzed: ${analyzed}`);
  console.log(`✔ Duplicate tickets deduplicated: ${TICKET_QUEUE.length * 10 - analyzed}`);
  console.log(`✔ Cost savings: ~${Math.round((1 - analyzed / (TICKET_QUEUE.length * 10)) * 100)}%`);
}

main().catch(console.error);
