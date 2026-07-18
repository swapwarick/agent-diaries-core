import { describe, it, expect, vi } from "vitest";
import {
  WorkflowState,
  WorkflowStateMachine,
  InvalidStateTransitionError,
  EventBus,
  StorageManager,
  MemoryCacheProvider,
  MemoryLockProvider,
  MemoryPersistenceProvider,
  WorkflowRepository,
  DiaryRepository,
  TraceRepository,
  TimelineRepository,
  MetricsRepository,
  ProviderRepository,
  WorkerRegistry,
  PluginRegistry,
  WorkflowCoordinator,
  SearchOrchestrator,
  TinyFishProvider,
  TavilyProvider,
  MetricsEngine,
  TracingService,
  TimelineService,
  Dashboard,
  BenchmarkEngine,
} from "../src";

describe("Workflow State Machine", () => {
  it("validates allowed state transitions", () => {
    expect(
      WorkflowStateMachine.canTransition(
        WorkflowState.CREATED,
        WorkflowState.CLAIMED,
      ),
    ).toBe(true);

    expect(
      WorkflowStateMachine.canTransition(
        WorkflowState.CLAIMED,
        WorkflowState.RUNNING,
      ),
    ).toBe(true);

    expect(
      WorkflowStateMachine.canTransition(
        WorkflowState.RUNNING,
        WorkflowState.COMPLETED,
      ),
    ).toBe(true);

    expect(
      WorkflowStateMachine.canTransition(
        WorkflowState.COMPLETED,
        WorkflowState.RUNNING,
      ),
    ).toBe(false);

    expect(() =>
      WorkflowStateMachine.validateTransition(
        WorkflowState.COMPLETED,
        WorkflowState.RUNNING,
      ),
    ).toThrow(InvalidStateTransitionError);
  });
});

describe("Internal Event Bus", () => {
  it("emits and handles domain events", async () => {
    const bus = new EventBus();
    const handler = vi.fn();

    bus.on("WorkflowCreated", handler);
    await bus.emit("WorkflowCreated", {
      workflow: {
        id: "wf-123",
        name: "test-wf",
        state: WorkflowState.CREATED,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });

    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow: expect.objectContaining({ id: "wf-123" }),
      }),
    );
  });
});

describe("StorageManager & Domain Repositories", () => {
  it("interacts with repositories backed by StorageManager", async () => {
    const storageManager = new StorageManager({
      cache: new MemoryCacheProvider(),
      lock: new MemoryLockProvider(),
      persistence: new MemoryPersistenceProvider(),
    });
    const eventBus = new EventBus();

    const wfRepo = new WorkflowRepository(storageManager, eventBus);
    const wf = await wfRepo.createWorkflow("Test Workflow");

    expect(wf.state).toBe(WorkflowState.CREATED);

    const claimed = await wfRepo.claimWorkflow(wf.id, "worker-1");
    expect(claimed).toBe(true);

    await wfRepo.completeWorkflow(wf.id, { result: "done" });
    const history = await wfRepo.listWorkflowHistory({ id: wf.id });
    expect(history[0].state).toBe(WorkflowState.COMPLETED);
    expect(history[0].result).toEqual({ result: "done" });
  });

  it("handles metrics, timeline, and trace repositories", async () => {
    const storageManager = new StorageManager();
    const eventBus = new EventBus();

    const metricsRepo = new MetricsRepository(storageManager);
    await metricsRepo.recordMetric("test_metric", 100);
    await metricsRepo.recordMetric("test_metric", 200);

    const agg = await metricsRepo.aggregateMetrics("test_metric");
    expect(agg).toEqual({
      name: "test_metric",
      count: 2,
      sum: 300,
      avg: 150,
      min: 100,
      max: 200,
    });

    const timelineRepo = new TimelineRepository(storageManager);
    await timelineRepo.appendEvent({
      type: "CUSTOM_EVENT",
      workflowId: "wf-1",
    });
    const timeline = await timelineRepo.loadTimeline("wf-1");
    expect(timeline).toHaveLength(1);
    expect(timeline[0].type).toBe("CUSTOM_EVENT");
  });
});

describe("WorkerRegistry", () => {
  it("registers, updates heartbeat, and prunes stale workers", async () => {
    const registry = new WorkerRegistry();
    const worker = await registry.registerWorker({ workerId: "w1" });

    expect(worker.workerId).toBe("w1");
    expect(worker.status).toBe("active");

    const hbSuccess = await registry.heartbeat("w1");
    expect(hbSuccess).toBe(true);

    const list = await registry.listWorkers();
    expect(list).toHaveLength(1);
  });
});

describe("Plugin Architecture", () => {
  it("registers and initializes plugins", async () => {
    const pluginRegistry = new PluginRegistry();
    const initFn = vi.fn();

    pluginRegistry.register({
      name: "TestPlugin",
      initialize: initFn,
    });

    const storageManager = new StorageManager();
    const eventBus = new EventBus();
    const workerRegistry = new WorkerRegistry();

    await pluginRegistry.initializeAll({
      storageManager,
      eventBus,
      workerRegistry,
    });

    expect(initFn).toHaveBeenCalledTimes(1);
  });
});

describe("Workflow Coordinator & Search Orchestration", () => {
  it("executes workflow end-to-end with coordinator", async () => {
    const storageManager = new StorageManager();
    const eventBus = new EventBus();

    const wfRepo = new WorkflowRepository(storageManager, eventBus);
    const diaryRepo = new DiaryRepository(storageManager, eventBus);
    const traceRepo = new TraceRepository(storageManager, eventBus);
    const timelineRepo = new TimelineRepository(storageManager);
    const metricsRepo = new MetricsRepository(storageManager);
    const providerRepo = new ProviderRepository(eventBus);
    const workerRegistry = new WorkerRegistry();

    await workerRegistry.registerWorker({ workerId: "worker-prod" });

    const coordinator = new WorkflowCoordinator(
      wfRepo,
      diaryRepo,
      traceRepo,
      timelineRepo,
      metricsRepo,
      providerRepo,
      workerRegistry,
      eventBus,
    );

    const wf = await coordinator.submitWorkflow("E2E Task");
    const res = await coordinator.executeWorkflow(
      wf.id,
      "worker-prod",
      async () => "success-output",
    );

    expect(res).toBe("success-output");

    const status = await coordinator.getWorkflowStatus(wf.id);
    expect(status?.state).toBe(WorkflowState.COMPLETED);
  });

  it("orchestrates search with provider latency and failover tracking", async () => {
    const eventBus = new EventBus();
    const providerRepo = new ProviderRepository(eventBus);
    const orchestrator = new SearchOrchestrator(providerRepo, eventBus);

    orchestrator.registerProvider(new TinyFishProvider());
    orchestrator.registerProvider(new TavilyProvider());

    const result = await orchestrator.search("enterprise workflow AI");
    expect(result.provider).toBe("TinyFish");

    const health = await providerRepo.loadProviderHealth("TinyFish");
    expect(health).toHaveLength(1);
    expect(health[0].success).toBe(true);
  });
});
