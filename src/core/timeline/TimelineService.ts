import { TimelineRepository } from "../repositories";
import { EventBus, defaultEventBus } from "../events/EventBus";
import { TimelineEvent } from "../../shared/types";

export class TimelineService {
  constructor(
    private timelineRepo: TimelineRepository,
    private eventBus: EventBus = defaultEventBus,
  ) {
    this.eventBus.on("WorkflowCreated", async ({ workflow }) => {
      await this.append("WORKFLOW_CREATED", workflow.id, { name: workflow.name });
    });

    this.eventBus.on("WorkflowStarted", async ({ workflowId }) => {
      await this.append("WORKFLOW_STARTED", workflowId);
    });

    this.eventBus.on("WorkflowCompleted", async ({ workflowId, result }) => {
      await this.append("WORKFLOW_COMPLETED", workflowId, { result });
    });

    this.eventBus.on("WorkflowFailed", async ({ workflowId, reason }) => {
      await this.append("WORKFLOW_FAILED", workflowId, { reason });
    });
  }

  async append(
    type: string,
    workflowId?: string,
    payload?: any,
  ): Promise<TimelineEvent> {
    return this.timelineRepo.appendEvent({
      type,
      workflowId,
      payload,
    });
  }

  async getTimeline(workflowId?: string): Promise<TimelineEvent[]> {
    return this.timelineRepo.loadTimeline(workflowId);
  }
}
