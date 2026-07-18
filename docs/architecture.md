# `@agent-diaries/core` Architecture Documentation

## 1. Monorepo Layout Diagram

```
                       ┌─────────────────────────┐
                       │  @agent-diaries/shared  │
                       └────────────┬────────────┘
                                    │
                                    ▼
                       ┌─────────────────────────┐
                       │   @agent-diaries/core   │
                       └────────────┬────────────┘
                                    │
         ┌──────────────────────────┼──────────────────────────┐
         │                          │                          │
         ▼                          ▼                          ▼
┌─────────────────┐       ┌──────────────────┐       ┌────────────────────┐
│ @agent-diaries/ │       │  @agent-diaries/ │       │   @agent-diaries/  │
│     memory      │       │      redis       │       │      postgres      │
└─────────────────┘       └──────────────────┘       └────────────────────┘
```

---

## 2. Package Responsibilities

| Package | Primary Responsibility | Included Modules / Interfaces |
| :--- | :--- | :--- |
| **`@agent-diaries/shared`** | Pure types, enums, constants, and utilities. | `WorkflowState` enum, `WorkflowRecord`, `TaskRecord`, `AgentState`, `DomainEvents`, `normalizeSignature`. |
| **`@agent-diaries/core`** | Core orchestration engine and domain abstractions. | `WorkflowCoordinator`, `WorkflowStateMachine`, `EventBus`, `WorkerRegistry`, `PluginRegistry`, `StorageManager`, Repositories (`Workflow`, `Diary`, `Trace`, `Timeline`, `Metrics`, `Provider`), `SearchOrchestrator`, `TracingService`, `MetricsEngine`, `TimelineService`, `Dashboard`, `BenchmarkEngine`. |
| **`@agent-diaries/memory`** | In-memory and local file storage providers. | `MemoryCacheProvider`, `MemoryLockProvider`, `MemoryPersistenceProvider`, `LocalFileStorage`, `MemoryStorage`. |
| **`@agent-diaries/redis`** | Distributed Redis caching and distributed locking hooks. | `RedisCacheProvider`, `RedisLockProvider`, `createRedisPlugin`. |
| **`@agent-diaries/postgres`** | Durable PostgreSQL persistence and locking hooks. | `PostgresPersistenceProvider`, `PostgresLockProvider`, SQL migrations (`migrations/001_initial_schema.sql`), `createPostgresPlugin`. |

---

## 3. Dependency Graph

```
@agent-diaries/shared (No internal dependencies)
     ▲
     │
@agent-diaries/core (Depends on @agent-diaries/shared)
     ▲
     ├───────────────────────┼───────────────────────┐
     │                       │                       │
@agent-diaries/memory  @agent-diaries/redis   @agent-diaries/postgres
(Depends on core &     (Depends on core &      (Depends on core &
 shared)               shared)                shared)
```

---

## 4. Single-Bundle & Future Publishing Strategy

### Current Distribution Model
- **Single NPM Package**: `@agent-diaries/core`
- **Internal Organization**: Modularized into sub-packages under `packages/`.
- **Bundling**: TypeScript compiles `packages/` into `dist/` with a single entry point re-exported at `src/index.ts`.
- **Consumer DX**:
  ```ts
  import { AgentDiary, WorkflowCoordinator, StorageManager } from "@agent-diaries/core";
  ```

### Future Multi-Package Roadmap
- When Redis and PostgreSQL providers mature, the monorepo structure allows publishing individual npm scope packages without refactoring source code:
  - `@agent-diaries/core`
  - `@agent-diaries/memory`
  - `@agent-diaries/redis`
  - `@agent-diaries/postgres`
