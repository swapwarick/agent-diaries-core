import { TraceRepository } from "../repositories";
import { EventBus, defaultEventBus } from "../events/EventBus";
import { TraceRecord, SpanRecord } from "../../shared/types";
import { randomUUID } from "crypto";

export class TracingService {
  constructor(
    private traceRepo: TraceRepository,
    private eventBus: EventBus = defaultEventBus,
  ) {
    this.eventBus.on("WorkflowStarted", async ({ workflowId }) => {
      await this.startTrace(`workflow-${workflowId}`, workflowId);
    });
  }

  async startTrace(name: string, workflowId?: string): Promise<TraceRecord> {
    const trace: TraceRecord = {
      traceId: randomUUID(),
      name,
      workflowId,
      startTime: Date.now(),
      spans: [],
      status: "active",
    };
    await this.traceRepo.recordTrace(trace);
    return trace;
  }

  async startSpan(
    traceId: string,
    name: string,
    parentSpanId?: string,
    attributes?: Record<string, any>,
  ): Promise<SpanRecord> {
    const span: SpanRecord = {
      spanId: randomUUID(),
      traceId,
      name,
      parentSpanId,
      startTime: Date.now(),
      status: "ok",
      attributes,
    };
    await this.traceRepo.recordSpan(traceId, span);
    return span;
  }

  async finishSpan(
    traceId: string,
    spanId: string,
    status: "ok" | "error" = "ok",
  ): Promise<void> {
    const trace = await this.traceRepo.loadTrace(traceId);
    if (!trace) return;
    const span = trace.spans.find((s) => s.spanId === spanId);
    if (span) {
      span.endTime = Date.now();
      span.status = status;
      await this.traceRepo.recordTrace(trace);
    }
  }

  async finishTrace(
    traceId: string,
    status: "completed" | "failed" = "completed",
  ): Promise<void> {
    const trace = await this.traceRepo.loadTrace(traceId);
    if (!trace) return;
    trace.endTime = Date.now();
    trace.status = status;
    await this.traceRepo.recordTrace(trace);
  }
}
