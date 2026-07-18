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
import { WorkflowRecord } from "@agent-diaries/shared";

export class WorkflowCoordinator {
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

  async getWorkflowStatus(workflowId: string): Promise<WorkflowRecord | null> {
    const list = await this.workflowRepo.listWorkflowHistory({ id: workflowId });
    return list.length > 0 ? list[0] : null;
  }
}
