import {
  Agent,
  AgentMetadata,
  AgentCategory,
  AgentCapability,
  HealthStatus,
} from "./contracts";

/**
 * Result of a full {@link AgentRegistry} health sweep.
 */
export interface AgentHealthReport {
  agentId: string;
  healthy: boolean;
  message?: string;
  lastChecked: number;
}

/**
 * Filter options for {@link AgentRegistry.list}.
 */
export interface AgentListOptions {
  category?: AgentCategory;
  capability?: string;
  tags?: string[];
}

/**
 * Central registry for all agents available in the Agent Diaries runtime.
 *
 * Agents are registered by their {@link AgentMetadata.id} and can be
 * discovered by category or capability label. {@link CapabilityRouter}
 * uses this registry to resolve the best agent for a given workflow step.
 *
 * @example
 * ```typescript
 * const registry = new AgentRegistry();
 * registry.register(new SummarizationAgent());
 * registry.register(new ClassificationAgent());
 *
 * const candidates = registry.findByCapability("summarize");
 * ```
 */
export class AgentRegistry {
  private agents = new Map<string, Agent>();

  // ---------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------

  /**
   * Registers an agent under its {@link AgentMetadata.id}.
   * Overwrites an existing agent with the same ID with a warning.
   *
   * @param agent - Any object implementing the {@link Agent} interface.
   * @throws If the agent has no valid `metadata.id`.
   */
  register<T extends Agent>(agent: T): void {
    if (!agent.metadata?.id) {
      throw new Error("[AgentRegistry] Agent must have a valid metadata.id.");
    }
    if (this.agents.has(agent.metadata.id)) {
      console.warn(
        `[AgentRegistry] Agent "${agent.metadata.id}" is already registered. Overwriting.`,
      );
    }
    this.agents.set(agent.metadata.id, agent);
  }

  /**
   * Removes an agent from the registry by ID.
   *
   * @param agentId - Agent ID to remove.
   * @returns `true` if found and removed, `false` otherwise.
   */
  unregister(agentId: string): boolean {
    return this.agents.delete(agentId);
  }

  // ---------------------------------------------------------------------------
  // Lookup
  // ---------------------------------------------------------------------------

  /**
   * Retrieves a registered agent by ID.
   *
   * @param agentId - Agent ID to look up.
   * @returns The {@link Agent} instance or `undefined` if not found.
   */
  get(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Finds all agents that expose a given capability label.
   *
   * @param capability - Capability name to match (e.g. `"summarize"`).
   * @returns Array of matching agents, possibly empty.
   */
  findByCapability(capability: string): Agent[] {
    const results: Agent[] = [];
    for (const agent of this.agents.values()) {
      const has = agent.metadata.capabilities.some(
        (c: AgentCapability) => c.name === capability,
      );
      if (has) results.push(agent);
    }
    return results;
  }

  /**
   * Finds all agents in a given category.
   *
   * @param category - {@link AgentCategory} to filter by.
   * @returns Array of matching agents.
   */
  findByCategory(category: AgentCategory): Agent[] {
    return Array.from(this.agents.values()).filter(
      (a) => a.metadata.category === category,
    );
  }

  /**
   * Lists agent metadata with optional filtering.
   *
   * @param options - Optional filter by category, capability, or tags.
   * @returns Array of {@link AgentMetadata} objects.
   */
  list(options?: AgentListOptions): AgentMetadata[] {
    let agents = Array.from(this.agents.values());

    if (options?.category) {
      agents = agents.filter((a) => a.metadata.category === options.category);
    }

    if (options?.capability) {
      const cap = options.capability;
      agents = agents.filter((a) =>
        a.metadata.capabilities.some((c: AgentCapability) => c.name === cap),
      );
    }

    if (options?.tags && options.tags.length > 0) {
      const required = options.tags;
      agents = agents.filter(
        (a) =>
          a.metadata.tags &&
          required.every((t) => a.metadata.tags!.includes(t)),
      );
    }

    return agents.map((a) => ({ ...a.metadata }));
  }

  // ---------------------------------------------------------------------------
  // Health
  // ---------------------------------------------------------------------------

  /**
   * Runs `healthCheck()` on every registered agent.
   * Agents that do not throw are reported with a `healthy: true` default.
   *
   * @returns Array of {@link AgentHealthReport} results.
   */
  async healthCheck(): Promise<AgentHealthReport[]> {
    const reports: AgentHealthReport[] = [];
    const now = Date.now();

    for (const agent of this.agents.values()) {
      try {
        const status: HealthStatus = await agent.healthCheck();
        reports.push({
          agentId: agent.metadata.id,
          healthy: status.healthy,
          message: status.message,
          lastChecked: status.lastChecked ?? now,
        });
      } catch (err: any) {
        reports.push({
          agentId: agent.metadata.id,
          healthy: false,
          message: err?.message || "healthCheck threw an error",
          lastChecked: now,
        });
      }
    }

    return reports;
  }

  /**
   * Returns aggregate statistics about the registered agents.
   */
  statistics(): {
    total: number;
    byCategory: Record<string, number>;
    capabilities: string[];
  } {
    const byCategory: Record<string, number> = {};
    const capSet = new Set<string>();

    for (const agent of this.agents.values()) {
      const cat = agent.metadata.category;
      byCategory[cat] = (byCategory[cat] ?? 0) + 1;
      agent.metadata.capabilities.forEach((c: AgentCapability) =>
        capSet.add(c.name),
      );
    }

    return {
      total: this.agents.size,
      byCategory,
      capabilities: Array.from(capSet).sort(),
    };
  }

  /**
   * Returns the number of agents currently registered.
   */
  get size(): number {
    return this.agents.size;
  }
}

/** Shared default agent registry singleton. */
export const defaultAgentRegistry = new AgentRegistry();
