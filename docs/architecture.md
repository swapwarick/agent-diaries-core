# `@agent-diaries/core` Architecture Documentation

## 1. High-Level Architecture Diagram

```
                       ┌─────────────────────────┐
                       │  @agent-diaries/shared  │
                       │  (Types, Enums, Utils)  │
                       └────────────┬────────────┘
                                    │
                                    ▼
                       ┌─────────────────────────┐
                       │   @agent-diaries/core   │
                       │  (Orchestrator, Repos,  │
                       │   Codec, LRU Cache)     │
                       └────────────┬────────────┘
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         │                          │                          │
         ▼                          ▼                          ▼
┌─────────────────┐       ┌──────────────────┐       ┌────────────────────┐
│ @agent-diaries/ │       │  @agent-diaries/ │       │   @agent-diaries/  │
│     memory      │       │      redis       │       │      postgres      │
│ (FIFO Mutex,    │       │ (Distributed     │       │ (SQL Persistence,  │
│  File Storage)  │       │  Locks, Cache)   │       │  Advisory Locks)   │
└─────────────────┘       └──────────────────┘       └────────────────────┘
```

---

## 2. Package & Core Module Responsibilities

| Module / Layer | Primary Responsibility | Key Components |
| :--- | :--- | :--- |
| **`@agent-diaries/shared`** | Pure types, enums, constants, and utilities. | `WorkflowState`, `WorkflowRecord`, `TaskRecord`, `AgentState`, `DomainEvents`, `normalizeSignature`. |
| **`@agent-diaries/core`** | Core orchestration engine, serialization, and storage abstraction. | `WorkflowCoordinator`, `AgentDiary`, `StorageManager`, `LruMemoryProvider`, `codec` (MessagePack), `EventBus`, `TracingService`, `MetricsEngine`, `TimelineService`, `WorkerRegistry`, `PluginRegistry`, `BenchmarkEngine`. |
| **`@agent-diaries/memory`** | In-memory and local file storage providers. | `MemoryCacheProvider`, `MemoryLockProvider` (Chained FIFO Mutex), `MemoryPersistenceProvider`, `LocalFileStorage`, `MemoryStorage`. |
| **`@agent-diaries/redis`** | Distributed Redis caching and distributed locking hooks. | `RedisCacheProvider`, `RedisLockProvider`, `createRedisPlugin`. |
| **`@agent-diaries/postgres`** | Durable PostgreSQL persistence and locking hooks. | `PostgresPersistenceProvider`, `PostgresLockProvider`, SQL migrations (`migrations/001_initial_schema.sql`), `createPostgresPlugin`. |

---

## 3. Storage & Caching Layer (`StorageManager`)

The `StorageManager` orchestrates three decoupled provider interfaces:

```
┌─────────────────────────────────────────────────────────────┐
│                       StorageManager                        │
├─────────────────┬─────────────────────┬─────────────────────┤
│  CacheProvider  │    LockProvider     │ PersistenceProvider │
└────────┬────────┴──────────┬──────────┴──────────┬──────────┘
         │                   │                     │
         ▼                   ▼                     ▼
┌─────────────────┐ ┌─────────────────┐   ┌───────────────────┐
│LruMemoryProvider│ │MemoryLockProvider│  │MemoryPersistence  │
│(L1 Bound Cache) │ │(FIFO Mutex)     │   │   Provider / DB   │
└────────┬────────┘ └─────────────────┘   └───────────────────┘
         │
         ▼
┌─────────────────┐
│ Underlying Cache│
│ (Memory/Redis)  │
└─────────────────┘
```

### Multi-Tiered L1 LRU Caching
* **`LruMemoryProvider`:** Transparent decorator that wraps any underlying `CacheProvider`. It keeps the hottest keys in an in-memory `LRUCache` instance (configurable via `AG_DIARIES_CACHE_SIZE` or default 500 items), eliminating latency spikes on frequently accessed agent context.
* **Bounded Heap Guarantee:** Prevents memory leaks in 24/7 long-running multi-agent swarms.

### Binary Serialization Codec (`codec.ts`)
* High-speed MessagePack encoding (`encode` / `decode`) converts JavaScript objects into compact `Uint8Array` binary payloads, cutting payload sizes by 30–60% over standard JSON strings.

### Concurrency Coordination (`MemoryLockProvider`)
* Built with an event-loop driven **chained-Promise FIFO queue** (`withLock`) that eliminates lock-theft and race conditions even when worker execution exceeds lease timeouts.

---

## 4. Distribution & Bundling Model

* **Single NPM Distribution:** Published as `@agent-diaries/core`.
* **Dual Packaging:** Compiles both CommonJS (`.js`, `.d.ts`) and modern native ESM (`.mjs`, `.d.mts`) bundles via `tsup`.
* **Zero External DB Dependencies:** Works in-memory out of the box with optional peer dependencies for Redis, Postgres, MongoDB, and SQLite.

