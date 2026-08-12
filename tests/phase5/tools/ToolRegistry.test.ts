import { describe, it, expect, beforeEach, vi } from "vitest";
import { ToolRegistry } from "../../../src/tools/ToolRegistry";
import { Tool, ToolMetadata, ToolContext, ToolResult } from "../../../src/tools/contracts";

// ---------------------------------------------------------------------------
// Minimal tool stub for testing
// ---------------------------------------------------------------------------

function makeTool(
  overrides: Partial<ToolMetadata> & { name: string },
  execResult?: Partial<ToolResult>,
): Tool {
  const meta: ToolMetadata = {
    ...overrides,
    name: overrides.name,
    version: overrides.version ?? "1.0.0",
    description: overrides.description ?? "Test tool",
    capabilities: overrides.capabilities ?? ["test:run"],
    permissions: overrides.permissions ?? ["network:http"],
  };

  return {
    metadata: meta,
    async execute(_input: unknown, _ctx: ToolContext): Promise<ToolResult> {
      return {
        success: execResult?.success ?? true,
        data: execResult?.data ?? { ok: true },
        durationMs: execResult?.durationMs ?? 10,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ToolRegistry", () => {
  let registry: ToolRegistry;

  beforeEach(() => {
    registry = new ToolRegistry();
  });

  // ── Registration ─────────────────────────────────────────────────────────

  it("registers a tool and retrieves it by name", async () => {
    const tool = makeTool({ name: "HttpTool" });
    await registry.register(tool);
    expect(registry.get("HttpTool")).toBe(tool);
  });

  it("throws when registering a tool with no name", async () => {
    const badTool = { metadata: { name: "" } } as unknown as Tool;
    await expect(registry.register(badTool)).rejects.toThrow(/valid metadata.name/);
  });

  it("overwrites an existing tool with a warning", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t1 = makeTool({ name: "HttpTool", version: "1.0.0" });
    const t2 = makeTool({ name: "HttpTool", version: "2.0.0" });
    await registry.register(t1);
    await registry.register(t2);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("HttpTool"));
    expect(registry.get("HttpTool")).toBe(t2);
    warnSpy.mockRestore();
  });

  it("unregisters a tool by name", async () => {
    await registry.register(makeTool({ name: "HttpTool" }));
    expect(await registry.unregister("HttpTool")).toBe(true);
    expect(registry.get("HttpTool")).toBeUndefined();
  });

  it("returns false when unregistering a non-existent tool", async () => {
    expect(await registry.unregister("NonExistent")).toBe(false);
  });

  // ── Discovery (capability) ───────────────────────────────────────────────

  it("finds tools by capability label", async () => {
    const http = makeTool({ name: "HttpTool", capabilities: ["http:get", "http:post"] });
    const fs = makeTool({ name: "FsTool", capabilities: ["filesystem:read"] });
    await registry.register(http);
    await registry.register(fs);
    const found = registry.find("http:get");
    expect(found).toHaveLength(1);
    expect(found[0].metadata.name).toBe("HttpTool");
  });

  it("returns empty array when no tools match a capability", async () => {
    await registry.register(makeTool({ name: "HttpTool", capabilities: ["http:get"] }));
    expect(registry.find("docker:run")).toHaveLength(0);
  });

  it("returns multiple tools that share the same capability", async () => {
    await registry.register(makeTool({ name: "TavilyTool", capabilities: ["search"] }));
    await registry.register(makeTool({ name: "TinyFishTool", capabilities: ["search"] }));
    expect(registry.find("search")).toHaveLength(2);
  });

  // ── Discovery (Phase 5) ──────────────────────────────────────────────────

  it("findByCategory returns tools in a specific category", async () => {
    await registry.register(makeTool({ name: "A", capabilities: ["a"], permissions: [], category: "networking" }));
    await registry.register(makeTool({ name: "B", capabilities: ["b"], permissions: [], category: "ai" }));
    await registry.register(makeTool({ name: "C", capabilities: ["c"], permissions: [], category: "networking" }));
    const networking = registry.findByCategory("networking");
    expect(networking.map((t) => t.metadata.name).sort()).toEqual(["A", "C"]);
  });

  it("findByTag returns tools with all specified tags", async () => {
    await registry.register(makeTool({ name: "Multi", capabilities: [], permissions: [], tags: ["prod", "stable"] }));
    await registry.register(makeTool({ name: "Partial", capabilities: [], permissions: [], tags: ["prod"] }));
    expect(registry.findByTag("prod", "stable")).toHaveLength(1);
    expect(registry.findByTag("prod")).toHaveLength(2);
  });

  it("findByPermission returns tools that declare a permission", async () => {
    await registry.register(makeTool({ name: "Writer", capabilities: [], permissions: ["filesystem:write"] }));
    await registry.register(makeTool({ name: "Reader", capabilities: [], permissions: ["filesystem:read"] }));
    expect(registry.findByPermission("filesystem:write").map((t) => t.metadata.name)).toEqual(["Writer"]);
  });

  it("findCompatible returns tools with matching caps and granted perms", async () => {
    await registry.register(makeTool({ name: "Safe", capabilities: ["http:get"], permissions: ["network:http"] }));
    await registry.register(makeTool({ name: "Risky", capabilities: ["http:get"], permissions: ["shell:exec"] }));
    const compat = registry.findCompatible(["http:get"], ["network:http"]);
    expect(compat.map((t) => t.metadata.name)).toEqual(["Safe"]);
  });

  it("recommend returns the lowest-latency healthy tool", async () => {
    await registry.register(makeTool({ name: "Slow", capabilities: ["fetch"], permissions: [], estimatedLatencyMs: 500 }));
    await registry.register(makeTool({ name: "Fast", capabilities: ["fetch"], permissions: [], estimatedLatencyMs: 50 }));
    const best = registry.recommend("fetch");
    expect(best?.metadata.name).toBe("Fast");
  });

  it("recommend returns undefined when no healthy tool exists for capability", async () => {
    await registry.register(makeTool({ name: "Down", capabilities: ["fetch"], permissions: [], healthState: "unavailable" }));
    expect(registry.recommend("fetch")).toBeUndefined();
  });

  // ── List ─────────────────────────────────────────────────────────────────

  it("lists metadata for all registered tools", async () => {
    await registry.register(makeTool({ name: "A" }));
    await registry.register(makeTool({ name: "B" }));
    const list = registry.list();
    expect(list.map((m) => m.name)).toEqual(expect.arrayContaining(["A", "B"]));
  });

  // ── Size ─────────────────────────────────────────────────────────────────

  it("tracks registry size correctly", async () => {
    expect(registry.size).toBe(0);
    await registry.register(makeTool({ name: "A" }));
    expect(registry.size).toBe(1);
    await registry.unregister("A");
    expect(registry.size).toBe(0);
  });

  // ── Permissions ──────────────────────────────────────────────────────────

  it("reports correct permission presence", async () => {
    await registry.register(
      makeTool({ name: "HttpTool", permissions: ["network:http", "network:https"] }),
    );
    expect(registry.hasPermission("HttpTool", "network:http")).toBe(true);
    expect(registry.hasPermission("HttpTool", "shell:exec")).toBe(false);
  });

  it("returns false for permission check on unknown tool", () => {
    expect(registry.hasPermission("Ghost", "network:http")).toBe(false);
  });

  // ── Scoped view ──────────────────────────────────────────────────────────

  it("creates a scoped registry with only allowed tools", async () => {
    await registry.register(makeTool({ name: "A" }));
    await registry.register(makeTool({ name: "B" }));
    await registry.register(makeTool({ name: "C" }));
    const scoped = registry.scoped(new Set(["A", "C"]));
    expect(scoped.size).toBe(2);
    expect(scoped.get("A")).toBeDefined();
    expect(scoped.get("B")).toBeUndefined();
    expect(scoped.get("C")).toBeDefined();
  });

  // ── Health check ─────────────────────────────────────────────────────────

  it("reports unknown state for tools without healthCheck", async () => {
    await registry.register(makeTool({ name: "NoHealth" }));
    const results = await registry.healthCheck();
    expect(results[0]).toMatchObject({ name: "NoHealth", healthy: true, state: "unknown" });
  });

  it("runs healthCheck on tools that implement it (legacy shape)", async () => {
    const tool = makeTool({ name: "Checked" });
    (tool as any).healthCheck = async () => ({ healthy: false, message: "Unreachable" });
    await registry.register(tool);
    const results = await registry.healthCheck();
    // Normalized: healthy=false, state="unavailable"
    expect(results[0]).toMatchObject({ healthy: false, state: "unavailable", message: "Unreachable" });
  });

  it("runs healthCheck on tools that implement it (rich shape)", async () => {
    const tool = makeTool({ name: "RichTool" });
    (tool as any).healthCheck = async () => ({
      state: "degraded",
      message: "High latency",
      latencyMs: 2500,
      checkedAt: Date.now(),
    });
    await registry.register(tool);
    const results = await registry.healthCheck();
    expect(results[0]).toMatchObject({ name: "RichTool", state: "degraded", healthy: false });
  });

  it("reports unhealthy if healthCheck throws", async () => {
    const tool = makeTool({ name: "Explosive" });
    (tool as any).healthCheck = async () => {
      throw new Error("connection refused");
    };
    await registry.register(tool);
    const results = await registry.healthCheck();
    expect(results[0].healthy).toBe(false);
    expect(results[0].message).toContain("connection refused");
  });

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  it("calls initialize() on register when autoInit=true", async () => {
    let initialized = false;
    const tool = makeTool({ name: "InitTool" });
    (tool as any).initialize = async () => { initialized = true; };
    await registry.register(tool, true);
    expect(initialized).toBe(true);
  });

  it("does NOT call initialize() on register when autoInit=false (default)", async () => {
    let initialized = false;
    const tool = makeTool({ name: "LazyTool" });
    (tool as any).initialize = async () => { initialized = true; };
    await registry.register(tool); // default autoInit=false
    expect(initialized).toBe(false);
  });

  it("calls cleanup() on unregister", async () => {
    let cleaned = false;
    const tool = makeTool({ name: "CleanTool" });
    (tool as any).cleanup = async () => { cleaned = true; };
    await registry.register(tool);
    await registry.unregister("CleanTool");
    expect(cleaned).toBe(true);
  });

  it("initializeAll initializes all tools with initialize()", async () => {
    const inited: string[] = [];
    const toolA = makeTool({ name: "A" });
    const toolB = makeTool({ name: "B" });
    (toolA as any).initialize = async () => { inited.push("A"); };
    (toolB as any).initialize = async () => { inited.push("B"); };
    await registry.register(toolA);
    await registry.register(toolB);
    await registry.initializeAll();
    expect(inited.sort()).toEqual(["A", "B"]);
  });
});
