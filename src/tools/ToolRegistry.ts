import {
  Tool,
  ToolMetadata,
  ToolPermission,
  ToolHealthStatus,
  ToolCategory,
  AnyHealthCheckResult,
  normalizeHealthCheckResult,
} from "./contracts";

/**
 * Central registry for all tools available in the Agent Diaries runtime.
 *
 * Tools are registered by name and can be discovered by capability label.
 * {@link AgentContext} exposes a permission-scoped view of this registry
 * so agents only access the tools they declared in {@link AgentMetadata.requiredTools}.
 *
 * @example
 * ```typescript
 * const registry = new ToolRegistry();
 * registry.register(new HttpTool());
 * registry.register(new FilesystemTool());
 *
 * const httpTools = registry.find("http:get");
 * ```
 */
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

/**
   * Options controlling a single {@link ToolRegistry.register} call.
   */
  // (No options needed yet; reserved for future autoInit flag.)

  /**
   * Registers a tool under its {@link ToolMetadata.name}.
   * Overwrites a previously registered tool with the same name with a warning.
   *
   * @param tool     - Any object implementing the {@link Tool} interface.
   * @param autoInit - When `true`, calls `tool.initialize()` before storing.
   *                   Use this when you want eager initialization at registration
   *                   time. Defaults to `false`; {@link ExecutionEnvironment.warmup}
   *                   is the recommended place to call `initialize()`.
   */
  async register<T extends Tool>(tool: T, autoInit = false): Promise<void> {
    if (!tool.metadata?.name) {
      throw new Error("[ToolRegistry] Tool must have a valid metadata.name.");
    }
    if (this.tools.has(tool.metadata.name)) {
      console.warn(
        `[ToolRegistry] Tool "${tool.metadata.name}" is already registered. Overwriting.`,
      );
    }
    if (autoInit && tool.initialize) {
      await tool.initialize();
    }
    this.tools.set(tool.metadata.name, tool);
  }

  /**
   * Removes a tool from the registry by name.
   * Calls `tool.cleanup()` if the tool implements it.
   *
   * @param name - Tool name to remove.
   * @returns `true` if the tool was found and removed, `false` otherwise.
   */
  async unregister(name: string): Promise<boolean> {
    const tool = this.tools.get(name);
    if (!tool) return false;
    if (tool.cleanup) {
      try {
        await tool.cleanup();
      } catch (err: any) {
        console.warn(`[ToolRegistry] cleanup() failed for "${name}": ${err?.message}`);
      }
    }
    return this.tools.delete(name);
  }

  // ---------------------------------------------------------------------------
  // Lookup
  // ---------------------------------------------------------------------------

  /**
   * Retrieves a tool by its exact name.
   *
   * @param name - Tool name to look up.
   * @returns The registered {@link Tool} or `undefined` if not found.
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Finds all tools that expose a given capability label.
   *
   * @param capability - Capability string to match (e.g. `"http:get"`).
   * @returns Array of matching tools, possibly empty.
   */
  find(capability: string): Tool[] {
    const results: Tool[] = [];
    for (const tool of this.tools.values()) {
      if (tool.metadata.capabilities.includes(capability)) {
        results.push(tool);
      }
    }
    return results;
  }

  /**
   * Finds all tools in the given functional category.
   *
   * @param category - {@link ToolCategory} to filter by.
   * @returns Array of matching tools, possibly empty.
   */
  findByCategory(category: ToolCategory): Tool[] {
    return Array.from(this.tools.values()).filter(
      (t) => t.metadata.category === category,
    );
  }

  /**
   * Finds all tools that have ALL of the specified tags.
   *
   * @param tags - One or more tag strings that must all be present.
   * @returns Array of matching tools, possibly empty.
   */
  findByTag(...tags: string[]): Tool[] {
    return Array.from(this.tools.values()).filter((t) => {
      const toolTags = t.metadata.tags ?? [];
      return tags.every((tag) => toolTags.includes(tag));
    });
  }

  /**
   * Finds all tools that declare a given permission.
   *
   * @param permission - Permission scope to search for.
   * @returns Array of matching tools, possibly empty.
   */
  findByPermission(permission: ToolPermission): Tool[] {
    return Array.from(this.tools.values()).filter((t) =>
      t.metadata.permissions.includes(permission),
    );
  }

  /**
   * Finds tools compatible with a set of required capabilities AND an
   * allowlist of granted permissions.
   *
   * A tool is "compatible" when:
   * 1. It exposes at least one of `requiredCapabilities`.
   * 2. All of its declared permissions appear in `grantedPermissions`.
   *
   * @param requiredCapabilities - At least one of these must be present.
   * @param grantedPermissions   - Tool permissions must be a subset of this list.
   * @returns Sorted array (best match first) of compatible tools.
   */
  findCompatible(
    requiredCapabilities: string[],
    grantedPermissions: ToolPermission[],
  ): Tool[] {
    return Array.from(this.tools.values()).filter((t) => {
      const hasCapability = requiredCapabilities.some((cap) =>
        t.metadata.capabilities.includes(cap),
      );
      const permissionsGranted = t.metadata.permissions.every((p) =>
        grantedPermissions.includes(p),
      );
      return hasCapability && permissionsGranted;
    });
  }

  /**
   * Recommends the best tool for a given capability.
   *
   * Selection criteria (in priority order):
   * 1. Tool exposes the requested capability.
   * 2. Health state is `"healthy"` or `"unknown"` (not degraded/unavailable).
   * 3. Lowest `estimatedLatencyMs` (undefined = treated as 0 for ranking).
   *
   * @param capability - Capability label to match.
   * @returns The recommended tool or `undefined` if no candidate exists.
   */
  recommend(capability: string): Tool | undefined {
    const candidates = this.find(capability).filter((t) => {
      const state = t.metadata.healthState;
      return !state || state === "healthy" || state === "unknown";
    });
    if (candidates.length === 0) return undefined;
    candidates.sort(
      (a, b) =>
        (a.metadata.estimatedLatencyMs ?? 0) -
        (b.metadata.estimatedLatencyMs ?? 0),
    );
    return candidates[0];
  }

  /**
   * Returns the metadata of all registered tools.
   *
   * @returns Array of {@link ToolMetadata} objects.
   */
  list(): ToolMetadata[] {
    return Array.from(this.tools.values()).map((t) => ({ ...t.metadata }));
  }

  // ---------------------------------------------------------------------------
  // Health
  // ---------------------------------------------------------------------------

  /**
   * Runs the optional `healthCheck()` on every registered tool.
   * Normalizes both legacy `{ healthy: boolean }` and rich
   * {@link ToolHealthCheckResult} shapes into a uniform {@link ToolHealthStatus}.
   * Also updates `tool.metadata.healthState` in-place.
   *
   * @returns Array of {@link ToolHealthStatus} results.
   */
  async healthCheck(): Promise<ToolHealthStatus[]> {
    const results: ToolHealthStatus[] = [];

    for (const tool of this.tools.values()) {
      if (tool.healthCheck) {
        try {
          const raw: AnyHealthCheckResult = await tool.healthCheck();
          const normalized = normalizeHealthCheckResult(raw);
          // Update metadata.healthState in-place so recommend() can use it
          (tool.metadata as any).healthState = normalized.state;
          results.push({
            name: tool.metadata.name,
            healthy: normalized.state === "healthy",
            ...normalized,
          });
        } catch (err: any) {
          (tool.metadata as any).healthState = "unavailable";
          results.push({
            name: tool.metadata.name,
            healthy: false,
            state: "unavailable",
            message: err?.message || "healthCheck threw an error",
            checkedAt: Date.now(),
          });
        }
      } else {
        results.push({
          name: tool.metadata.name,
          healthy: true,
          state: "unknown",
          checkedAt: Date.now(),
        });
      }
    }

    return results;
  }

  // ---------------------------------------------------------------------------
  // Permissions
  // ---------------------------------------------------------------------------

  /**
   * Checks whether a named tool declares a given permission.
   *
   * @param toolName  - Name of the tool to inspect.
   * @param permission - Permission scope to check for.
   * @returns `true` if the tool declares the permission, `false` otherwise.
   */
  hasPermission(toolName: string, permission: ToolPermission): boolean {
    const tool = this.tools.get(toolName);
    if (!tool) return false;
    return tool.metadata.permissions.includes(permission);
  }

  /**
   * Initializes all registered tools that implement `initialize()`.
   * Called by {@link ExecutionEnvironment.warmup}.
   *
   * @returns Array of tool names that successfully initialized.
   */
  async initializeAll(): Promise<string[]> {
    const initialized: string[] = [];
    for (const tool of this.tools.values()) {
      if (tool.initialize) {
        try {
          await tool.initialize();
          initialized.push(tool.metadata.name);
        } catch (err: any) {
          console.warn(
            `[ToolRegistry] initialize() failed for "${tool.metadata.name}": ${err?.message}`,
          );
        }
      }
    }
    return initialized;
  }

  /**
   * Cleans up all registered tools that implement `cleanup()`.
   * Called by {@link ExecutionEnvironment.shutdown}.
   */
  async cleanupAll(): Promise<void> {
    for (const tool of this.tools.values()) {
      if (tool.cleanup) {
        try {
          await tool.cleanup();
        } catch (err: any) {
          console.warn(
            `[ToolRegistry] cleanup() failed for "${tool.metadata.name}": ${err?.message}`,
          );
        }
      }
    }
  }

  /**
   * Creates a permission-scoped view of this registry.
   * The returned registry only contains tools whose names appear in `allowedNames`.
   *
   * Used by {@link AgentContext} to restrict tool access to what the agent declared.
   *
   * @param allowedNames - Set of permitted tool names.
   * @returns A new `ToolRegistry` containing only the allowed tools.
   */
  scoped(allowedNames: Set<string>): ToolRegistry {
    const scoped = new ToolRegistry();
    for (const [name, tool] of this.tools.entries()) {
      if (allowedNames.has(name)) {
        scoped.tools.set(name, tool);
      }
    }
    return scoped;
  }

  /**
   * Returns the number of tools currently registered.
   */
  get size(): number {
    return this.tools.size;
  }
}

/** Shared default tool registry singleton. */
export const defaultToolRegistry = new ToolRegistry();
