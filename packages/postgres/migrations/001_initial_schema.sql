-- Agent Diaries PostgreSQL Initial Schema Placeholder

CREATE TABLE IF NOT EXISTS agent_diaries_workflows (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  state TEXT NOT NULL,
  signature TEXT,
  worker_id TEXT,
  payload JSONB,
  result JSONB,
  fail_reason TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  completed_at BIGINT,
  ttl_ms BIGINT,
  metadata JSONB
);

CREATE TABLE IF NOT EXISTS agent_diaries_locks (
  key TEXT PRIMARY KEY,
  locked_at BIGINT NOT NULL,
  lock_id TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_agent_diaries_locks_locked_at
  ON agent_diaries_locks (locked_at);
