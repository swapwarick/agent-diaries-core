import { StorageAdapter, LocalFileStorage } from './storage';

export interface TaskRecord {
  title: string;
  signature: string; // A unique hash or normalized string to identify the task
  result?: string;
  timestamp: number;
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
}

export class AgentDiary {
  private agentId: string;
  private storage: StorageAdapter<AgentState>;
  private maxHistory: number;

  constructor(options: AgentDiaryOptions) {
    this.agentId = options.agentId;
    // Use local file storage by default if none provided
    this.storage = options.storage || new LocalFileStorage<AgentState>();
    this.maxHistory = options.maxHistory || 500;
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
    return (title || '').toLowerCase().trim().replace(/\s+/g, ' ');
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
  public async claimTask(title: string): Promise<boolean> {
    const signature = AgentDiary.normalizeSignature(title);
    
    return await this.storage.withLock(`diary_${this.agentId}`, async () => {
      const state = await this.readDiary();
      
      const seenSet = new Set(state.seenSignatures);
      if (seenSet.has(signature)) {
        return false; // Task already exists
      }

      // Claim it immediately to prevent race conditions
      const record: TaskRecord = {
        title,
        signature,
        timestamp: Date.now()
      };

      state.history = [record, ...state.history].slice(0, this.maxHistory);
      // Fix Desync Bug: seenSignatures is strictly derived from the sliced history
      state.seenSignatures = state.history.map(r => r.signature);
      state.runCount += 1;
      state.lastRun = Date.now();

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
    const seenSet = new Set(state.seenSignatures);
    return seenSet.has(signature);
  }

  /**
   * Retrieves the stored result of a previously processed task, if available.
   */
  public async getTaskResult(title: string): Promise<string | undefined> {
    const signature = AgentDiary.normalizeSignature(title);
    const state = await this.readDiary();
    const record = state.history.find(r => r.signature === signature);
    return record?.result;
  }

  /**
   * Filters out items that the agent has already processed.
   * 
   * ⚠️ WARNING: filterNewTasks() is a non-atomic snapshot. Always follow it with claimTask()
   * to atomically claim ownership. Never act on filterNewTasks() results directly without claiming them first.
   */
  public async filterNewTasks<T extends { title: string }>(tasks: T[]): Promise<T[]> {
    const state = await this.readDiary();
    const seenSet = new Set(state.seenSignatures);
    return tasks.filter(task => {
      const signature = AgentDiary.normalizeSignature(task.title);
      return !seenSet.has(signature);
    });
  }

  /**
   * Updates a claimed task with its final result.
   */
  public async writeTaskResult(title: string, result?: string): Promise<void> {
    const signature = AgentDiary.normalizeSignature(title);

    await this.storage.withLock(`diary_${this.agentId}`, async () => {
      const state = await this.readDiary();
      
      const recordIndex = state.history.findIndex(r => r.signature === signature);
      if (recordIndex !== -1) {
        state.history[recordIndex].result = result;
        state.history[recordIndex].timestamp = Date.now(); // update timestamp
        state.lastRun = Date.now();
        await this.storage.set(`diary_${this.agentId}`, state);
      } else {
        // If not claimed first, we insert it
        const record: TaskRecord = { title, signature, result, timestamp: Date.now() };
        state.history = [record, ...state.history].slice(0, this.maxHistory);
        state.seenSignatures = state.history.map(r => r.signature);
        state.runCount += 1;
        state.lastRun = Date.now();
        await this.storage.set(`diary_${this.agentId}`, state);
      }
    });
  }
}
