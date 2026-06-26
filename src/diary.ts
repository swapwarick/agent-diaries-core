import { StorageAdapter, LocalFileStorage } from "./storage";

export interface TaskRecord {
  title: string;
  signature: string; // A unique hash or normalized string to identify the task
  result?: string;
  status: "pending" | "done" | "failed"; // Tracks task lifecycle stage
  failReason?: string; // Optional failure message set by failTask()
  timestamp: number;
  ttlMs?: number; // Optional TTL specific to this task run
}

export interface AgentState {
  lastRun: number;
  seenSignatures: string[];
  runCount: number;
  history: TaskRecord[];
}

/** Diagnostic summary of an agent's diary state. */
export interface AgentStats {
  agentId: string;
  runCount: number;
  historyCount: number; // Active (non-expired) records
  pendingCount: number;
  doneCount: number;
  failedCount: number;
  lastRunAt: number;
  oldestTaskAt?: number; // Unix ms of oldest active task
}

export interface AgentDiaryOptions {
  agentId: string;
  storage?: StorageAdapter<AgentState>;
  maxHistory?: number;
  defaultTtlMs?: number; // Default TTL in milliseconds for claimed tasks
  /**
   * Custom function to compute a task's signature from its title.
   * Defaults to AgentDiary.normalizeSignature (lowercase + trim).
   * Useful for structured task IDs or custom deduplication logic.
   */
  hashFn?: (title: string) => string;
  /**
   * Optional callback invoked whenever a task record is found to be expired
   * during claimTask() or pruneExpiredTasks(). Useful for audit trails,
   * re-queuing, or observability pipelines.
   */
  onTaskExpired?: (record: TaskRecord) => void | Promise<void>;
}

export class AgentDiary {
  private agentId: string;
  private storage: StorageAdapter<AgentState>;
  private maxHistory: number;
  private defaultTtlMs?: number;
  private hashFn?: (title: string) => string;
  private onTaskExpired?: (record: TaskRecord) => void | Promise<void>;

  constructor(options: AgentDiaryOptions) {
    this.agentId = options.agentId;
    this.storage = options.storage || new LocalFileStorage<AgentState>();
    this.maxHistory = options.maxHistory || 500;
    this.defaultTtlMs = options.defaultTtlMs;
    this.hashFn = options.hashFn;
    this.onTaskExpired = options.onTaskExpired;
  }

  private emptyState(): AgentState {
    return {
      lastRun: 0,
      seenSignatures: [],
      runCount: 0,
      history: [],
    };
  }

  /**
   * Generates a normalized signature for a task title.
   * Lowercases, trims, and collapses whitespace.
   */
  public static normalizeSignature(title: string): string {
    return (title || "").toLowerCase().trim().replace(/\s+/g, " ");
  }

  /**
   * Computes the task signature using the custom hashFn if provided,
   * or falls back to the default normalizeSignature method.
   */
  private computeSignature(title: string): string {
    return this.hashFn
      ? this.hashFn(title)
      : AgentDiary.normalizeSignature(title);
  }

  /**
   * Checks whether a task record has expired based on its TTL.
   */
  private isExpired(record: TaskRecord, now: number): boolean {
    return record.ttlMs !== undefined && now - record.timestamp > record.ttlMs;
  }

  /**
   * Reads the current diary state (without locking).
   *
   * ⚠️ NOTE: This is a non-atomic snapshot. Do not make decisions based on
   * this read in high-concurrency environments without acquiring a lock first.
   */
  public async readDiary(): Promise<AgentState> {
    const state = await this.storage.get(`diary_${this.agentId}`);
    return state ?? this.emptyState();
  }

