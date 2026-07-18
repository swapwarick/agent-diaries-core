import { StorageManager } from "../storage/StorageManager";
import { EventBus } from "../events/EventBus";
import { WorkerRegistry } from "../workers/WorkerRegistry";

export interface PluginContext {
  storageManager: StorageManager;
  eventBus: EventBus;
  workerRegistry: WorkerRegistry;
}

export interface AgentDiariesPlugin {
  name: string;
  version?: string;
  storage?: {
    cache?: any;
    lock?: any;
    persistence?: any;
  };
  searchProviders?: any[];
  metrics?: any;
  tracing?: any;
  scheduler?: any;
  dashboard?: any;
  eventSubscribers?: Array<{
    event: string;
    handler: (payload: any) => void | Promise<void>;
  }>;
  initialize?: (context: PluginContext) => void | Promise<void>;
}

export class PluginRegistry {
  private plugins = new Map<string, AgentDiariesPlugin>();
  private initialized = false;

  public register(plugin: AgentDiariesPlugin): void {
    if (!plugin.name) {
      throw new Error("[PluginRegistry] Plugin must have a valid name.");
    }
    if (this.plugins.has(plugin.name)) {
      console.warn(
        `[PluginRegistry] Plugin "${plugin.name}" is already registered. Overwriting.`,
      );
    }
    this.plugins.set(plugin.name, plugin);
  }

  public getPlugin(name: string): AgentDiariesPlugin | undefined {
    return this.plugins.get(name);
  }

  public listPlugins(): AgentDiariesPlugin[] {
    return Array.from(this.plugins.values());
  }

  public async initializeAll(context: PluginContext): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.storage?.cache) {
        context.storageManager.setCache(plugin.storage.cache);
      }
      if (plugin.storage?.lock) {
        context.storageManager.setLock(plugin.storage.lock);
      }
      if (plugin.storage?.persistence) {
        context.storageManager.setPersistence(plugin.storage.persistence);
      }
      if (plugin.eventSubscribers) {
        for (const sub of plugin.eventSubscribers) {
          context.eventBus.on(sub.event as any, sub.handler);
        }
      }
      if (plugin.initialize) {
        await plugin.initialize(context);
      }
    }
    this.initialized = true;
  }

  public isInitialized(): boolean {
    return this.initialized;
  }
}

export const defaultPluginRegistry = new PluginRegistry();
