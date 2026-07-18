import { PersistenceProvider } from "@agent-diaries/core";
import { WorkflowRecord, TraceRecord, TimelineEvent, MetricRecord } from "@agent-diaries/shared";

export interface PostgresPersistenceProviderOptions {
  connectionString?: string;
  tableName?: string;
}

export class PostgresPersistenceProvider implements PersistenceProvider {
  constructor(private options: PostgresPersistenceProviderOptions = {}) {}

  async saveWorkflow(_workflow: WorkflowRecord): Promise<void> {
    throw new Error("[PostgresPersistenceProvider] PostgreSQL implementation placeholder. Implement in future phase.");
  }

  async getWorkflow(_id: string): Promise<WorkflowRecord | null> {
    throw new Error("[PostgresPersistenceProvider] PostgreSQL implementation placeholder. Implement in future phase.");
  }

  async listWorkflows(_filter?: Partial<WorkflowRecord>): Promise<WorkflowRecord[]> {
    throw new Error("[PostgresPersistenceProvider] PostgreSQL implementation placeholder. Implement in future phase.");
  }

  async saveTrace(_trace: TraceRecord): Promise<void> {
    throw new Error("[PostgresPersistenceProvider] PostgreSQL implementation placeholder. Implement in future phase.");
  }

  async getTrace(_id: string): Promise<TraceRecord | null> {
    throw new Error("[PostgresPersistenceProvider] PostgreSQL implementation placeholder. Implement in future phase.");
  }

  async saveTimelineEvent(_event: TimelineEvent): Promise<void> {
    throw new Error("[PostgresPersistenceProvider] PostgreSQL implementation placeholder. Implement in future phase.");
  }

  async getTimeline(_workflowId?: string): Promise<TimelineEvent[]> {
    throw new Error("[PostgresPersistenceProvider] PostgreSQL implementation placeholder. Implement in future phase.");
  }

  async saveMetric(_metric: MetricRecord): Promise<void> {
    throw new Error("[PostgresPersistenceProvider] PostgreSQL implementation placeholder. Implement in future phase.");
  }

  async getMetrics(): Promise<MetricRecord[]> {
    throw new Error("[PostgresPersistenceProvider] PostgreSQL implementation placeholder. Implement in future phase.");
  }
}
