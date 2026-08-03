import {
  StorageAdapter,
  LocalFileStorage,
  MemoryCacheProvider,
  MemoryLockProvider,
  MemoryPersistenceProvider,
} from "./memory";
import {
  StorageManager,
  DiaryRepository,
  defaultEventBus,
} from "./core";
import {
  TaskRecord,
  AgentState,
  AgentStats,
  TaskListOptions,
  AgentDiaryOptions,
} from "./shared";

export type {
  TaskRecord,
  AgentState,
  AgentStats,
  TaskListOptions,
  AgentDiaryOptions,
};

/**
 * High-level persistent memory diary for autonomous AI agents.
 * 
 * Provides atomic task deduplication, status tracking, expiration TTLs,
 * and lock-safe concurrent execution across multi-agent swarms.
 *
 * @example
 * ```typescript
 * const diary = new AgentDiary({ agentId: "data-collector" });
 * const claimed = await diary.claimTask("Download Q3 Financial Report");
 * if (claimed) {
 *   await diary.writeTaskResult("Download Q3 Financial Report", "Success");
 * }
 * ```
 */
export class AgentDiary {
  private agentId: string;
  private storage: StorageAdapter<AgentState>;
  private storageManager: StorageManager;
  private diaryRepo: DiaryRepository;
  private maxHistory: number;
  private defaultTtlMs?: number;
  private hashFn?: (title: string) => string;
  private onTaskExpired?: (record: TaskRecord) => void | Promise<void>;

