import { StorageAdapter, LocalFileStorage } from "./storage";

export interface TaskRecord {
  title: string;
  signature: string; // A unique hash or normalized string to identify the task
  result?: string;
  timestamp: number;
  ttlMs?: number; // Optional TTL specific to this task run
}

export interface AgentState {
  lastRun: number;
  seenSignatures: string[];
  runCount: number;
  history: TaskRecord[];
}

export interface AgentDiaryOptions {
  agentId: string;
  storage?: StorageAdapter<AgentState>;
  maxHistory?: number;
  defaultTtlMs?: number; // Default TTL in milliseconds for claimed tasks
}

export class AgentDiary {
  private agentId: string;
  private storage: StorageAdapter<AgentState>;
  private maxHistory: number;
  private defaultTtlMs?: number;

  constructor(options: AgentDiaryOptions) {
    this.agentId = options.agentId;
    // Use local file storage by default if none provided
    this.storage = options.storage || new LocalFileStorage<AgentState>();
    this.maxHistory = options.maxHistory || 500;
    this.defaultTtlMs = options.defaultTtlMs;
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
   */
  public static normalizeSignature(title: string): string {
    return (title || "").toLowerCase().trim().replace(/\s+/g, " ");
  }

  /**
   * Reads the current diary state (without locking).
   */
  public async readDiary(): Promise<AgentState> {
    const state = await this.storage.get(`diary_${this.agentId}`);
    return state ?? this.emptyState();
  }

  /**
   * Atomically attempts to claim a task.
   * Returns true if successfully claimed (first time seen), false if already claimed/processed.
   */
  public async claimTask(
    title: string,
    options?: { ttlMs?: number },
  ): Promise<boolean> {
    const signature = AgentDiary.normalizeSignature(title);
    const ttlMs = options?.ttlMs ?? this.defaultTtlMs;

    return await this.storage.withLock(`diary_${this.agentId}`, async () => {
      const state = await this.readDiary();
      const now = Date.now();

      const recordIndex = state.history.findIndex(
        (r) => r.signature === signature,
      );
      if (recordIndex !== -1) {
        const record = state.history[recordIndex];
        const isExpired =
          record.ttlMs !== undefined && now - record.timestamp > record.ttlMs;
        if (!isExpired) {
          return false; // Task already exists and is not expired
        }
        // If expired, remove the old record from history so we can reclaim
        state.history.splice(recordIndex, 1);
      }

      // Claim it immediately to prevent race conditions
      const record: TaskRecord = {
        title,
        signature,
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
   * Checks if a task has already been processed by the agent.
   */
  public async hasProcessedTask(title: string): Promise<boolean> {
    const signature = AgentDiary.normalizeSignature(title);
    const state = await this.readDiary();
    const record = state.history.find((r) => r.signature === signature);
    if (!record) return false;
    const isExpired =
      record.ttlMs !== undefined &&
      Date.now() - record.timestamp > record.ttlMs;
    return !isExpired;
  }

  /**
   * Retrieves the stored result of a previously processed task, if available.
   */
  public async getTaskResult(title: string): Promise<string | undefined> {
    const signature = AgentDiary.normalizeSignature(title);
    const state = await this.readDiary();
    const record = state.history.find((r) => r.signature === signature);
    if (!record) return undefined;
    const isExpired =
      record.ttlMs !== undefined &&
      Date.now() - record.timestamp > record.ttlMs;
    return isExpired ? undefined : record.result;
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
      const signature = AgentDiary.normalizeSignature(task.title);
      const record = state.history.find((r) => r.signature === signature);
      if (!record) return true;
      const isExpired =
        record.ttlMs !== undefined && now - record.timestamp > record.ttlMs;
      return isExpired;
    });
  }

  /**
   * Updates a claimed task with its final result.
   */
  public async writeTaskResult(
    title: string,
    result?: string,
    options?: { ttlMs?: number },
  ): Promise<void> {
    const signature = AgentDiary.normalizeSignature(title);
    const ttlMs = options?.ttlMs ?? this.defaultTtlMs;

    await this.storage.withLock(`diary_${this.agentId}`, async () => {
      const state = await this.readDiary();

      const recordIndex = state.history.findIndex(
        (r) => r.signature === signature,
      );
      if (recordIndex !== -1) {
        state.history[recordIndex].result = result;
        state.history[recordIndex].timestamp = Date.now(); // update timestamp
        if (ttlMs !== undefined) {
          state.history[recordIndex].ttlMs = ttlMs;
        } else if (
          state.history[recordIndex].ttlMs === undefined &&
          this.defaultTtlMs !== undefined
        ) {
          state.history[recordIndex].ttlMs = this.defaultTtlMs;
        }
        state.lastRun = Date.now();
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
   * Deletes a task from the diary so that it can be processed/run again.
   * Returns true if the task was found and deleted, false otherwise.
   */
  public async deleteTask(title: string): Promise<boolean> {
    const signature = AgentDiary.normalizeSignature(title);

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
      const isExpired = r.ttlMs !== undefined && now - r.timestamp > r.ttlMs;
      return !isExpired;
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
      const isExpired = r.ttlMs !== undefined && now - r.timestamp > r.ttlMs;
      if (isExpired) return false;
      const titleMatch = r.title.toLowerCase().includes(cleanKeyword);
      const resultMatch =
        r.result !== undefined && r.result.toLowerCase().includes(cleanKeyword);
      return titleMatch || resultMatch;
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
