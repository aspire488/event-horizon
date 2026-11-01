import type { CosmicEvent, EventKind } from './types';

export class EventLog {
  readonly events: CosmicEvent[] = [];
  onChange: (() => void) | null = null;
  private nextId = 1;
  private readonly listeners = new Set<(event: CosmicEvent) => void>();
  private lastKeyAt = new Map<string, number>();

  constructor(private readonly capacity = 60) {}

  /**
   * Records an event. `cooldownKey` suppresses repeats (e.g. one absorption
   * message per black hole every few seconds) so the feed stays meaningful.
   */
  push(
    kind: EventKind,
    text: string,
    x: number,
    y: number,
    at: number,
    cooldownKey?: string,
    cooldown = 2.5,
  ): CosmicEvent | null {
    if (cooldownKey) {
      const last = this.lastKeyAt.get(cooldownKey);
      // `at >= last`: rewind/undo move sim time backwards; a stale future
      // timestamp must not silence this key until time catches up again.
      if (last !== undefined && at >= last && at - last < cooldown) return null;
      this.lastKeyAt.set(cooldownKey, at);
    }
    const event: CosmicEvent = { id: this.nextId++, at, kind, text, x, y };
    this.events.unshift(event);
    if (this.events.length > this.capacity) this.events.length = this.capacity;
    this.onChange?.();
    // Listeners run inside the physics step: one failing observer must not
    // abort the step and stop the animation loop.
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error(error);
      }
    }
    return event;
  }

  /** Observes every recorded (non-suppressed) event. Returns an unsubscribe. */
  subscribe(listener: (event: CosmicEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  clear(): void {
    this.events.length = 0;
    this.lastKeyAt.clear();
    this.onChange?.();
  }
}
