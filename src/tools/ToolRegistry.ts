import { Tool, ToolMetadata, ToolPermission, ToolHealthStatus } from "./contracts";

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
   * Registers a tool under its {@link ToolMetadata.name}.
   * Overwrites a previously registered tool with the same name with a warning.
   *
   * @param tool - Any object implementing the {@link Tool} interface.
   */
  register<T extends Tool>(tool: T): void {
    if (!tool.metadata?.name) {
      throw new Error("[ToolRegistry] Tool must have a valid metadata.name.");
    }
    if (this.tools.has(tool.metadata.name)) {
      console.warn(
        `[ToolRegistry] Tool "${tool.metadata.name}" is already registered. Overwriting.`,
      );
    }
    this.tools.set(tool.metadata.name, tool);
  }

  /**
   * Removes a tool from the registry by name.
   *
   * @param name - Tool name to remove.
   * @returns `true` if the tool was found and removed, `false` otherwise.
   */
  unregister(name: string): boolean {
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
   * Tools that do not implement `healthCheck` are reported as healthy by default.
   *
   * @returns Array of {@link ToolHealthStatus} results.
   */
  async healthCheck(): Promise<ToolHealthStatus[]> {
    const results: ToolHealthStatus[] = [];

    for (const tool of this.tools.values()) {
      if (tool.healthCheck) {
        try {
          const status = await tool.healthCheck();
          results.push({
            name: tool.metadata.name,
            healthy: status.healthy,
            message: status.message,
          });
        } catch (err: any) {
          results.push({
            name: tool.metadata.name,
            healthy: false,
            message: err?.message || "healthCheck threw an error",
          });
        }
      } else {
        results.push({ name: tool.metadata.name, healthy: true });
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
