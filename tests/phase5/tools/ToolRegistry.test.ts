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
    name: overrides.name,
    version: overrides.version ?? "1.0.0",
    description: overrides.description ?? "Test tool",
    capabilities: overrides.capabilities ?? ["test:run"],
    permissions: overrides.permissions ?? ["network:http"],
    ...overrides,
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

  // ── Registration ───────────────────────────────────────────────────────────

  it("registers a tool and retrieves it by name", () => {
    const tool = makeTool({ name: "HttpTool" });
    registry.register(tool);
    expect(registry.get("HttpTool")).toBe(tool);
  });

  it("throws when registering a tool with no name", () => {
    const badTool = { metadata: { name: "" } } as unknown as Tool;
    expect(() => registry.register(badTool)).toThrow(/valid metadata.name/);
  });

  it("overwrites an existing tool with a warning", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const t1 = makeTool({ name: "HttpTool", version: "1.0.0" });
    const t2 = makeTool({ name: "HttpTool", version: "2.0.0" });
    registry.register(t1);
    registry.register(t2);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("HttpTool"));
    expect(registry.get("HttpTool")).toBe(t2);
    warnSpy.mockRestore();
  });

  it("unregisters a tool by name", () => {
    registry.register(makeTool({ name: "HttpTool" }));
    expect(registry.unregister("HttpTool")).toBe(true);
    expect(registry.get("HttpTool")).toBeUndefined();
  });

  it("returns false when unregistering a non-existent tool", () => {
    expect(registry.unregister("NonExistent")).toBe(false);
  });

  // ── Discovery ─────────────────────────────────────────────────────────────

  it("finds tools by capability label", () => {
    const http = makeTool({ name: "HttpTool", capabilities: ["http:get", "http:post"] });
    const fs = makeTool({ name: "FsTool", capabilities: ["filesystem:read"] });
    registry.register(http);
    registry.register(fs);
    const found = registry.find("http:get");
    expect(found).toHaveLength(1);
    expect(found[0].metadata.name).toBe("HttpTool");
  });

  it("returns empty array when no tools match a capability", () => {
    registry.register(makeTool({ name: "HttpTool", capabilities: ["http:get"] }));
    expect(registry.find("docker:run")).toHaveLength(0);
  });

  it("returns multiple tools that share the same capability", () => {
    registry.register(makeTool({ name: "TavilyTool", capabilities: ["search"] }));
    registry.register(makeTool({ name: "TinyFishTool", capabilities: ["search"] }));
    expect(registry.find("search")).toHaveLength(2);
  });

  // ── List ──────────────────────────────────────────────────────────────────

  it("lists metadata for all registered tools", () => {
    registry.register(makeTool({ name: "A" }));
    registry.register(makeTool({ name: "B" }));
    const list = registry.list();
    expect(list.map((m) => m.name)).toEqual(expect.arrayContaining(["A", "B"]));
  });

  // ── Size ─────────────────────────────────────────────────────────────────

  it("tracks registry size correctly", () => {
    expect(registry.size).toBe(0);
    registry.register(makeTool({ name: "A" }));
    expect(registry.size).toBe(1);
    registry.unregister("A");
    expect(registry.size).toBe(0);
  });

  // ── Permissions ──────────────────────────────────────────────────────────

  it("reports correct permission presence", () => {
    registry.register(
      makeTool({ name: "HttpTool", permissions: ["network:http", "network:https"] }),
    );
    expect(registry.hasPermission("HttpTool", "network:http")).toBe(true);
    expect(registry.hasPermission("HttpTool", "shell:exec")).toBe(false);
  });

  it("returns false for permission check on unknown tool", () => {
    expect(registry.hasPermission("Ghost", "network:http")).toBe(false);
  });

  // ── Scoped view ──────────────────────────────────────────────────────────

  it("creates a scoped registry with only allowed tools", () => {
    registry.register(makeTool({ name: "A" }));
    registry.register(makeTool({ name: "B" }));
    registry.register(makeTool({ name: "C" }));
    const scoped = registry.scoped(new Set(["A", "C"]));
    expect(scoped.size).toBe(2);
    expect(scoped.get("A")).toBeDefined();
    expect(scoped.get("B")).toBeUndefined();
    expect(scoped.get("C")).toBeDefined();
  });

  // ── Health check ─────────────────────────────────────────────────────────

  it("reports healthy for tools without healthCheck", async () => {
    registry.register(makeTool({ name: "NoHealth" }));
    const results = await registry.healthCheck();
    expect(results[0]).toEqual({ name: "NoHealth", healthy: true });
  });

  it("runs healthCheck on tools that implement it", async () => {
    const tool = makeTool({ name: "Checked" });
    (tool as any).healthCheck = async () => ({ healthy: false, message: "Unreachable" });
    registry.register(tool);
    const results = await registry.healthCheck();
    expect(results[0]).toMatchObject({ healthy: false, message: "Unreachable" });
  });

  it("reports unhealthy if healthCheck throws", async () => {
    const tool = makeTool({ name: "Explosive" });
    (tool as any).healthCheck = async () => {
      throw new Error("connection refused");
    };
    registry.register(tool);
    const results = await registry.healthCheck();
    expect(results[0].healthy).toBe(false);
    expect(results[0].message).toContain("connection refused");
  });
});
