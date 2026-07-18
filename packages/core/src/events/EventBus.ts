import { DomainEvents } from "@agent-diaries/shared";

export type EventHandler<T> = (payload: T) => void | Promise<void>;

export class EventBus {
  private handlers = new Map<keyof DomainEvents, Set<EventHandler<any>>>();

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

  public off<K extends keyof DomainEvents>(
    event: K,
    handler: EventHandler<DomainEvents[K]>,
  ): void {
    const set = this.handlers.get(event);
    if (set) {
      set.delete(handler);
    }
  }

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

  public removeAllListeners(event?: keyof DomainEvents): void {
    if (event) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }
}

export const defaultEventBus = new EventBus();