  /**
   * Atomically attempts to claim a task.
   * Returns true if successfully claimed (first time seen or expired), false if
   * already claimed/processed and not yet expired.
   *
   * When a previously expired task is reclaimed, the optional `onTaskExpired`
   * callback is invoked with the old record before it is removed.
   */
  public async claimTask(
    title: string,
    options?: { ttlMs?: number },
  ): Promise<boolean> {
    const signature = this.computeSignature(title);
    const ttlMs = options?.ttlMs ?? this.defaultTtlMs;

    return await this.storage.withLock(`diary_${this.agentId}`, async () => {
      const state = await this.readDiary();
      const now = Date.now();

      const recordIndex = state.history.findIndex(
        (r) => r.signature === signature,
      );
      if (recordIndex !== -1) {
        const record = state.history[recordIndex];
        if (!this.isExpired(record, now)) {
          return false; // Task already exists and is not expired
        }
        // Fire the expiry hook before evicting the old record
        if (this.onTaskExpired) {
          await this.onTaskExpired(record);
        }
        state.history.splice(recordIndex, 1);
      }

      // Claim it immediately to prevent race conditions
      const record: TaskRecord = {
        title,
        signature,
        status: "pending",
        timestamp: now,
      };
      if (ttlMs !== undefined) {
        record.ttlMs = ttlMs;
      }

      state.history = [record, ...state.history].slice(0, this.maxHistory);
      state.seenSignatures = state.history.map((r) => r.signature);
      state.runCount += 1;
      state.lastRun = now;

      await this.storage.set(`diary_${this.agentId}`, state);
      return true;
    });
  }

  /**
   * Atomically claims multiple tasks in a single lock acquisition.
   * Much more efficient than calling claimTask() N times for batch workloads —
   * reduces round-trips to Redis/MongoDB/SQLite by a factor of N.
   *
   * Returns the subset of titles that were successfully claimed (new or expired).
   * Tasks already processed and not expired are skipped silently.
   */
  public async batchClaimTasks(
    titles: string[],
    options?: { ttlMs?: number },
  ): Promise<string[]> {
    const ttlMs = options?.ttlMs ?? this.defaultTtlMs;

    return await this.storage.withLock(`diary_${this.agentId}`, async () => {
      const state = await this.readDiary();
      const now = Date.now();
      const claimed: string[] = [];

      for (const title of titles) {
        const signature = this.computeSignature(title);
        const recordIndex = state.history.findIndex(
          (r) => r.signature === signature,
        );

        if (recordIndex !== -1) {
          const record = state.history[recordIndex];
          if (!this.isExpired(record, now)) {
            continue; // Already claimed and not expired — skip
          }
          // Fire the expiry hook before evicting the old record
          if (this.onTaskExpired) {
            await this.onTaskExpired(record);
          }
          state.history.splice(recordIndex, 1);
        }

        const record: TaskRecord = {
          title,
          signature,
          status: "pending",
          timestamp: now,
        };
        if (ttlMs !== undefined) {
          record.ttlMs = ttlMs;
        }

        state.history.unshift(record);
        claimed.push(title);
        state.runCount += 1;
      }

      if (claimed.length > 0) {
        state.history = state.history.slice(0, this.maxHistory);
        state.seenSignatures = state.history.map((r) => r.signature);
        state.lastRun = now;
        await this.storage.set(`diary_${this.agentId}`, state);
      }

      return claimed;
    });
  }

  /**
   * Checks if a task has already been processed by the agent.
   *
   * ⚠️ WARNING: This is a non-atomic read. In high-concurrency environments,
   * always follow this with claimTask() before acting on the result.
   */
  public async hasProcessedTask(title: string): Promise<boolean> {
    const signature = this.computeSignature(title);
    const state = await this.readDiary();
    const record = state.history.find((r) => r.signature === signature);
    if (!record) return false;
    return !this.isExpired(record, Date.now());
  }

  /**
   * Retrieves the stored result of a previously processed task, if available.
   *
   * ⚠️ WARNING: This is a non-atomic read. In high-concurrency environments,
   * always follow this with claimTask() before acting on the result.
   */
  public async getTaskResult(title: string): Promise<string | undefined> {
    const signature = this.computeSignature(title);
    const state = await this.readDiary();
    const record = state.history.find((r) => r.signature === signature);
    if (!record) return undefined;
    return this.isExpired(record, Date.now()) ? undefined : record.result;
  }

  /**
   * Filters out items that the agent has already processed.
   *
   * ⚠️ WARNING: filterNewTasks() is a non-atomic snapshot. Always follow it with claimTask()
   * to atomically claim ownership. Never act on filterNewTasks() results directly without claiming them first.
   */
  public async filterNewTasks<T extends { title: string }>(
    tasks: T[],
  ): Promise<T[]> {
    const state = await this.readDiary();
    const now = Date.now();
    return tasks.filter((task) => {
      const signature = this.computeSignature(task.title);
      const record = state.history.find((r) => r.signature === signature);
      if (!record) return true;
      return this.isExpired(record, now);
    });
  }