  /**
   * Initializes a new `AgentDiary` instance.
   *
   * @param options Configuration options including agent ID, storage adapter, and TTL settings.
   */
  constructor(options: AgentDiaryOptions) {
    this.agentId = options.agentId;
    this.storage = options.storage || new LocalFileStorage<AgentState>();
    this.storageManager = new StorageManager({
      legacyAdapter: this.storage,
    });
    this.diaryRepo = new DiaryRepository(this.storageManager, defaultEventBus);
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
   * Normalizes a task title into a standardized signature string.
   *
   * @param title The raw task title string.
   * @returns Lowercased, whitespace-trimmed signature.
   */
  public static normalizeSignature(title: string): string {
    return (title || "").toLowerCase().trim().replace(/\s+/g, " ");
  }

  private computeSignature(title: string): string {
    return this.hashFn
      ? this.hashFn(title)
      : AgentDiary.normalizeSignature(title);
  }

  private isExpired(record: TaskRecord, now: number): boolean {
    return record.ttlMs !== undefined && now - record.timestamp > record.ttlMs;
  }

  private getRecordStatus(record: TaskRecord): TaskRecord["status"] {
    if (record.status) {
      return record.status;
    }
    return record.result !== undefined ? "done" : "pending";
  }

  private buildTaskView(
    records: TaskRecord[],
    options?: TaskListOptions,
  ): TaskRecord[] {
    const statuses = Array.isArray(options?.status)
      ? options?.status
      : options?.status
        ? [options.status]
        : undefined;

    const limit =
      options?.limit !== undefined ? Math.max(0, options.limit) : undefined;
    const offset =
      options?.offset !== undefined ? Math.max(0, options.offset) : 0;

    let filtered = records;
    if (!options?.includeExpired) {
      const now = Date.now();
      filtered = filtered.filter((record) => !this.isExpired(record, now));
    }

    if (statuses) {
      filtered = filtered.filter((record) =>
        statuses.includes(this.getRecordStatus(record)),
      );
    }

    const sliced = filtered.slice(offset);
    return limit === undefined ? sliced : sliced.slice(0, limit);
  }

  /**
   * Reads the current raw agent diary state.
   *
   * @returns Promise resolving to the AgentState structure.
   */
  public async readDiary(): Promise<AgentState> {
    const state = await this.diaryRepo.loadDiary(this.agentId);
    return state ?? this.emptyState();
  }

  private async writeDiary(state: AgentState): Promise<void> {
    await this.diaryRepo.saveDiary(this.agentId, state);
  }

  /**
   * Executes a function exactly once for a given task title, across any number of concurrent agents.
   *
   * If the task has already been executed, returns the cached result immediately without calling `fn`.
   * If the task is new, claims it atomically, calls `fn`, stores the result, and returns it.
   * If another agent is currently executing the same task, waits for the lock, then returns the cached result.
   *
   * This is the primary API for most use cases. Use `claimTask` / `writeTaskResult` directly
   * only when you need manual control over the claim–execute–record cycle.
   *
   * @param title A unique string identifying this task (e.g. `"research:openai-q4-2024"`).
   * @param fn The async function to execute exactly once. Its return value is stored as the result.
   * @param options Optional TTL settings.
   * @returns The result of `fn`, or the previously cached result if the task was already completed.
   *
   * @example
   * ```typescript
   * const diary = new AgentDiary({ agentId: "researcher" });
   *
   * // 100 agents can call this simultaneously.
   * // Only ONE will call the LLM. The rest return instantly from cache.
   * const report = await diary.executeOnce("summarize:q4-earnings", async () => {
   *   return await callLLM("Summarize Q4 earnings...");
   * });
   * ```
   */
  public async executeOnce<T = string>(
    title: string,
    fn: () => Promise<T>,
    options?: { ttlMs?: number },
  ): Promise<T | undefined> {
    const signature = this.computeSignature(title);
    const ttlMs = options?.ttlMs ?? this.defaultTtlMs;

    return await this.storage.withLock(`diary_${this.agentId}`, async () => {
      const state = await this.readDiary();
      const now = Date.now();

      const recordIndex = state.history.findIndex(
        (r: TaskRecord) => r.signature === signature,
      );

      if (recordIndex !== -1) {
        const record = state.history[recordIndex];
        if (!this.isExpired(record, now)) {
          // Task already completed — return cached result immediately
          return record.result as unknown as T | undefined;
        }
        if (this.onTaskExpired) {
          await this.onTaskExpired(record);
        }
        state.history.splice(recordIndex, 1);
      }

      // Claim the task
      const claimRecord: TaskRecord = {
        title,
        signature,
        status: "pending",
        timestamp: now,
      };
      if (ttlMs !== undefined) {
        claimRecord.ttlMs = ttlMs;
      }
      state.history = [claimRecord, ...state.history].slice(0, this.maxHistory);
      state.seenSignatures = state.history.map((r: TaskRecord) => r.signature);
      state.runCount += 1;
      state.lastRun = now;
      await this.writeDiary(state);

      // Execute and record result
      let result: T;
      try {
        result = await fn();
      } catch (err) {
        // Mark as failed, then rethrow so the caller knows
        const failState = await this.readDiary();
        const idx = failState.history.findIndex((r: TaskRecord) => r.signature === signature);
        if (idx !== -1) {
          failState.history[idx].status = "failed";
          failState.history[idx].failReason =
            err instanceof Error ? err.message : String(err);
          failState.history[idx].timestamp = Date.now();
          await this.writeDiary(failState);
        }
        throw err;
      }

      // Persist the result
      const doneState = await this.readDiary();
      const idx = doneState.history.findIndex((r: TaskRecord) => r.signature === signature);
      if (idx !== -1) {
        const resultStr = typeof result === "string" ? result : JSON.stringify(result);
        doneState.history[idx].result = resultStr;
        doneState.history[idx].status = "done";
        doneState.history[idx].timestamp = Date.now();
        if (ttlMs !== undefined) {
          doneState.history[idx].ttlMs = ttlMs;
        }
        doneState.lastRun = Date.now();
        await this.writeDiary(doneState);
      }

      return result;
    });
  }

  /**
   * Atomically claims a task for execution under a distributed lock.
   *
   * @param title The task title to claim.
   * @param options Per-task TTL options.
   * @returns Promise resolving to `true` if claimed successfully, `false` if already claimed/processed.
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
        (r: TaskRecord) => r.signature === signature,
      );
      if (recordIndex !== -1) {
        const record = state.history[recordIndex];
        if (!this.isExpired(record, now)) {
          return false;
        }
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

      state.history = [record, ...state.history].slice(0, this.maxHistory);
      state.seenSignatures = state.history.map((r: TaskRecord) => r.signature);
      state.runCount += 1;
      state.lastRun = now;

      await this.writeDiary(state);
      return true;
    });
  }

  /**
   * Atomically claims a batch of task titles in a single lock session.
   *
   * @param titles Array of task titles to claim.
   * @param options Per-batch TTL options.
   * @returns Promise resolving to an array of successfully claimed titles.
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
          (r: TaskRecord) => r.signature === signature,
        );

        if (recordIndex !== -1) {
          const record = state.history[recordIndex];
          if (!this.isExpired(record, now)) {
            continue;
          }
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
        state.seenSignatures = state.history.map((r: TaskRecord) => r.signature);
        state.lastRun = now;
        await this.writeDiary(state);
      }

      return claimed;
    });
  }

  /**
   * Checks whether a task has already been processed and is active.
   *
   * @param title The task title to query.
   * @returns Promise resolving to `true` if processed, `false` otherwise.
   */
  public async hasProcessedTask(title: string): Promise<boolean> {
    const signature = this.computeSignature(title);
    const state = await this.readDiary();
    const record = state.history.find((r: TaskRecord) => r.signature === signature);
    if (!record) return false;
    return !this.isExpired(record, Date.now());
  }

  /**
   * Retrieves the saved string result of a previously completed task.
   *
   * @param title The task title to query.
   * @returns Promise resolving to the result string, or `undefined` if missing/expired.
   */
  public async getTaskResult(title: string): Promise<string | undefined> {
    const signature = this.computeSignature(title);
    const state = await this.readDiary();
    const record = state.history.find((r: TaskRecord) => r.signature === signature);
    if (!record) return undefined;
    return this.isExpired(record, Date.now()) ? undefined : record.result;
  }

  /**
   * Filters an array of objects containing task titles, returning only new/unseen tasks.
   *
   * @param tasks Array of task objects containing a `title` property.
   * @returns Promise resolving to array of unseen task objects.
   */
  public async filterNewTasks<T extends { title: string }>(
    tasks: T[],
  ): Promise<T[]> {
    const state = await this.readDiary();
    const now = Date.now();
    return tasks.filter((task) => {
      const signature = this.computeSignature(task.title);
      const record = state.history.find((r: TaskRecord) => r.signature === signature);
      if (!record) return true;
      return this.isExpired(record, now);
    });
  }

  /**
   * Writes the final execution result for a previously claimed task.
   *
   * @param title The task title.
   * @param result The result string output from LLM/execution logic.
   * @param options Per-task TTL options.
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
        (r: TaskRecord) => r.signature === signature,
      );
      if (recordIndex !== -1) {
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
        await this.writeDiary(state);
      } else {
        throw new Error(
          `[AgentDiary] Task "${title}" was not claimed. Call claimTask() before writeTaskResult().`,
        );
      }
    });
  }

  /**
   * Marks a claimed task as failed with an optional error reason.
   *
   * @param title The task title.
   * @param reason The error or failure message.
   */
  public async failTask(title: string, reason?: string): Promise<void> {
    const signature = this.computeSignature(title);

    await this.storage.withLock(`diary_${this.agentId}`, async () => {
      const state = await this.readDiary();
      const recordIndex = state.history.findIndex(
        (r: TaskRecord) => r.signature === signature,
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

      await this.writeDiary(state);
    });
  }

  /**
   * Deletes a task entry from the diary history.
   *
   * @param title The task title to delete.
   * @returns Promise resolving to `true` if deleted, `false` if not found.
   */
  public async deleteTask(title: string): Promise<boolean> {
    const signature = this.computeSignature(title);

    return await this.storage.withLock(`diary_${this.agentId}`, async () => {
      const state = await this.readDiary();
      const initialLength = state.history.length;
      state.history = state.history.filter((r: TaskRecord) => r.signature !== signature);

      if (state.history.length === initialLength) {
        return false;
      }

      state.seenSignatures = state.history.map((r: TaskRecord) => r.signature);
      await this.writeDiary(state);
      return true;
    });
  }

  /**
   * Retrieves all completed tasks recorded after a given timestamp.
   *
   * @param timestamp The starting millisecond timestamp.
   * @returns Array of matching TaskRecord items.
   */
  public async getTasksCompletedSince(
    timestamp: number,
  ): Promise<TaskRecord[]> {
    const state = await this.readDiary();
    const now = Date.now();
    return state.history.filter((r: TaskRecord) => {
      if (r.result === undefined || r.timestamp < timestamp) return false;
      return !this.isExpired(r, now);
    });
  }

  /**
   * Searches active task history by keyword matching title or result content.
   *
   * @param keyword Search keyword.
   * @returns Array of matching TaskRecord items.
   */
  public async findTasksByKeyword(keyword: string): Promise<TaskRecord[]> {
    const state = await this.readDiary();
    const now = Date.now();
    const cleanKeyword = keyword.toLowerCase().trim();
    return state.history.filter((r: TaskRecord) => {
      if (this.isExpired(r, now)) return false;
      const titleMatch = r.title.toLowerCase().includes(cleanKeyword);
      const resultMatch =
        r.result !== undefined && r.result.toLowerCase().includes(cleanKeyword);
      return titleMatch || resultMatch;
    });
  }

  /**
   * Returns live health and performance statistics for this agent instance.
   *
   * @returns AgentStats summary structure.
   */
  public async getStats(): Promise<AgentStats> {
    const state = await this.readDiary();
    const now = Date.now();

    const activeHistory = state.history.filter(
      (r: TaskRecord) => !this.isExpired(r, now),
    );

    const pendingCount = activeHistory.filter(
      (r: TaskRecord) => this.getRecordStatus(r) === "pending",
    ).length;
    const doneCount = activeHistory.filter(
      (r: TaskRecord) => this.getRecordStatus(r) === "done",
    ).length;
    const failedCount = activeHistory.filter(
      (r: TaskRecord) => this.getRecordStatus(r) === "failed",
    ).length;

    const timestamps = activeHistory.map((r: TaskRecord) => r.timestamp);

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
   * Lists tasks with optional status filtering, pagination limits, and offset options.
   *
   * @param options TaskListOptions for filtering and pagination.
   * @returns Array of matching TaskRecord items.
   */
  public async listTasks(options?: TaskListOptions): Promise<TaskRecord[]> {
    const state = await this.readDiary();
    return this.buildTaskView(state.history, options);
  }

  /**
   * Lists tasks filtered by a specific status.
   *
   * @param status Task status to filter ("pending" | "done" | "failed").
   * @param options Pagination options.
   * @returns Array of matching TaskRecord items.
   */
  public async getTasksByStatus(
    status: TaskRecord["status"],
    options?: Omit<TaskListOptions, "status">,
  ): Promise<TaskRecord[]> {
    return await this.listTasks({ ...options, status });
  }

  /**
   * Convenience helper to list pending tasks.
   */
  public async getPendingTasks(
    options?: Omit<TaskListOptions, "status">,
  ): Promise<TaskRecord[]> {
    return await this.getTasksByStatus("pending", options);
  }

  /**
   * Convenience helper to list completed tasks.
   */
  public async getDoneTasks(
    options?: Omit<TaskListOptions, "status">,
  ): Promise<TaskRecord[]> {
    return await this.getTasksByStatus("done", options);
  }

  /**
   * Convenience helper to list failed tasks.
   */
  public async getFailedTasks(
    options?: Omit<TaskListOptions, "status">,
  ): Promise<TaskRecord[]> {
    return await this.getTasksByStatus("failed", options);
  }

  /**
   * Scans and prunes expired tasks from history.
   *
   * @returns Array of pruned expired TaskRecord items.
   */
  public async pruneExpiredTasks(): Promise<TaskRecord[]> {
    return await this.storage.withLock(`diary_${this.agentId}`, async () => {
      const state = await this.readDiary();
      const now = Date.now();
      const expired: TaskRecord[] = [];

      state.history = state.history.filter((r: TaskRecord) => {
        if (this.isExpired(r, now)) {
          expired.push(r);
          return false;
        }
        return true;
      });

      if (expired.length > 0) {
        state.seenSignatures = state.history.map((r: TaskRecord) => r.signature);
        await this.writeDiary(state);

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
   * Exports a complete snapshot of the current agent state.
   */
  public async exportHistory(): Promise<AgentState> {
    return await this.readDiary();
  }

  /**
   * Imports an agent state snapshot into the diary.
   *
   * @param snapshot The state structure to restore.
   * @param options Merge behavior options.
   */
  public async importHistory(
    snapshot: AgentState,
    options?: { merge?: boolean },
  ): Promise<void> {
    await this.storage.withLock(`diary_${this.agentId}`, async () => {
      if (options?.merge) {
        const current = await this.readDiary();
        const existingSignatures = new Set(
          current.history.map((r: TaskRecord) => r.signature),
        );
        const newRecords = snapshot.history.filter(
          (r: TaskRecord) => !existingSignatures.has(r.signature),
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
        merged.seenSignatures = merged.history.map((r: TaskRecord) => r.signature);
        await this.writeDiary(merged);
      } else {
        await this.writeDiary({
          ...snapshot,
          history: snapshot.history.slice(0, this.maxHistory),
        });
      }
    });
  }

  /**
   * Clears all diary state and history.
   */
  public async clearHistory(): Promise<void> {
    await this.storage.withLock(`diary_${this.agentId}`, async () => {
      await this.writeDiary(this.emptyState());
    });
  }
}
