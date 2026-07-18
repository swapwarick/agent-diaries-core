import {
  WorkflowRepository,
  DiaryRepository,
  TraceRepository,
  TimelineRepository,
  MetricsRepository,
  ProviderRepository,
} from "../repositories";
import { WorkerRegistry, defaultWorkerRegistry } from "../workers/WorkerRegistry";
import { EventBus, defaultEventBus } from "../events/EventBus";
import { WorkflowRecord } from "../../shared/types";

/**
 * Enterprise workflow coordinator orchestrating multi-agent workflow submissions, claims, execution, and state machine lifecycle transitions.
 *
 * @example
 * ```typescript
 * const coordinator = new WorkflowCoordinator(workflowRepo, diaryRepo, traceRepo, timelineRepo, metricsRepo, providerRepo);
 * const wf = await coordinator.submitWorkflow("Sync Data");
 * const result = await coordinator.executeWorkflow(wf.id, "worker-1", async () => {
 *   return { status: "OK" };
 * });
 * ```
 */
export class WorkflowCoordinator {
  /**
   * Constructs a new WorkflowCoordinator.
   */
  constructor(
    public readonly workflowRepo: WorkflowRepository,
    public readonly diaryRepo: DiaryRepository,
    public readonly traceRepo: TraceRepository,
    public readonly timelineRepo: TimelineRepository,
    public readonly metricsRepo: MetricsRepository,
    public readonly providerRepo: ProviderRepository,
    public readonly workerRegistry: WorkerRegistry = defaultWorkerRegistry,
    public readonly eventBus: EventBus = defaultEventBus,
  ) {}

  /**
   * Submits a workflow for execution, checking for signature deduplication.
   *
   * @param name Workflow name.
   * @param payload Optional workflow input payload.
   * @param options Signature and TTL options.
   * @returns WorkflowRecord instance.
   */
  async submitWorkflow(
    name: string,
    payload?: any,
    options?: { signature?: string; ttlMs?: number },
  ): Promise<WorkflowRecord> {
    if (options?.signature) {
      const reusable = await this.workflowRepo.findReusableWorkflow(
        options.signature,
      );
      if (reusable) {
        await this.timelineRepo.appendEvent({
          workflowId: reusable.id,
          type: "WORKFLOW_REUSED",
          payload: { signature: options.signature },
        });
        return reusable;
      }
    }

    const workflow = await this.workflowRepo.createWorkflow(
      name,
      payload,
      options,
    );

    await this.timelineRepo.appendEvent({
      workflowId: workflow.id,
      type: "WORKFLOW_CREATED",
      payload: { name, options },
    });

    await this.metricsRepo.recordMetric("workflow_created", 1, {
      name,
    });

    return workflow;
  }

  /**
   * Claims a workflow for execution by a worker node.
   *
   * @param workflowId Workflow ID to claim.
   * @param workerId Worker process ID.
   * @returns Promise resolving to `true` if claimed successfully, `false` otherwise.
   */
  async claimWorkflow(workflowId: string, workerId: string): Promise<boolean> {
    const claimed = await this.workflowRepo.claimWorkflow(workflowId, workerId);
    if (claimed) {
      await this.timelineRepo.appendEvent({
        workflowId,
        type: "WORKFLOW_CLAIMED",
        payload: { workerId },
      });
      await this.workerRegistry.heartbeat(workerId);
      await this.metricsRepo.recordMetric("workflow_claimed", 1, { workerId });
    }
    return claimed;
  }

  /**
   * Executes a workflow function under a worker claim with automated metric and timeline recording.
   *
   * @param workflowId Workflow ID.
   * @param workerId Worker ID.
   * @param fn Async execution function returning workflow output.
   * @returns Output returned by fn.
   */
  async executeWorkflow<T>(
    workflowId: string,
    workerId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const claimed = await this.claimWorkflow(workflowId, workerId);
    if (!claimed) {
      throw new Error(`Failed to claim workflow "${workflowId}".`);
    }

    const startTime = Date.now();
    await this.timelineRepo.appendEvent({
      workflowId,
      type: "WORKFLOW_STARTED",
      payload: { workerId },
    });
    await this.eventBus.emit("WorkflowStarted", { workflowId });

    try {
      const result = await fn();
      await this.workflowRepo.completeWorkflow(workflowId, result);

      const duration = Date.now() - startTime;
      await this.timelineRepo.appendEvent({
        workflowId,
        type: "WORKFLOW_COMPLETED",
        payload: { durationMs: duration },
      });
      await this.metricsRepo.recordMetric("workflow_execution_duration_ms", duration);

      return result;
    } catch (err: any) {
      const errorMessage = err?.message || String(err);
      await this.workflowRepo.failWorkflow(workflowId, errorMessage);

      await this.timelineRepo.appendEvent({
        workflowId,
        type: "WORKFLOW_FAILED",
        payload: { error: errorMessage },
      });
      await this.metricsRepo.recordMetric("workflow_failed", 1);

      throw err;
    }
  }

  /** Gets workflow status by ID. */
  async getWorkflowStatus(workflowId: string): Promise<WorkflowRecord | null> {
    const list = await this.workflowRepo.listWorkflowHistory({ id: workflowId });
    return list.length > 0 ? list[0] : null;
  }
}
