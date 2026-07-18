import { WorkerMetadata, WorkerStatus } from "../../shared/types";
import { SDK_VERSION } from "../../shared/constants";
import os from "os";
import process from "process";
import { randomUUID } from "crypto";

/**
 * Manages active worker registrations, heartbeats, hostnames, PIDs, and stale node pruning.
 */
export class WorkerRegistry {
  private workers = new Map<string, WorkerMetadata>();

  /**
   * Registers a new worker node.
   * @param options Worker metadata parameters.
   */
  async registerWorker(
    options: Partial<WorkerMetadata> = {},
  ): Promise<WorkerMetadata> {
    const workerId = options.workerId || randomUUID();
    const now = Date.now();
    const worker: WorkerMetadata = {
      workerId,
      hostname: options.hostname || os.hostname(),
      pid: options.pid || process.pid,
      version: options.version || SDK_VERSION,
      heartbeat: now,
      status: options.status || "active",
      startedTime: options.startedTime || now,
      lastActivity: options.lastActivity || now,
    };

    this.workers.set(workerId, worker);
    return { ...worker };
  }

  /** Unregisters a worker node. */
  async unregisterWorker(workerId: string): Promise<boolean> {
    return this.workers.delete(workerId);
  }

  /** Updates the heartbeat timestamp for a registered worker. */
  async heartbeat(workerId: string): Promise<boolean> {
    const worker = this.workers.get(workerId);
    if (!worker) return false;
    const now = Date.now();
    worker.heartbeat = now;
    worker.lastActivity = now;
    worker.status = "active";
    return true;
  }

  /** Updates the status of a worker process. */
  async setWorkerStatus(
    workerId: string,
    status: WorkerStatus,
  ): Promise<boolean> {
    const worker = this.workers.get(workerId);
    if (!worker) return false;
    worker.status = status;
    worker.lastActivity = Date.now();
    return true;
  }

  /** Retrieves worker metadata by ID. */
  async getWorker(workerId: string): Promise<WorkerMetadata | null> {
    const w = this.workers.get(workerId);
    return w ? { ...w } : null;
  }

  /** Lists all registered workers. */
  async listWorkers(): Promise<WorkerMetadata[]> {
    return Array.from(this.workers.values()).map((w) => ({ ...w }));
  }

  /** Prunes workers that have missed their heartbeat window. */
  async pruneStaleWorkers(
    maxInactivityMs: number = 30000,
  ): Promise<string[]> {
    const now = Date.now();
    const pruned: string[] = [];

    for (const [id, worker] of this.workers.entries()) {
      if (now - worker.heartbeat > maxInactivityMs) {
        worker.status = "offline";
        pruned.push(id);
      }
    }
    return pruned;
  }
}

export const defaultWorkerRegistry = new WorkerRegistry();
