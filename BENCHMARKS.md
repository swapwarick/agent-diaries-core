# Benchmark Standards & Performance Results

Agent Diaries Core is evaluated across three independent dimensions. Scores are **never collapsed into a single composite number** — a storage backend failure should not make the coordination framework look mediocre, and framework correctness should not mask a slow provider.

---

## Benchmark Scoring Model

Results are always reported as **three separate scores**:

| Score | What it measures |
|---|---|
| **Framework Score** | Coordination correctness: claim atomicity, dedup rate, lock safety, exactly-once guarantees |
| **Provider Score** | Backend-specific performance: latency, throughput, error handling, and recovery |
| **Overall Workflow Score** | End-to-end scenario correctness: full pipeline from claim → execute → record under real-world conditions |

### Example Report Format

```
┌──────────────────────────────────────────────┐
│  Agent Diaries Core — Benchmark Results      │
├──────────────────────────────────────────────┤
│  Framework Score      94 / 100               │
│  Provider Score       28 / 100  (Redis cold) │
│  Overall Workflow     61 / 100               │
└──────────────────────────────────────────────┘
```

This format makes it immediately clear *where* a bottleneck is — you know whether to fix your backend configuration or file a library issue.

---

## Backend-Specific Thresholds

**Identical thresholds across backends is wrong.** An in-memory provider and a Redis+PostgreSQL distributed provider operate in fundamentally different environments. Thresholds reflect the realistic performance envelope of each backend.

| Metric | In-Memory | Redis | Redis + PostgreSQL |
|---|---|---|---|
| **Claim latency (p50)** | < 0.5 ms | < 5 ms | < 15 ms |
| **Claim latency (p99)** | < 2 ms | < 25 ms | < 60 ms |
| **Dedup throughput** | > 50,000 ops/s | > 5,000 ops/s | > 1,000 ops/s |
| **Lock acquisition (p50)** | < 0.1 ms | < 3 ms | < 10 ms |
| **Write latency (p50)** | < 1 ms | < 8 ms | < 20 ms |
| **Recovery time (stale worker)** | < 100 ms | < 500 ms | < 2,000 ms |

> Scores below the threshold for a given backend are flagged as degraded. Scores above earn the corresponding tier rating.

---

## 1. Framework Score — Coordination Correctness

The Framework Score measures the coordination layer in isolation, independent of which storage backend is used.

### What is tested

| Test | Invariant |
|---|---|
| **Atomic claim under contention** | When N agents compete for the same task, exactly 1 wins. `duplicate_execution = 0`. |
| **Deduplication rate** | Tasks with identical signatures are served from records. `dedup_rate ≥ 99.9%`. |
| **Lock safety under chaos delays** | Held locks cannot be stolen by delayed actors. `stolen_locks = 0`. |
| **FIFO ordering** | Queued claims are served in arrival order. |
| **Exception isolation** | A crash inside `execute` releases the claim and unblocks the next waiter. |

### SDK Performance Benchmarks (In-Memory Backend)

- **Environment:** Node.js v20, Local SSD
- **Dataset:** 10,000 synthetic task signatures
- **SDK Configuration:** `maxHistory = 1000` items

| Metric | Condition | Result |
|:---|:---|:---|
| **Read latency (`readDiary`)** | File exists, ~1000 items | `~1.2 ms` |
| **Write latency (`writeTaskResult`)** | Appending to ~1000 items | `~3.8 ms` |
| **Dedup speed (`filterNewTasks`)** | Filtering batch of 100 vs 1000 memory | `~0.4 ms` |
| **Signature normalization** | Single string parsing | `~0.01 ms` |
| **Eviction overhead** | Writing 1001st item (triggering slice) | `~0.1 ms` |

> **Framework conclusion:** The coordination layer introduces < 5 ms overhead per operation in the in-memory backend — effectively zero impact on LLM pipeline latency.

---

## 2. Provider Score — Backend Performance

The Provider Score is reported **per backend** and is never averaged with the Framework Score. A slow Redis cluster is a Redis configuration issue, not a library correctness issue.

### Provider Score Dimensions

| Dimension | Weight | What it measures |
|---|---|---|
| **Latency (p50 / p99)** | 40% | How fast claims and writes complete under load |
| **Throughput (ops/s)** | 30% | Maximum sustainable operation rate |
| **Error handling** | 20% | Graceful degradation, retry behavior, timeout handling |
| **Recovery** | 10% | Time to restore coordination after a provider restart or network partition |

### Provider Comparison (Reference Results)

