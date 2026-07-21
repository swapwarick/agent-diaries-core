import { describe, it, expect, beforeEach, vi } from "vitest";
import { AgentRegistry } from "../../../src/agents/AgentRegistry";
import {
  Agent,
  AgentMetadata,
  AgentCategory,
  AgentResult,
  ValidationResult,
  CostEstimate,
  DurationEstimate,
  HealthStatus,
} from "../../../src/agents/contracts";
import type { AgentContext } from "../../../src/runtime/AgentContext";

// ---------------------------------------------------------------------------
// Stub agent factory
// ---------------------------------------------------------------------------

function makeAgent(opts: {
  id: string;
  category?: AgentCategory;
  capabilities?: string[];
  tags?: string[];
  healthy?: boolean;
}): Agent {
  const meta: AgentMetadata = {
    id: opts.id,
    name: opts.id,
    version: "1.0.0",
    category: opts.category ?? "ai",
    capabilities: (opts.capabilities ?? ["test"]).map((n) => ({ name: n })),
    tags: opts.tags,
  };

  return {
    metadata: meta,
    async execute(_input: unknown, _ctx: AgentContext): Promise<AgentResult> {
      return { success: true, durationMs: 10, agentId: meta.id };
    },
    validate(_input: unknown): ValidationResult {
      return { valid: true };
    },
    estimateCost(_input: unknown): CostEstimate {
      return { apiCalls: 1 };
    },
    estimateDuration(_input: unknown): DurationEstimate {
      return { estimatedMs: 1000, confidence: "medium" };
    },
    async healthCheck(): Promise<HealthStatus> {
      return { healthy: opts.healthy ?? true };
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentRegistry", () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    registry = new AgentRegistry();
  });

  // ── Registration ──────────────────────────────────────────────────────────

  it("registers an agent and retrieves it by ID", () => {
    const agent = makeAgent({ id: "summarizer" });
    registry.register(agent);
    expect(registry.get("summarizer")).toBe(agent);
  });

  it("throws when registering an agent with no ID", () => {
    const bad = { metadata: { id: "" } } as unknown as Agent;
    expect(() => registry.register(bad)).toThrow(/valid metadata.id/);
  });

  it("overwrites an existing agent with a warning", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    registry.register(makeAgent({ id: "agent-a" }));
    registry.register(makeAgent({ id: "agent-a" }));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("agent-a"));
    warn.mockRestore();
  });

  it("unregisters an agent by ID", () => {
    registry.register(makeAgent({ id: "agent-a" }));
    expect(registry.unregister("agent-a")).toBe(true);
    expect(registry.get("agent-a")).toBeUndefined();
  });

  it("returns false when unregistering a non-existent agent", () => {
    expect(registry.unregister("ghost")).toBe(false);
  });

  // ── Capability lookup ─────────────────────────────────────────────────────

  it("finds agents by capability", () => {
    registry.register(makeAgent({ id: "s1", capabilities: ["summarize"] }));
    registry.register(makeAgent({ id: "s2", capabilities: ["summarize", "classify"] }));
    registry.register(makeAgent({ id: "o1", capabilities: ["ocr"] }));

    const found = registry.findByCapability("summarize");
    expect(found.map((a) => a.metadata.id)).toEqual(
      expect.arrayContaining(["s1", "s2"]),
    );
    expect(found).toHaveLength(2);
  });

  it("returns empty array for unknown capability", () => {
    registry.register(makeAgent({ id: "a", capabilities: ["summarize"] }));
    expect(registry.findByCapability("translate")).toHaveLength(0);
  });

  // ── Category lookup ───────────────────────────────────────────────────────

  it("finds agents by category", () => {
    registry.register(makeAgent({ id: "ai-1", category: "ai" }));
    registry.register(makeAgent({ id: "ai-2", category: "ai" }));
    registry.register(makeAgent({ id: "devops-1", category: "devops" }));

    const aiAgents = registry.findByCategory("ai");
    expect(aiAgents).toHaveLength(2);
    const devops = registry.findByCategory("devops");
    expect(devops).toHaveLength(1);
  });

  // ── List with filtering ───────────────────────────────────────────────────

  it("lists all agents without filter", () => {
    registry.register(makeAgent({ id: "a" }));
    registry.register(makeAgent({ id: "b" }));
    expect(registry.list()).toHaveLength(2);
  });

  it("filters list by category", () => {
    registry.register(makeAgent({ id: "a", category: "ai" }));
    registry.register(makeAgent({ id: "b", category: "search" }));
    const filtered = registry.list({ category: "ai" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("a");
  });

  it("filters list by capability", () => {
    registry.register(makeAgent({ id: "a", capabilities: ["ocr"] }));
    registry.register(makeAgent({ id: "b", capabilities: ["summarize"] }));
    const filtered = registry.list({ capability: "ocr" });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("a");
  });

  it("filters list by tags", () => {
    registry.register(makeAgent({ id: "a", tags: ["enterprise", "v2"] }));
    registry.register(makeAgent({ id: "b", tags: ["community"] }));
    const filtered = registry.list({ tags: ["enterprise"] });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].id).toBe("a");
  });

  // ── Size ─────────────────────────────────────────────────────────────────

  it("tracks registry size correctly", () => {
    expect(registry.size).toBe(0);
    registry.register(makeAgent({ id: "a" }));
    registry.register(makeAgent({ id: "b" }));
    expect(registry.size).toBe(2);
    registry.unregister("a");
    expect(registry.size).toBe(1);
  });

  // ── Statistics ───────────────────────────────────────────────────────────

  it("returns correct aggregate statistics", () => {
    registry.register(makeAgent({ id: "a", category: "ai", capabilities: ["summarize"] }));
    registry.register(makeAgent({ id: "b", category: "ai", capabilities: ["classify"] }));
    registry.register(makeAgent({ id: "c", category: "search", capabilities: ["search"] }));

    const stats = registry.statistics();
    expect(stats.total).toBe(3);
    expect(stats.byCategory["ai"]).toBe(2);
    expect(stats.byCategory["search"]).toBe(1);
    expect(stats.capabilities).toEqual(
      expect.arrayContaining(["classify", "search", "summarize"]),
    );
  });

  // ── Health check ─────────────────────────────────────────────────────────

  it("returns healthy reports for healthy agents", async () => {
    registry.register(makeAgent({ id: "a", healthy: true }));
    const reports = await registry.healthCheck();
    expect(reports[0].healthy).toBe(true);
    expect(reports[0].lastChecked).toBeGreaterThan(0);
  });

  it("returns unhealthy report when agent healthCheck returns false", async () => {
    registry.register(makeAgent({ id: "a", healthy: false }));
    const reports = await registry.healthCheck();
    expect(reports[0].healthy).toBe(false);
  });

  it("handles exceptions in healthCheck gracefully", async () => {
    const agent = makeAgent({ id: "explosive" });
    (agent.healthCheck as any) = async () => {
      throw new Error("dependency unreachable");
    };
    registry.register(agent);
    const reports = await registry.healthCheck();
    expect(reports[0].healthy).toBe(false);
    expect(reports[0].message).toContain("dependency unreachable");
  });
});
