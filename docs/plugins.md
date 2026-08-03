# Plugin Framework (`PluginRegistry`)

`@agent-diaries/core` includes a modular plugin framework that allows developers to extend the runtime with custom storage backends, search adapters, telemetry sinks, and middleware hooks.

---

## Overview

Plugins encapsulate lifecycle hooks and providers into reusable modules. Packages like `@agent-diaries/redis` and `@agent-diaries/postgres` use this plugin interface under the hood.

### Plugin Capabilities

- 🔌 Register custom `CacheProvider`, `LockProvider`, or `PersistenceProvider`.
- 📡 Attach event listeners to the global `EventBus`.
- 🛠️ Inject custom metrics collectors or search indexers.

---

## Creating & Registering a Custom Plugin

```typescript
import {
  PluginRegistry,
  AgentDiaryPlugin,
  StorageManager,
} from "@agent-diaries/core";

// 1. Define custom plugin
const myCustomPlugin: AgentDiaryPlugin = {
  name: "custom-logger-plugin",
  version: "1.0.0",
  init(context) {
    console.log(`[Plugin] Initialized: ${this.name} v${this.version}`);
    
    // Subscribe to EventBus domain events
    context.eventBus.on("DiaryUpdated", (event) => {
      console.log(`[Plugin Log] Diary updated for agent: ${event.agentId}`);
    });
  },
};

// 2. Register plugin with PluginRegistry
const registry = new PluginRegistry();
registry.register(myCustomPlugin);

// 3. Initialize registered plugins
const storageManager = new StorageManager();
registry.initAll({ storageManager });
```

---

## Distributed Storage Plugins

Out-of-the-box storage plugins provided by core packages:

| Storage Plugin | Source Package | Features |
|---|---|---|
| `MemoryPlugin` | `@agent-diaries/memory` | In-memory Promise-queue mutex & Local file storage |
| `RedisPlugin` | `@agent-diaries/redis` | Distributed Redis locks (`SET NX`) & shared caching |
| `PostgresPlugin` | `@agent-diaries/postgres` | Durable SQL storage, advisory locks, schema migrations |
