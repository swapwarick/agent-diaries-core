import { MetricsRepository } from "../repositories";
import { EventBus, defaultEventBus } from "../events/EventBus";
import { AggregatedMetrics, MetricRecord } from "@agent-diaries/shared";

export class MetricsEngine {
  constructor(
    private metricsRepo: MetricsRepository,
    private eventBus: EventBus = defaultEventBus,
  ) {
    this.eventBus.on("WorkflowCompleted", async () => {
      await this.metricsRepo.recordMetric("workflow_success_count", 1);
    });

    this.eventBus.on("WorkflowFailed", async () => {
      await this.metricsRepo.recordMetric("workflow_failure_count", 1);
    });

    this.eventBus.on("CacheHit", async () => {
      await this.metricsRepo.recordMetric("cache_hit_count", 1);
    });

    this.eventBus.on("CacheMiss", async () => {
      await this.metricsRepo.recordMetric("cache_miss_count", 1);
    });
  }

  async record(
    name: string,
    value: number,
    tags?: Record<string, string>,
  ): Promise<MetricRecord> {
    return this.metricsRepo.recordMetric(name, value, tags);
  }

  async getAggregate(name: string): Promise<AggregatedMetrics | null> {
    return this.metricsRepo.aggregateMetrics(name);
  }

  async listMetrics(name?: string): Promise<MetricRecord[]> {
    return this.metricsRepo.loadMetrics(name);
  }
}
