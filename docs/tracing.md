# Distributed Tracing & Observability (`TracingService`)

`@agent-diaries/core` features OpenTelemetry-inspired distributed tracing and real-time observability for multi-agent swarm deployments. It tracks multi-step agent reasoning, tool calls, LLM spans, and audit trails across distributed environments.

---

## Key Features

- 🔭 **Span & Trace Recording:** Measure execution durations, start/end timestamps, parent/child relationships, and context metadata.
- 📡 **Event-Driven Pub-Sub:** Integrates seamlessly with `EventBus` to capture domain events (`WorkflowStarted`, `DiaryUpdated`, `TraceRecorded`).
- ⏱️ **Sequenced Timeline Audit Trails:** Append-only timeline store (`TimelineRepository`) capturing chronological agent audit events.
- 📊 **Metrics Aggregation:** Real-time throughput, latency histograms, and pass/fail counts.

---

## Usage Example

```typescript
import {
  StorageManager,
  TraceRepository,
  TracingService,
  defaultEventBus,
} from "@agent-diaries/core";

const storageManager = new StorageManager();
const traceRepo = new TraceRepository(storageManager, defaultEventBus);
const tracingService = new TracingService(traceRepo);

async function runTracedAgentTask() {
  const traceId = `trace-${Date.now()}`;

  // Start root trace span
  const span = await tracingService.startSpan(traceId, "agent:scrape-and-summarize", {
    agentId: "researcher-01",
    model: "gpt-4o",
  });

  try {
    // Perform LLM or scraping operation...
    await new Promise((resolve) => setTimeout(resolve, 150));

    // End span successfully
    await tracingService.endSpan(span.id, { status: "OK", tokensUsed: 450 });
  } catch (err: any) {
    // Record span failure
    await tracingService.failSpan(span.id, err.message);
    throw err;
  }
}

runTracedAgentTask();
```

---

## Architecture Integration

```
┌────────────────────────┐
│     Agent Operation    │
└───────────┬────────────┘
            │
            ▼
┌────────────────────────┐      Emits Event     ┌────────────────────────┐
│     TracingService     │ ───────────────────► │        EventBus        │
└───────────┬────────────┘                      └───────────┬────────────┘
            │                                               │
            ▼                                               ▼
┌────────────────────────┐                      ┌────────────────────────┐
│    TraceRepository     │                      │   Metrics & Timeline   │
└────────────────────────┘                      └────────────────────────┘
```
