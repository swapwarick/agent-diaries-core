import { WorkflowCoordinator } from "../coordinator/WorkflowCoordinator";
import { MetricsRepository } from "../repositories";

export interface BenchmarkResult {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  avgDurationMs: number;
  throughputPerSec: number;
}

export class BenchmarkEngine {
  constructor(
    private coordinator: WorkflowCoordinator,
    private metricsRepo: MetricsRepository,
  ) {}

  async runBenchmark(
    iterations: number = 10,
    workerId: string = "benchmark-worker",
  ): Promise<BenchmarkResult> {
    const startTime = Date.now();
    let success = 0;
    let failed = 0;

    for (let i = 0; i < iterations; i++) {
      try {
        const wf = await this.coordinator.submitWorkflow(`benchmark-task-${i}`);
        await this.coordinator.executeWorkflow(wf.id, workerId, async () => {
          return { status: "ok" };
        });
        success++;
      } catch {
        failed++;
      }
    }

    const totalDuration = Date.now() - startTime;
    const avgDuration = totalDuration / iterations;
    const throughput = (iterations / totalDuration) * 1000;

    return {
      totalRuns: iterations,
      successfulRuns: success,
      failedRuns: failed,
      avgDurationMs: avgDuration,
      throughputPerSec: throughput,
    };
  }
}

export interface CertificationReport {
  certified: boolean;
  score: number;
  details: Record<string, boolean>;
}

export class CertificationEngine {
  constructor(private benchmarkEngine: BenchmarkEngine) {}

  async certify(): Promise<CertificationReport> {
    const result = await this.benchmarkEngine.runBenchmark(5);
    const hasHighSuccess = result.successfulRuns === 5;
    const isFastEnough = result.avgDurationMs < 500;

    const certified = hasHighSuccess && isFastEnough;
    const score = (result.successfulRuns / result.totalRuns) * 100;

    return {
      certified,
      score,
      details: {
        highSuccessRate: hasHighSuccess,
        lowLatency: isFastEnough,
      },
    };
  }
}
