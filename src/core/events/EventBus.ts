import { DomainEvents } from "../../shared/types";

export type EventHandler<T> = (payload: T) => void | Promise<void>;

/**
 * Strongly-typed pub-sub event bus for domain event dispatching and observability.
 *
 * @example
 * ```typescript
 * const bus = new EventBus();
 * bus.on("WorkflowCompleted", ({ workflowId }) => {
 *   console.log("Workflow completed:", workflowId);
 * });
 * ```
 */
export class EventBus {
  private handlers = new Map<keyof DomainEvents, Set<EventHandler<any>>>();

  /**
   * Subscribes an event handler to a domain event.
   *
   * @param event The event key to listen for.
   * @param handler The handler callback function.
   * @returns Unsubscribe function.
   */
  public on<K extends keyof DomainEvents>(
    event: K,
    handler: EventHandler<DomainEvents[K]>,
  ): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    const set = this.handlers.get(event)!;
    set.add(handler);

    return () => this.off(event, handler);
  }

  /**
   * Removes an event handler subscription.
   */
  public off<K extends keyof DomainEvents>(
    event: K,
    handler: EventHandler<DomainEvents[K]>,
  ): void {
    const set = this.handlers.get(event);
    if (set) {
      set.delete(handler);
    }
  }

  /**
   * Subscribes a one-time handler that auto-unsubscribes after first execution.
   */
  public once<K extends keyof DomainEvents>(
    event: K,
    handler: EventHandler<DomainEvents[K]>,
  ): () => void {
    const wrapper: EventHandler<DomainEvents[K]> = async (payload) => {
      this.off(event, wrapper);
      await handler(payload);
    };
    return this.on(event, wrapper);
  }

  /**
   * Asynchronously emits a domain event payload to all registered listeners.
   */
  public async emit<K extends keyof DomainEvents>(
    event: K,
    payload: DomainEvents[K],
  ): Promise<void> {
    const set = this.handlers.get(event);
    if (!set || set.size === 0) return;

    const listeners = Array.from(set);
    await Promise.all(
      listeners.map(async (handler) => {
        try {
          await handler(payload);
        } catch (err) {
          console.error(`[EventBus] Unhandled error in listener for event "${String(event)}":`, err);
        }
      }),
    );
  }

  /**
   * Removes all registered event listeners.
   */
  public removeAllListeners(event?: keyof DomainEvents): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }
}

export const defaultEventBus = new EventBus();
