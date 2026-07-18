import { EventBus, defaultEventBus } from "../events/EventBus";
import { WorkflowRepository, DiaryRepository } from "../repositories";

export interface DashboardOverview {
  activeWorkers: number;
  totalWorkflows: number;
  completedWorkflows: number;
  failedWorkflows: number;
  recentEvents: string[];
}

export class Dashboard {
  private recentEvents: string[] = [];

  constructor(
    private workflowRepo: WorkflowRepository,
    private diaryRepo: DiaryRepository,
    private eventBus: EventBus = defaultEventBus,
  ) {
    this.subscribeToEvents();
  }

  private subscribeToEvents(): void {
    const logEvent = (evt: string) => {
      this.recentEvents.unshift(`[${new Date().toISOString()}] ${evt}`);
      if (this.recentEvents.length > 50) this.recentEvents.pop();
    };

    this.eventBus.on("WorkflowCreated", ({ workflow }) =>
      logEvent(`Workflow created: ${workflow.id}`),
    );
    this.eventBus.on("WorkflowCompleted", ({ workflowId }) =>
      logEvent(`Workflow completed: ${workflowId}`),
    );
    this.eventBus.on("WorkflowFailed", ({ workflowId, reason }) =>
      logEvent(`Workflow failed: ${workflowId} (${reason || "No reason"})`),
    );
  }

  async getOverview(): Promise<DashboardOverview> {
    const history = await this.workflowRepo.listWorkflowHistory();
    const completed = history.filter((w) => w.state === "COMPLETED").length;
    const failed = history.filter((w) => w.state === "FAILED").length;

    return {
      activeWorkers: 1,
      totalWorkflows: history.length,
      completedWorkflows: completed,
      failedWorkflows: failed,
      recentEvents: [...this.recentEvents],
    };
  }
}