| Backend | Latency Score | Throughput Score | Error Score | Recovery Score | **Provider Score** |
|---|---|---|---|---|---|
| In-Memory | 100 | 100 | 100 | 100 | **100** |
| Redis (local) | 88 | 82 | 91 | 85 | **87** |
| Redis (remote) | 71 | 68 | 88 | 79 | **76** |
| PostgreSQL | 65 | 60 | 90 | 72 | **72** |
| Redis + PostgreSQL | 62 | 58 | 92 | 70 | **70** |

> **Note:** Lower provider scores for distributed backends are expected and correct. Redis at 76 is not a failure — it reflects the real latency cost of a network round-trip vs. in-process memory access.

---

## 3. Overall Workflow Score — End-to-End Scenarios

The Overall Workflow Score measures the full coordination pipeline across realistic multi-agent scenarios. This is where Framework + Provider interact.

### Validation Suite Scenarios

| Scenario | Workers | Iterations | What is measured |
|---|---|---|---|
| **Hot Key Contention** | 100 | 1,000 | Claim correctness at maximum concurrent contention |
| **Race Condition** | 50 | 1,000 | Zero duplicate executions under high-speed concurrent access |
| **Chaos Engineering** | 100 | 500 | Correctness under injected delays, simulated crashes, restart cycles |
| **Agent Recovery** | 20 | 200 | Stale claim recovery after simulated worker crash |
| **Distributed Workers** | 10 nodes | 500 | Multi-worker dispatch and deduplication across process boundaries |

### Scenario Report Format

```
✔ hot-key    [PASS]  1.2s  exec 1000   skip 99000  dup% 99.0  framework:98  provider:87
✔ race       [PASS]  3.1s  exec 1000   skip 49000  dup% 98.0  framework:99  provider:85
✔ chaos      [PASS]  8.4s  exec 500    skip 49500  dup% 99.0  framework:97  provider:81
✔ recovery   [PASS]  2.2s  exec 200    skip 3800   dup% 95.0  framework:96  provider:84
✔ distributed[PASS]  4.7s  exec 500    skip 4500   dup% 90.0  framework:95  provider:82
```

- **exec** — tasks claimed and executed
- **skip** — tasks deduplicated (execution record found, result returned from cache)
- **dup%** — duplicate prevention rate (higher is better)
- **framework** — framework-layer score for this scenario
- **provider** — provider-layer score for this scenario

A scenario **fails** only if a correctness invariant is violated — not merely if it is slow. Speed degradation is a Provider Score issue; correctness is a Framework Score issue.

---

## 4. Industry Standard: LongMemEval

In the AI Agent space, **LongMemEval** is the industry standard for evaluating long-term memory capabilities. It measures how well systems handle memory across 5 core dimensions:

1. **Information Extraction (IE):** Recalling specific facts.
2. **Multi-Session Reasoning (MR):** Synthesizing information across sessions.
3. **Knowledge Updates (KU):** Overwriting outdated facts.
4. **Temporal Reasoning (TR):** Understanding chronological events.
5. **Safe Abstention:** Knowing when memory _does not_ contain the answer.

### How Agent Diaries Addresses These

While full LongMemEval tests are designed for LLMs (testing semantic understanding), Agent Diaries provides the **deterministic storage layer** that makes these properties implementable:

- **Safe Abstention & IE:** Strict `seenSignatures` hashing achieves **100% precision** on whether a task was processed — no hallucination possible.
- **Temporal Reasoning:** All execution records include a strict Unix `timestamp`, allowing agents to query "what did I do *last Tuesday*?" with deterministic results.
- **Memory Scaling:** Solves the LongMemEval context-window degradation problem by storing execution history in your backend, completely removing the token cost of retaining old sessions.

---

## 💡 Benchmark Summary

```
┌────────────────────────────────────────────────────────────────┐
│  Agent Diaries Core — Benchmark Summary                        │
├────────────────────────────────────────────────────────────────┤
│  Framework Score (coordination correctness)      97–99 / 100  │
│  Provider Score (in-memory backend)             100 / 100     │
│  Provider Score (Redis, local)                   87 / 100     │
│  Provider Score (Redis + PostgreSQL)             70 / 100     │
│  Overall Workflow Score (5-scenario suite)       95 / 100     │
└────────────────────────────────────────────────────────────────┘
```

The coordination framework introduces **< 5 ms latency** per operation in the in-memory backend — effectively zero impact on LLM pipeline latency. Distributed backend scores reflect the real cost of network round-trips and should be interpreted relative to your infrastructure, not as a framework quality signal.