  /**
   * Updates a claimed task with its final result and marks it as "done".
   * Supports updating or setting the task's TTL.
   */
  public async writeTaskResult(
    title: string,
    result?: string,
    options?: { ttlMs?: number },
  ): Promise<void> {
    const signature = this.computeSignature(title);
    const ttlMs = options?.ttlMs ?? this.defaultTtlMs;

    await this.storage.withLock(`diary_${this.agentId}`, async () => {
      const state = await this.readDiary();

      const recordIndex = state.history.findIndex(
        (r) => r.signature === signature,
      );
      if (recordIndex !== -1) {
        // Capture timestamp once to ensure consistency between record and lastRun
        const now = Date.now();
        state.history[recordIndex].result = result;
        state.history[recordIndex].status = "done";
        state.history[recordIndex].timestamp = now;
        if (ttlMs !== undefined) {
          state.history[recordIndex].ttlMs = ttlMs;
        } else if (
          state.history[recordIndex].ttlMs === undefined &&
          this.defaultTtlMs !== undefined
        ) {
          state.history[recordIndex].ttlMs = this.defaultTtlMs;
        }
        state.lastRun = now;
        await this.storage.set(`diary_${this.agentId}`, state);
      } else {
        // If not claimed first, we throw a loud error
        throw new Error(
          `[AgentDiary] Task "${title}" was not claimed. Call claimTask() before writeTaskResult().`,
        );
      }
    });
  }

  /**
   * Marks a previously claimed task as "failed" with an optional reason string.
   * Failed tasks remain in history and can be queried or re-claimed.
   *
   * @param title - The task title (must have been previously claimed)
   * @param reason - Optional human-readable failure message
   * @throws If the task was never claimed
   */
  public async failTask(title: string, reason?: string): Promise<void> {
    const signature = this.computeSignature(title);

    await this.storage.withLock(`diary_${this.agentId}`, async () => {
      const state = await this.readDiary();
      const recordIndex = state.history.findIndex(
        (r) => r.signature === signature,
      );

      if (recordIndex === -1) {
        throw new Error(
          `[AgentDiary] Task "${title}" was not claimed. Call claimTask() before failTask().`,
        );
      }

      const now = Date.now();
      state.history[recordIndex].status = "failed";
      state.history[recordIndex].failReason = reason;
      state.history[recordIndex].timestamp = now;
      state.lastRun = now;

      await this.storage.set(`diary_${this.agentId}`, state);
    });
  }

  /**
   * Deletes a task from the diary so that it can be processed/run again.
   * Returns true if the task was found and deleted, false otherwise.
   */
  public async deleteTask(title: string): Promise<boolean> {
    const signature = this.computeSignature(title);

    return await this.storage.withLock(`diary_${this.agentId}`, async () => {
      const state = await this.readDiary();
      const initialLength = state.history.length;
      state.history = state.history.filter((r) => r.signature !== signature);

      if (state.history.length === initialLength) {
        return false;
      }

      state.seenSignatures = state.history.map((r) => r.signature);
      await this.storage.set(`diary_${this.agentId}`, state);
      return true;
    });
  }

  /**
   * Retrieves task records completed after a specific timestamp, excluding expired tasks.
   */
  public async getTasksCompletedSince(
    timestamp: number,
  ): Promise<TaskRecord[]> {
    const state = await this.readDiary();
    const now = Date.now();
    return state.history.filter((r) => {
      if (r.result === undefined || r.timestamp < timestamp) return false;
      return !this.isExpired(r, now);
    });
  }

  /**
   * Performs a case-insensitive substring search for task records in history, excluding expired tasks.
   */
  public async findTasksByKeyword(keyword: string): Promise<TaskRecord[]> {
    const state = await this.readDiary();
    const now = Date.now();
    const cleanKeyword = keyword.toLowerCase().trim();
    return state.history.filter((r) => {
      if (this.isExpired(r, now)) return false;
      const titleMatch = r.title.toLowerCase().includes(cleanKeyword);
      const resultMatch =
        r.result !== undefined && r.result.toLowerCase().includes(cleanKeyword);
      return titleMatch || resultMatch;
    });
  }

