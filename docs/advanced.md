# Workflow Coordinator (`WorkflowCoordinator`)

The `WorkflowCoordinator` is the enterprise multi-step pipeline orchestration engine in `@agent-diaries/core`. While `AgentDiary` and `executeOnce()` provide task-level deduplication, `WorkflowCoordinator` manages full workflow lifecycles, atomic worker node claims, event timelines, metrics tracking, and state machine transitions across distributed agent swarms.

---

## Key Capabilities

- 🔄 **State Machine Lifecycle:** Enforces strict state transitions (`CREATED` → `QUEUED` → `CLAIMED` → `RUNNING` → `COMPLETED` / `FAILED` / `CANCELLED` / `EXPIRED`).
- ✍️ **Signature Deduplication:** Intercepts identical workflow submissions by signature hash, reusing past results without re-executing pipelines.
- 👷 **Worker Node Claims:** Guarantees atomic claims across distributed worker instances via `WorkerRegistry` heartbeats.
- 📜 **Event Timeline & Metrics:** Automatically logs timeline events (`WORKFLOW_CREATED`, `WORKFLOW_CLAIMED`, `WORKFLOW_COMPLETED`) and aggregates performance metrics.

---

## Quick Start Example

```typescript
import {
  StorageManager,
  WorkflowRepository,
  DiaryRepository,
  TraceRepository,
  TimelineRepository,
  MetricsRepository,
  ProviderRepository,
  WorkflowCoordinator,
  defaultEventBus,
} from "@agent-diaries/core";

// 1. Initialize Storage & Repositories
const storageManager = new StorageManager();

const workflowRepo = new WorkflowRepository(storageManager, defaultEventBus);
const diaryRepo    = new DiaryRepository(storageManager, defaultEventBus);
const traceRepo    = new TraceRepository(storageManager, defaultEventBus);
const timelineRepo = new TimelineRepository(storageManager);
const metricsRepo  = new MetricsRepository(storageManager);
const providerRepo = new ProviderRepository(defaultEventBus);

// 2. Instantiate Coordinator
const coordinator = new WorkflowCoordinator(
  workflowRepo,
  diaryRepo,
  traceRepo,
  timelineRepo,
  metricsRepo,
  providerRepo
);

async function runSwarmPipeline() {
  // 3. Submit workflow with signature deduplication
  const wf = await coordinator.submitWorkflow("Sync Account Data", { batchSize: 100 }, {
    signature: "sync-account-data-batch-100",
  });

  // 4. Safely execute under worker claim
  const result = await coordinator.executeWorkflow(wf.id, "worker-node-01", async () => {
    // Pipeline logic here...
    return { status: "SUCCESS", itemsProcessed: 100 };
  });

  console.log("Pipeline Output:", result);
}

runSwarmPipeline();
```

---

## API Methods

### `submitWorkflow(name, payload?, options?)`
Submits a new workflow or returns an existing reusable workflow if a matching `signature` hash is found in storage.

### `claimWorkflow(workflowId, workerId)`
Atomically attempts to claim ownership of a workflow for a specified worker instance. Sends a heartbeat to `WorkerRegistry`.

### `executeWorkflow(workflowId, workerId, fn)`
Claims the workflow and runs `fn()`. Automatically manages state transitions (`RUNNING` → `COMPLETED` / `FAILED`), timing metrics, and timeline logs.

### `getWorkflowStatus(workflowId)`
Retrieves current state metadata and execution details for a workflow.
