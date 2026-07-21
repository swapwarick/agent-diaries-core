import { describe, it, expect, beforeEach, vi } from "vitest";
import { ToolExecutor } from "../../../src/tools/ToolExecutor";
import { Tool, ToolContext, ToolResult } from "../../../src/tools/contracts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTool(opts: {
  name?: string;
  permissions?: string[];
  executeImpl?: (input: unknown, ctx: ToolContext) => Promise<ToolResult>;
  validateImpl?: (input: unknown) => { valid: boolean; errors?: string[] };
}): Tool {
  const defaultExec = async (_i: unknown, _c: ToolContext): Promise<ToolResult> =>
    ({ success: true, data: "ok", durationMs: 5 });

  return {
    metadata: {
      name: opts.name ?? "TestTool",
      version: "1.0.0",
      description: "Test",
      capabilities: ["test:run"],
      permissions: (opts.permissions as any) ?? ["network:http"],
    },
    execute: opts.executeImpl ?? defaultExec,
    validate: opts.validateImpl,
  };
}

const ctx: ToolContext = { timeout: 5000 };

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ToolExecutor", () => {
  let executor: ToolExecutor;

  beforeEach(() => {
    executor = new ToolExecutor();
  });

  // ── Success path ──────────────────────────────────────────────────────────

  it("returns a successful ToolResult on happy path", async () => {
    const tool = makeTool({});
    const result = await executor.run(tool, {}, ctx);
    expect(result.success).toBe(true);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("populates durationMs with measured time", async () => {
    const tool = makeTool({
      executeImpl: async (_i, _c) => {
        await new Promise((r) => setTimeout(r, 50));
        return { success: true, durationMs: 0 };
      },
    });
    const result = await executor.run(tool, {}, ctx);
    expect(result.durationMs).toBeGreaterThanOrEqual(40);
  });

  // ── Permission enforcement ────────────────────────────────────────────────

  it("blocks execution when grantedPermissions does not cover tool permissions", async () => {
    const tool = makeTool({ permissions: ["shell:exec"] });
    const result = await executor.run(tool, {}, ctx, {
      grantedPermissions: ["network:http"],
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("Permission denied");
    expect(result.error).toContain("shell:exec");
  });

  it("allows execution when grantedPermissions covers all required permissions", async () => {
    const tool = makeTool({ permissions: ["network:http"] });
    const result = await executor.run(tool, {}, ctx, {
      grantedPermissions: ["network:http", "network:https"],
    });
    expect(result.success).toBe(true);
  });

  it("skips permission check when grantedPermissions is undefined", async () => {
    const tool = makeTool({ permissions: ["shell:exec"] });
    const result = await executor.run(tool, {}, ctx, {
      grantedPermissions: undefined,
    });
    expect(result.success).toBe(true);
  });

  // ── Input validation ─────────────────────────────────────────────────────

  it("blocks execution when validate() returns invalid", async () => {
    const tool = makeTool({
      validateImpl: () => ({ valid: false, errors: ["url is required"] }),
    });
    const result = await executor.run(tool, {}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toContain("url is required");
  });

  it("proceeds when validate() returns valid", async () => {
    const tool = makeTool({
      validateImpl: () => ({ valid: true }),
    });
    const result = await executor.run(tool, {}, ctx);
    expect(result.success).toBe(true);
  });

  // ── Retry logic ───────────────────────────────────────────────────────────

  it("retries on failure up to maxRetries and returns last error", async () => {
    let calls = 0;
    const tool = makeTool({
      executeImpl: async () => {
        calls++;
        throw new Error("transient failure");
      },
    });
    const result = await executor.run(tool, {}, ctx, {
      maxRetries: 2,
      retryDelayMs: 10,
    });
    expect(result.success).toBe(false);
    expect(calls).toBe(3); // initial + 2 retries
    expect(result.error).toContain("3 attempt(s)");
  });

  it("succeeds on retry if tool eventually succeeds", async () => {
    let calls = 0;
    const tool = makeTool({
      executeImpl: async () => {
        calls++;
        if (calls < 3) throw new Error("not yet");
        return { success: true, durationMs: 0 };
      },
    });
    const result = await executor.run(tool, {}, ctx, {
      maxRetries: 3,
      retryDelayMs: 10,
    });
    expect(result.success).toBe(true);
    expect(calls).toBe(3);
  });

  // ── Cancellation ─────────────────────────────────────────────────────────

  it("cancels execution when caller AbortSignal is already aborted", async () => {
    const abortCtrl = new AbortController();
    abortCtrl.abort();

    // Tool that honours the signal — agents must propagate signal to I/O
    const tool = makeTool({
      executeImpl: async (_i: unknown, toolCtx: ToolContext): Promise<ToolResult> => {
        if (toolCtx.signal?.aborted) {
          const err = new Error("AbortError");
          err.name = "AbortError";
          throw err;
        }
        return { success: true, durationMs: 0 };
      },
    });

    const result = await executor.run(tool, {}, { ...ctx, signal: abortCtrl.signal });
    expect(result.success).toBe(false);
    expect(result.error).toContain("cancelled");
  });

  it("times out when tool exceeds the configured timeout", async () => {
    const tool = makeTool({
      executeImpl: async (_i, ctx2) => {
        await new Promise<void>((_, reject) => {
          const timer = setTimeout(() => reject(new Error("timed out internally")), 2000);
          ctx2.signal?.addEventListener("abort", () => {
            clearTimeout(timer);
            const err = new Error("AbortError");
            err.name = "AbortError";
            reject(err);
          });
        });
        return { success: true, durationMs: 0 };
      },
    });

    const result = await executor.run(tool, {}, { timeout: 100 });
    expect(result.success).toBe(false);
    expect(result.error).toContain("cancelled");
  });
});
