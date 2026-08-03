# GitHub Security Scanner Swarm

> **200 agents. 50 repositories. Zero duplicate scans.**

This is the killer demo for Agent Diaries. Without coordination, 200 agents scanning 50 repos would trigger 10,000 LLM calls. With Agent Diaries, exactly 50 calls run — one per repo.

## What this shows

- `executeOnce()` prevents duplicate work automatically
- Works with any number of concurrent agents
- No Redis, no infrastructure required

## Run it

```bash
npx tsx index.ts
```

## Expected output

```
[agent-0]  Scanning vercel/next.js...       ✓ executed
[agent-1]  Cache hit: vercel/next.js        ↩ skipped
[agent-2]  Cache hit: vercel/next.js        ↩ skipped
...
───────────────────────────────────────────
✔ Repos scanned:           50
✔ Duplicate calls stopped: 9,950
✔ Total wall time:         ~2.1s
✔ Simulated LLM cost saved: $148.50
───────────────────────────────────────────
```