  /**
   * Returns a diagnostic summary of this agent's current diary state.
   * Counts are based on active (non-expired) records only.
   * Useful for monitoring dashboards and health checks.
   */
  public async getStats(): Promise<AgentStats> {
    const state = await this.readDiary();
    const now = Date.now();

    const activeHistory = state.history.filter(
      (r) => !this.isExpired(r, now),
    );

    const pendingCount = activeHistory.filter(
      (r) => (r.status ?? "pending") === "pending",
    ).length;
    const doneCount = activeHistory.filter(
      (r) => (r.status ?? "done") === "done",
    ).length;
    const failedCount = activeHistory.filter(
      (r) => r.status === "failed",
    ).length;

    const timestamps = activeHistory.map((r) => r.timestamp);

    return {
      agentId: this.agentId,
      runCount: state.runCount,
      historyCount: activeHistory.length,
      pendingCount,
      doneCount,
      failedCount,
      lastRunAt: state.lastRun,
      oldestTaskAt:
        timestamps.length > 0 ? Math.min(...timestamps) : undefined,
    };
  }

  /**
   * Scans history for expired task records, removes them atomically,
   * and returns the list of evicted records.
   *
   * Also triggers the `onTaskExpired` callback (if configured) for every
   * evicted record — making this a useful scheduled cleanup operation.
   *
   * @returns Array of TaskRecord entries that were pruned
   */
  public async pruneExpiredTasks(): Promise<TaskRecord[]> {
    return await this.storage.withLock(`diary_${this.agentId}`, async () => {
      const state = await this.readDiary();
      const now = Date.now();
      const expired: TaskRecord[] = [];

      state.history = state.history.filter((r) => {
        if (this.isExpired(r, now)) {
          expired.push(r);
          return false;
        }
        return true;
      });

      if (expired.length > 0) {
        state.seenSignatures = state.history.map((r) => r.signature);
        await this.storage.set(`diary_${this.agentId}`, state);

        // Fire expiry callbacks after state is safely written
        if (this.onTaskExpired) {
          for (const record of expired) {
            await this.onTaskExpired(record);
          }
        }
      }

      return expired;
    });
  }

  /**
   * Exports the full agent diary state as a plain serializable object.
   * Useful for backups, cross-environment migrations, or cross-agent sync.
   *
   * @example
   * const snapshot = await diary.exportHistory();
   * await otherDiary.importHistory(snapshot);
   */
  public async exportHistory(): Promise<AgentState> {
    return await this.readDiary();
  }

  /**
   * Imports a previously exported diary snapshot into this agent.
   *
   * @param snapshot - A state object previously returned by exportHistory()
   * @param options.merge - If true, merges the snapshot with existing history
   *   (tasks from snapshot not in current state are prepended). If false (default),
   *   replaces the current state entirely.
   */
  public async importHistory(
    snapshot: AgentState,
    options?: { merge?: boolean },
  ): Promise<void> {
    await this.storage.withLock(`diary_${this.agentId}`, async () => {
      if (options?.merge) {
        const current = await this.readDiary();
        const existingSignatures = new Set(
          current.history.map((r) => r.signature),
        );
        const newRecords = snapshot.history.filter(
          (r) => !existingSignatures.has(r.signature),
        );
        const merged: AgentState = {
          lastRun: Math.max(current.lastRun, snapshot.lastRun),
          runCount: current.runCount + snapshot.runCount,
          history: [...newRecords, ...current.history].slice(
            0,
            this.maxHistory,
          ),
          seenSignatures: [],
        };
        merged.seenSignatures = merged.history.map((r) => r.signature);
        await this.storage.set(`diary_${this.agentId}`, merged);
      } else {
        await this.storage.set(`diary_${this.agentId}`, {
          ...snapshot,
          history: snapshot.history.slice(0, this.maxHistory),
        });
      }
    });
  }

  /**
   * Clears the entire agent history and seen signatures.
   */
  public async clearHistory(): Promise<void> {
    await this.storage.withLock(`diary_${this.agentId}`, async () => {
      await this.storage.set(`diary_${this.agentId}`, this.emptyState());
    });
  }
}
